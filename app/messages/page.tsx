'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Link from 'next/link';
import Logo from '@/components/base/Logo';
import LoginModel from '@/components/auth/LoginModel';
import { getImageUrl, capitializeFirst } from '@/lib/utils';
import { Search, Inbox } from 'lucide-react';

export default function MessagesInboxPage() {
    const supabase = createClientComponentClient();
    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<any>(null);
    const [conversations, setConversations] = useState<any[]>([]);
    const [query, setQuery] = useState('');
    const [unreadOnly, setUnreadOnly] = useState(false);

    useEffect(() => {
        const load = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setSession(session);
            if (!session?.user) {
                setLoading(false);
                return;
            }

            const res = await fetch('/api/messages/threads');
            const convos = res.ok ? (await res.json()).conversations || [] : [];

            setConversations(convos);
            setLoading(false);
        };
        load();
    }, [supabase]);

    const totalUnread = useMemo(
        () => conversations.reduce((sum, c) => sum + (c.unread || 0), 0),
        [conversations]
    );

    // Searching by name and by property, since a host is as likely to think
    // "the Kirkcudbright one" as to remember who booked it.
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();

        return conversations.filter((c) => {
            if (unreadOnly && !c.unread) return false;
            if (!q) return true;

            const name = (c.otherName || '').toLowerCase();
            const place = ((c.listing && c.listing.title) || '').toLowerCase();
            const body = ((c.lastMessage && c.lastMessage.body) || '').toLowerCase();

            return name.indexOf(q) !== -1 || place.indexOf(q) !== -1 || body.indexOf(q) !== -1;
        });
    }, [conversations, query, unreadOnly]);

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

    return (
        <div className="max-w-3xl mx-auto px-6 py-10">
            <div className="flex items-baseline gap-3 mb-6">
                <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Messages</h1>
                {totalUnread > 0 && (
                    <span className="text-sm font-semibold text-white bg-emerald-700 rounded-full px-2.5 py-0.5">
                        {totalUnread} new
                    </span>
                )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2 mb-6">
                <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search by name, property or message"
                        className="w-full pl-9 pr-3 py-2.5 border rounded-xl text-sm outline-none focus:border-slate-900"
                    />
                </div>
                <button
                    type="button"
                    onClick={() => setUnreadOnly(!unreadOnly)}
                    className={
                        'px-4 py-2.5 rounded-xl text-sm font-semibold border transition whitespace-nowrap ' +
                        (unreadOnly
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'text-slate-600 hover:border-slate-900')
                    }
                >
                    Unread{totalUnread > 0 ? ' (' + totalUnread + ')' : ''}
                </button>
            </div>

            {shown.length === 0 ? (
                <div className="border rounded-2xl p-10 text-center">
                    <Inbox className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                    <p className="text-slate-600 font-medium">
                        {conversations.length === 0
                            ? 'No messages yet'
                            : unreadOnly
                                ? 'Nothing unread'
                                : 'Nothing matches that'}
                    </p>
                    {conversations.length > 0 && (
                        <button
                            type="button"
                            onClick={() => {
                                setQuery('');
                                setUnreadOnly(false);
                            }}
                            className="text-sm text-slate-500 underline hover:text-slate-800 mt-2"
                        >
                            Show everything
                        </button>
                    )}
                </div>
            ) : (
                <div className="space-y-3">
                    {shown.map((c) => (
                        <Link
                            key={c.bookingId}
                            href={`/messages/${c.bookingId}`}
                            className={
                                'flex items-center gap-4 p-4 border rounded-2xl transition hover:border-slate-400 ' +
                                (c.unread ? 'bg-emerald-50/50 border-emerald-200' : '')
                            }
                        >
                            <div className="w-16 h-16 rounded-xl bg-slate-200 overflow-hidden flex-shrink-0">
                                {c.listing?.images?.[0] && (
                                    <img
                                        src={getImageUrl(c.listing.images[0])}
                                        alt={c.listing.title}
                                        className="w-full h-full object-cover"
                                    />
                                )}
                            </div>

                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <div className="font-semibold text-slate-900 truncate">
                                        {capitializeFirst(c.otherName)}
                                    </div>
                                    {c.unread > 0 && (
                                        <span className="flex-shrink-0 text-xs font-bold text-white bg-emerald-700 rounded-full px-2 py-0.5">
                                            {c.unread}
                                        </span>
                                    )}
                                </div>

                                <div className="text-sm text-slate-500 truncate">
                                    {c.listing?.title || 'Listing'} · {c.checkIn} → {c.checkOut}
                                </div>

                                {c.lastMessage && (
                                    <div
                                        className={
                                            'text-sm truncate mt-0.5 ' +
                                            (c.unread ? 'text-slate-900 font-medium' : 'text-slate-400')
                                        }
                                    >
                                        {c.lastMessage.body}
                                    </div>
                                )}
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
