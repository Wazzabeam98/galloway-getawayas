'use client';

import { useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';
import { displayName } from '@/lib/utils';
import { notify } from '@/lib/notify';
import { resolveTemplate } from '@/lib/messageTemplates';
import { bookingsChanged } from '@/components/base/usePendingCount';

export default function BookingActions({
    bookingId,
    mode = 'pending',
    allowCancel = true,
    allowRefund = true,
    totalPrice = 0,
    amountPaid = 0,
    amountRefunded = 0,
}: {
    bookingId: string;
    mode?: 'pending' | 'confirmed';
    // Off once the guest has arrived. Cancelling refunds the whole stay and
    // puts the dates back on sale, which is the wrong answer to a problem
    // found on the second night — Refund guest is.
    allowCancel?: boolean;
    // Off on the home page card, which is a summary rather than the place to
    // settle a complaint. Deciding what a bad stay is worth belongs on the
    // booking itself, with the full picture of what has been paid in front of
    // you — so the card offers calling it off and nothing finer-grained.
    allowRefund?: boolean;
    totalPrice?: number;
    amountPaid?: number;
    amountRefunded?: number;
}) {
    const supabase = createClientComponentClient();
    const router = useRouter();
    const [updating, setUpdating] = useState(false);
    const [panel, setPanel] = useState<'none' | 'cancel' | 'decline' | 'refund'>('none');
    const [refundAmount, setRefundAmount] = useState('');
    // Whether they have asked for the amount box. Refunding the whole lot is
    // the main action; a part refund is a deliberate second choice.
    const [partial, setPartial] = useState(false);
    const [panelError, setPanelError] = useState('');

    const refundable = Math.round((Number(amountPaid) - Number(amountRefunded)) * 100) / 100;
    const penalty = Math.round(Number(totalPrice) * 0.05 * 100) / 100;

    const closeRefund = () => {
        setPanel('none');
        setPartial(false);
        setRefundAmount('');
        setPanelError('');
    };

    // Giving money back without calling the stay off. The amount is passed in
    // rather than read from the box, because the main action refunds the whole
    // of what is left and never touches the box at all.
    const sendRefundOf = async (requested: number) => {
        setPanelError('');
        const value = Math.round(Number(requested) * 100) / 100;

        if (!value || isNaN(value) || value <= 0) {
            setPanelError('Enter how much to refund.');
            return;
        }
        if (value > refundable) {
            setPanelError('The guest has only paid £' + refundable.toFixed(2) + '.');
            return;
        }

        setUpdating(true);
        try {
            const res = await fetch('/api/bookings/host-refund', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingId: bookingId, amount: value }),
            });
            const data = await res.json();

            if (data && data.ok) {
                toast.success('£' + value.toFixed(2) + ' refunded to your guest.', { theme: 'colored' });
                closeRefund();
                router.refresh();
            } else {
                setPanelError((data && data.error) || 'Could not process the refund.');
            }
        } catch (err) {
            setPanelError('Could not process the refund.');
        }
        setUpdating(false);
    };

    // Posts the host's saved welcome message into the conversation, if they
    // have one switched on. Deliberately silent on failure — a booking that
    // was successfully confirmed should never look like it failed just
    // because an optional courtesy message didn't send.
    const sendWelcomeMessage = async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session?.user) return;

            // A host can have several booking-confirmation templates now, each
            // scoped to different properties. This used to be .single(), which
            // *errors* on a second row — and the error is swallowed by the
            // catch below so a confirmed booking never looks broken, meaning
            // welcome messages would have stopped sending with nothing said.
            const { data: candidates } = await supabase
                .from('message_templates')
                .select('id, user_id, template_type, body, enabled, anchor, minutes_after, created_at')
                .eq('user_id', session.user.id)
                .eq('template_type', 'booking_confirmation');

            if (!candidates || candidates.length === 0) return;

            const { data: scopes } = await supabase
                .from('message_template_listings')
                .select('template_id, listing_id')
                .in('template_id', candidates.map((t: any) => t.id));

            const scopeOf: Record<string, string[]> = {};
            (scopes || []).forEach((r: any) => {
                if (!scopeOf[r.template_id]) scopeOf[r.template_id] = [];
                scopeOf[r.template_id].push(r.listing_id);
            });

            const { data: booking } = await supabase
                .from('bookings')
                .select('guest_id, host_id, listing_id, check_in, check_out')
                .eq('id', bookingId)
                .single();
            if (!booking) return;

            // Only the host sends this, and only to the guest.
            if (booking.host_id !== session.user.id) return;

            // Which of their templates covers this property. Same rule the
            // scheduled sender uses, from the same file, so the two can never
            // disagree about which message a guest should get.
            const template = resolveTemplate(
                candidates.map((t: any) => ({ ...t, listingIds: scopeOf[t.id] || [] })),
                'booking_confirmation',
                booking.listing_id
            );

            if (!template) return;

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

            // Only send from here when the host chose "as soon as you accept".
            // Any delay is handled by the scheduled job instead.
            if (template.anchor !== 'booking' || (template.minutes_after || 0) > 0) return;
            let body = (template.body || '').trim();
            if (!body) return;

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

        // The money moves BEFORE the booking changes. If the refund fails the
        // booking is left exactly as it was, so nobody is told their stay is
        // off while their payment is still sitting here. Better a host who
        // has to try again than a guest who is declined and not repaid.
        if (status === 'declined' || status === 'cancelled') {
            let refunded = false;
            let reason = '';

            try {
                const res = await fetch('/api/stripe/refund', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bookingId: bookingId, reason: status }),
                });
                const data = await res.json();
                refunded = !!(data && data.ok);
                reason = (data && data.error) || '';
            } catch (err: any) {
                reason = (err && err.message) || '';
            }

            if (!refunded) {
                setUpdating(false);
                toast.error(
                    'The refund could not be processed, so the booking has been left unchanged. '
                        + (reason ? reason + '. ' : '')
                        + 'Please check Stripe and try again.',
                    { theme: 'colored' }
                );
                return;
            }
        }

        // Declining or cancelling is finished by the refund route above — it
        // moves the money and closes the booking in one place, so a tab closed
        // at the wrong moment can't leave a refunded guest with a booking that
        // still reads as confirmed. Only accepting is still set from here,
        // because no money moves for it.
        if (status === 'confirmed') {
            const { error } = await supabase
                .from('bookings')
                .update({
                    status: status,
                    // Scheduled messages anchored to acceptance need to know when
                    // that was.
                    confirmed_at: new Date().toISOString(),
                })
                .eq('id', bookingId);

            if (error) {
                setUpdating(false);
                toast.error(error.message, { theme: 'colored' });
                return;
            }
        }

        if (status === 'confirmed') {
            await sendWelcomeMessage();
        }

        // Only now, with the money returned and the booking updated, is it
        // safe to tell the guest.
        notify('booking_status', bookingId);

        setUpdating(false);

        const messages: Record<string, string> = {
            confirmed: 'Booking confirmed.',
            declined: 'Booking declined.',
            cancelled: 'Booking cancelled.',
        };
        toast.success(messages[status], { theme: 'colored' });

        // The menu badge is a client component that router.refresh() does not
        // re-run, so without this the dot stays lit on a request that has just
        // been answered.
        bookingsChanged();

        router.refresh();
    };

    if (mode === 'confirmed') {
        if (panel === 'cancel') {
            return (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-left max-w-md">
                    <div className="text-sm font-semibold text-red-900">
                        Cancel this booking?
                    </div>
                    <p className="text-sm text-red-800 mt-1">
                        Your guest has this stay confirmed and may have arranged travel around it.
                        They&apos;ll be refunded the full £{refundable.toFixed(2)} they have paid,
                        whatever your cancellation policy says, and the dates go back on sale.
                    </p>
                    {penalty > 0 && (
                        <p className="text-sm text-red-800 mt-2">
                            A cancellation fee of <strong>£{penalty.toFixed(2)}</strong> (5% of the
                            booking) will be taken off your next payout.
                        </p>
                    )}
                    <p className="text-xs text-red-700 mt-2">
                        If you only want to give some money back and still host the stay, close this
                        and choose Refund guest instead.
                    </p>

                    <div className="mt-3 flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => updateStatus('cancelled')}
                            disabled={updating}
                            className="px-4 py-2 bg-red-700 hover:bg-red-800 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
                        >
                            {updating ? 'Cancelling…' : 'Yes, cancel it'}
                        </button>
                        <button
                            type="button"
                            onClick={() => setPanel('none')}
                            className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
                        >
                            Keep the booking
                        </button>
                    </div>
                </div>
            );
        }

        if (panel === 'refund') {
            return (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left max-w-md">
                    <div className="text-sm font-semibold text-slate-900">Refund your guest</div>
                    <p className="text-sm text-slate-600 mt-1">
                        For when something wasn&apos;t right but the stay is still going ahead. The
                        booking stays confirmed and the amount comes off what you&apos;re paid.
                    </p>

                    {/* Giving back everything is the common answer and used to
                        be the one that took typing. The amount is in the label
                        rather than in a box, so a single press is never
                        ambiguous about how much is leaving. */}
                    <button
                        type="button"
                        onClick={() => sendRefundOf(refundable)}
                        disabled={updating}
                        className="mt-3 w-full px-4 py-2.5 bg-slate-900 hover:bg-black text-white text-sm font-semibold rounded-lg disabled:opacity-50"
                    >
                        {updating && !partial
                            ? 'Refunding…'
                            : 'Refund the full £' + refundable.toFixed(2)}
                    </button>

                    {!partial ? (
                        <button
                            type="button"
                            onClick={() => { setPartial(true); setPanelError(''); }}
                            disabled={updating}
                            className="mt-3 text-sm font-semibold text-slate-600 underline hover:text-slate-900 disabled:opacity-50"
                        >
                            Refund part of it instead
                        </button>
                    ) : (
                        <div className="mt-3 pt-3 border-t border-slate-200">
                            <div className="text-xs text-slate-500 mb-2">
                                Anything up to £{refundable.toFixed(2)}.
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-slate-500">£</span>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={refundAmount}
                                    onChange={(e) => setRefundAmount(e.target.value)}
                                    placeholder="0.00"
                                    autoFocus
                                    className="w-28 border rounded-lg px-3 py-2 text-sm outline-none focus:border-slate-900"
                                />
                                <button
                                    type="button"
                                    onClick={() => sendRefundOf(Number(refundAmount))}
                                    disabled={updating}
                                    className="px-4 py-2 border border-slate-300 hover:border-slate-900 text-slate-800 text-sm font-semibold rounded-lg disabled:opacity-50"
                                >
                                    {updating ? 'Refunding…' : 'Send that instead'}
                                </button>
                            </div>
                        </div>
                    )}

                    {panelError && <p className="text-xs text-red-600 mt-2">{panelError}</p>}

                    <button
                        type="button"
                        onClick={closeRefund}
                        disabled={updating}
                        className="mt-3 block text-sm font-semibold text-slate-500 hover:text-slate-900 disabled:opacity-50"
                    >
                        Don&apos;t refund anything
                    </button>
                </div>
            );
        }

        return (
            <div className="flex gap-2">
                {allowRefund && refundable > 0 && (
                    <button
                        type="button"
                        onClick={() => { setPanel('refund'); setPartial(false); setPanelError(''); }}
                        disabled={updating}
                        className="px-4 py-1.5 border border-slate-300 hover:border-slate-500 text-slate-700 text-sm font-semibold rounded-lg disabled:opacity-50"
                    >
                        Refund guest
                    </button>
                )}
                {allowCancel && (
                    <button
                        type="button"
                        onClick={() => setPanel('cancel')}
                        disabled={updating}
                        className="px-4 py-1.5 border border-slate-300 hover:border-red-400 hover:text-red-600 text-slate-700 text-sm font-semibold rounded-lg disabled:opacity-50"
                    >
                        Cancel booking
                    </button>
                )}
            </div>
        );
    }

    // Declining sends the guest's money back. It used to fire on one click,
    // which was survivable while these buttons only existed on the bookings
    // list; they are on the home page card now, on a surface that is itself a
    // link, so a misplaced click has to be recoverable.
    if (panel === 'decline') {
        return (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-left max-w-md">
                <div className="text-sm font-semibold text-red-900">
                    Decline this request?
                </div>
                <p className="text-sm text-red-800 mt-1">
                    {refundable > 0
                        ? 'Your guest is refunded the full £' + refundable.toFixed(2)
                            + ' they have paid, and the dates go back on sale.'
                        : 'The request is turned down and the dates go back on sale.'}
                </p>
                <p className="text-xs text-red-700 mt-2">
                    There is no undoing this — they would have to book again, and the dates
                    may be gone by then.
                </p>

                <div className="mt-3 flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => updateStatus('declined')}
                        disabled={updating}
                        className="px-4 py-2 bg-red-700 hover:bg-red-800 text-white text-sm font-semibold rounded-lg disabled:opacity-50"
                    >
                        {updating ? 'Declining…' : 'Yes, decline it'}
                    </button>
                    <button
                        type="button"
                        onClick={() => setPanel('none')}
                        className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900"
                    >
                        Keep the request
                    </button>
                </div>
            </div>
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
                {updating ? 'Confirming…' : 'Confirm'}
            </button>
            <button
                type="button"
                onClick={() => setPanel('decline')}
                disabled={updating}
                className="px-4 py-1.5 border border-slate-300 hover:border-slate-500 text-slate-700 text-sm font-semibold rounded-lg disabled:opacity-50"
            >
                Decline
            </button>
        </div>
    );
}
