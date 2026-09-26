export const dynamic = 'force-dynamic';

import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { adminClient } from '@/lib/supabaseAdmin';
import { checkListing } from '@/lib/access';
import { displayName, capitializeFirst } from '@/lib/utils';
import { ukLongDate } from '@/lib/dayKey';
import { round2, whoAnswers, refundSplit } from '@/lib/bookingChange';
import ChangeRequestActions from '@/components/reservations/ChangeRequestActions';

// The review page for a proposed change, shown to whoever must act on it — the
// guest (for a host proposal) or the host (for a guest proposal). Read through
// the service role and gated to the two parties on the booking.
export default async function ChangeRequestPage({ params }: { params: { id: string } }) {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return (
            <div className="mx-auto max-w-lg px-4 py-16 text-center">
                <h1 className="text-xl font-bold text-slate-900">Please sign in</h1>
                <p className="mt-2 text-sm text-slate-500">Sign in to review this change.</p>
                <Link href="/" className="mt-4 inline-block rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Go to Galloway Getaways</Link>
            </div>
        );
    }

    const admin = adminClient();
    const { data: chg } = await admin
        .from('booking_change_requests')
        .select('id, booking_id, host_id, guest_id, initiated_by, new_check_in, new_check_out, new_guests, new_children, new_pets, new_total, old_check_in, old_check_out, old_guests, old_children, old_pets, old_total, price_delta, status')
        .eq('id', params.id)
        .maybeSingle();
    if (!chg) notFound();

    const { data: booking } = await admin.from('bookings').select('listing_id, amount_paid, amount_refunded').eq('id', chg.booking_id).maybeSingle();
    const isGuest = chg.guest_id === user.id;
    const isHost = !isGuest && !!(booking && await checkListing(user.id, booking.listing_id, 'can_bookings'));
    if (!isGuest && !isHost) notFound();
    const viewer: 'host' | 'guest' = isGuest ? 'guest' : 'host';

    const { data: listing } = booking ? await admin.from('listings').select('title').eq('id', booking.listing_id).maybeSingle() : { data: null };
    const otherId = viewer === 'guest' ? chg.host_id : chg.guest_id;
    const { data: other } = await admin.from('profiles').select('full_name, preferred_name, show_full_name').eq('id', otherId).maybeSingle();
    const otherReal = displayName(other, '');
    const otherFirst = otherReal ? capitializeFirst(otherReal.split(' ')[0]) : (viewer === 'guest' ? 'Your host' : 'Your guest');
    const stayName = (listing && listing.title) || 'the stay';
    const delta = round2(Number(chg.price_delta));

    // Split a decrease the same way the money actually settles: only overpayment
    // against the new total comes back to the card; the rest lowers a deposit
    // booking's remaining balance. Drives both the button and the summary so
    // neither promises a card refund that a deposit guest won't receive.
    const netPaid = round2(Number(booking?.amount_paid || 0) - Number(booking?.amount_refunded || 0));
    const { cardRefund, balanceDrop } = refundSplit(netPaid, round2(Number(chg.old_total)), round2(Number(chg.new_total)));

    const answerer = whoAnswers(chg.initiated_by as any);
    // What THIS viewer can do now.
    const canAnswer = chg.status === 'pending' && viewer === answerer;       // accept/decline (or approve)
    const canPay = chg.status === 'awaiting_guest_payment' && viewer === 'guest';
    const canWithdraw = (chg.status === 'pending' || chg.status === 'awaiting_guest_payment')
        && viewer !== answerer && !(canPay);

    const guestLine = (g: number, c: number, p: number) =>
        g + ' guest' + (g === 1 ? '' : 's') + (c ? ' · ' + c + ' child' + (c === 1 ? '' : 'ren') : '') + (p ? ' · ' + p + ' pet' + (p === 1 ? '' : 's') : '');
    const datesChanged = chg.old_check_in !== chg.new_check_in || chg.old_check_out !== chg.new_check_out;
    const guestsChanged = chg.old_guests !== chg.new_guests || chg.old_children !== chg.new_children || chg.old_pets !== chg.new_pets;

    const proposer = chg.initiated_by === 'host' ? 'host' : 'guest';
    const heading = viewer === 'host'
        ? (proposer === 'guest' ? otherFirst + ' requested a change' : 'A change to this stay')
        : (proposer === 'host' ? otherFirst + ' proposed a change' : 'Your requested change');

    const statusLine: Record<string, string> = {
        awaiting_guest_payment: viewer === 'guest' ? 'Approved — pay to confirm the change.' : 'Approved. Waiting for the guest to pay.',
        accepted: 'This change was accepted. The booking has been updated.',
        declined: 'This change was declined. The booking is unchanged.',
        cancelled: 'This change is off. The booking is unchanged.',
        expired: 'This change request has expired.',
    };

    // The label the actor sees when accepting.
    const acceptLabel = delta > 0
        ? (viewer === 'guest' ? 'Accept and pay £' + delta.toFixed(2) : 'Approve — guest pays £' + delta.toFixed(2))
        : delta < 0
            // A card refund only when something is actually coming back to the card;
            // a decrease that only shrinks the balance keeps a plain "Accept".
            ? (cardRefund > 0
                ? (viewer === 'guest' ? 'Accept and get £' + cardRefund.toFixed(2) + ' back' : 'Approve — refund £' + cardRefund.toFixed(2))
                : (viewer === 'guest' ? 'Accept the change' : 'Approve the change'))
            : (viewer === 'guest' ? 'Accept the change' : 'Approve the change');

    return (
        <div className="mx-auto min-h-[calc(100dvh-4rem)] max-w-lg px-4 py-8">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700">Change to the stay</p>
                <h1 className="mt-1.5 text-2xl font-bold text-slate-900">{heading}</h1>
                <p className="mt-1 text-sm text-slate-500">{stayName}.</p>

                <div className="mt-5 space-y-3">
                    {datesChanged && (
                        <Diff label="Dates"
                            from={ukLongDate(String(chg.old_check_in)) + ' → ' + ukLongDate(String(chg.old_check_out))}
                            to={ukLongDate(String(chg.new_check_in)) + ' → ' + ukLongDate(String(chg.new_check_out))} />
                    )}
                    {guestsChanged && (
                        <Diff label="Guests"
                            from={guestLine(chg.old_guests, chg.old_children, chg.old_pets)}
                            to={guestLine(chg.new_guests, chg.new_children, chg.new_pets)} />
                    )}
                    <Diff label="Total" from={'£' + round2(chg.old_total).toFixed(2)} to={'£' + round2(chg.new_total).toFixed(2)} />
                </div>

                <div className="mt-5 rounded-xl bg-slate-50 p-3 text-[15px] text-slate-700">
                    {delta > 0
                        ? <>The guest {viewer === 'guest' ? '(you) ' : ''}pay{viewer === 'guest' ? '' : 's'} an extra <strong>£{delta.toFixed(2)}</strong> to confirm.</>
                        : delta < 0
                            ? <>{decreaseSummary(viewer, cardRefund, balanceDrop)}</>
                            : <>There’s nothing extra to pay for this change.</>}
                </div>

                {canAnswer ? (
                    <ChangeRequestActions changeId={chg.id} acceptLabel={acceptLabel} declineLabel="Decline" />
                ) : canPay ? (
                    <ChangeRequestActions changeId={chg.id} acceptLabel={'Continue to payment · £' + delta.toFixed(2)} payOnly />
                ) : canWithdraw ? (
                    <>
                        <p className="mt-5 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">Waiting for {otherFirst} to respond.</p>
                        <ChangeRequestActions changeId={chg.id} withdrawOnly />
                    </>
                ) : (
                    <p className="mt-5 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{statusLine[chg.status] || 'This change is closed.'}</p>
                )}

                <p className="mt-4 text-[12px] text-slate-400">Nothing changes on the booking until it’s agreed. Payments are handled securely by Stripe.</p>
            </div>
        </div>
    );
}

