'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Link from 'next/link';
import Logo from '@/components/base/Logo';
import LoginModel from '@/components/auth/LoginModel';
import { getImageUrl, capitializeFirst } from '@/lib/utils';
import { toast } from 'react-toastify';
import { Search, Inbox, Send, Zap, Phone, ExternalLink, ChevronLeft, Info } from 'lucide-react';

function timeAgo(iso: string): string {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hours = Math.round(mins / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.round(hours / 24);
    return days + 'd ago';
}

export default function MessagesInboxPage() {
    const supabase = createClientComponentClient();

    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<any>(null);
    const [conversations, setConversations] = useState<any[]>([]);

    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState<'all' | 'unread' | 'needsReply'>('all');

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

            // Open whichever conversation is waiting on them, so the page
            // lands on something useful rather than an empty pane.
            const first =
                convos.find((c: any) => c.unread > 0) ||
                convos.find((c: any) => c.needsReply) ||
                convos[0];

            // Pre-selects for the desktop's middle pane. mobileOpen stays
            // false, so a phone still lands on the list.
            if (first) setActiveId(first.bookingId);

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

        const load = async () => {
            try {
                const res = await fetch('/api/messages/threads/' + activeId);

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

                // Opening it clears the unread flags, here and in the list.
                fetch('/api/messages/mark-read', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bookingId: activeId }),
                }).catch(() => {});

                setConversations((prev) =>
                    prev.map((c) => (c.bookingId === activeId ? { ...c, unread: 0 } : c))
                );
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

        const channel = supabase
            .channel('thread-' + activeId)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'messages',
                    filter: 'booking_id=eq.' + activeId,
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

    const counts = useMemo(
        () => ({
            unread: conversations.reduce((s, c) => s + (c.unread || 0), 0),
            needsReply: conversations.filter((c) => c.needsReply).length,
        }),
        [conversations]
    );

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();

        return conversations.filter((c) => {
            if (filter === 'unread' && !c.unread) return false;
            if (filter === 'needsReply' && !c.needsReply) return false;
            if (!q) return true;

            const name = (c.otherName || '').toLowerCase();
            const place = ((c.listing && c.listing.title) || '').toLowerCase();
            const body = ((c.lastMessage && c.lastMessage.body) || '').toLowerCase();

            return name.indexOf(q) !== -1 || place.indexOf(q) !== -1 || body.indexOf(q) !== -1;
        });
    }, [conversations, query, filter]);

    const send = async () => {
        const outgoing = text.trim();
        if (!outgoing || !thread || sending) return;

        setSending(true);

        const { error } = await supabase.from('messages').insert({
            booking_id: activeId,
            sender_id: session.user.id,
            recipient_id: thread.other.id,
            body: outgoing,
        });

        setSending(false);

        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }

        setText('');
        setShowQuick(false);

        // Reflect it straight away in the list, so the ordering and the
        // needs-reply flag don't lie until the next load.
        setConversations((prev) =>
            prev.map((c) =>
                c.bookingId === activeId
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

    const stageStyles: Record<string, string> = {
        staying: 'bg-emerald-100 text-emerald-800',
        upcoming: 'bg-sky-100 text-sky-800',
        past: 'bg-slate-100 text-slate-500',
    };

    const stageWords: Record<string, string> = {
        staying: 'Here now',
        upcoming: 'Upcoming',
        past: 'Past',
    };

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

                <div className="flex gap-1.5">
                    {([
                        ['all', 'All', 0],
                        ['needsReply', 'Needs reply', counts.needsReply],
                        ['unread', 'Unread', counts.unread],
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
                            {conversations.length === 0 ? 'No messages yet' : 'Nothing here'}
                        </p>
                    </div>
                ) : (
                    shown.map((c) => (
                        <button
                            key={c.bookingId}
                            type="button"
                            onClick={() => setActiveId(c.bookingId)}
                            className={
                                'w-full text-left p-4 border-b transition flex gap-3 ' +
                                (activeId === c.bookingId
                                    ? 'bg-slate-100'
                                    : c.unread
                                        ? 'bg-emerald-50/50 hover:bg-emerald-50'
                                        : 'hover:bg-slate-50')
                            }
                        >
                            <div className="w-12 h-12 rounded-xl bg-slate-200 overflow-hidden flex-shrink-0">
                                {c.listing && c.listing.images && c.listing.images[0] && (
                                    <img
                                        src={getImageUrl(c.listing.images[0])}
                                        alt=""
                                        className="w-full h-full object-cover"
                                    />
                                )}
                            </div>

                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold text-slate-900 truncate">
                                        {capitializeFirst(c.otherName)}
                                    </span>
                                    {c.unread > 0 && (
                                        <span className="flex-shrink-0 text-xs font-bold text-white bg-emerald-700 rounded-full px-1.5">
                                            {c.unread}
                                        </span>
                                    )}
                                    {c.lastMessage && (
                                        <span className="ml-auto text-xs text-slate-400 flex-shrink-0">
                                            {timeAgo(c.lastMessage.created_at)}
                                        </span>
                                    )}
                                </div>

                                <div className="flex items-center gap-1.5 mt-0.5">
                                    <span
                                        className={
                                            'text-[10px] font-semibold px-1.5 py-0.5 rounded ' +
                                            (stageStyles[c.stage] || stageStyles.past)
                                        }
                                    >
                                        {stageWords[c.stage] || 'Past'}
                                    </span>
                                    <span className="text-xs text-slate-500 truncate">
                                        {(c.listing && c.listing.title) || 'Listing'}
                                    </span>
                                </div>

                                {c.lastMessage && (
                                    <div
                                        className={
                                            'text-xs truncate mt-1 ' +
                                            (c.needsReply ? 'text-slate-900 font-medium' : 'text-slate-400')
                                        }
                                    >
                                        {c.needsReply && <span className="text-amber-600">&bull; </span>}
                                        {c.lastMessage.body}
                                    </div>
                                )}
                            </div>
                        </button>
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
                                {capitializeFirst(thread.other.name)}
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
    const details = thread ? (
        <div className="h-full overflow-y-auto p-5 space-y-5">
            {thread.listing && thread.listing.images && thread.listing.images[0] && (
                <img
                    src={getImageUrl(thread.listing.images[0])}
                    alt=""
                    className="w-full h-32 object-cover rounded-xl"
                />
            )}

            <div>
                <div className="font-semibold text-slate-900">
                    {thread.listing && thread.listing.title}
                </div>
                <div className="text-sm text-slate-500">
                    {thread.listing && thread.listing.location}
                </div>
            </div>

            <div className="space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                    <span className="text-slate-500 flex-shrink-0">Check in</span>
                    <span className="text-slate-900 font-medium text-right">
                        {thread.booking.check_in}
                        {thread.listing && thread.listing.checkin_start
                            ? ' · ' + thread.listing.checkin_start
                            : ''}
                    </span>
                </div>
                <div className="flex justify-between gap-2">
                    <span className="text-slate-500 flex-shrink-0">Check out</span>
                    <span className="text-slate-900 font-medium text-right">
                        {thread.booking.check_out}
                        {thread.listing && thread.listing.checkout_time
                            ? ' · ' + thread.listing.checkout_time
                            : ''}
                    </span>
                </div>
                <div className="flex justify-between gap-2">
                    <span className="text-slate-500 flex-shrink-0">Guests</span>
                    <span className="text-slate-900 font-medium text-right">
                        {thread.booking.guests}
                        {thread.booking.adults
                            ? ' (' +
                              thread.booking.adults +
                              (thread.booking.adults === 1 ? ' adult' : ' adults') +
                              (thread.booking.children
                                  ? ', ' +
                                    thread.booking.children +
                                    (thread.booking.children === 1 ? ' child' : ' children')
                                  : '') +
                              ')'
                            : ''}
                    </span>
                </div>
                {thread.booking.pets > 0 && (
                    <div className="flex justify-between">
                        <span className="text-slate-500">Pets</span>
                        <span className="text-slate-900 font-medium">{thread.booking.pets}</span>
                    </div>
                )}
                <div className="flex justify-between">
                    <span className="text-slate-500">Nights</span>
                    <span className="text-slate-900 font-medium">
                        {Math.round(
                            (new Date(thread.booking.check_out).getTime() -
                                new Date(thread.booking.check_in).getTime()) /
                                86400000
                        )}
                    </span>
                </div>
                <div className="flex justify-between">
                    <span className="text-slate-500">Status</span>
                    <span className="text-slate-900 font-medium capitalize">
                        {String(thread.booking.status).replace(/_/g, ' ')}
                    </span>
                </div>
                <div className="flex justify-between gap-2">
                    <span className="text-slate-500 flex-shrink-0">Booked</span>
                    <span className="text-slate-900 font-medium text-right">
                        {new Date(thread.booking.created_at).toLocaleDateString('en-GB')}
                    </span>
                </div>
                <div className="flex justify-between gap-2">
                    <span className="text-slate-500 flex-shrink-0">Reference</span>
                    <span className="text-slate-500 font-mono text-xs text-right">
                        {String(thread.booking.id).slice(0, 8)}
                    </span>
                </div>
            </div>

            {thread.booking.total_price !== null && (
                <div className="border-t pt-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                        <span className="text-slate-500">Total</span>
                        <span className="text-slate-900 font-medium">
                            £{Number(thread.booking.total_price).toFixed(2)}
                        </span>
                    </div>
                    {thread.booking.amount_paid !== null && (
                        <div className="flex justify-between">
                            <span className="text-slate-500">Paid</span>
                            <span className="text-slate-900 font-medium">
                                £{Number(thread.booking.amount_paid || 0).toFixed(2)}
                            </span>
                        </div>
                    )}
                    {Number(thread.booking.balance_amount) > 0 && (
                        <div className="flex justify-between gap-2">
                            <span className="text-slate-500 flex-shrink-0">Still to pay</span>
                            <span className="text-amber-700 font-medium text-right">
                                £{Number(thread.booking.balance_amount).toFixed(2)}
                                {thread.booking.balance_due_date
                                    ? ' by ' +
                                      new Date(thread.booking.balance_due_date).toLocaleDateString('en-GB')
                                    : ''}
                            </span>
                        </div>
                    )}
                    {thread.booking.free_cancel_until && (
                        <div className="flex justify-between gap-2">
                            <span className="text-slate-500 flex-shrink-0">Free cancellation</span>
                            <span className="text-slate-600 text-right">
                                until{' '}
                                {new Date(thread.booking.free_cancel_until).toLocaleDateString('en-GB')}
                            </span>
                        </div>
                    )}
                </div>
            )}

            {thread.other.phone && (
                <div className="border-t pt-4">
                    <div className="text-xs text-slate-500 mb-1">Phone</div>
                    <a
                        href={'tel:' + thread.other.phone}
                        className="text-sm text-emerald-700 hover:underline"
                    >
                        {thread.other.phone}
                    </a>
                </div>
            )}

            <div className="border-t pt-4 space-y-2">
                {thread.listing && (
                    <Link
                        href={'/homes/' + thread.listing.id}
                        className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
                    >
                        <ExternalLink className="w-3.5 h-3.5" />
                        View the listing
                    </Link>
                )}
                {thread.role === 'host' && (
                    <Link
                        href="/dashboard/bookings"
                        className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
                    >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Manage this booking
                    </Link>
                )}
            </div>
        </div>
    ) : (
        <div className="p-5 text-sm text-slate-400">Pick a conversation</div>
    );

    return (
        <div className="max-w-[1400px] mx-auto px-4 py-6">
            <h1 className="text-2xl font-bold text-slate-900 mb-4">Messages</h1>

            {/* Three panes side by side once there's room for them. */}
            <div className="hidden lg:flex border rounded-2xl overflow-hidden h-[calc(100vh-14rem)] min-h-[32rem] bg-white">
                <div className="w-80 border-r flex-shrink-0">{list}</div>
                <div className="flex-1 min-w-0 border-r">{conversation}</div>
                <div className="w-72 flex-shrink-0">{details}</div>
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

                            <div className="flex gap-1.5">
                                {([
                                    ['all', 'All', 0],
                                    ['needsReply', 'Needs reply', counts.needsReply],
                                    ['unread', 'Unread', counts.unread],
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
                                    {conversations.length === 0 ? 'No messages yet' : 'Nothing here'}
                                </p>
                            </div>
                        ) : (
                            shown.map((c) => (
                                <button
                                    key={c.bookingId}
                                    type="button"
                                    onClick={() => {
                                        setActiveId(c.bookingId);
                                        setMobileOpen(true);
                                        setShowDetails(false);
                                    }}
                                    className={
                                        'w-full text-left p-4 border-b flex gap-3 ' +
                                        (c.unread ? 'bg-emerald-50/50' : '')
                                    }
                                >
                                    <div className="w-12 h-12 rounded-xl bg-slate-200 overflow-hidden flex-shrink-0">
                                        {c.listing && c.listing.images && c.listing.images[0] && (
                                            <img
                                                src={getImageUrl(c.listing.images[0])}
                                                alt=""
                                                className="w-full h-full object-cover"
                                            />
                                        )}
                                    </div>

                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-semibold text-slate-900 truncate">
                                                {capitializeFirst(c.otherName)}
                                            </span>
                                            {c.unread > 0 && (
                                                <span className="flex-shrink-0 text-xs font-bold text-white bg-emerald-700 rounded-full px-1.5">
                                                    {c.unread}
                                                </span>
                                            )}
                                            {c.lastMessage && (
                                                <span className="ml-auto text-xs text-slate-400 flex-shrink-0">
                                                    {timeAgo(c.lastMessage.created_at)}
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-1.5 mt-0.5">
                                            <span
                                                className={
                                                    'text-[10px] font-semibold px-1.5 py-0.5 rounded ' +
                                                    (stageStyles[c.stage] || stageStyles.past)
                                                }
                                            >
                                                {stageWords[c.stage] || 'Past'}
                                            </span>
                                            <span className="text-xs text-slate-500 truncate">
                                                {(c.listing && c.listing.title) || 'Listing'}
                                            </span>
                                        </div>

                                        {c.lastMessage && (
                                            <div
                                                className={
                                                    'text-xs truncate mt-1 ' +
                                                    (c.needsReply
                                                        ? 'text-slate-900 font-medium'
                                                        : 'text-slate-400')
                                                }
                                            >
                                                {c.needsReply && (
                                                    <span className="text-amber-600">&bull; </span>
                                                )}
                                                {c.lastMessage.body}
                                            </div>
                                        )}
                                    </div>
                                </button>
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
                                    {thread ? capitializeFirst(thread.other.name) : 'Loading…'}
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

                        {/* The third column, folded away until asked for. */}
                        {showDetails && thread && (
                            <div className="border-b bg-slate-50 max-h-64 overflow-y-auto">
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
