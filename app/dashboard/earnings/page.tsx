export const dynamic = "force-dynamic";

import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import EarningsDateFilter from "@/components/EarningsDateFilter";
import MonthlyTrendChart from "@/components/MonthlyTrendChart";
import { DEFAULT_COMMISSION_PERCENT, rateFor, netOfFee, feeAmount } from '@/lib/fees';
import { formatUk } from '@/lib/cancellation';
import { createClient } from '@supabase/supabase-js';
import { listingIdsFor } from '@/lib/access';
import { outstandingDebts, outstandingOf, debtAgainstStays, debtReason, round2 } from '@/lib/hostDebt';
import { readSchedule, payoutTimingText } from '@/lib/payoutTiming';


export default async function EarningsPage({ searchParams }: { searchParams?: { from?: string; to?: string } }) {
    const supabase = createServerComponentClient({ cookies });
    const { data: user } = await supabase.auth.getUser();


    const currentYear = new Date().getFullYear();
    const from = searchParams?.from || `${currentYear}-01-01`;
    const to = searchParams?.to || `${currentYear}-12-31`;

    // Only properties they may see money for. A co-host without the earnings
    // permission sees nothing here, even for a listing they otherwise manage.
    const allowed = await listingIdsFor(user.user?.id || '', 'can_earnings');

    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );

    const { data: allBookings } = allowed.length
        ? await admin.from("bookings").select("*").in("listing_id", allowed)
        : { data: [] };

    // Everything on this page is scoped to bookings whose check-in falls
    // within the selected period.
    const bookings = (allBookings || []).filter((b) => b.check_in >= from && b.check_in <= to);

    // The payout schedule ignores the date filter: a host wants to see money
    // that is coming whatever period they happen to be looking at.
    const payoutRows = (allBookings || [])
        .filter((b) => b.status === 'confirmed')
        .sort((a, b) => (a.check_in < b.check_in ? -1 : 1));

    const listingIds = Array.from(new Set(bookings.map((b) => b.listing_id).concat(payoutRows.map((b) => b.listing_id))));
    const { data: listings } = listingIds.length
        ? await admin.from("listings").select("id, title, commission_rate").in("id", listingIds)
        : { data: [] };
    const listingMap = new Map((listings || []).map((l) => [l.id, l.title]));
    const rateMap = new Map((listings || []).map((l) => [l.id, rateFor(l)]));

    // Each booking is netted using its own listing's rate, since different
    // properties can be on different arrangements.
    const rateOfBooking = (b: any) =>
        b.commission_rate !== null && b.commission_rate !== undefined
            ? Number(b.commission_rate)
            : rateMap.get(b.listing_id) ?? DEFAULT_COMMISSION_PERCENT;

    const today = new Date();
    const confirmed = bookings.filter((b) => b.status === "confirmed");
    const pending = bookings.filter((b) => b.status === "pending");
    const cancelled = bookings.filter((b) => b.status === "cancelled");

    const upcoming = confirmed.filter((b) => new Date(b.check_in) >= today);
    const completed = confirmed.filter((b) => new Date(b.check_out) < today);

    // Sums a set of bookings after each one's own listing rate.
    const netOfBookings = (rows: any[]) =>
        rows.reduce((sum, b) => sum + netOfFee(Number(b.total_price), rateOfBooking(b)), 0);

    const grossTotal = confirmed.reduce((sum, b) => sum + Number(b.total_price), 0);
    const netTotal = netOfBookings(confirmed);
    const feeTotal = grossTotal - netTotal;

    // The headline percentage is what was actually taken across the period,
    // which is the standard rate unless a listing is on its own arrangement.
    const effectivePercent = grossTotal > 0
        ? Math.round((feeTotal / grossTotal) * 1000) / 10
        : DEFAULT_COMMISSION_PERCENT;

    const upcomingNet = netOfBookings(upcoming);
    const completedNet = netOfBookings(completed);
    const pendingGross = pending.reduce((sum, b) => sum + Number(b.total_price), 0);

    // Cancellation rate: of bookings that were ever accepted (confirmed or
    // later cancelled), what share ended up cancelled.
    const everAccepted = confirmed.length + cancelled.length;
    const cancellationRate = everAccepted > 0 ? (cancelled.length / everAccepted) * 100 : 0;

    // Monthly trend across the selected period (capped at 12 buckets so a
    // multi-year range doesn't produce an unreadable chart).
    const startDate = new Date(from);
    const endDate = new Date(to);
    const monthCount = Math.min(
        12,
        Math.max(1, (endDate.getFullYear() - startDate.getFullYear()) * 12 + (endDate.getMonth() - startDate.getMonth()) + 1)
    );
    const months: { label: string; net: number }[] = [];
    for (let i = 0; i < monthCount; i++) {
        const d = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
        const label = d.toLocaleDateString('en-GB', { month: 'short' });
        const monthNet = netOfBookings(
            confirmed.filter((b) => {
                const bd = new Date(b.check_in);
                return bd.getFullYear() === d.getFullYear() && bd.getMonth() === d.getMonth();
            })
        );
        months.push({ label, net: monthNet });
    }
    // The scale moved into MonthlyTrendChart with the bars — it is only
    // needed where the heights are worked out.

    const byListing = new Map<string, number>();
    confirmed.forEach((b) => {
        byListing.set(
            b.listing_id,
            (byListing.get(b.listing_id) || 0) + netOfFee(Number(b.total_price), rateOfBooking(b))
        );
    });
    const listingBreakdown = Array.from(byListing.entries())
        .map(([id, net]) => ({ id, title: listingMap.get(id) || 'Listing', net }))
        .sort((a, b) => b.net - a.net);

    // A stay pays out the day after check-in.
    const payoutDay = (checkIn: string) => {
        const d = new Date(checkIn);
        d.setDate(d.getDate() + 1);
        return d;
    };

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const schedule = payoutRows.map((b) => {
        const rate = rateOfBooking(b);
        const due = payoutDay(b.check_in);
        const refunded = Number(b.amount_refunded || 0);

        // The whole stay, less anything already refunded — a guest paying in
        // two parts still results in one payout for the full amount, the day
        // after they check in.
        const expectedGross = Math.round(
            (Number(b.total_price || 0) - refunded) * 100
        ) / 100;

        return {
            id: b.id,
            hostId: b.host_id,
            title: listingMap.get(b.listing_id) || 'Listing',
            checkIn: b.check_in,
            due: due,
            paidOutAt: b.paid_out_at,
            payoutAmount: b.payout_amount,
            expected: netOfFee(expectedGross > 0 ? expectedGross : 0, rate),
            fullyPaid: b.payment_status === 'paid',
            outstanding: Number(b.balance_amount || 0),
        };
    });

    const awaiting = schedule.filter((r) => !r.paidOutAt);
    const alreadyPaid = schedule.filter((r) => r.paidOutAt).reverse();

    // What this person owes back, and which of their coming payouts it will
    // come off — the same allocation the payout run performs, so the figure
    // here is the figure that arrives.
    //
    // Their own debts only. payout_balance_owed belongs to whoever is host_id
    // on a booking, and this page can show listings belonging to other people:
    // a co-host with the earnings permission must not be shown the owner's
    // debts, nor have someone else's deducted from what they are told.
    const viewerId = user.user?.id || '';

    // Read the settlement wait off the viewer's own connected account rather
    // than printing a number. This page used to say a payout landed "within a
    // couple of working days" — that was the day-after release dressed up as
    // the bank arrival, and every account checked said seven days. Stripe
    // shortens it as an account builds history, so the only honest figure is
    // whatever the account says today.
    const { data: payoutProfile } = await admin
        .from('profile_private')
        .select('stripe_account_id')
        .eq('id', viewerId)
        .maybeSingle();

    const payoutSchedule = payoutProfile && payoutProfile.stripe_account_id
        ? await readSchedule(payoutProfile.stripe_account_id)
        : null;

    const timingText = payoutTimingText(payoutSchedule ? payoutSchedule.delayDays : null);
    const debts = await outstandingDebts(admin, viewerId);
    const owedTotal = debts.reduce((sum, d) => round2(sum + outstandingOf(d)), 0);

    const myAwaiting = awaiting.filter((r) => r.hostId === viewerId);
    const deductions = owedTotal > 0 ? debtAgainstStays(owedTotal, myAwaiting) : {};

    const awaitingTotal = awaiting.reduce((sum, r) => sum + r.expected, 0);
    const deductionTotal = Object.keys(deductions).reduce(
        (sum, k) => round2(sum + deductions[k]),
        0
    );
    const netAfterDebt = round2(awaitingTotal - deductionTotal);

    // Owed more than the coming stays can absorb: the rest waits for the ones
    // after those. Saying so beats a host working it out from a total that
    // does not add up.
    const owedBeyondQueue = round2(owedTotal - deductionTotal);

    const StatCard = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
        <div className="border rounded-2xl p-5">
            <div className="text-sm text-slate-500 mb-1">{label}</div>
            <div className="text-2xl font-bold text-slate-900">{value}</div>
            {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
        </div>
    );

    return (
        <div className="max-w-5xl mx-auto px-6 py-10">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-4">
                <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Earnings</h1>
                <EarningsDateFilter from={from} to={to} />
            </div>
            <p className="text-slate-500 mb-8">
                {new Date(from).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} – {new Date(to).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                <StatCard label="Net revenue" value={`£${netTotal.toFixed(2)}`} sub={`£${grossTotal.toFixed(2)} gross`} />
                <StatCard label="Reservations" value={String(confirmed.length)} sub={`${pending.length} pending`} />
                <StatCard label="Cancellation rate" value={`${cancellationRate.toFixed(2)}%`} sub={`${cancelled.length} of ${everAccepted} accepted`} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-10">
                <StatCard label="Upcoming payout" value={`£${upcomingNet.toFixed(2)}`} sub={`${upcoming.length} stay${upcoming.length !== 1 ? 's' : ''}`} />
                <StatCard label="Completed stays" value={`£${completedNet.toFixed(2)}`} sub={`${completed.length} stay${completed.length !== 1 ? 's' : ''}`} />
                <StatCard label="Pending requests" value={`£${pendingGross.toFixed(2)}`} sub={`${pending.length} awaiting response`} />
            </div>

            <div className="border rounded-2xl p-6 mb-10">
                <h2 className="font-bold text-slate-900 mb-1">Monthly trend</h2>
                <p className="text-xs text-slate-400 mb-6">Net payout, by check-in month, within the selected period</p>
                <MonthlyTrendChart months={months} />
            </div>

            <div className="border rounded-2xl p-6 mb-8">
                <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
                    <h2 className="font-bold text-slate-900">Your payouts</h2>
                    <div className="text-sm text-slate-500">
                        £{(owedTotal > 0 ? netAfterDebt : awaitingTotal).toFixed(2)} still to come
                    </div>
                </div>
                <p className="text-sm text-slate-500 mb-5">
                    {timingText}
                </p>

                {/* A host used to find out about a deduction by receiving less
                    than they expected, with nothing anywhere explaining it. */}
                {owedTotal > 0 && (
                    <div className="border border-amber-300 bg-amber-50 rounded-xl p-4 mb-5">
                        <div className="font-semibold text-amber-900 text-sm">
                            £{owedTotal.toFixed(2)} comes off your next payouts
                        </div>
                        <ul className="text-sm text-amber-800 mt-2 space-y-1">
                            {debts.map((d) => (
                                <li key={d.id}>
                                    £{outstandingOf(d).toFixed(2)} &mdash; {debtReason(d.kind).toLowerCase()}
                                </li>
                            ))}
                        </ul>
                        <p className="text-xs text-amber-700 mt-2">
                            {deductionTotal > 0
                                ? 'Taken off the stays marked below, as each one pays out.'
                                : 'It will come off as soon as you have a stay to pay out.'}
                            {owedBeyondQueue > 0 && deductionTotal > 0
                                ? ' £' + owedBeyondQueue.toFixed(2) + ' of it is more than your'
                                    + ' booked stays cover, so it waits for later ones.'
                                : ''}
                        </p>
                    </div>
                )}

                {awaiting.length === 0 ? (
                    <p className="text-sm text-slate-400">No payouts on the way.</p>
                ) : (
                    <div className="space-y-3">
                        {awaiting.map((r) => (
                            <div
                                key={r.id}
                                className="flex items-start justify-between gap-4 flex-wrap border-b last:border-b-0 pb-3 last:pb-0"
                            >
                                <div className="min-w-0">
                                    <div className="font-medium text-slate-800 truncate">{r.title}</div>
                                    <div className="text-sm text-slate-500">
                                        Guest arrives {formatUk(new Date(r.checkIn))}
                                    </div>
                                    {!r.fullyPaid && r.outstanding > 0 && (
                                        <div className="text-xs text-amber-700 mt-0.5">
                                            Includes £{r.outstanding.toFixed(2)} of the guest&apos;s
                                            balance still to be collected before check-in
                                        </div>
                                    )}
                                </div>
                                <div className="text-right">
                                    {deductions[r.id] ? (
                                        <>
                                            <div className="text-sm text-slate-500 line-through">
                                                £{r.expected.toFixed(2)}
                                            </div>
                                            <div className="text-xs text-amber-700">
                                                less £{deductions[r.id].toFixed(2)} owed
                                            </div>
                                            <div className="font-semibold text-slate-900">
                                                £{Math.max(0, round2(r.expected - deductions[r.id])).toFixed(2)}
                                            </div>
                                        </>
                                    ) : (
                                        <div className="font-semibold text-slate-900">
                                            £{r.expected.toFixed(2)}
                                        </div>
                                    )}
                                    <div className="text-xs text-slate-500">
                                        {r.due <= todayStart ? 'Due now' : 'Pays ' + formatUk(r.due)}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {alreadyPaid.length > 0 && (
                    <div className="mt-6 pt-5 border-t">
                        <h3 className="text-sm font-semibold text-slate-900 mb-3">Already paid</h3>
                        <div className="space-y-2">
                            {alreadyPaid.slice(0, 10).map((r) => (
                                <div key={r.id} className="flex justify-between text-sm">
                                    <span className="text-slate-600 truncate">
                                        {r.title} &middot; {formatUk(new Date(r.checkIn))}
                                    </span>
                                    <span className="text-slate-900 font-medium whitespace-nowrap ml-3">
                                        £{Number(r.payoutAmount || 0).toFixed(2)} on{' '}
                                        {formatUk(new Date(r.paidOutAt))}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="border rounded-2xl p-6 mb-10">
                <h2 className="font-bold text-slate-900 mb-4">Fee breakdown</h2>
                <div className="space-y-2 text-sm max-w-sm">
                    <div className="flex justify-between text-slate-600">
                        <span>Gross bookings (confirmed)</span>
                        <span>£{grossTotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                        <span>Host fee ({effectivePercent}%)</span>
                        <span>− £{feeTotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-slate-900 pt-2 border-t">
                        <span>Net earnings</span>
                        <span>£{netTotal.toFixed(2)}</span>
                    </div>
                </div>
            </div>

            <div className="border rounded-2xl p-6">
                <h2 className="font-bold text-slate-900 mb-4">By listing</h2>
                {listingBreakdown.length === 0 ? (
                    <p className="text-sm text-slate-400">No confirmed bookings in this period.</p>
                ) : (
                    <div className="space-y-3">
                        {listingBreakdown.map((l) => {
                            const pct = netTotal > 0 ? (l.net / netTotal) * 100 : 0;
                            return (
                                <div key={l.id}>
                                    <div className="flex justify-between text-sm mb-1">
                                        <span className="font-medium text-slate-800">{l.title}</span>
                                        <span className="text-slate-600">£{l.net.toFixed(2)}</span>
                                    </div>
                                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                        <div className="h-full bg-slate-900 rounded-full" style={{ width: `${Math.min(100, pct)}%` }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Said once, at the bottom, rather than beside every figure. */}
            <p className="text-xs text-slate-400 mt-6">
                All figures on this page are after the {effectivePercent}% platform fee.
            </p>
        </div>
    );
}