// The honest summary for a decrease: money back to the card only for what the
// guest overpaid, the rest shown as a drop in the balance they've yet to pay.
// A deposit booking still below the new total shows only the balance drop, never
// a card refund the guest won't see.
function decreaseSummary(viewer: 'host' | 'guest', cardRefund: number, balanceDrop: number) {
    const money = (n: number) => <strong>£{n.toFixed(2)}</strong>;
    const subj = viewer === 'guest' ? 'You’re' : 'The guest is';
    const their = viewer === 'guest' ? 'your' : 'their';
    if (cardRefund > 0 && balanceDrop > 0) {
        return <>{subj} refunded {money(cardRefund)} to {viewer === 'guest' ? 'your' : 'their'} original card, and {their} remaining balance drops by {money(balanceDrop)}.</>;
    }
    if (cardRefund > 0) {
        return <>{subj} refunded {money(cardRefund)} to {viewer === 'guest' ? 'your' : 'their'} original card.</>;
    }
    return <>{viewer === 'guest' ? 'Your' : 'The guest’s'} remaining balance drops by {money(balanceDrop)}. Nothing goes back to the card — the reduced nights hadn’t been paid yet.</>;
}

function Diff({ label, from, to }: { label: string; from: string; to: string }) {
    return (
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
            <span className="text-[13px] font-semibold text-slate-500">{label}</span>
            <span className="text-right text-[14px]">
                <span className="block text-slate-400 line-through">{from}</span>
                <span className="block font-semibold text-slate-900">{to}</span>
            </span>
        </div>
    );
}
