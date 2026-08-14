'use client';

import { useEffect, useRef, useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useParams, useRouter } from 'next/navigation';
import Logo from '@/components/base/Logo';
import LoginModel from '@/components/auth/LoginModel';
import { toast } from 'react-toastify';
import { ChevronLeft, Send } from 'lucide-react';
import Link from 'next/link';
import { capitializeFirst } from '@/lib/utils';

interface Message {
    id: string;
    sender_id: string;
    body: string;
    created_at: string;
}

export default function ConversationPage() {
    const params = useParams();
    const bookingId = params?.bookingId as string;
    const supabase = createClientComponentClient();
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [session, setSession] = useState<any>(null);
    const [notAllowed, setNotAllowed] = useState(false);
    const [otherName, setOtherName] = useState('');
    const [listingTitle, setListingTitle] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [text, setText] = useState('');
    const [sending, setSending] = useState(false);

    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const load = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            setSession(session);

            if (!session?.user || !bookingId) {
                setLoading(false);
                return;
            }
            const uid = session.user.id;

            const { data: booking } = await supabase
                .from('bookings')
                .select('id, listing_id, guest_id, host_id')
                .eq('id', bookingId)
                .single();

            if (!booking || (booking.guest_id !== uid && booking.host_id !== uid)) {
                setNotAllowed(true);
                setLoading(false);
                return;
            }

            const otherId = booking.guest_id === uid ? booking.host_id : booking.guest_id;
            const { data: profile } = await supabase.from('profiles').select('full_name, preferred_name').eq('id', otherId).single();
            setOtherName(profile?.preferred_name || profile?.full_name || 'User');

            const { data: listing } = await supabase.from('listings').select('title').eq('id', booking.listing_id).single();
            setListingTitle(listing?.title || 'Listing');

            const { data: msgs } = await supabase
                .from('messages')
                .select('id, sender_id, body, created_at')
                .eq('booking_id', bookingId)
                .order('created_at', { ascending: true });
            setMessages(msgs || []);

            setLoading(false);
        };
        load();
    }, [supabase, bookingId]);

    // Live updates: new messages from the other person appear without a refresh.
    useEffect(() => {
        if (!bookingId) return;

        const channel = supabase
            .channel(`messages-${bookingId}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'messages', filter: `booking_id=eq.${bookingId}` },
                (payload) => {
                    setMessages((prev) => {
                        if (prev.some((m) => m.id === (payload.new as any).id)) return prev;
                        return [...prev, payload.new as Message];
                    });
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [supabase, bookingId]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = async () => {
        if (!text.trim() || !session?.user) return;

        const { data: booking } = await supabase
            .from('bookings')
            .select('guest_id, host_id')
            .eq('id', bookingId)
            .single();
        if (!booking) return;

        const recipientId = booking.guest_id === session.user.id ? booking.host_id : booking.guest_id;

        setSending(true);
        const { error } = await supabase.from('messages').insert({
            booking_id: bookingId,
            sender_id: session.user.id,
            recipient_id: recipientId,
            body: text.trim(),
        });
        setSending(false);

        if (error) {
            toast.error(error.message, { theme: 'colored' });
            return;
        }
        setText('');
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-4">
                <Logo />
                <p className="text-slate-500 animate-pulse">Loading conversation...</p>
            </div>
        );
    }

    if (!session) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-6 text-center px-4">
                <Logo />
                <h1 className="text-2xl font-bold text-slate-900">Sign in to view this conversation</h1>
                <LoginModel />
            </div>
        );
    }

    if (notAllowed) {
        return <div className="text-center py-20 text-slate-500">You don't have access to this conversation.</div>;
    }

    return (
        <div className="max-w-2xl mx-auto px-6 py-6 flex flex-col h-[calc(100vh-100px)]">
            <div className="flex items-center gap-3 mb-4 pb-4 border-b">
                <Link href="/messages" className="p-1.5 rounded-full hover:bg-slate-100">
                    <ChevronLeft className="w-5 h-5" />
                </Link>
                <div>
                    <div className="font-semibold text-slate-900">{capitializeFirst(otherName)}</div>
                    <div className="text-xs text-slate-500">{listingTitle}</div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {messages.length === 0 ? (
                    <p className="text-center text-sm text-slate-400 mt-10">No messages yet — say hello.</p>
                ) : (
                    messages.map((m) => {
                        const mine = m.sender_id === session.user.id;
                        return (
                            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm ${mine ? 'bg-rose-500 text-white' : 'bg-slate-100 text-slate-800'}`}>
                                    {m.body}
                                </div>
                            </div>
                        );
                    })
                )}
                <div ref={bottomRef} />
            </div>

            <div className="flex items-center gap-2 mt-4 pt-4 border-t">
                <input
                    type="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
                    placeholder="Write a message..."
                    className="flex-1 p-3 border rounded-xl text-sm"
                />
                <button
                    type="button"
                    onClick={handleSend}
                    disabled={sending || !text.trim()}
                    className="p-3 bg-rose-500 hover:bg-rose-600 text-white rounded-xl disabled:opacity-50"
                >
                    <Send className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}
