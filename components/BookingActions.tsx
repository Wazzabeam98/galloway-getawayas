'use client';

import { useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';

export default function BookingActions({ bookingId, mode = 'pending' }: { bookingId: string; mode?: 'pending' | 'confirmed' }) {
    const supabase = createClientComponentClient();
    const router = useRouter();
    const [updating, setUpdating] = useState(false);

    // Posts the host's saved welcome message into the conversation, if they
    // have one switched on. Deliberately silent on failure — a booking that
    // was successfully confirmed should never look like it failed just
    // because an optional courtesy message didn't send.
    const sendWelcomeMessage = async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.user) return;

            const { data: profile } = await supabase
                .from('profiles')
                .select('welcome_message, welcome_message_enabled')
                .eq('id', session.user.id)
                .single();

            if (!profile?.welcome_message_enabled) return;
            const body = (profile.welcome_message || '').trim();
            if (!body) return;

            const { data: booking } = await supabase
                .from('bookings')
                .select('guest_id, host_id')
                .eq('id', bookingId)
                .single();
            if (!booking) return;

            // Only the host sends this, and only to the guest.
            if (booking.host_id !== session.user.id) return;

            await supabase.from('messages').insert({
                booking_id: bookingId,
                sender_id: session.user.id,
                recipient_id: booking.guest_id,
                body: body,
            });
        } catch (err) {
            console.error('Welcome message could not be sent:', err);
        }
    };

    const updateStatus = async (status: 'confirmed' | 'declined' | 'cancelled') => {
        setUpdating(true);
        const { error } = await supabase.from('bookings').update({ status }).eq('id', bookingId);

        if (error) {
            setUpdating(false);
            toast.error(error.message, { theme: 'colored' });
            return;
        }

        if (status === 'confirmed') {
            await sendWelcomeMessage();
        }

        setUpdating(false);

        const messages: Record<string, string> = {
            confirmed: 'Booking confirmed.',
            declined: 'Booking declined.',
            cancelled: 'Booking cancelled.',
        };
        toast.success(messages[status], { theme: 'colored' });
        router.refresh();
    };

    if (mode === 'confirmed') {
        return (
            <button
                type="button"
                onClick={() => {
                    if (confirm('Cancel this confirmed booking? The guest will need to be told separately, since this only updates your records here.')) {
                        updateStatus('cancelled');
                    }
                }}
                disabled={updating}
                className="px-4 py-1.5 border border-slate-300 hover:border-red-400 hover:text-red-600 text-slate-700 text-sm font-semibold rounded-lg disabled:opacity-50"
            >
                Cancel booking
            </button>
        );
    }

    return (
        <div className="flex gap-2">
            <button
                type="button"
                onClick={() => updateStatus('confirmed')}
                disabled={updating}
                className="px-4 py-1.5 bg-slate-900 hover:bg-black text-white text-sm font-semibold rounded-lg disabled:opacity-50"
            >
                Confirm
            </button>
            <button
                type="button"
                onClick={() => updateStatus('declined')}
                disabled={updating}
                className="px-4 py-1.5 border border-slate-300 hover:border-slate-500 text-slate-700 text-sm font-semibold rounded-lg disabled:opacity-50"
            >
                Decline
            </button>
        </div>
    );
}
