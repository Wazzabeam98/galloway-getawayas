export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { orderNet } from '@/lib/serviceOrders';
import { londonDayKey } from '@/lib/dayKey';
import EarningsDateFilter from '@/components/EarningsDateFilter';
import MonthlyTrendChart, { type TrendMonth } from '@/components/MonthlyTrendChart';
import { ArrowLeft } from 'lucide-react';
import { formatGBP } from '@/lib/formatMoney';

export const metadata = {
    title: 'Earnings',
    robots: { index: false, follow: false },
};

// The guest-experience provider's earnings — the sibling of the cottage host's
// /dashboard/earnings, with the same layout and the same figures, adapted where
// an experience genuinely differs:
//   * paid per ORDER, not per stay;
//   * OCCUPANCY is seats filled in a session, not nights booked;
//   * money is HELD by us until the day after the booking, then the provider's
//     share is transferred by /api/cron/experience-payouts — the same rhythm as
//     a host paid the day after check-in (orders before 30/09/2026 were
//     destination charges, paid at capture). The "how you're paid" note says
//     that plainly.
// Every figure shown is the provider's take (their 90%), via orderNet.

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => formatGBP(n);
const ukDate = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const MONTH_LETTERS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default async function ServiceEarningsPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
    const supabase = createServerComponentClient({ cookies });
    // getUser(), not getSession() — the page keys authorization off who this is.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/');

    const admin = adminClient();

    // The provider this account owns (approved first, most recently touched) —
    // the same resolution the dashboard uses.
    const { data: providers } = await admin
        .from('service_providers')
        .select('id, business_name, status')
        .eq('owner_id', user.id)
        .order('updated_at', { ascending: false });
    const provider = (providers || []).find((p: any) => p.status === 'approved') || (providers || [])[0];
    if (!provider) redirect('/services/dashboard');

    // Range: default to the current calendar year, filtered on SERVICE_DATE (the
    // day the session runs — the experience analogue of a stay's check-in).
    const year = new Date().getFullYear();
    const from = searchParams.from || `${year}-01-01`;
    const to = searchParams.to || `${year}-12-31`;
    const today = londonDayKey();

    // Every order for this provider (no 50-row cap — this is the ledger).
    const { data: allOrders } = await admin
        .from('service_orders')
        .select('id, status, service_date, price, commission_rate, amount_refunded, item_name, quantity, slot_session_id, created_at')
        .eq('provider_id', provider.id);

    const orders = (allOrders || []).filter((o: any) => o.service_date && o.service_date >= from && o.service_date <= to);

    // Buckets. Confirmed is realised revenue; a refunded order nets to its kept
    // amount via orderNet (amount_refunded). Cancelled/refunded feed only the
    // cancellation rate.
    const confirmed = orders.filter((o: any) => o.status === 'confirmed');
    const cancelled = orders.filter((o: any) => o.status === 'cancelled' || o.status === 'refunded');
    const upcoming = confirmed.filter((o: any) => o.service_date >= today);
    const completed = confirmed.filter((o: any) => o.service_date < today);

    const netOf = (rows: any[]) => r2(rows.reduce((s, o) => s + orderNet(o).youGet, 0));
    const grossOf = (rows: any[]) => r2(rows.reduce((s, o) => s + orderNet(o).gross, 0));
    const seatsOf = (rows: any[]) => rows.reduce((s, o) => s + (Number(o.quantity) || 1), 0);

    const netTotal = netOf(confirmed);
    const grossTotal = grossOf(confirmed);
    const feeTotal = r2(grossTotal - netTotal);
    const effectivePercent = grossTotal > 0 ? Math.round((feeTotal / grossTotal) * 1000) / 10 : 10;

    const everAccepted = confirmed.length + cancelled.length;
    const cancellationRate = everAccepted > 0 ? (cancelled.length / everAccepted) * 100 : 0;

    // OCCUPANCY = seats filled / capacity across this provider's booked sessions
    // in the range — the experience analogue of nights booked / nights available.
    const sessionIds = Array.from(new Set(confirmed.map((o: any) => o.slot_session_id).filter(Boolean)));
    let seatsTaken = 0, seatsCapacity = 0;
    if (sessionIds.length) {
        const { data: sessions } = await admin
            .from('slot_sessions')
            .select('id, capacity, seats_taken')
            .in('id', sessionIds as string[]);
        for (const s of sessions || []) {
            seatsTaken += Number(s.seats_taken) || 0;
            seatsCapacity += Number(s.capacity) || 0;
        }
    }
    const occupancy = seatsCapacity > 0 ? (seatsTaken / seatsCapacity) * 100 : 0;

    // Monthly trend — net take by service-date month within the range.
    const months: TrendMonth[] = [];
    {
        const start = new Date(from + 'T00:00:00Z');
        const end = new Date(to + 'T00:00:00Z');
        let y = start.getUTCFullYear(), m = start.getUTCMonth();
        for (let i = 0; i < 12 && (y < end.getUTCFullYear() || (y === end.getUTCFullYear() && m <= end.getUTCMonth())); i++) {
            const key = `${y}-${String(m + 1).padStart(2, '0')}`;
            const net = netOf(confirmed.filter((o: any) => String(o.service_date).slice(0, 7) === key));
            months.push({ label: MONTH_LETTERS[m], net });
            m++; if (m > 11) { m = 0; y++; }
        }
    }

    // By experience — net take per item, the analogue of the cottage "by listing".
    const byItemMap = new Map<string, number>();
    for (const o of confirmed) {
        const name = o.item_name || 'Experience';
        byItemMap.set(name, r2((byItemMap.get(name) || 0) + orderNet(o).youGet));
    }
    const byItem = Array.from(byItemMap.entries()).map(([name, net]) => ({ name, net })).sort((a, b) => b.net - a.net);

    const StatCard = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
        <div className="border rounded-2xl p-5">
            <div className="text-sm text-slate-500 mb-1">{label}</div>
            <div className="text-2xl font-bold text-slate-900">{value}</div>
            {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
        </div>
    );

    return (
        <div className="max-w-5xl mx-auto px-6 py-10">
            <Link href="/services/dashboard" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800 mb-4">
                <ArrowLeft className="h-4 w-4" /> Your business
            </Link>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-4">
                <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Earnings</h1>
                <EarningsDateFilter from={from} to={to} basePath="/services/dashboard/earnings" />
            </div>
            <p className="text-slate-500 mb-8">{ukDate(from)} – {ukDate(to)}</p>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                <StatCard label="What you've earned" value={money(netTotal)} sub={`${money(grossTotal)} taken`} />
                <StatCard label="Bookings" value={String(confirmed.length)} sub={`${seatsOf(confirmed)} seat${seatsOf(confirmed) !== 1 ? 's' : ''}`} />
                <StatCard label="Cancellation rate" value={`${cancellationRate.toFixed(1)}%`} sub={`${cancelled.length} of ${everAccepted} booked`} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-10">
                <StatCard label="Coming up" value={money(netOf(upcoming))} sub={`${upcoming.length} booking${upcoming.length !== 1 ? 's' : ''}`} />
                <StatCard label="Completed" value={money(netOf(completed))} sub={`${completed.length} booking${completed.length !== 1 ? 's' : ''}`} />
                <StatCard label="Seats filled" value={`${occupancy.toFixed(0)}%`} sub={seatsCapacity > 0 ? `${seatsTaken} of ${seatsCapacity} seats` : 'no booked sessions'} />
            </div>

            <div className="border rounded-2xl p-6 mb-10">
                <h2 className="font-bold text-slate-900 mb-1">Monthly trend</h2>
                <p className="text-xs text-slate-400 mb-6">What you kept, by session month, within the selected period</p>
                <MonthlyTrendChart months={months} />
            </div>

            {/* How the money reaches the provider: taken on their behalf (they are
                the seller, named on the guest's statement), held by us, released
                the day after the booking, then Stripe to their bank. */}
            <div className="border rounded-2xl p-6 mb-10">
                <h2 className="font-bold text-slate-900 mb-2">How you're paid</h2>
                <p className="text-sm text-slate-600">
                    You&rsquo;re the seller: each booking is taken in your name, and your business is what the guest sees on
                    their card statement. We hold the guest&rsquo;s payment until the booking has happened, then send you your share &mdash;
                    what they paid, less our {effectivePercent}% fee &mdash; the day after. Stripe then pays it into your
                    bank, which usually takes about a week. If a booking is cancelled and refunded before then, the
                    refund comes from the money we hold.
                </p>
            </div>

            <div className="border rounded-2xl p-6 mb-10">
                <h2 className="font-bold text-slate-900 mb-4">Fee breakdown</h2>
                <div className="space-y-2 text-sm max-w-sm">
                    <div className="flex justify-between text-slate-600">
                        <span>Taken from guests (confirmed)</span>
                        <span>{money(grossTotal)}</span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                        <span>Galloway fee ({effectivePercent}%)</span>
                        <span>− {money(feeTotal)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-slate-900 pt-2 border-t">
                        <span>What you keep</span>
                        <span>{money(netTotal)}</span>
                    </div>
                </div>
            </div>

            <div className="border rounded-2xl p-6">
                <h2 className="font-bold text-slate-900 mb-4">By experience</h2>
                {byItem.length === 0 ? (
                    <p className="text-sm text-slate-400">No confirmed bookings in this period.</p>
                ) : (
                    <div className="space-y-3">
                        {byItem.map((it) => {
                            const pct = netTotal > 0 ? (it.net / netTotal) * 100 : 0;
                            return (
                                <div key={it.name}>
                                    <div className="flex justify-between text-sm mb-1">
                                        <span className="font-medium text-slate-800">{it.name}</span>
                                        <span className="text-slate-600">{money(it.net)}</span>
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

            <p className="text-xs text-slate-400 mt-6">
                All figures on this page are your share, after the {effectivePercent}% Galloway fee. We send your share the day after each booking.
            </p>
        </div>
    );
}
