'use client';

import { notify } from '@/lib/notify';
import ConversationRow from '@/components/messages/ConversationRow';
import ProviderReservationCard, { type ReservationCardData } from '@/components/services/ProviderReservationCard';
import ManageReservationSheet from '@/components/dashboard/reservation/ManageReservationSheet';
import RequestChangeRow from '@/components/trips/RequestChangeRow';
import StayCancelRow from '@/components/trips/StayCancelRow';
import { stayHasEnded, stayHasStarted } from '@/lib/stayWindow';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Link from 'next/link';
import Logo from '@/components/base/Logo';
import LoginModel from '@/components/auth/LoginModel';
import { getImageUrl, capitializeFirst } from '@/lib/utils';
import { toast } from 'react-toastify';
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

    // Set for the one conversation the page opens by itself on load. See the
    // note where it is set.
    const skipMarkRead = useRef(false);

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
                if (asked) {
                    setMobileOpen(true);
                } else {
                    // Marking read follows somebody choosing a conversation,
                    // not the page choosing one for them. Without this,
                    // marking a conversation unread and reloading the page
                    // would land on it and quietly mark it read again, which
                    // is the one thing the action exists to prevent. Asking
                    // for one by name is them choosing it, so it is exempt.
                    skipMarkRead.current = true;
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

                if (skipMarkRead.current) {
                    // Opened by the page rather than by the person. Leave the
                    // unread flags alone; the next conversation they choose
                    // themselves clears its own.
                    skipMarkRead.current = false;
                } else {
                    // Opening it clears the unread flags, here and in the list.
                    // Booking threads have an explicit mark-read; enquiry and order
                    // threads are stamped read by their own GET above, so those
                    // just need the optimistic list update.
                    if (kind === 'booking') {
                        fetch('/api/messages/mark-read', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ bookingId: id }),
                        }).catch(() => {});
                    }

                    setConversations((prev) =>
                        prev.map((c) => (c.key === activeId ? { ...c, unread: 0 } : c))
                    );
                }
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
                    setThread((prev: any) => {
                        if (!prev) return prev;
                        if (prev.messages.some((m: any) => m.id === payload.new.id)) return prev;
                        return { ...prev, messages: prev.messages.concat(payload.new) };
                    });
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
    const counts = useMemo(
        () => {
            const inbox = conversations.filter((c) => !c.archived);
            return {
                unread: inbox.reduce((s, c) => s + (c.unread || 0), 0),
                needsReply: inbox.filter((c) => c.needsReply).length,
                starred: inbox.filter((c) => c.starred).length,
                archived: conversations.filter((c) => c.archived).length,
            };
        },
        [conversations]
    );

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();

        return conversations.filter((c) => {
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
            const place = ((c.listing && c.listing.title) || '').toLowerCase();
            const body = ((c.lastMessage && c.lastMessage.body) || '').toLowerCase();

            return name.indexOf(q) !== -1 || place.indexOf(q) !== -1 || body.indexOf(q) !== -1;
        });
    }, [conversations, query, filter]);

    // Starring and archiving are this person's own view of the conversation,
    // so the browser writes them straight to conversation_prefs — the row is
    // theirs, and row-level security is what keeps it that way. Unlike the
    // rest of this page there is no co-host problem to work around: a co-host
    // writing their own preference row is still writing their own row.
    const setPref = async (bookingId: string, patch: any, optimistic: any, undo: any) => {
        if (!session || !session.user || busy[bookingId]) return;

        setBusy((prev) => ({ ...prev, [bookingId]: true }));
        setConversations((prev) =>
            prev.map((c) => (c.bookingId === bookingId ? { ...c, ...optimistic } : c))
        );

        const { error } = await supabase.from('conversation_prefs').upsert(
            { user_id: session.user.id, booking_id: bookingId, ...patch },
            { onConflict: 'user_id,booking_id' }
        );

        setBusy((prev) => ({ ...prev, [bookingId]: false }));

        if (error) {
            // Put this row back rather than leaving the screen claiming
            // something that did not happen. Only the fields this action
            // touched, on the one row — restoring the whole list would throw
            // away anything that arrived while the save was in flight.
            setConversations((prev) =>
                prev.map((c) => (c.bookingId === bookingId ? { ...c, ...undo } : c))
            );
            toast.error('That did not save. Please try again.');
        }
    };

    const toggleStar = (c: any) =>
        setPref(
            c.bookingId,
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
    const markNoReplyNeeded = (bookingId: string) =>
        setPref(
            bookingId,
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
            c.bookingId,
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

    const markUnread = async (c: any) => {
        if (busy[c.bookingId]) return;
        setBusy((prev) => ({ ...prev, [c.bookingId]: true }));

        let data: any = null;
        try {
            const res = await fetch('/api/messages/mark-unread', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingId: c.bookingId }),
            });
            data = await res.json();
        } catch (err) {
            data = null;
        }

        setBusy((prev) => ({ ...prev, [c.bookingId]: false }));

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
                x.bookingId === c.bookingId ? { ...x, unread: Math.max(1, x.unread || 0) } : x
            )
        );

        // Opening a conversation marks it read, so leaving this one open would
        // undo the action the moment anything reloaded it.
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
            // Email the other person, if they have message alerts on — the route
            // decides that, this just asks.
            notify('new_message', id, outgoing);
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

        // Reflect it straight away in the list, so the ordering and the
        // needs-reply flag don't lie until the next load.
        setConversations((prev) =>
            prev.map((c) =>
                c.key === activeId
                    ? {
                        ...c,
                        needsReply: false,
                        lastMessage: { body: outgoing, created_at: new Date().toISOString() },
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
                <LoginModel />
            </div>
        );
    }

    // The row in the list for whatever is open, which is where needsReply
    // lives — it is worked out per person when the list is built.
    const activeConversation = conversations.filter(
        (c) => c.key === activeId
    )[0] || null;

    // Offered under the last message rather than buried in the row menu,
    // because it belongs to the message that is waiting. A needs-reply count
    // that includes threads ending "thanks!" is one nobody reads.
    const noReplyLink = activeConversation && activeConversation.needsReply ? (
        <div className="pt-2 flex items-center justify-center gap-2 text-xs">
            <span className="text-amber-700 font-medium">Waiting on you</span>
            <span className="text-slate-300">&middot;</span>
            <button
                type="button"
                onClick={() => markNoReplyNeeded(activeConversation.bookingId)}
                disabled={!!busy[activeConversation.bookingId]}
                className="font-semibold text-slate-500 underline hover:text-slate-900 disabled:opacity-50"
            >
                Mark no reply needed
            </button>
        </div>
    ) : null;

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

                <div className="flex flex-wrap gap-1.5">
                    {([
                        ['all', 'All', 0],
                        ['needsReply', 'Needs reply', counts.needsReply],
                        ['unread', 'Unread', counts.unread],
                        ['starred', 'Starred', counts.starred],
                        ['archived', 'Archived', counts.archived],
                    ] as [typeof filter, string, number][]).map((row) => (
                        <button
                            key={row[0]}
                            type="button"
                            onClick={() => setFilter(row[0])}
                            className={
                                'px-3 py-1.5 rounded-lg text-xs font-semibold border transition ' +
                                (filter === row[0]
                                    ? 'bg-slate-900 text-white border-slate-900'
                                    : 'text-slate-600 hover:border-slate-900')
                            }
                        >
                            {row[1]}
                            {row[2] > 0 ? ' ' + row[2] : ''}
                        </button>
                    ))}
                </div>
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
                            busy={!!busy[c.bookingId]}
                            onOpen={() => setActiveId(c.key)}
                            onNoReplyNeeded={() => markNoReplyNeeded(c.bookingId)}
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
                                            {new Date(m.created_at).toLocaleString('en-GB', {
                                                day: 'numeric',
                                                month: 'short',
                                                hour: '2-digit',
                                                minute: '2-digit',
                                            })}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        {noReplyLink}
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
            {thread.role === 'host' && thread.listing && (
                <ManageReservationSheet
                    bookingId={thread.booking.id}
                    status={thread.booking.status}
                    isOwner
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
                when: { heading: rez.whenHeading || 'When', value: rez.whenLabel || '' },
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

                            <div className="flex flex-wrap gap-1.5">
                                {([
                                    ['all', 'All', 0],
                                    ['needsReply', 'Needs reply', counts.needsReply],
                                    ['unread', 'Unread', counts.unread],
                                    ['starred', 'Starred', counts.starred],
                                    ['archived', 'Archived', counts.archived],
                                ] as [typeof filter, string, number][]).map((row) => (
                                    <button
                                        key={row[0]}
                                        type="button"
                                        onClick={() => setFilter(row[0])}
                                        className={
                                            'px-3 py-2 rounded-lg text-xs font-semibold border transition ' +
                                            (filter === row[0]
                                                ? 'bg-slate-900 text-white border-slate-900'
                                                : 'text-slate-600')
                                        }
                                    >
                                        {row[1]}
                                        {row[2] > 0 ? ' ' + row[2] : ''}
                                    </button>
                                ))}
                            </div>
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
                                    busy={!!busy[c.bookingId]}
                                    onOpen={() => {
                                        setActiveId(c.key);
                                        setMobileOpen(true);
                                        setShowDetails(false);
                                    }}
                                    onNoReplyNeeded={() => markNoReplyNeeded(c.bookingId)}
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
                                                        'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ' +
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
                                                        {new Date(m.created_at).toLocaleString('en-GB', {
                                                            day: 'numeric',
                                                            month: 'short',
                                                            hour: '2-digit',
                                                            minute: '2-digit',
                                                        })}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {noReplyLink}
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
