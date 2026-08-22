export const dynamic = "force-dynamic";

import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { adminClient } from "@/lib/supabaseAdmin";
import { checkListing } from "@/lib/access";
import { displayName, getImageUrl, formatTime } from "@/lib/utils";
import { rateFor, netOfFee } from "@/lib/fees";
import { formatUk, refundFraction, policyOf, freeCancelDateOrNull } from "@/lib/cancellation";
import { stayHasEnded, stayHasStarted } from "@/lib/stayWindow";
import { dateFromKey } from "@/lib/pricing";
import BookingActions from "@/components/BookingActions";
import { ArrowLeft, MessageSquare, Phone } from "lucide-react";

// One booking, in full.
//
// Everything here was already on the row and shown nowhere — what has been
// paid, what is still to come and when, what has been refunded, whether the
// payout has gone. The bookings list had to stay skimmable, so the detail
// went nowhere; clicking a booking scrolled you to the summary you were
// already looking at. This is the screen for when something has gone wrong.

function money(value: number): string {
    return '£' + Number(value || 0).toFixed(2);
}

function Row({ label, value, muted }: { label: string; value: any; muted?: boolean }) {
    return (
        <div className="flex items-baseline justify-between gap-6 py-2 border-b border-slate-100 last:border-0">
            <div className="text-sm text-slate-500">{label}</div>
            <div className={'text-sm text-right ' + (muted ? 'text-slate-500' : 'font-medium text-slate-900')}>
                {value}
            </div>
        </div>
    );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="border border-slate-200 rounded-2xl p-6 bg-white">
            <h2 className="font-semibold text-slate-900 mb-3">{title}</h2>
            {children}
        </div>
    );
}

const statusStyles: Record<string, string> = {
    confirmed: 'bg-green-100 text-green-800',
    pending: 'bg-amber-100 text-amber-800',
    pending_payment: 'bg-slate-100 text-slate-600',
    declined: 'bg-slate-100 text-slate-500',
    cancelled: 'bg-slate-100 text-slate-500',
};

const statusWords: Record<string, string> = {
    confirmed: 'Confirmed',
    pending: 'Waiting for you',
    pending_payment: 'Guest is paying',
    declined: 'Declined',
    cancelled: 'Cancelled',
};

