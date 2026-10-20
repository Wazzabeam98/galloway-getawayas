'use client';

import { notify } from '@/lib/notify';
import ConversationRow from '@/components/messages/ConversationRow';
import { recountBadges } from '@/components/base/useBadgeCounts';
import ProviderReservationCard, { type ReservationCardData } from '@/components/services/ProviderReservationCard';
import ManageReservationSheet from '@/components/dashboard/reservation/ManageReservationSheet';
import RequestChangeRow from '@/components/trips/RequestChangeRow';
import StayCancelRow from '@/components/trips/StayCancelRow';
import { stayHasEnded, stayHasStarted } from '@/lib/stayWindow';
import { ukDateTime } from '@/lib/dayKey';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Link from 'next/link';
import Logo from '@/components/base/Logo';
import LoginModel from '@/components/auth/LoginModel';
import { getImageUrl, capitializeFirst } from '@/lib/utils';
import { toast } from 'react-toastify';
import { hasSecretTokens } from '@/lib/messageSecrets';
import PushPrompt from '@/components/pwa/PushPrompt';
import { Search, Inbox, Send, Zap, Phone, ExternalLink, ChevronLeft, Info } from 'lucide-react';

// A conversation's identity is now "kind:id" — booking, enquiry or order — so the
// one inbox can carry all three. This splits it back apart for routing.
function splitKey(key: string | null): { kind: 'booking' | 'enquiry' | 'order'; id: string } {
    if (!key) return { kind: 'booking', id: '' };
    const i = key.indexOf(':');
    if (i < 0) return { kind: 'booking', id: key };   // legacy bare bookingId
    return { kind: key.slice(0, i) as any, id: key.slice(i + 1) };
}
const THREAD_GET: Record<string, (id: string) => string> = {
    booking: (id) => '/api/messages/threads/' + id,
    enquiry: (id) => '/api/messages/enquiry/' + id,
    order: (id) => '/api/messages/order/' + id,
};

