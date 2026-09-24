export const dynamic = "force-dynamic";

import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { adminClient } from "@/lib/supabaseAdmin";
import { checkListing, accessibleListings } from "@/lib/access";
import { displayName, getImageUrl, capitializeFirst } from "@/lib/utils";
import { rateFor, netOfFee } from "@/lib/fees";
import { formatUk, refundDue, policyOf, freeCancelUntilKey } from "@/lib/cancellation";
import { londonDayKey } from "@/lib/dayKey";
import { contactNumberVisible, stayHasEnded, stayHasStarted } from "@/lib/stayWindow";
import { outstandingDebts, outstandingOf, debtAgainstStays, debtReason, round2 } from "@/lib/hostDebt";
import { dateFromKey } from "@/lib/pricing";
import { confirmationNumber, cancellationWords } from "@/lib/bookingDisplay";
import EditableDoorCode from "@/components/dashboard/reservation/EditableDoorCode";
import CancellationPolicyCard from "@/components/dashboard/reservation/CancellationPolicyCard";
import MoneyCards, { type MoneyCardsData, type MoneyDetailRow } from "@/components/dashboard/reservation/MoneyCards";
import ManageReservationSheet from "@/components/dashboard/reservation/ManageReservationSheet";
import {
    ArrowLeft, MessageSquare, Phone, CheckCircle2, Clock3, XCircle,
    ChevronRight,
} from "lucide-react";

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

// The status pill, in the reservation-page family: a label and a tone, the same
// three tones (ok / wait / over) the guest trip page uses, so the two read as
// one product from either side of the booking.
const STATUS: Record<string, { label: string; tone: 'ok' | 'wait' | 'over' }> = {
    confirmed: { label: 'Confirmed', tone: 'ok' },
    pending: { label: 'Waiting for you', tone: 'wait' },
    pending_payment: { label: 'Guest is paying', tone: 'wait' },
    declined: { label: 'Declined', tone: 'over' },
    cancelled: { label: 'Cancelled', tone: 'over' },
};
const PILL: Record<string, string> = {
    ok: 'bg-emerald-100 text-emerald-800',
    wait: 'bg-amber-100 text-amber-800',
    over: 'bg-slate-200 text-slate-600',
};

