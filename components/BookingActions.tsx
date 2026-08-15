'use client';

import { useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';
import { displayName } from '@/lib/utils';

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

            const { data: template } = await supabase
                .from('message_templates')
                .select('body, enabled, anchor, minutes_after')
                .eq('user_id', session.user.id)
                .eq('template_type', 'booking_confirmation')
                .single();

            if (!template?.enabled) return;

            // Only send from here when the host chose "as soon as you accept".
            // Any delay is handled by the scheduled job instead.
            if (template.anchor !== 'booking' || (template.minutes_after || 0) > 0) return;
            let body = (template.body || '').trim();
            if (!body) return;

            const { data: booking } = await supabase
                .from('bookings')
                .select('guest_id, host_id, listing_id, check_in, check_out')
                .eq('id', bookingId)
                .single();
            if (!booking) return;

            // Only the host sends this, and only to the guest.
            if (booking.host_id !== session.user.id) return;

            // Don't send it twice if the booking is confirmed more than once.
            const { data: already } = await supabase
                .from('sent_scheduled_messages')
                .select('id')
                .eq('booking_id', bookingId)
                .eq('template_type', 'booking_confirmation')
                .maybeSingle();
            if (already) return;

            const { data: guest } = await supabase
                .from('profiles')
                .select('full_name, preferred_name, show_full_name')
                .eq('id', booking.guest_id)
                .single();

            const { data: listing } = await supabase
                .from('listings')
                .select('title')
                .eq('id', booking.listing_id)
                .single();

            // First name only, to match how {guest_name} renders elsewhere.
            const fullGuestName = displayName(guest, 'there');
            const guestName = fullGuestName.split(' ')[0] || 'there';
            const formatDate = (value: string | null) => {
                if (!value) return '';
                const d = new Date(value);
                return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
            };

            body = body
                .split('{guest_name}').join(guestName)
                .split('{listing}').join(listing?.title || 'your stay')
                .split('{check_in}').join(formatDate(booking.check_in))
                .split('{check_out}').join(formatDate(booking.check_out));

            await supabase.from('messages').insert({
                booking_id: bookingId,
                sender_id: session.user.id,
                recipient_id: booking.guest_id,
                body: body,
            });

            await supabase.from('sent_scheduled_messages').insert({
                booking_id: bookingId,
                template_type: 'booking_confirmation',
            });
        } catch (err) {
            console.error('Welcome message could not be sent:', err);
        }
    };

    const updateStatus = async (status: 'confirmed' | 'declined' | 'cancelled') => {
        setUpdating(true);
        const patch: Record<string, any> = { status };
        // Scheduled messages anchored to acceptance need to know when that was.
        if (status === 'confirmed') {
            patch.confirmed_at = new Date().toISOString();
        }

        const { error } = await supabase.from('bookings').update(patch).eq('id', bookingId);

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
