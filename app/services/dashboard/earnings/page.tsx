export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import BusinessSwitcher from '@/components/services/BusinessSwitcher';
import { BUSINESS_COOKIE, dashboardProviders, pickDashboardProvider, firstProviderPageFor } from '@/lib/providerAccess';
import { orderNet } from '@/lib/serviceOrders';
import { londonDayKey } from '@/lib/dayKey';
import { defaultEarningsPeriod } from '@/lib/earningsPeriod';
import EarningsDateFilter from '@/components/EarningsDateFilter';
import MonthlyTrendChart, { type TrendMonth } from '@/components/MonthlyTrendChart';
import { ArrowLeft } from 'lucide-react';
import { formatGBP } from '@/lib/formatMoney';
import { supplierFromSnapshot } from '@/lib/vat';
import VatSettingsCard from '@/components/account/VatSettingsCard';
import { providerPayoutRows } from '@/lib/providerPayoutRows';
import { readSchedule, arrivalSentence } from '@/lib/payoutTiming';
import { PROVIDER_RELEASE_SENTENCE } from '@/lib/payoutScheduleInput';

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
    // Owned, or co-hosted with the earnings permission (lib/providerAccess).
    const { rows: providers, access } = await dashboardProviders(admin, user.id, 'can_earnings', 'id, business_name, status, vat_registered, vat_number, vat_name, stripe_account_id, stripe_payouts_enabled');
    const switchable = (providers as any[]).map((r: any) => ({ id: r.id, name: r.business_name || 'Your business' }));
    const provider: any = pickDashboardProvider(providers, access, cookies().get(BUSINESS_COOKIE)?.value);
    if (!provider) redirect((await firstProviderPageFor(user.id)) || '/services/dashboard');
    // Their own VAT registration at the head of the statement — the name and
    // number their guests' receipts carry. Nothing when not VAT registered.
    // Tax details stay with the owner: a co-host with earnings sees neither
    // this line nor the VAT card (whose API is owner-only anyway).
    const isOwner = !!access[provider.id]?.isOwner;
    const ownVat = isOwner && provider.vat_registered
        ? supplierFromSnapshot({ supplier_vat_number: provider.vat_number, supplier_vat_name: provider.vat_name })
        : null;

    // Range: default to this year from the month their account was created —
    // the host's rule (lib/earningsPeriod) — filtered on SERVICE_DATE (the day
    // the session runs — the experience analogue of a stay's check-in).
    const period = defaultEarningsPeriod(user.created_at, londonDayKey());
    const from = searchParams.from || period.from;
    const to = searchParams.to || period.to;
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

    // YOUR PAYOUTS — the host's list, for an experience: what's still to come
    // (held, unpaid; paid the day after the experience) and what's been paid.
    // Every date, not just the filtered range, as the host's list is.
    const { data: heldRows } = await admin
        .from('service_orders')
        .select('id, provider_id, status, cancel_ack, service_date, price, commission_rate, amount_refunded, created_at, paid_out_at, funds_flow, item_name, payout_amount')
        .eq('provider_id', provider.id)
        .eq('funds_flow', 'held')
        // 'refunded' is here so an order refunded AFTER it was paid out still
        // shows under "Already paid" (with the refund). A full refund flips the
        // status to 'refunded'; without it such an order dropped off the list
        // entirely, even though the money really was paid. A refunded order that
        // was never paid out carries no paid_out_at and isn't owed, so it is
        // filtered out by providerPayoutRows — it appears nowhere, as before.
        .in('status', ['confirmed', 'cancelled', 'refunded']);
    const payouts = providerPayoutRows((heldRows || []) as any[], today);
    // When it reaches their bank: read off their own Stripe account (it shortens
    // as the account builds history), the way the host's page says it.
    const schedule = provider.stripe_account_id ? await readSchedule(provider.stripe_account_id) : null;
    const arrival = arrivalSentence(schedule ? schedule.delayDays : null);
    const payoutsOn = provider.stripe_payouts_enabled === true;

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
            <BusinessSwitcher options={switchable} current={provider.id} className="mb-3" />
            <p className={`text-slate-500 ${ownVat ? 'mb-1' : 'mb-8'}`}>{ukDate(from)} – {ukDate(to)}</p>
            {ownVat && (
                <p className="text-sm text-slate-500 mb-8">{ownVat.name} · VAT number {ownVat.vatNumber}</p>
            )}

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

            <div className="border rounded-2xl p-6 mb-10">
                <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
                    <h2 className="font-bold text-slate-900">Your payouts</h2>
                    <div className="text-sm text-slate-500">{money(payouts.stillToCome)} still to come</div>
                </div>
                <p className="text-sm text-slate-500 mb-5">
                    {PROVIDER_RELEASE_SENTENCE} {arrival}
                    {isOwner && (
                        <> <Link href="/account?section=payments" className="font-semibold text-slate-700 underline underline-offset-2">Payout settings</Link></>
                    )}
                </p>
                {!payoutsOn && payouts.awaiting.length > 0 && (
                    <p className="text-sm text-amber-800 border border-amber-300 bg-amber-50 rounded-xl px-4 py-3 mb-5">
                        Your payouts aren&rsquo;t set up yet, so we&rsquo;re holding these safely for you. They&rsquo;re paid on the first run after you set them up.
                    </p>
                )}
                {payouts.awaiting.length === 0 ? (
                    <p className="text-sm text-slate-400">No payouts on the way.</p>
                ) : (
                    <div className="space-y-3">
                        {payouts.awaiting.map((r) => (
                            <div key={r.id} className="flex items-start justify-between gap-4 flex-wrap border-b last:border-b-0 pb-3 last:pb-0">
                                <div className="min-w-0">
                                    <div className="font-medium text-slate-800 truncate">{r.title}</div>
                                    <div className="text-sm text-slate-500">Experience on {ukDate(r.date)}</div>
                                </div>
                                <div className="text-right">
                                    <div className="font-semibold text-slate-900">{money(r.expected)}</div>
                                    <div className="text-xs text-slate-500">{r.dueNow ? 'Due now' : 'Pays ' + ukDate(r.payDate)}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {payouts.alreadyPaid.length > 0 && (
                    <div className="mt-6 pt-5 border-t">
                        <h3 className="text-sm font-semibold text-slate-900 mb-3">Already paid</h3>
                        <div className="space-y-2">
                            {payouts.alreadyPaid.slice(0, 10).map((r) => (
                                <div key={r.id} className="flex justify-between text-sm">
                                    <span className="text-slate-600 truncate">{r.title} &middot; {ukDate(r.date)}</span>
                                    <span className="text-right whitespace-nowrap ml-3">
                                        <span className="text-slate-900 font-medium">{money(r.amount)} on {ukDate(r.paidOn)}</span>
                                        {r.refunded > 0 && (
                                            <span className="block text-xs text-amber-700">{money(r.refunded)} refunded since</span>
                                        )}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* How the money reaches the provider: taken on their behalf (they are
                the seller, named on the guest's statement), held by us, released
                the day after the booking, then Stripe to their bank. */}
            <div className="border rounded-2xl p-6 mb-10">
                <h2 className="font-bold text-slate-900 mb-2">How you're paid</h2>
                <p className="text-sm text-slate-600">
                    You&rsquo;re the seller: each booking is taken in your name, and your business is what the guest sees on
                    their card statement. We hold the guest&rsquo;s payment until the booking has happened, then send you your share &mdash;
                    what they paid, less our {effectivePercent}% fee &mdash; the day after. {arrival} If a booking is
                    cancelled and refunded before then, the refund comes from the money we hold.
                </p>
            </div>

            {isOwner && (
                <div className="mb-10">
                    <VatSettingsCard providerId={provider.id} audience="experience" />
                </div>
            )}

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
