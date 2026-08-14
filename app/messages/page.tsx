'use client';

import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import Link from 'next/link';
import Logo from '@/components/base/Logo';
import LoginModel from '@/components/auth/LoginModel';
import { getImageUrl, capitializeFirst } from '@/lib/utils';

export default function MessagesInboxPage() {
    const supabase = createClientComponentClient();
    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<any>(null);
    const [conversations, setConversations] = useState<any[]>([]);

    useEffect(() => {
        const load = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setSession(session);
            if (!session?.user) {
                setLoading(false);
                return;
            }

            const uid = session.user.id;

            const { data: bookings } = await supabase
                .from('bookings')
                .select('id, listing_id, guest_id, host_id, check_in, check_out')
                .or(`guest_id.eq.${uid},host_id.eq.${uid}`)
                .order('created_at', { ascending: false });

            if (!bookings || bookings.length === 0) {
                setConversations([]);
                setLoading(false);
                return;
            }

            const listingIds = Array.from(new Set(bookings.map((b) => b.listing_id)));
            const { data: listings } = await supabase.from('listings').select('id, title, images').in('id', listingIds);
            const listingMap = new Map((listings || []).map((l) => [l.id, l]));

            const otherPartyIds = Array.from(new Set(bookings.map((b) => (b.guest_id === uid ? b.host_id : b.guest_id))));
            const { data: profiles } = await supabase.from('profiles').select('id, full_name, preferred_name').in('id', otherPartyIds);
            const profileMap = new Map((profiles || []).map((p) => [p.id, p.preferred_name || p.full_name || 'User']));

            const bookingIds = bookings.map((b) => b.id);
            const { data: lastMessages } = await supabase
                .from('messages')
                .select('booking_id, body, created_at')
                .in('booking_id', bookingIds)
                .order('created_at', { ascending: false });

            const lastMessageMap = new Map<string, any>();
            (lastMessages || []).forEach((m) => {
                if (!lastMessageMap.has(m.booking_id)) lastMessageMap.set(m.booking_id, m);
            });

            const convos = bookings.map((b) => {
                const otherId = b.guest_id === uid ? b.host_id : b.guest_id;
                return {
                    bookingId: b.id,
                    listing: listingMap.get(b.listing_id),
                    otherName: profileMap.get(otherId) || 'User',
                    checkIn: b.check_in,
                    checkOut: b.check_out,
                    lastMessage: lastMessageMap.get(b.id),
                };
            });

            setConversations(convos);
            setLoading(false);
        };
        load();
    }, [supabase]);

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
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-8">Messages</h1>

            {conversations.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-2xl border border-slate-200">
                    <h3 className="text-lg font-semibold text-slate-800">No conversations yet</h3>
                    <p className="text-slate-500 mt-1">Messages tied to your bookings will show up here.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {conversations.map((c) => (
                        <Link
                            key={c.bookingId}
                            href={`/messages/${c.bookingId}`}
                            className="flex items-center gap-4 border rounded-2xl p-4 hover:border-slate-400 transition"
                        >
                            <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-200 flex-shrink-0">
                                {c.listing?.images?.[0] && (
                                    <img src={getImageUrl(c.listing.images[0])} alt={c.listing.title} className="w-full h-full object-cover" />
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="font-semibold text-slate-900">{capitializeFirst(c.otherName)}</div>
                                <div className="text-sm text-slate-500 truncate">{c.listing?.title || 'Listing'} · {c.checkIn} → {c.checkOut}</div>
                                {c.lastMessage && (
                                    <div className="text-sm text-slate-400 truncate mt-0.5">{c.lastMessage.body}</div>
                                )}
                            </div>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