function weekday(dateStr: string): string {
    const d = new Date(String(dateStr).slice(0, 10) + 'T12:00:00');
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { weekday: 'long' });
}
function dateLong(dateStr: string): string {
    const d = new Date(String(dateStr).slice(0, 10) + 'T12:00:00');
    return isNaN(d.getTime()) ? String(dateStr) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
// "24 Sep" — the compact day used in the reservations rail's date range.
function shortDay(dateStr: string): string {
    const d = new Date(String(dateStr).slice(0, 10) + 'T12:00:00');
    return isNaN(d.getTime()) ? String(dateStr) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
// "3:00pm" from a stored 'HH:MM[:SS]'. Null in, null out — no invented time.
function timeLabel(t: string | null | undefined): string | null {
    if (!t) return null;
    const [h, m] = String(t).split(':').map(Number);
    if (isNaN(h)) return null;
    const ampm = h < 12 ? 'am' : 'pm';
    const h12 = ((h + 11) % 12) + 1;
    return h12 + ':' + String(m || 0).padStart(2, '0') + ampm;
}

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
        .select('id, title, images, location, check_in_time, check_in_end_time, check_out_time, commission_rate, cancellation_policy, damage_deposit, host_id, max_guests, amenities')
        .eq('id', booking.listing_id)
        .maybeSingle();

    // The guest's private contact details — phone and email only. Their NAME is
    // NOT here: for a silent/seed guest account the profile_private name columns
    // are null and the account name lives on profiles. Reading the name from this
    // table is exactly why the rail and the "Who's going" line fell back to
    // "Group of N" and "Guest" — the name was in the other table all along.
    const { data: guest } = await admin
        .from('profile_private')
        .select('id, phone, email')
        .eq('id', booking.guest_id)
        .maybeSingle();

    // Name and avatar from the guest's profile (the account name + picture),
    // like every other name on the site.
    const { data: guestProfile } = await admin
        .from('profiles')
        .select('id, full_name, preferred_name, show_full_name, avatar_url')
        .eq('id', booking.guest_id)
        .maybeSingle();

    const guestName = displayName(guestProfile, 'Guest');
    const firstName = guestName.split(' ')[0] || 'there';
    const guestAvatar = guestProfile?.avatar_url ? getImageUrl(String(guestProfile.avatar_url)) : null;

    // The owner of this listing, for the "Hosted by" line — the person the
    // booking is really with. On the owner's own screen this is themselves; for
    // a co-host it names whose property they are looking after. Read from
    // profiles (the public-facing name + avatar), never profile_private.
    const { data: owner } = listing?.host_id
        ? await admin
            .from('profiles')
            .select('id, full_name, preferred_name, show_full_name, avatar_url')
            .eq('id', listing.host_id)
            .maybeSingle()
        : { data: null };
    const ownerName = capitializeFirst(displayName(owner, 'the owner'));
    const ownerFirst = ownerName.split(' ')[0] || ownerName;
    const ownerAvatar = owner?.avatar_url ? getImageUrl(String(owner.avatar_url)) : null;
    const ownerIsViewer = uid === listing?.host_id;

    // The door code — read ONLY when the viewer holds can_listing. This is the
    // server-side wall: a co-host without the listing permission never has the
    // code pulled from listing_access_codes, so it cannot reach their page at
    // all (the value, not just its display, is withheld). Same table and same
    // permission as /api/listings/access-code, the code's own secure route.
    // The standing listing code AND this booking's override (if any). The
    // override wins — the same precedence the guest's arrival screen and the
    // scheduled sender apply — so the host sees exactly the code the guest will.
    const [{ data: codeRow }, { data: overrideRow }] = access.can_listing
        ? await Promise.all([
            admin.from('listing_access_codes').select('code').eq('listing_id', booking.listing_id).maybeSingle(),
            admin.from('booking_access_codes').select('code').eq('booking_id', booking.id).maybeSingle(),
        ])
        : [{ data: null }, { data: null }];
    const listingCode = access.can_listing ? (codeRow?.code || null) : null;
    const doorCodeOverride = access.can_listing ? (overrideRow?.code || null) : null;
    const doorCode = doorCodeOverride || listingCode;

    // The host's private notes box has been removed from this page. The table
    // (booking_host_notes) and its route are kept — the notes and their data are
    // untouched — so it isn't read here any more.

    // An open change request on this booking, so the host can find and act on a
    // guest's request (or see the state of their own proposal).
    const { data: openChange } = await admin
        .from('booking_change_requests')
        .select('id, initiated_by, status')
        .eq('booking_id', booking.id)
        .in('status', ['pending', 'awaiting_guest_payment'])
        .maybeSingle();

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
    // The working shown on the "You get" card, using the booking's stamped
    // commission rate: "Guest paid £480 − our 10% fee £48 = £432". Base and fee
    // reconcile exactly to `yours`, so the line can never disagree with the
    // headline figure above it.
    const youGetBase = grossDue > 0 ? grossDue : 0;
    const youGetFee = round2(youGetBase - yours);
    const youGetWorking = 'Guest paid ' + money(youGetBase) + ' − our ' + rate + '% fee ' + money(youGetFee) + ' = ' + money(yours);

    // A stay pays out the day after check-in.
    const paysOn = dateFromKey(booking.check_in);
    paysOn.setDate(paysOn.getDate() + 1);

    const closed = booking.status === 'cancelled' || booking.status === 'declined';

    // Debts charged against this particular booking — the 5% fee if the host
    // called it off, or a clawback if a refund landed after the payout.
    const { data: ownDebtRows } = showMoney
        ? await admin
            .from('payouts')
            .select('id, booking_id, host_id, amount, kind, status, note, created_at, settled_amount')
            .eq('booking_id', booking.id)
            .in('kind', ['penalty', 'reversal'])
        : { data: [] };

    const ownDebts = ownDebtRows || [];

    // What this host still owes overall, and which of their coming stays it
    // will actually come off. Only their own money: payout_balance_owed
    // belongs to whoever is host_id on the booking, and a co-host looking at
    // someone else's listing has no business seeing it.
    const viewerIsPayee = uid === booking.host_id;

    const debts = (showMoney && viewerIsPayee) ? await outstandingDebts(admin, booking.host_id) : [];
    const owedTotal = debts.reduce(function (sum, d) { return round2(sum + outstandingOf(d)); }, 0);

    let deductionHere = 0;
    let owedElsewhere = 0;

    if (owedTotal > 0 && booking.status === 'confirmed' && !booking.paid_out_at) {
        // Every stay of theirs still waiting to pay out, in the order the
        // payout run will reach them.
        const { data: queue } = await admin
            .from('bookings')
            .select('id, listing_id, check_in, total_price, amount_refunded, commission_rate')
            .eq('host_id', booking.host_id)
            .eq('status', 'confirmed')
            .is('paid_out_at', null)
            .order('check_in', { ascending: true });

        const stays = (queue || []).map(function (b: any) {
            const r = b.commission_rate !== null && b.commission_rate !== undefined
                ? Number(b.commission_rate)
                : rate;
            const gross = round2(Number(b.total_price || 0) - Number(b.amount_refunded || 0));
            return { id: b.id, expected: netOfFee(gross > 0 ? gross : 0, r) };
        });

        const allocation = debtAgainstStays(owedTotal, stays);
        deductionHere = allocation[booking.id] || 0;
        owedElsewhere = round2(owedTotal - deductionHere);
    }

    // Worked out live from the policy, never from the stored free_cancel_until
    // column — nothing writes that any more, and old rows drifted a day early
    // under BST. null once the free window has passed; inclusive of the last
    // free day, so a host is not told their guest has lost a right they still
    // have that very day.
    const freeKey = freeCancelUntilKey(booking.check_in, listing?.cancellation_policy);
    const freeCancelDisplay = londonDayKey() <= freeKey ? dateFromKey(freeKey) : null;

    // A guest cancelling right now would get this much back, under the
    // policy on the listing. Worth knowing before asking them to.
    // Against what they are actually still holding, not what they once paid.
    // A booking already part-refunded cannot give back the whole amount again.
    const stillHeld = round2(paid - refunded);
    // The very function the refund routes run, so the figure a host is quoted
    // is the figure the guest actually receives.
    const guestWouldGet = refundDue({
        amountPaid: paid,
        alreadyRefunded: refunded,
        cleaningFee: booking.cleaning_fee,
        checkIn: booking.check_in,
        policy: listing?.cancellation_policy,
    });

    const nights = Math.round(
        (dateFromKey(booking.check_out).getTime() - dateFromKey(booking.check_in).getTime()) / 86400000
    );

    const partySize = Number(booking.adults || 0) + Number(booking.children || 0);
    const partyBits: string[] = [];
    if (booking.adults) partyBits.push(booking.adults + (Number(booking.adults) === 1 ? ' adult' : ' adults'));
    if (booking.children) partyBits.push(booking.children + (Number(booking.children) === 1 ? ' child' : ' children'));
    if (booking.pets) partyBits.push(booking.pets + (Number(booking.pets) === 1 ? ' pet' : ' pets'));
    // "3 adults · 1 child · 1 pet", pets included — the same phrasing the guest
    // trip card uses, so the two never disagree about who's on a stay.
    // The Guests card's second line, Airbnb-style: the party beyond the lead
    // guest, then the make-up — e.g. "+2 · 1 adult, 1 pet". With no one beyond the
    // lead it is just the make-up.
    const partyBreakdown = partyBits.join(', ');
    const extraPeople = Math.max(0, (partySize || Number(booking.guests || 1)) - 1);
    const guestsCardRow = (extraPeople > 0 ? '+' + extraPeople + ' · ' : '') + (partyBreakdown || (partySize || booking.guests) + ' guests');

    // The confirmation code and the day the booking was made — both derived from
    // the row already in memory (the code from the id, so there is no new
    // column; the date from created_at).
    const confCode = confirmationNumber(booking.id);
    const bookedOn = booking.created_at ? formatUk(new Date(booking.created_at)) : null;

    // THE UPCOMING RAIL — the host's other arrivals, shown beside this booking so
    // the page sits inside the run of stays rather than on its own. Scoped to the
    // listings this viewer may see bookings for (a co-host sees only theirs), the
    // next few confirmed/pending arrivals from today on, this booking excluded.
    const todayKey = londonDayKey(now);
    const bookableIds = (await accessibleListings(uid)).filter((a) => a.can_bookings).map((a) => a.listingId);
    const { data: upcomingRows } = bookableIds.length
        ? await admin
            .from('bookings')
            .select('id, listing_id, guest_id, check_in, check_out, status, adults, children, guests')
            .in('listing_id', bookableIds)
            .in('status', ['confirmed', 'pending'])
            .gte('check_in', todayKey)
            .neq('id', booking.id)
            .order('check_in', { ascending: true })
            .limit(20)
        : { data: [] };
    const upcoming = upcomingRows || [];
    const upListingIds = Array.from(new Set(upcoming.map((b: any) => b.listing_id)));
    const upGuestIds = Array.from(new Set(upcoming.map((b: any) => b.guest_id)));
    const { data: upListings } = upListingIds.length
        ? await admin.from('listings').select('id, title, images').in('id', upListingIds)
        : { data: [] };
    // Names and avatars come from profiles, not profile_private: the account name
    // (and picture) lives there, while profile_private holds only contact details
    // and, for a silent/seed guest, no name at all. Reading the name from
    // profile_private is what made every row say "Group of N" instead of the
    // guest's first name.
    const { data: upGuests } = upGuestIds.length
        ? await admin.from('profiles').select('id, full_name, preferred_name, show_full_name, avatar_url').in('id', upGuestIds)
        : { data: [] };
    const upListingMap: Record<string, { title: string; image: string | null }> = {};
    (upListings || []).forEach((l: any) => {
        upListingMap[l.id] = { title: l.title, image: Array.isArray(l.images) && l.images[0] ? getImageUrl(l.images[0]) : null };
    });
    // First name only, so the list reads like the reservations rail on Airbnb —
    // and never the word "Guest": where a guest hasn't shared a name we drop the
    // possessive rather than print a placeholder. The host is entitled to the
    // first name of a guest on their own booking even when that guest hides their
    // full name publicly, so this reads the stored name directly rather than
    // through displayName's public (show_full_name) gate.
    const upGuestFirst: Record<string, string | null> = {};
    const upGuestAvatar: Record<string, string | null> = {};
    (upGuests || []).forEach((g: any) => {
        const held = String(g.preferred_name || g.full_name || '').trim();
        upGuestFirst[g.id] = held ? (held.split(/\s+/)[0] || null) : null;
        upGuestAvatar[g.id] = g.avatar_url ? getImageUrl(String(g.avatar_url)) : null;
    });
    // "Sara's group of 4" — the guest's first name and the party size (people,
    // pets aside). The list says who is coming and how many, at a glance.
    const groupLabel = (b: any): string => {
        const size = Number(b.adults || 0) + Number(b.children || 0) || Number(b.guests || 0) || 1;
        const first = upGuestFirst[b.guest_id];
        return first ? `${first}'s group of ${size}` : `Group of ${size}`;
    };

    // A number is only on the page close to arrival. There is no reason to put
    // a guest's private number on a screen that opens the moment somebody
    // signs in. The rule itself lives in lib/stayWindow.ts, so the reservation
    // card, this screen and the messages panel cannot drift apart.
    const phone = contactNumberVisible(booking, listing?.check_out_time, now)
        ? (guest?.phone || null)
        : null;

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

    // Five values, not three. 'refunded' and 'partially_refunded' both used to
    // fall through to 'Nothing paid yet', which told a host their guest had
    // never paid for a stay that had been paid for and refunded.
    const paymentStage =
        booking.payment_status === 'paid' ? 'Everything paid'
            : booking.payment_status === 'deposit_paid' ? 'Deposit paid, balance outstanding'
                : booking.payment_status === 'refunded' ? 'Paid, then refunded in full'
                    : booking.payment_status === 'partially_refunded' ? 'Paid, then partly refunded'
                        : 'Nothing paid yet';

    const whoCancelled =
        booking.cancelled_by_role === 'host'
            ? (viewerIsPayee ? 'by you' : 'by the owner')
            : booking.cancelled_by_role === 'guest' ? 'by the guest'
                : booking.cancelled_by_role === 'system' ? 'automatically' : '';

    const cancelledLine = booking.cancelled_at
        ? (whoCancelled ? whoCancelled + ' on ' : 'on ') + formatUk(new Date(booking.cancelled_at))
        : (closed ? 'Not recorded — this predates us writing it down' : '');

    const meta = STATUS[booking.status] || { label: booking.status, tone: 'over' as const };
    const hero = listing?.images?.[0] ? getImageUrl(listing.images[0]) : null;
    const area = listing?.location || null;

    // ---- Money & payment, arranged for the three compact cards. Every figure
    // is formatted here (the same helpers the payout run uses) and each appears
    // once: the fee breakdown behind "You get", the payment stage behind "Paid
    // so far", the payout reasoning behind "Payout". ----
    const payoutStatus = booking.payout_transfer_id
        ? 'Sent — ' + money(Number(booking.payout_amount || 0))
        : booking.status !== 'confirmed'
            ? 'Nothing to send'
            : started
                ? 'Was due ' + formatUk(paysOn) + ' — not recorded as sent'
                : 'Due ' + formatUk(paysOn) + ', the day after check-in';
    const payoutHeadline = booking.payout_transfer_id
        ? 'Sent'
        : booking.status !== 'confirmed'
            ? '—'
            : started ? 'Overdue' : formatUk(paysOn);

    const earningRows: MoneyDetailRow[] = [{ label: 'Guest pays in total', value: money(total) }];
    if (refunded > 0) earningRows.push({ label: 'Refunded to guest', value: '−' + money(refunded) });
    if (round2(grossDue - yours) > 0) earningRows.push({ label: 'Our fee (' + rate + '%)', value: '−' + money(grossDue - yours), muted: true });
    earningRows.push({ label: 'You get', value: money(yours) });
    if (Number(listing?.damage_deposit || 0) > 0) earningRows.push({ label: 'Damage deposit', value: money(Number(listing?.damage_deposit)) + ' — you collect this yourself', muted: true });

    const paymentRows: MoneyDetailRow[] = [
        { label: 'Plan', value: booking.payment_plan === 'deposit' ? 'Deposit, then the balance' : 'Paid in full at booking' },
        { label: 'Stage', value: paymentStage },
    ];
    if (outstanding > 0) paymentRows.push({ label: 'Still to come', value: money(outstanding) + (booking.balance_due_date ? ', charged ' + formatUk(dateFromKey(booking.balance_due_date)) : '') });
    if (booking.confirmed_at) paymentRows.push({ label: 'You accepted', value: formatUk(new Date(booking.confirmed_at)), muted: true });
    if (!closed) {
        paymentRows.push({ label: 'Free cancellation for guest', value: freeCancelDisplay ? 'Until ' + formatUk(freeCancelDisplay) : 'Window has closed', muted: true });
        paymentRows.push({ label: 'If they cancelled today', value: money(guestWouldGet) + ' back (' + policyOf(listing?.cancellation_policy) + ')', muted: true });
    }
    if (closed && cancelledLine) paymentRows.push({ label: 'Cancelled', value: cancelledLine, muted: true });

    const payoutRows: MoneyDetailRow[] = [{ label: 'When', value: payoutStatus, muted: !booking.payout_transfer_id }];
    ownDebts.forEach((d: any) => payoutRows.push({
        label: debtReason(d.kind),
        value: '−' + money(Math.abs(Number(d.amount || 0)))
            + (d.status === 'settled'
                ? ' — taken from a later payout'
                : outstandingOf(d) < Math.abs(Number(d.amount || 0))
                    ? ' — ' + money(outstandingOf(d)) + ' of it still to come off'
                    : ' — comes off your next payout'),
    }));
    if (deductionHere > 0) {
        payoutRows.push({ label: 'Less owed from before', value: '−' + money(deductionHere) + (owedElsewhere > 0 ? ' (' + money(owedElsewhere) + ' more off later stays)' : '') });
        payoutRows.push({ label: 'Expected in your bank', value: money(round2(yours - deductionHere) > 0 ? round2(yours - deductionHere) : 0) });
    }

    const moneyProps: MoneyCardsData = {
        showMoney,
        youGet: money(yours),
        youGetWorking,
        paidSoFar: money(paid),
        ofTotal: 'of ' + money(total),
        payoutHeadline,
        earningRows,
        paymentRows,
        payoutRows,
    };

    // The ask-to-cancel draft is the same one this screen has always offered.
    const askToCancelHref = (isOwner && booking.status === 'confirmed' && !ended)
        ? '/messages?b=' + booking.id + '&draft=' + encodeURIComponent(askToCancelDraft)
        : null;

    return (
        <div className="min-h-[calc(100dvh-81px)] bg-slate-50">
            <div className="mx-auto max-w-[1200px] px-4 sm:px-6 py-6">
                <Link
                    href="/dashboard/bookings"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800"
                >
                    <ArrowLeft className="h-4 w-4" />
                    All bookings
                </Link>

                {/* Airbnb's host shape: a full-height reservations panel runs down the
                    left, divided from the rest by a thin rule (not a floating card), and
                    the one booking sits centred in the space beside it. On a phone the
                    two stack — the booking first (that is what you opened), the list
                    beneath — so the order classes only re-sort the columns at lg. */}
                <div className="mt-4 flex flex-col gap-6 lg:grid lg:grid-cols-[320px_1fr] lg:gap-x-12 lg:items-start">
                    {/* ---- MAIN COLUMN — the booking, in full. Second on desktop
                        (centred in the space beside the rail), first on a phone. ---- */}
                    <div className="min-w-0 space-y-6 lg:order-2 lg:mx-auto lg:w-full lg:max-w-[560px]">
                        {/* Hero: the property photo, the title, the status pill,
                            the nights line and — for anyone allowed the takings —
                            the total for the stay. */}
                        <div>
                            {hero && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={hero} alt={listing?.title || 'Booking'} className="h-44 w-full rounded-2xl object-cover sm:h-56" />
                            )}
                            <div className={`${hero ? 'mt-4' : ''} flex items-start justify-between gap-3`}>
                                <h1 className="min-w-0 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                                    {listing?.title || 'Booking'}
                                </h1>
                                <span className={`inline-flex flex-none items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${PILL[meta.tone]}`}>
                                    {meta.tone === 'ok' && <CheckCircle2 className="h-3 w-3" />}
                                    {meta.tone === 'wait' && <Clock3 className="h-3 w-3" />}
                                    {meta.tone === 'over' && <XCircle className="h-3 w-3" />}
                                    {meta.label}
                                </span>
                            </div>
                            <p className="mt-1.5 text-sm text-slate-500">
                                {[area, `${nights} ${nights === 1 ? 'night' : 'nights'}`].filter(Boolean).join(' · ')}
                            </p>
                            {showMoney && (
                                <p className="mt-2 text-lg font-semibold text-slate-900">
                                    {money(total)}
                                    <span className="text-sm font-normal text-slate-500"> for {nights} {nights === 1 ? 'night' : 'nights'}</span>
                                </p>
                            )}
                        </div>

                        {/* The booking column matches the guest trip card and Airbnb's
                            host view, top to bottom: the dates, the door code, hosted
                            by, then who's going as a Guests card, then the cancellation
                            policy, the money cards and the rest. */}

                        {/* 1 — Check-in / Check-out: two raised cards, the lifted-card
                            treatment reserved for surfaces you act on. */}
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            {([
                                { label: 'Check-in', date: booking.check_in, time: timeLabel(listing?.check_in_time), end: timeLabel(listing?.check_in_end_time) },
                                { label: 'Check-out', date: booking.check_out, time: timeLabel(listing?.check_out_time), end: null },
                            ] as const).map((c) => (
                                <div key={c.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{c.label}</div>
                                    <div className="mt-1 text-sm font-medium text-slate-900">{weekday(c.date)}</div>
                                    <div className="text-sm text-slate-600">{dateLong(c.date)}</div>
                                    {c.time && (
                                        <div className="mt-1 text-sm text-slate-600">
                                            {c.label === 'Check-in' ? 'From ' : 'By '}{c.time}{c.end ? `–${c.end}` : ''}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* 2 — Door code: for anyone with the listing permission. Read
                            server-side only when can_listing, so a co-host without it
                            never receives the code. Editable on an upcoming booking:
                            the edit sets an override for this booking only, without
                            changing the property's code. */}
                        {access.can_listing && (
                            <EditableDoorCode
                                bookingId={booking.id}
                                code={doorCode}
                                hasOverride={!!doorCodeOverride}
                                listingCode={listingCode}
                                editable={!closed && !ended}
                            />
                        )}

                        {/* 3 — Hosted by — whose property this is. On the owner's own
                            screen it names them; for a co-host it names the person
                            they look after it for. */}
                        <section className="border-t border-slate-200 pt-6">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h2 className="text-lg font-semibold text-slate-900">
                                        Hosted by {ownerFirst}{ownerIsViewer ? ' · you' : ''}
                                    </h2>
                                    {area && <div className="mt-0.5 text-[13px] text-slate-500">{area}</div>}
                                </div>
                                {ownerAvatar ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={ownerAvatar} alt={ownerName} className="h-12 w-12 flex-none rounded-full object-cover ring-1 ring-slate-200" />
                                ) : (
                                    <span className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-slate-100 text-base font-semibold text-slate-500">{ownerFirst.slice(0, 1)}</span>
                                )}
                            </div>
                        </section>

                        {/* 4 — Who's going, as a Guests card in the card family: the
                            lead guest's avatar (initial-letter fallback) and name, with
                            the party beneath — "+2 · 1 adult, 1 pet". */}
                        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Guests</div>
                            <div className="mt-3 flex items-center gap-3">
                                {guestAvatar ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={guestAvatar} alt={guestName} className="h-11 w-11 flex-none rounded-full object-cover ring-1 ring-slate-200" />
                                ) : (
                                    <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-slate-100 text-base font-semibold text-slate-500">{firstName.slice(0, 1).toUpperCase()}</span>
                                )}
                                <div className="min-w-0">
                                    <div className="truncate text-base font-semibold text-slate-900">{guestName}</div>
                                    <div className="text-[13px] text-slate-500">{guestsCardRow}</div>
                                </div>
                            </div>
                        </section>

                        {/* 5 — Cancellation policy — a small card showing just the tier
                            name; tapping opens the full policy in the page's pop-up. */}
                        {(() => {
                            const words = cancellationWords(listing?.cancellation_policy);
                            return <CancellationPolicyCard tier={words.tier} summary={words.summary} />;
                        })()}

                        {/* 6 — Money and the rest. Money & Payment as three compact
                            cards — You get (with the working), Paid so far, Payout —
                            each opening its full detail in the page's pop-up, gated on
                            can_earnings. */}
                        <MoneyCards {...moneyProps} />

                        {/* Manage reservation — a single row with a pencil that opens
                            the action pop-up: change, send/request money, dispute,
                            the guest's phone, ask to cancel, cancel. */}
                        {openChange && (
                            <a href={`/reservations/change/${openChange.id}`} className="mb-3 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-left transition hover:border-emerald-300">
                                <span className="flex-1 text-sm font-semibold text-emerald-900">
                                    {openChange.initiated_by === 'guest'
                                        ? (openChange.status === 'pending' ? 'Your guest requested a change — review it' : 'Change approved — waiting on the guest’s payment')
                                        : (openChange.status === 'awaiting_guest_payment' ? 'Change sent — waiting on the guest’s payment' : 'You proposed a change — waiting on the guest')}
                                </span>
                                <span className="text-[13px] font-semibold text-emerald-700">Review</span>
                            </a>
                        )}
                        <ManageReservationSheet
                            bookingId={booking.id}
                            status={booking.status}
                            isOwner={isOwner}
                            ended={ended}
                            started={started}
                            phone={phone}
                            guestFirst={firstName}
                            totalPrice={total}
                            amountPaid={paid}
                            amountRefunded={refunded}
                            askToCancelHref={askToCancelHref}
                            checkIn={String(booking.check_in).slice(0, 10)}
                            checkOut={String(booking.check_out).slice(0, 10)}
                            adults={Number(booking.adults || 0) || Math.max(1, Number(booking.guests || 1) - Number(booking.children || 0))}
                            children={Number(booking.children || 0)}
                            pets={Number(booking.pets || 0)}
                            maxGuests={Number(listing?.max_guests || 1)}
                            petsAllowed={Array.isArray(listing?.amenities) && listing!.amenities.indexOf('Pets allowed') !== -1}
                            listingId={booking.listing_id}
                            listingTitle={listing?.title || 'your stay'}
                            listingImage={hero}
                        />

                        {/* Booking details — the confirmation code (derived from the
                            id, no new column) and the day the booking was made. */}
                        <section className="border-t border-slate-200 pt-6">
                            <h2 className="text-lg font-semibold text-slate-900">Booking details</h2>
                            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
                                <div>
                                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Confirmation</div>
                                    <div className="mt-1 font-mono text-sm tracking-wide text-slate-900">{confCode}</div>
                                </div>
                                {bookedOn && (
                                    <div>
                                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Booked</div>
                                        <div className="mt-1 text-sm font-medium text-slate-900">{bookedOn}</div>
                                    </div>
                                )}
                            </div>
                        </section>

                        {/* Reach the guest — replaces the floating button. Centred in
                            the booking column and stuck to the bottom of the viewport so
                            it stays in reach however far you scroll. Call sits beside
                            Message only on a confirmed booking whose guest number we
                            actually hold (close to arrival, per lib/stayWindow). */}
                        <div className="sticky bottom-4 z-30 flex justify-center gap-3 pt-2">
                            <Link
                                href={'/messages?b=' + booking.id}
                                className="inline-flex items-center gap-2 rounded-full bg-emerald-700 px-6 py-3.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(4,120,87,0.35)] transition hover:bg-emerald-800"
                            >
                                <MessageSquare className="h-4 w-4" />
                                Message {firstName}
                            </Link>
                            {booking.status === 'confirmed' && phone && (
                                <a
                                    href={'tel:' + phone}
                                    className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-6 py-3.5 text-sm font-semibold text-slate-800 shadow-[0_10px_24px_rgba(0,0,0,0.10)] transition hover:border-slate-900"
                                >
                                    <Phone className="h-4 w-4" />
                                    Call
                                </a>
                            )}
                        </div>
                    </div>

                    {/* ---- RESERVATIONS PANEL — the host's next arrivals, run down the
                        left on desktop (first column, hence lg:order-1) and stacked
                        below the booking on a phone. A full-height panel divided from
                        the booking by a thin rule, not a floating card — the way Airbnb
                        keeps every other reservation one click away. ---- */}
                    <aside className="lg:order-1 lg:sticky lg:top-24 lg:h-[calc(100dvh-112px)] lg:border-r lg:border-slate-200 lg:pr-8">
                        <div className="flex h-full flex-col">
                            <div className="flex flex-none items-baseline gap-2 text-slate-900">
                                <span className="text-sm font-semibold">Upcoming</span>
                                <span className="text-sm text-slate-400">· {upcoming.length} {upcoming.length === 1 ? 'reservation' : 'reservations'}</span>
                            </div>
                            {upcoming.length === 0 ? (
                                <p className="mt-4 text-sm text-slate-500">Nothing else is coming up just now.</p>
                            ) : (
                                <ul className="mt-4 space-y-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                                    {upcoming.map((b: any) => {
                                        const l = upListingMap[b.listing_id];
                                        const daysTo = Math.round((dateFromKey(b.check_in).getTime() - dateFromKey(todayKey).getTime()) / 86400000);
                                        const when = daysTo <= 0 ? 'Today' : daysTo === 1 ? 'Tomorrow' : `in ${daysTo} days`;
                                        const av = upGuestAvatar[b.guest_id];
                                        const first = upGuestFirst[b.guest_id];
                                        return (
                                            <li key={b.id}>
                                                <Link href={'/dashboard/bookings/' + b.id} className="group flex items-center gap-4">
                                                    {/* The guest's avatar overlaps the listing photo, bottom-right. */}
                                                    <span className="relative flex-none">
                                                        <span className="block h-14 w-14 overflow-hidden rounded-xl bg-slate-100">
                                                            {l?.image && (
                                                                // eslint-disable-next-line @next/next/no-img-element
                                                                <img src={l.image} alt="" className="h-full w-full object-cover" />
                                                            )}
                                                        </span>
                                                        {av ? (
                                                            // eslint-disable-next-line @next/next/no-img-element
                                                            <img src={av} alt="" className="absolute -bottom-1.5 -right-1.5 h-7 w-7 rounded-full object-cover ring-2 ring-white" />
                                                        ) : (
                                                            <span className="absolute -bottom-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-600 ring-2 ring-white">{(first || '·').slice(0, 1).toUpperCase()}</span>
                                                        )}
                                                    </span>
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block text-xs font-medium text-slate-500">{shortDay(b.check_in)} – {shortDay(b.check_out)} · {when}</span>
                                                        <span className="block truncate text-sm font-semibold text-slate-900 group-hover:text-slate-950">{groupLabel(b)}</span>
                                                        <span className="block truncate text-xs text-slate-500">{l?.title || 'Your listing'}</span>
                                                    </span>
                                                    <ChevronRight className="h-4 w-4 flex-none text-slate-300" />
                                                </Link>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    </aside>
                </div>
            </div>
        </div>
    );
}