export default function MessagesInboxPage() {
    const supabase = createClientComponentClient();

    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<any>(null);
    const [conversations, setConversations] = useState<any[]>([]);

    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState<
        'all' | 'unread' | 'needsReply' | 'starred' | 'archived'
    >('all');
    // What the thread is about, as Airbnb's Messages tabs sort it: a stay
    // (Homes), an experience order, or a trade job (Services). Sits alongside
    // the filter above — Homes + Unread is the unread stays.
    const [category, setCategory] = useState<'all' | 'homes' | 'experiences' | 'services'>('all');
    // Which rows have a menu action in flight. One entry per conversation
    // rather than a single id: two rows acted on at once are independent, and
    // a shared flag would have let the second one finish and re-enable the
    // first while it was still saving.
    const [busy, setBusy] = useState<Record<string, boolean>>({});

    const [activeId, setActiveId] = useState<string | null>(null);
    const [thread, setThread] = useState<any>(null);
    const [threadLoading, setThreadLoading] = useState(false);
    const [threadError, setThreadError] = useState('');
    // On a phone the two panes are two screens, so which one is showing has
    // to be tracked. On a desktop this is ignored entirely.
    const [mobileOpen, setMobileOpen] = useState(false);
    const [showDetails, setShowDetails] = useState(false);

    const [text, setText] = useState('');
    const [sending, setSending] = useState(false);
    // Sending a message is one of the moments notifications are offered: the
    // card appears above the composer after the first send (PushPrompt decides
    // whether there is anything to ask).
    const [askPush, setAskPush] = useState(false);
    const [quickReplies, setQuickReplies] = useState<any[]>([]);
    const [showQuick, setShowQuick] = useState(false);

    // The scrollable message list itself, not the page. Asking the browser to
    // reveal an element scrolls whatever container it likes — which dragged
    // the whole page down past the footer every time a thread opened.
    const scrollRef = useRef<HTMLDivElement>(null);
    const mobileScrollRef = useRef<HTMLDivElement>(null);

    // The composers. Both are in the DOM at once — the three-pane layout and
    // the phone one — and they share `text`, so they are grown together.
    const composerRef = useRef<HTMLTextAreaElement>(null);
    const mobileComposerRef = useRef<HTMLTextAreaElement>(null);

    // The conversation the person themselves chose (clicked, or asked for by
    // link). Only that one is marked read as new messages arrive in it; the one
    // the page puts on screen by itself on load is not theirs until they click.
    const chosenKey = useRef<string | null>(null);

    // rows={1} does not mean "one line and then grow" — it means one line and
    // then scroll, which hides what the host has already written from them.
    // So on every change the box is collapsed and given back exactly the
    // height its content needs. max-h-32 caps it at about six lines, and past
    // that the textarea's own overflow takes over and it scrolls, which is the
    // right behaviour for a genuinely long message.
    useEffect(() => {
        [composerRef.current, mobileComposerRef.current].forEach((el) => {
            if (!el) return;
            el.style.height = 'auto';
            // scrollHeight counts the padding but not the border, and these
            // boxes are border-box — so height alone leaves the border with
            // nowhere to go and the box can be nudged by 2px even when empty.
            const style = getComputedStyle(el);
            const border =
                parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
            el.style.height = el.scrollHeight + border + 'px';
        });
    }, [text]);

    useEffect(() => {
        const load = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setSession(session);

            if (!session?.user) {
                setLoading(false);
                return;
            }

            const res = await fetch('/api/messages/threads');
            const data = res.ok ? await res.json() : { conversations: [] };
            const convos = data.conversations || [];
            setConversations(convos);

            const { data: replies } = await supabase
                .from('quick_replies')
                .select('id, title, body')
                .eq('user_id', session.user.id)
                .order('created_at', { ascending: true });
            setQuickReplies(replies || []);

            // Arriving from a Message guest button, which names the booking
            // it wants: /messages?b=<bookingId>, and optionally a draft to
            // put in the composer. Every booking has a conversation here —
            // the list is built from bookings, not from messages — so a
            // named one is always found.
            const params = new URLSearchParams(window.location.search);
            const wanted = params.get('b');
            // ?o=<orderId>: the experience order detail page's "Message the host"
            // link, so the one conversation for that order opens here rather than
            // in a second thread on that page.
            const wantedOrder = params.get('o');
            // ?e=<enquiryId>: a Message button on a trade job (host or provider
            // side), so the three-pane opens on that enquiry rather than the old
            // single-thread page.
            const wantedEnquiry = params.get('e');
            const draft = params.get('draft');
            if (draft) setText(draft);

            const asked = wanted
                ? convos.find((c: any) => c.bookingId === wanted)
                : wantedOrder
                    ? convos.find((c: any) => c.kind === 'order' && c.id === wantedOrder)
                    : wantedEnquiry
                        ? convos.find((c: any) => c.kind === 'enquiry' && c.id === wantedEnquiry)
                        : null;

            // Something archived is out of the inbox, so the row for it would
            // not be in the list beside the thread. Show the archive instead
            // of an open conversation with nothing selected next to it.
            if (asked && asked.archived) setFilter('archived');

            // Otherwise open whichever conversation is waiting on them, so
            // the page lands on something useful rather than an empty pane.
            const first =
                asked ||
                convos.find((c: any) => c.unread > 0) ||
                convos.find((c: any) => c.needsReply) ||
                convos[0];

            // Pre-selects for the desktop's middle pane. mobileOpen stays
            // false unless they asked for this one by name, so a phone lands
            // on the list — but lands on the conversation they clicked.
            if (first) {
                // Marking read follows somebody choosing a conversation, not the
                // page choosing one for them: marking a conversation unread and
                // reloading must not land on it and quietly read it again. Asking
                // for one by name (a link from an email or a push) is choosing it.
                if (asked) {
                    setMobileOpen(true);
                    markRead(first.key);
                }
                setActiveId(first.key);
            }

            setLoading(false);
        };
        load();
    }, [supabase]);

    // Load whichever conversation is selected.
    useEffect(() => {
        if (!activeId) return;

        let cancelled = false;
        setThreadLoading(true);
        setThreadError('');

        const { kind, id } = splitKey(activeId);
        const load = async () => {
            try {
                const res = await fetch(THREAD_GET[kind](id));

                // A failure that looks identical to "nothing selected" is
                // impossible to diagnose, so say what actually happened.
                if (!res.ok) {
                    if (!cancelled) {
                        setThread(null);
                        setThreadError(
                            res.status === 404
                                ? 'That conversation could not be found.'
                                : 'Could not load this conversation (' + res.status + ').'
                        );
                        setThreadLoading(false);
                    }
                    return;
                }

                const data = await res.json();
                if (cancelled) return;

                if (!data || !data.ok) {
                    setThread(null);
                    setThreadError((data && data.error) || 'Could not load this conversation.');
                    setThreadLoading(false);
                    return;
                }

                setThread(data);
            } catch (err: any) {
                if (!cancelled) {
                    setThread(null);
                    setThreadError('Could not reach the server.');
                }
            }
            if (!cancelled) setThreadLoading(false);
        };

        load();
        return () => {
            cancelled = true;
        };
    }, [activeId]);

    // New messages arrive without a refresh.
    useEffect(() => {
        if (!activeId) return;

        const { kind, id } = splitKey(activeId);
        const channel = supabase
            .channel('thread-' + activeId)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'messages',
                    filter: kind + '_id=eq.' + id,
                },
                (payload: any) => {
                    // A check-in message holds placeholders for the door code and
                    // wifi password, filled in only by the server for someone who
                    // may see them — so fetch the thread rather than show the row.
                    if (payload.new && payload.new.automated && hasSecretTokens(payload.new.body)) {
                        fetch(THREAD_GET[kind](id))
                            .then((r) => (r.ok ? r.json() : null))
                            .then((data) => { if (data && data.ok) setThread(data); })
                            .catch(() => {});
                        return;
                    }
                    setThread((prev: any) => {
                        if (!prev) return prev;
                        if (prev.messages.some((m: any) => m.id === payload.new.id)) return prev;
                        return { ...prev, messages: prev.messages.concat(payload.new) };
                    });
                    // Arriving in the conversation they have open and chose: read.
                    if (chosenKey.current === activeId && payload.new.sender_id !== (session && session.user.id)) {
                        markRead(activeId);
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [supabase, activeId]);

    useEffect(() => {
        const box = scrollRef.current;
        if (box) box.scrollTop = box.scrollHeight;

        const phoneBox = mobileScrollRef.current;
        if (phoneBox) phoneBox.scrollTop = phoneBox.scrollHeight;
    }, [thread, mobileOpen]);

    // Every count is of the inbox, never of the archive. Something archived is
    // deliberately out of sight, so it must not keep a number lit next to a
    // filter the person is not looking at.
    const inCategory = useMemo(
        () => conversations.filter((c) => category === 'all' || c.category === category),
        [conversations, category]
    );

    // Airbnb's All "shows only the categories relevant to your account", so a
    // tab appears once there is something in it.
    const categories = useMemo(
        () =>
            ([
                ['homes', 'Homes'],
                ['experiences', 'Experiences'],
                ['services', 'Services'],
            ] as [typeof category, string][]).filter((row) =>
                conversations.some((c) => c.category === row[0])
            ),
        [conversations]
    );

    const counts = useMemo(
        () => {
            const inbox = inCategory.filter((c) => !c.archived);
            return {
                unread: inbox.reduce((s, c) => s + (c.unread || 0), 0),
                needsReply: inbox.filter((c) => c.needsReply).length,
                starred: inbox.filter((c) => c.starred).length,
                archived: inCategory.filter((c) => c.archived).length,
            };
        },
        [inCategory]
    );

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();

        return inCategory.filter((c) => {
            // The archive is a folder, not a filter on top of the inbox: it is
            // the only view that shows archived conversations, and every other
            // view hides them.
            if (filter === 'archived') {
                if (!c.archived) return false;
            } else if (c.archived) {
                return false;
            }

            if (filter === 'unread' && !c.unread) return false;
            if (filter === 'needsReply' && !c.needsReply) return false;
            if (filter === 'starred' && !c.starred) return false;
            if (!q) return true;

            const name = (c.otherName || '').toLowerCase();
            const place = [
                c.listing && c.listing.title,
                c.placeTitle,
                c.subtitle,
                c.statusLine,
            ].filter(Boolean).join(' ').toLowerCase();
            const body = ((c.lastMessage && c.lastMessage.body) || '').toLowerCase();

            return name.indexOf(q) !== -1 || place.indexOf(q) !== -1 || body.indexOf(q) !== -1;
        });
    }, [inCategory, query, filter]);

    // The one filter row both lists use: All and the category tabs, then the
    // folders and flags. One row that scrolls sideways on a phone, as Airbnb's
    // does, rather than wrapping onto three lines. `phone` only changes the
    // tap target.
    const filterRow = (phone: boolean) => {
        const pill = (on: boolean) =>
            'px-3 rounded-lg text-xs font-semibold border transition flex-shrink-0 whitespace-nowrap ' +
            (phone ? 'py-2 ' : 'py-1.5 ') +
            (on
                ? 'bg-slate-900 text-white border-slate-900'
                : 'text-slate-600' + (phone ? '' : ' hover:border-slate-900'));
        return (
            <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <button
                    type="button"
                    onClick={() => { setCategory('all'); setFilter('all'); }}
                    className={pill(category === 'all' && filter === 'all')}
                >
                    All
                </button>
                {categories.map((row) => (
                    <button
                        key={row[0]}
                        type="button"
                        onClick={() => setCategory(category === row[0] ? 'all' : row[0])}
                        className={pill(category === row[0])}
                    >
                        {row[1]}
                    </button>
                ))}
                {([
                    ['needsReply', 'Needs reply', counts.needsReply],
                    ['unread', 'Unread', counts.unread],
                    ['starred', 'Starred', counts.starred],
                    ['archived', 'Archived', counts.archived],
                ] as [typeof filter, string, number][]).map((row) => (
                    <button
                        key={row[0]}
                        type="button"
                        onClick={() => setFilter(filter === row[0] ? 'all' : row[0])}
                        className={pill(filter === row[0])}
                    >
                        {row[1]}
                        {row[2] > 0 ? ' ' + row[2] : ''}
                    </button>
                ))}
            </div>
        );
    };

    // Starring and archiving are this person's own view of the conversation,
    // so the browser writes them straight to conversation_prefs — the row is
    // theirs, and row-level security is what keeps it that way. Unlike the
    // rest of this page there is no co-host problem to work around: a co-host
    // writing their own preference row is still writing their own row.
    // Keyed on the thread's key, like every other per-row action, so the busy
    // flag and the row match line up across all thread kinds. conversation_prefs
    // now carries a generic (thread_kind, thread_id) identity, so a star or an
    // archive stores against the thread whatever kind it is — the matching
    // booking_id / order_id / enquiry_id column carries the on-delete cascade.
    const setPref = async (c: any, patch: any, optimistic: any, undo: any) => {
        if (!session || !session.user || busy[c.key]) return;

        setBusy((prev) => ({ ...prev, [c.key]: true }));
        setConversations((prev) =>
            prev.map((x) => (x.key === c.key ? { ...x, ...optimistic } : x))
        );

        const { kind, id } = splitKey(c.key);
        const idColumn = kind === 'order' ? 'order_id' : kind === 'enquiry' ? 'enquiry_id' : 'booking_id';
        const { error } = await supabase.from('conversation_prefs').upsert(
            {
                user_id: session.user.id,
                thread_kind: kind,
                thread_id: id,
                [idColumn]: id,
                ...patch,
            },
            { onConflict: 'user_id,thread_kind,thread_id' }
        );

        setBusy((prev) => ({ ...prev, [c.key]: false }));

        if (error) {
            // Put this row back rather than leaving the screen claiming
            // something that did not happen. Only the fields this action
            // touched, on the one row — restoring the whole list would throw
            // away anything that arrived while the save was in flight.
            setConversations((prev) =>
                prev.map((x) => (x.key === c.key ? { ...x, ...undo } : x))
            );
            toast.error('That did not save. Please try again.');
        }
    };

    const toggleStar = (c: any) =>
        setPref(
            c,
            { starred_at: c.starred ? null : new Date().toISOString() },
            { starred: !c.starred },
            { starred: !!c.starred }
        );

    // "I have read it, there is nothing to answer." Stored the same way as
    // archiving and read back the same way — it holds only while nothing
    // newer has been said, so a guest who follows "thanks!" with a real
    // question puts the thread back in the count on their own. See
    // lib/conversations.ts.
    //
    // Deliberately not a toggle. Undoing it would mean writing null, and the
    // thing it would put back is a flag the next message restores anyway.
    const markNoReplyNeeded = (c: any) =>
        setPref(
            c,
            { no_reply_needed_at: new Date().toISOString() },
            { needsReply: false, noReplyNeeded: true },
            { needsReply: true, noReplyNeeded: false }
        );

    const toggleArchive = (c: any) => {
        // Archiving stamps the time, which is what puts the conversation
        // behind every message in it so far. Anything arriving afterwards is
        // newer than the stamp and brings it back on its own.
        //
        // The time sent from here is NOT the one that gets stored — a trigger
        // on the table replaces it with the database's own clock. It has to,
        // because that stamp is compared against message timestamps the
        // database wrote, and a browser running a few seconds slow would
        // archive something and watch it reappear immediately. The value is
        // still sent so the row means something without the trigger.
        //
        // Moving it back to the inbox clears the stamp outright, so it stays
        // in the inbox until it is archived again.
        setPref(
            c,
            { archived_at: c.archived ? null : new Date().toISOString() },
            { archived: !c.archived },
            { archived: !!c.archived }
        );

        if (!c.archived && activeId === c.key) {
            // Do not leave a conversation open in the middle pane that has
            // just left the list on the left.
            setActiveId(null);
            setThread(null);
            setMobileOpen(false);
        }
    };

    // Reads a conversation for this person: both markers the list checks —
    // read_at on what was sent to them, and their own place in the thread when
    // they answer it as the owner or a co-host — for every kind of thread
    // (app/api/messages/mark-read, lib/threadReads). The row, the Unread filter
    // and its count follow at once; the badge and the menu dot re-count when
    // the server has it.
    function markRead(key: string | null) {
        if (!key) return;
        const { kind, id } = splitKey(key);
        setConversations((prev) => prev.map((c) => (c.key === key ? { ...c, unread: 0 } : c)));
        fetch('/api/messages/mark-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind, id }),
        }).then(recountBadges, () => {});
    }

    // The person choosing a conversation. Marks it read EVERY time, including
    // the one the page had already put on screen: that one was selected without
    // being read, and clicking it changes no selection — so when reading hung
    // off the selection changing, clicking it did nothing at all and it stayed
    // bold for good (20/10/2026).
    const openConversation = (key: string) => {
        chosenKey.current = key;
        setActiveId(key);
        markRead(key);
    };

    const markUnread = async (c: any) => {
        if (busy[c.key]) return;
        setBusy((prev) => ({ ...prev, [c.key]: true }));

        const { kind, id } = splitKey(c.key);

        let data: any = null;
        try {
            const res = await fetch('/api/messages/mark-unread', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind, id }),
            });
            data = await res.json();
        } catch (err) {
            data = null;
        }

        setBusy((prev) => ({ ...prev, [c.key]: false }));

        if (!data || !data.ok) {
            toast.error('Could not mark that as unread.');
            return;
        }

        // A conversation they have only ever sent in has nothing addressed to
        // them, so there is nothing that could come back unread. Saying so is
        // better than a tick that changed nothing.
        if (!data.marked) {
            toast.info('There is nothing from them to mark as unread.');
            return;
        }

        setConversations((prev) =>
            prev.map((x) =>
                x.key === c.key ? { ...x, unread: Math.max(1, x.unread || 0) } : x
            )
        );

        // Opening a conversation marks it read, so leaving this one open would
        // undo the action the moment anything reloaded it.
        if (chosenKey.current === c.key) chosenKey.current = null;
        if (activeId === c.key) {
            setActiveId(null);
            setThread(null);
            setMobileOpen(false);
        }
    };

    const send = async () => {
        const outgoing = text.trim();
        if (!outgoing || !thread || sending) return;

        const { kind, id } = splitKey(activeId);
        setSending(true);

        if (kind === 'booking') {
            const { error } = await supabase.from('messages').insert({
                booking_id: id,
                sender_id: session.user.id,
                recipient_id: thread.other.id,
                body: outgoing,
            });
            setSending(false);
            if (error) {
                toast.error(error.message, { theme: 'colored' });
                return;
            }
            // Replying is reading. The page can open a conversation by itself
            // without marking it read (so a thread marked unread survives a
            // reload); answering it is the person choosing it, so nothing in it
            // may stay unread for them — the guest's question they just answered
            // included (lib/threadReads). Order and enquiry threads do this in
            // their own send route.
            markRead(activeId);
            // Email the other person, if they have message alerts on — the route
            // decides that, this just asks.
            notify('new_message', id, outgoing);
            setAskPush(true);
        } else {
            // Enquiry and order threads send through their own route, which owns
            // the insert, the recipient and the new-message email.
            try {
                const res = await fetch(THREAD_GET[kind](id), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ body: outgoing }),
                });
                const d = await res.json();
                setSending(false);
                if (!d || !d.ok) {
                    toast.error((d && d.error) || 'Could not send.', { theme: 'colored' });
                    return;
                }
                // The route marked the thread read for the sender; let the dot know.
                recountBadges();
                // Reflect it now; the realtime channel dedupes if it also fires.
                if (d.message) {
                    setThread((prev: any) => prev && !prev.messages.some((m: any) => m.id === d.message.id)
                        ? { ...prev, messages: prev.messages.concat(d.message) } : prev);
                }
            } catch {
                setSending(false);
                toast.error('Could not send.', { theme: 'colored' });
                return;
            }
        }

        setText('');
        setShowQuick(false);

        // Reflect it straight away in the list, so the ordering, the needs-reply
        // flag and the unread count don't lie until the next load: their own
        // message, read, as "You: …" in normal weight, the way Airbnb shows it.
        setConversations((prev) =>
            prev.map((c) =>
                c.key === activeId
                    ? {
                        ...c,
                        needsReply: false,
                        unread: 0,
                        lastMessage: {
                            body: outgoing,
                            created_at: new Date().toISOString(),
                            sender_id: session.user.id,
                            senderLabel: 'You',
                        },
                    }
                    : c
            )
        );
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-4">
                <Logo />
                <p className="text-slate-500 animate-pulse">Loading your messages...</p>
            </div>
        );
    }

    if (!session) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-6 text-center px-4">
                <Logo />
                <h1 className="text-2xl font-bold text-slate-900">Sign in to see your messages</h1>
                <div className="w-full max-w-xs"><LoginModel variant="button" /></div>
            </div>
        );
    }

    // No "Waiting on you · Mark no reply needed" line under the messages:
    // Airbnb shows none, and Liam doesn't want it (20/10/2026). Needs reply is
    // still the filter, which a thread leaves when someone on the host's side
    // replies, and "No reply needed" is still in the row's menu.

    // --- The list of conversations ----------------------------------------
    const list = (
        <div className="flex flex-col h-full">
            <div className="p-4 border-b space-y-3">
                <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search name, property or message"
                        className="w-full pl-9 pr-3 py-2 border rounded-xl text-sm outline-none focus:border-slate-900"
                    />
                </div>

                {filterRow(false)}
            </div>

            <div className="flex-1 overflow-y-auto">
                {shown.length === 0 ? (
                    <div className="p-8 text-center">
                        <Inbox className="w-7 h-7 text-slate-300 mx-auto mb-2" />
                        <p className="text-sm text-slate-500">
                            {filter === 'archived'
                                ? 'Nothing archived'
                                : conversations.length === 0
                                    ? 'No messages yet'
                                    : 'Nothing here'}
                        </p>
                    </div>
                ) : (
                    shown.map((c) => (
                        <ConversationRow
                            key={c.key}
                            conversation={c}
                            active={activeId === c.key}
                            showActive
                            busy={!!busy[c.key]}
                            onOpen={() => openConversation(c.key)}
                            onMarkRead={() => markRead(c.key)}
                            onNoReplyNeeded={() => markNoReplyNeeded(c)}
                            onStar={() => toggleStar(c)}
                            onArchive={() => toggleArchive(c)}
                            onMarkUnread={() => markUnread(c)}
                        />
                    ))
                )}
            </div>
        </div>
    );

    // --- The conversation -------------------------------------------------
    const conversation = (
        <div className="flex flex-col h-full">
            {!thread ? (
                <div className="flex-1 flex items-center justify-center px-6 text-center">
                    {threadLoading ? (
                        <span className="text-slate-400 text-sm">Loading…</span>
                    ) : threadError ? (
                        <span className="text-sm text-red-600">{threadError}</span>
                    ) : (
                        <span className="text-slate-400 text-sm">Pick a conversation</span>
                    )}
                </div>
            ) : (
                <>
                    <div className="p-4 border-b flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="font-semibold text-slate-900 truncate">
                                {capitializeFirst((thread.header && thread.header.personFirst) || thread.other.name)}
                            </div>
                            <div className="text-xs text-slate-500 truncate">
                                {thread.listing && thread.listing.title}
                            </div>
                        </div>
                        {thread.other.phone && (
                            <a
                                href={'tel:' + thread.other.phone}
                                className="flex-shrink-0 text-slate-400 hover:text-emerald-700"
                                title={thread.other.phone}
                            >
                                <Phone className="w-4 h-4" />
                            </a>
                        )}
                    </div>

                    <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
                        {thread.messages.length === 0 && (
                            <p className="text-sm text-slate-400 text-center py-8">
                                Nothing here yet. Say hello.
                            </p>
                        )}

                        {thread.messages.map((m: any) => {
                            const mine = m.sender_id === session.user.id;
                            return (
                                <div
                                    key={m.id}
                                    className={'flex ' + (mine ? 'justify-end' : 'justify-start')}
                                >
                                    <div
                                        className={
                                            'max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ' +
                                            (mine
                                                ? 'bg-emerald-700 text-white'
                                                : 'bg-slate-100 text-slate-900')
                                        }
                                    >
                                        <div className="whitespace-pre-wrap break-words">{m.body}</div>
                                        <div
                                            className={
                                                'text-[10px] mt-1 ' +
                                                (mine ? 'text-emerald-100' : 'text-slate-400')
                                            }
                                        >
                                            {ukDateTime(m.created_at)}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="p-4 border-t">
                        {showQuick && quickReplies.length > 0 && (
                            <div className="mb-2 border rounded-xl divide-y max-h-40 overflow-y-auto">
                                {quickReplies.map((r) => (
                                    <button
                                        key={r.id}
                                        type="button"
                                        onClick={() => {
                                            setText(r.body);
                                            setShowQuick(false);
                                        }}
                                        className="w-full text-left px-3 py-2 hover:bg-slate-50"
                                    >
                                        <div className="text-sm font-medium text-slate-800">
                                            {r.title}
                                        </div>
                                        <div className="text-xs text-slate-500 truncate">{r.body}</div>
                                    </button>
                                ))}
                            </div>
                        )}

                        {askPush && <PushPrompt context="message" className="mb-2" />}
                        <div className="flex items-end gap-2">
                            {quickReplies.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setShowQuick(!showQuick)}
                                    title="Saved replies"
                                    className={
                                        'p-2.5 rounded-xl border transition flex-shrink-0 ' +
                                        (showQuick
                                            ? 'border-slate-900 text-slate-900'
                                            : 'text-slate-400 hover:text-slate-800 hover:border-slate-400')
                                    }
                                >
                                    <Zap className="w-4 h-4" />
                                </button>
                            )}

                            <textarea
                                ref={composerRef}
                                value={text}
                                onChange={(e) => setText(e.target.value)}
                                onKeyDown={(e) => {
                                    // Enter sends; shift and enter makes a new line.
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        send();
                                    }
                                }}
                                rows={1}
                                placeholder="Write a message…"
                                className="flex-1 border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-slate-900 resize-none max-h-32"
                            />

                            <button
                                type="button"
                                onClick={send}
                                disabled={sending || !text.trim()}
                                className="p-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl disabled:opacity-40 flex-shrink-0"
                            >
                                <Send className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );

    // --- The booking behind the conversation ------------------------------
    // Order and enquiry threads carry no booking (no check_in, no listing), so
    // the full booking panel renders only for booking threads; the others get a
    // compact summary from their own context rather than throwing on booking.*.
    const details = !thread ? (
        <div className="p-5 text-sm text-slate-400">Pick a conversation</div>
    ) : thread.booking ? (
        <div className="h-full overflow-y-auto p-5 space-y-5">
            {/* The reservation, as the SAME floating-card set the experience threads
                and the host reservation page use — viewer-aware from the route (the
                host sees the guest and their take; the guest sees their host and
                what they paid). The card carries the header, the split check-in/out
                with arrival, the guests list, hosted-by, cancellation, money, and
                booked/reference; the Manage-reservation actions sit under it. */}
            {thread.reservation && (
                <ProviderReservationCard r={thread.reservation as ReservationCardData} size="sm" />
            )}

            {/* Manage reservation — the host's pop-up (change / send-or-request
                money / cancel), or the guest's own change/cancel, in a card of the
                same family so it reads as the last card in the stack. */}
            {(thread.role === 'host' || thread.ownerEquivalent) && thread.listing && (
                <ManageReservationSheet
                    bookingId={thread.booking.id}
                    status={thread.booking.status}
                    isOwnerEquivalent={!!thread.ownerEquivalent}
                    ended={stayHasEnded(thread.booking.check_out, thread.listing.check_out_time)}
                    started={stayHasStarted(thread.booking.check_in)}
                    phone={thread.other.phone}
                    guestFirst={capitializeFirst((thread.header && thread.header.personFirst) || thread.other.name)}
                    totalPrice={Number(thread.booking.total_price || 0)}
                    amountPaid={Number(thread.booking.amount_paid || 0)}
                    amountRefunded={Number(thread.booking.amount_refunded || 0)}
                    askToCancelHref={null}
                    checkIn={String(thread.booking.check_in).slice(0, 10)}
                    checkOut={String(thread.booking.check_out).slice(0, 10)}
                    adults={Number(thread.booking.adults || 0) || Math.max(1, Number(thread.booking.guests || 1) - Number(thread.booking.children || 0))}
                    children={Number(thread.booking.children || 0)}
                    pets={Number(thread.booking.pets || 0)}
                    maxGuests={Number(thread.listing.max_guests || 1)}
                    petsAllowed={Array.isArray(thread.listing.amenities) && thread.listing.amenities.indexOf('Pets allowed') !== -1}
                    listingId={thread.listing.id}
                    listingTitle={thread.listing.title || 'your stay'}
                    listingImage={thread.listing.images && thread.listing.images[0] ? getImageUrl(thread.listing.images[0]) : null}
                />
            )}

            {thread.role === 'guest' && thread.listing && (() => {
                const todayIso = new Date().toISOString().slice(0, 10);
                const checkInIso = String(thread.booking.check_in).slice(0, 10);
                const checkOutIso = String(thread.booking.check_out).slice(0, 10);
                const canChange = thread.booking.status === 'confirmed' && checkOutIso >= todayIso;
                const canCancel = checkInIso > todayIso;
                if (!canChange && !canCancel) return null;
                const rowCls = 'flex w-full items-center justify-between py-3 text-left text-sm font-semibold text-slate-900';
                return (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Manage reservation</div>
                        <div className="mt-1 divide-y divide-slate-100">
                            {canChange && (
                                <RequestChangeRow
                                    bookingId={thread.booking.id}
                                    listingId={thread.listing.id}
                                    listingTitle={thread.listing.title || 'your stay'}
                                    listingImage={thread.listing.images && thread.listing.images[0] ? getImageUrl(thread.listing.images[0]) : null}
                                    hostFirst={capitializeFirst(thread.other.name)}
                                    checkIn={checkInIso}
                                    checkOut={checkOutIso}
                                    adults={Number(thread.booking.adults || 0) || Math.max(1, Number(thread.booking.guests || 1) - Number(thread.booking.children || 0))}
                                    childrenCount={Number(thread.booking.children || 0)}
                                    pets={Number(thread.booking.pets || 0)}
                                    maxGuests={Number(thread.listing.max_guests || 1)}
                                    petsAllowed={Array.isArray(thread.listing.amenities) && thread.listing.amenities.indexOf('Pets allowed') !== -1}
                                    className={rowCls}
                                />
                            )}
                            {canCancel && (
                                <StayCancelRow
                                    bookingId={thread.booking.id}
                                    checkIn={thread.booking.check_in}
                                    policy={thread.booking.cancellation_policy}
                                    customDays={thread.booking.cancellation_custom_days}
                                    nonRefundable={thread.booking.non_refundable === true}
                                    amountPaid={thread.booking.amount_paid}
                                    amountRefunded={thread.booking.amount_refunded}
                                    cleaningFee={thread.booking.cleaning_fee}
                                    className={rowCls + ' text-slate-600 hover:text-rose-700'}
                                    panelClassName="pb-3"
                                />
                            )}
                        </div>
                    </div>
                );
            })()}

            {thread.role === 'companion' && (
                <Link
                    href="/trips"
                    className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
                >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Your trip
                </Link>
            )}
        </div>
    ) : (
        // Order / enquiry thread: the reservation this thread is about, in the
        // SAME card the holiday-let host page and the provider dashboard show, fed
        // the viewer-aware shape from the thread route (a guest sees only what they
        // paid). No Message button here — you are already in the thread.
        (() => {
            const c = (thread.context || {}) as any;
            const rez = c.reservation;
            if (!rez) {
                return (
                    <div className="h-full overflow-y-auto p-5">
                        <div className="font-semibold text-slate-900">{c.business || (thread.other && thread.other.name) || 'Conversation'}</div>
                        {c.item && <div className="text-sm text-slate-500">{c.item}</div>}
                    </div>
                );
            }
            const data: ReservationCardData = {
                avatarUrl: rez.avatarUrl ?? null,
                initial: rez.initial || '·',
                photoUrl: rez.photoUrl ?? null,
                heading: rez.heading || c.business || 'Reservation',
                whenLabel: rez.whenLabel || '',
                itemName: rez.itemName || c.item || '',
                status: rez.status || null,
                // whenValue feeds the fact card; whenLabel (often emptied for a
                // trade job) is the header subline, so the asked-for line reads once.
                when: { heading: rez.whenHeading || 'When', value: rez.whenValue ?? rez.whenLabel ?? '' },
                where: rez.where ?? null,
                note: rez.note ?? null,
                allergy: rez.allergy ?? null,
                money: rez.money ?? null,
                moneyNote: rez.moneyNote ?? null,
                phone: rez.phone ?? null,
                messageHref: null,
                personFirst: rez.personFirst || '',
                guests: rez.guests ?? null,
                cancellation: rez.cancellation ?? null,
                // The Manage sheet's own Message action would loop back to this
                // thread, so drop it here (you're already in the conversation).
                manage: rez.manage ? { ...rez.manage, messageHref: null } : null,
                // The guest's mirror of the Manage sheet — change/cancel from the
                // thread. The route sets exactly one of manage / guestManage.
                guestManage: rez.guestManage ?? null,
                // A trade's Accept / Decline on a still-to-answer request, in the
                // thread too (set only by the enquiry route, for the provider).
                requestActions: rez.requestActions ?? null,
                clashWarning: rez.clashWarning ?? null,
            };
            return (
                <div className="h-full overflow-y-auto p-5">
                    <ProviderReservationCard r={data} size="sm" />
                    {rez.reference && <div className="mt-4 text-center text-xs text-slate-400">{rez.reference}</div>}
                </div>
            );
        })()
    );

    return (
        <div className="max-w-[1400px] mx-auto px-4 py-6">
            <h1 className="text-2xl font-bold text-slate-900 mb-4">Messages</h1>

            {/* Three panes side by side once there's room for them. The thread
                list keeps its width; the reservation pane is widened to roughly
                Airbnb's proportions (the when/where cards sit side by side and
                nothing wraps awkwardly), and the space comes from the middle
                conversation column, which flexes. h-full + min-h-0 let the pane
                scroll inside the fixed-height row rather than clipping its last
                card. */}
            <div className="hidden lg:flex border rounded-2xl overflow-hidden h-[calc(100vh-14rem)] min-h-[32rem] bg-white">
                <div className="w-80 border-r flex-shrink-0 h-full min-h-0">{list}</div>
                <div className="flex-1 min-w-0 border-r h-full min-h-0">{conversation}</div>
                <div className="w-[400px] flex-shrink-0 h-full min-h-0">{details}</div>
            </div>

            {/* On a phone the same panes become two screens: the list, then
                the conversation with a back arrow. The booking details fold
                away behind a toggle rather than taking a whole column. */}
            <div className="lg:hidden">
                {!mobileOpen ? (
                    <div className="border rounded-2xl overflow-hidden bg-white">
                        <div className="p-4 border-b space-y-3">
                            <div className="relative">
                                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                <input
                                    type="text"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Search name, property or message"
                                    className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm outline-none focus:border-slate-900"
                                />
                            </div>

                            {filterRow(true)}
                        </div>

                        {shown.length === 0 ? (
                            <div className="p-10 text-center">
                                <Inbox className="w-7 h-7 text-slate-300 mx-auto mb-2" />
                                <p className="text-sm text-slate-500">
                                    {filter === 'archived'
                                ? 'Nothing archived'
                                : conversations.length === 0
                                    ? 'No messages yet'
                                    : 'Nothing here'}
                                </p>
                            </div>
                        ) : (
                            shown.map((c) => (
                                <ConversationRow
                                    key={c.key}
                                    conversation={c}
                                    busy={!!busy[c.key]}
                                    onMarkRead={() => markRead(c.key)}
                                    onOpen={() => {
                                        openConversation(c.key);
                                        setMobileOpen(true);
                                        setShowDetails(false);
                                    }}
                                    onNoReplyNeeded={() => markNoReplyNeeded(c)}
                                    onStar={() => toggleStar(c)}
                                    onArchive={() => toggleArchive(c)}
                                    onMarkUnread={() => markUnread(c)}
                                />
                            ))
                        )}
                    </div>
                ) : (
                    <div className="border rounded-2xl overflow-hidden bg-white flex flex-col h-[calc(100vh-12rem)] min-h-[28rem]">
                        <div className="p-3 border-b flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setMobileOpen(false)}
                                className="p-2 -ml-1 text-slate-500 hover:text-slate-900 flex-shrink-0"
                                aria-label="Back to messages"
                            >
                                <ChevronLeft className="w-5 h-5" />
                            </button>

                            <div className="min-w-0 flex-1">
                                <div className="font-semibold text-slate-900 truncate text-sm">
                                    {thread ? capitializeFirst((thread.header && thread.header.personFirst) || thread.other.name) : 'Loading…'}
                                </div>
                                <div className="text-xs text-slate-500 truncate">
                                    {thread && thread.listing && thread.listing.title}
                                </div>
                            </div>

                            {thread && thread.other.phone && (
                                <a
                                    href={'tel:' + thread.other.phone}
                                    className="p-2 text-slate-400 flex-shrink-0"
                                    aria-label="Call"
                                >
                                    <Phone className="w-4 h-4" />
                                </a>
                            )}

                            {thread && (
                                <button
                                    type="button"
                                    onClick={() => setShowDetails(!showDetails)}
                                    className={
                                        'p-2 flex-shrink-0 ' +
                                        (showDetails ? 'text-emerald-700' : 'text-slate-400')
                                    }
                                    aria-label="Booking details"
                                >
                                    <Info className="w-4 h-4" />
                                </button>
                            )}
                        </div>

                        {/* The third column, folded away until asked for. A
                            definite height (not max-h) gives the inner h-full
                            pane something to resolve against, so the reservation
                            card scrolls within the drawer and its last card —
                            the Manage reservation row — is reachable rather than
                            spilling over the conversation beneath. */}
                        {showDetails && thread && (
                            <div className="border-b bg-slate-50 h-[60vh] overflow-hidden">
                                {details}
                            </div>
                        )}

                        {!thread ? (
                            <div className="flex-1 flex items-center justify-center px-6 text-center">
                                {threadLoading ? (
                                    <span className="text-slate-400 text-sm">Loading…</span>
                                ) : (
                                    <span className="text-sm text-red-600">
                                        {threadError || 'Could not load this conversation.'}
                                    </span>
                                )}
                            </div>
                        ) : (
                            <>
                                <div
                                    ref={mobileScrollRef}
                                    className="flex-1 overflow-y-auto p-4 space-y-3"
                                >
                                    {thread.messages.length === 0 && (
                                        <p className="text-sm text-slate-400 text-center py-8">
                                            Nothing here yet. Say hello.
                                        </p>
                                    )}

                                    {thread.messages.map((m: any) => {
                                        const mine = m.sender_id === session.user.id;
                                        return (
                                            <div
                                                key={m.id}
                                                className={'flex ' + (mine ? 'justify-end' : 'justify-start')}
                                            >
                                                <div
                                                    className={
                                                        // Chat bubbles are body text — 17px on a phone.
                                                        'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm max-sm:text-[17px] ' +
                                                        (mine
                                                            ? 'bg-emerald-700 text-white'
                                                            : 'bg-slate-100 text-slate-900')
                                                    }
                                                >
                                                    <div className="whitespace-pre-wrap break-words">
                                                        {m.body}
                                                    </div>
                                                    <div
                                                        className={
                                                            'text-[10px] mt-1 ' +
                                                            (mine ? 'text-emerald-100' : 'text-slate-400')
                                                        }
                                                    >
                                                        {ukDateTime(m.created_at)}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="p-3 border-t">
                                    {showQuick && quickReplies.length > 0 && (
                                        <div className="mb-2 border rounded-xl divide-y max-h-40 overflow-y-auto">
                                            {quickReplies.map((r) => (
                                                <button
                                                    key={r.id}
                                                    type="button"
                                                    onClick={() => {
                                                        setText(r.body);
                                                        setShowQuick(false);
                                                    }}
                                                    className="w-full text-left px-3 py-2.5"
                                                >
                                                    <div className="text-sm font-medium text-slate-800">
                                                        {r.title}
                                                    </div>
                                                    <div className="text-xs text-slate-500 truncate">
                                                        {r.body}
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {askPush && <PushPrompt context="message" className="mb-2" />}
                                    <div className="flex items-end gap-2">
                                        {quickReplies.length > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => setShowQuick(!showQuick)}
                                                className={
                                                    'p-3 rounded-xl border flex-shrink-0 ' +
                                                    (showQuick
                                                        ? 'border-slate-900 text-slate-900'
                                                        : 'text-slate-400')
                                                }
                                                aria-label="Saved replies"
                                            >
                                                <Zap className="w-4 h-4" />
                                            </button>
                                        )}

                                        <textarea
                                            ref={mobileComposerRef}
                                            value={text}
                                            onChange={(e) => setText(e.target.value)}
                                            rows={1}
                                            placeholder="Write a message…"
                                            className="flex-1 border rounded-xl px-3 py-3 text-base outline-none focus:border-slate-900 resize-none max-h-32"
                                        />

                                        <button
                                            type="button"
                                            onClick={send}
                                            disabled={sending || !text.trim()}
                                            className="p-3 bg-emerald-700 text-white rounded-xl disabled:opacity-40 flex-shrink-0"
                                            aria-label="Send"
                                        >
                                            <Send className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