export default async function BookingDetail({ params }: { params: { id: string } }) {
    const supabase = createServerComponentClient({ cookies });
    const { data: user } = await supabase.auth.getUser();
    const uid = user.user?.id || '';

    const admin = adminClient();

    // Read with the service key — a co-host is not the host_id on a booking
    // row, so row-level security would hand back nothing and this would look
    // like a missing booking rather than a permissions question. Access is
    // decided immediately below instead.
    const { data: booking } = await admin
        .from('bookings')
        .select('*')
        .eq('id', params.id)
        .maybeSingle();

    if (!booking) notFound();

    const access = await checkListing(uid, booking.listing_id, 'can_bookings');
    if (!access) notFound();

    // Cancelling, declining and refunding are never delegated, whatever else
    // somebody has been given. The routes behind them answer 403 to anyone who
    // is not the host_id, so a co-host is shown the booking without the
    // buttons that would fail.
    const isOwner = access.isOwner;
    const showMoney = access.can_earnings;

    const { data: listing } = await admin
        .from('listings')
        .select('id, title, images, check_in_time, check_out_time, commission_rate, cancellation_policy, damage_deposit')
        .eq('id', booking.listing_id)
        .maybeSingle();

    const { data: guest } = await admin
        .from('profiles')
        .select('id, full_name, preferred_name, show_full_name, phone, email')
        .eq('id', booking.guest_id)
        .maybeSingle();

    const guestName = displayName(guest, 'Guest');
    const firstName = guestName.split(' ')[0] || 'there';

    const now = new Date();
    const started = stayHasStarted(booking.check_in, now);
    const ended = stayHasEnded(booking.check_out, listing?.check_out_time, now);

    const rate = booking.commission_rate !== null && booking.commission_rate !== undefined
        ? Number(booking.commission_rate)
        : rateFor(listing);

    const total = Number(booking.total_price || 0);
    const paid = Number(booking.amount_paid || 0);
    const refunded = Number(booking.amount_refunded || 0);
    const outstanding = Math.round((total - paid) * 100) / 100;
    const grossDue = Math.round((total - refunded) * 100) / 100;
    const yours = netOfFee(grossDue > 0 ? grossDue : 0, rate);

    // A stay pays out the day after check-in.
    const paysOn = dateFromKey(booking.check_in);
    paysOn.setDate(paysOn.getDate() + 1);

    // free_cancel_until is stamped by the checkout route, so it is null on
    // anything that did not come through it — and a null there means 'not
    // recorded', not 'the window has closed'. Work it out from the policy in
    // that case rather than telling a host their guest has lost a right they
    // still have.
    const freeCancelDisplay = booking.free_cancel_until
        ? dateFromKey(booking.free_cancel_until)
        : freeCancelDateOrNull(booking.check_in, listing?.cancellation_policy);

    // A guest cancelling right now would get this much back, under the
    // policy on the listing. Worth knowing before asking them to.
    const guestWouldGet = Math.round(refundFraction(booking.check_in, listing?.cancellation_policy) * paid * 100) / 100;

    const nights = Math.round(
        (dateFromKey(booking.check_out).getTime() - dateFromKey(booking.check_in).getTime()) / 86400000
    );

    const partySize = Number(booking.adults || 0) + Number(booking.children || 0);
    const partyBits: string[] = [];
    if (booking.adults) partyBits.push(booking.adults + (Number(booking.adults) === 1 ? ' adult' : ' adults'));
    if (booking.children) partyBits.push(booking.children + (Number(booking.children) === 1 ? ' child' : ' children'));
    if (booking.pets) partyBits.push(booking.pets + (Number(booking.pets) === 1 ? ' pet' : ' pets'));

    // A number is only on the page close to arrival — the same rule the home
    // page card uses. There is no reason to put a guest's private number on a
    // screen that opens the moment somebody signs in.
    const daysToArrival = Math.round(
        (dateFromKey(booking.check_in).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000
    );
    const phone = (daysToArrival <= 1 && !ended) ? (guest?.phone || null) : null;

    // Prefills the message box rather than sending anything. The host adds
    // the reason and presses send — a stay called off in the guest's name
    // without them reading it first is not something to automate.
    //
    // One paragraph, no line breaks, and short. The composer on the other end
    // is a single-line <input>, which silently drops newlines: a draft written
    // in paragraphs arrived with its sentences run together, and only the
    // first sixty characters are visible while the host reads it back. It also
    // has to be sendable exactly as it stands, because a bracketed 'fill this
    // in' note is one distracted press away from reaching the guest.
    const shortDate = (value: string) =>
        dateFromKey(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });

    const askToCancelDraft =
        'Hi ' + firstName + ', I’m very sorry — I’ve run into a problem with '
        + (listing?.title || 'the property')
        + ' and I don’t think I can host you for '
        + shortDate(booking.check_in) + ' to ' + shortDate(booking.check_out)
        + ' as planned. If you cancel from Your trips you’d be refunded '
        + money(guestWouldGet) + '. Do let me know and I’ll help however I can.';

    return (
        <div className="max-w-3xl mx-auto px-6 py-10">
            <Link
                href="/dashboard/bookings"
                className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
            >
                <ArrowLeft className="w-4 h-4" />
                All bookings
            </Link>

            <div className="flex items-start gap-4 mt-4 mb-8">
                <div className="w-20 h-20 rounded-xl overflow-hidden bg-slate-200 flex-shrink-0">
                    {listing?.images?.[0] && (
                        <img
                            src={getImageUrl(listing.images[0])}
                            alt={listing.title}
                            className="w-full h-full object-cover"
                        />
                    )}
                </div>
                <div className="min-w-0">
                    <h1 className="text-2xl font-bold text-slate-900 truncate">
                        {listing?.title || 'Booking'}
                    </h1>
                    <p className="text-slate-600 mt-0.5">
                        {formatUk(dateFromKey(booking.check_in))} &rarr; {formatUk(dateFromKey(booking.check_out))}
                        {' '}&middot; {nights} {nights === 1 ? 'night' : 'nights'}
                    </p>
                    <span className={`inline-block mt-2 text-xs font-semibold px-3 py-1 rounded-full ${statusStyles[booking.status] || 'bg-slate-100 text-slate-600'}`}>
                        {statusWords[booking.status] || booking.status}
                    </span>
                </div>
            </div>

            <div className="space-y-5">
                <Card title="Your guest">
                    <Row label="Name" value={guestName} />
                    <Row
                        label="Party"
                        value={partyBits.length ? partyBits.join(', ') : (partySize || booking.guests) + ' guests'}
                    />
                    {phone ? (
                        <Row
                            label="Phone"
                            value={
                                <a href={'tel:' + phone} className="inline-flex items-center gap-1.5 hover:underline">
                                    <Phone className="w-3.5 h-3.5" />
                                    {phone}
                                </a>
                            }
                        />
                    ) : (
                        <Row label="Phone" value="Shown from the day before arrival" muted />
                    )}
                    <Row
                        label="Arriving"
                        value={
                            (formatTime(listing?.check_in_time) || 'any time')
                            + ', leaving by ' + (formatTime(listing?.check_out_time) || '11am')
                        }
                        muted
                    />
                </Card>

                {showMoney ? (
                    <Card title="Money">
                        <Row label="Guest pays in total" value={money(total)} />
                        <Row label="Paid so far" value={money(paid)} />
                        {outstanding > 0 && (
                            <Row
                                label="Still to come"
                                value={
                                    money(outstanding)
                                    + (booking.balance_due_date
                                        ? ', charged ' + formatUk(dateFromKey(booking.balance_due_date))
                                        : '')
                                }
                            />
                        )}
                        {refunded > 0 && <Row label="Refunded to guest" value={'−' + money(refunded)} />}
                        <Row label={'Our fee (' + rate + '%)'} value={'−' + money(grossDue - yours)} muted />
                        <Row label="You get" value={money(yours)} />
                        <Row
                            label="Payout"
                            value={
                                booking.payout_transfer_id
                                    ? 'Sent — ' + money(Number(booking.payout_amount || 0))
                                    : booking.status !== 'confirmed'
                                        ? 'Nothing to send'
                                        : started
                                            ? 'Was due ' + formatUk(paysOn) + ' — not recorded as sent'
                                            : 'Due ' + formatUk(paysOn) + ', the day after check-in'
                            }
                            muted={!booking.payout_transfer_id}
                        />
                        {Number(listing?.damage_deposit || 0) > 0 && (
                            <Row
                                label="Damage deposit"
                                value={money(Number(listing?.damage_deposit)) + ' — you collect this yourself'}
                                muted
                            />
                        )}
                    </Card>
                ) : (
                    <Card title="Money">
                        <p className="text-sm text-slate-500">
                            You look after this booking but not its takings, so the figures are
                            hidden. The owner can change that under Co-hosts.
                        </p>
                    </Card>
                )}

                <Card title="Payment">
                    <Row
                        label="Plan"
                        value={booking.payment_plan === 'deposit' ? 'Deposit, then the balance' : 'Paid in full at booking'}
                    />
                    <Row
                        label="Stage"
                        value={
                            booking.payment_status === 'paid'
                                ? 'Everything paid'
                                : booking.payment_status === 'deposit_paid'
                                    ? 'Deposit paid, balance outstanding'
                                    : 'Nothing paid yet'
                        }
                    />
                    {booking.confirmed_at && (
                        <Row label="You accepted" value={formatUk(new Date(booking.confirmed_at))} muted />
                    )}
                    <Row
                        label="Free cancellation for guest"
                        value={
                            freeCancelDisplay
                                ? 'Until ' + formatUk(freeCancelDisplay)
                                : 'Window has closed'
                        }
                        muted
                    />
                    <Row
                        label="If they cancelled today"
                        value={money(guestWouldGet) + ' back (' + policyOf(listing?.cancellation_policy) + ')'}
                        muted
                    />
                </Card>

                <Card title="What you can do">
                    <div className="flex flex-wrap gap-3 pt-1">
                        <Link
                            href={'/messages/' + booking.id}
                            className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 hover:border-slate-900 text-slate-800 text-sm font-semibold rounded-lg transition"
                        >
                            <MessageSquare className="w-4 h-4" />
                            Message guest
                        </Link>

                        {isOwner && booking.status === 'confirmed' && !ended && (
                            <Link
                                href={'/messages/' + booking.id + '?draft=' + encodeURIComponent(askToCancelDraft)}
                                className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 hover:border-slate-900 text-slate-800 text-sm font-semibold rounded-lg transition"
                            >
                                Ask the guest to cancel
                            </Link>
                        )}
                    </div>

                    {isOwner && booking.status === 'pending' && (
                        <div className="mt-4">
                            <BookingActions
                                bookingId={booking.id}
                                totalPrice={total}
                                amountPaid={paid}
                                amountRefunded={refunded}
                            />
                        </div>
                    )}

                    {isOwner && booking.status === 'confirmed' && !started && (
                        <div className="mt-4">
                            <BookingActions
                                bookingId={booking.id}
                                mode="confirmed"
                                totalPrice={total}
                                amountPaid={paid}
                                amountRefunded={refunded}
                            />
                        </div>
                    )}

                    {isOwner && booking.status === 'confirmed' && started && !ended && (
                        <div className="mt-4">
                            <p className="text-sm text-slate-500 mb-3">
                                Your guest has arrived, so calling the stay off in full is no longer
                                the right instrument. Refund part of what they paid and let the stay
                                run, or ask them to cancel.
                            </p>
                            <BookingActions
                                bookingId={booking.id}
                                mode="confirmed"
                                allowCancel={false}
                                totalPrice={total}
                                amountPaid={paid}
                                amountRefunded={refunded}
                            />
                        </div>
                    )}

                    {!isOwner && (
                        <p className="text-sm text-slate-500 mt-4">
                            Accepting, cancelling and refunding stay with the owner.
                        </p>
                    )}
                </Card>
            </div>
        </div>
    );
}
