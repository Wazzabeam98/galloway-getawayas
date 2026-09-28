import { requireAdmin } from '@/lib/access';
import { adminClient } from '@/lib/supabaseAdmin';
import { DEFAULT_COMMISSION_PERCENT, feeAmount } from '@/lib/fees';
import Link from 'next/link';

// Pounds, grouped, two decimals — kept local so the page has no cross-branch
// dependency on a shared money helper.
function formatGBP(n: number): string {
    return '£' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const dynamic = 'force-dynamic';

export const metadata = {
    title: 'Traffic and growth',
    robots: { index: false, follow: false },
};

const LONDON = 'Europe/London';

// 'YYYY-MM' for a timestamp, in the site's timezone, so a booking made just
// before midnight lands in the right month for a UK owner.
function monthKey(ts: string | null | undefined): string {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-CA', { timeZone: LONDON }).slice(0, 7);
}

function nightsBetween(checkIn: string, checkOut: string): number {
    const a = new Date(String(checkIn).slice(0, 10) + 'T12:00:00Z');
    const b = new Date(String(checkOut).slice(0, 10) + 'T12:00:00Z');
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
    return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

interface MonthRow {
    key: string;
    label: string;
    signups: number;
    listings: number;
    bookings: number;
    nights: number;
    value: number;      // gross, pence-accurate pounds
    commission: number;
    cancellations: number;
}

export default async function AdminTraffic() {
    // Owners only — the same gate every admin page checks for itself.
    await requireAdmin();
    // Read across every host with the service role, like the other owner pages.
    const admin = adminClient();

    // The last twelve months, oldest first. Buckets are built up front so a month
    // with no activity still shows as a zero row rather than vanishing.
    const nowKey = new Date().toLocaleDateString('en-CA', { timeZone: LONDON }).slice(0, 7);
    let [yy, mm] = nowKey.split('-').map(Number);
    const buckets: { key: string; label: string }[] = [];
    for (let i = 0; i < 12; i++) {
        const key = `${yy}-${String(mm).padStart(2, '0')}`;
        const label = new Date(Date.UTC(yy, mm - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
        buckets.unshift({ key, label });
        mm--; if (mm === 0) { mm = 12; yy--; }
    }
    const windowStart = new Date(Date.UTC(Number(buckets[0].key.slice(0, 4)), Number(buckets[0].key.slice(5, 7)) - 1, 1)).toISOString();
    const known = new Set(buckets.map((b) => b.key));

    // Cheap by design: a handful of date-filtered reads, minimal columns, summed
    // in memory rather than a query per month.
    const [{ data: profiles }, { data: listings }, { data: standing }, { data: cancelled }] = await Promise.all([
        admin.from('profiles').select('created_at').gte('created_at', windowStart),
        // No publish timestamp is stored on a listing, so "published" is counted by
        // the month the listing was created — the closest signal we hold.
        admin.from('listings').select('id, commission_rate, status, created_at'),
        admin.from('bookings')
            .select('created_at, check_in, check_out, total_price, commission_rate, listing_id')
            .in('status', ['confirmed', 'completed'])
            .gte('created_at', windowStart),
        admin.from('bookings')
            .select('cancelled_at')
            .eq('status', 'cancelled')
            .gte('cancelled_at', windowStart),
    ]);

    const rows: Record<string, MonthRow> = {};
    buckets.forEach((b) => {
        rows[b.key] = { ...b, signups: 0, listings: 0, bookings: 0, nights: 0, value: 0, commission: 0, cancellations: 0 };
    });

    (profiles || []).forEach((p: any) => {
        const k = monthKey(p.created_at);
        if (rows[k]) rows[k].signups += 1;
    });

    // A booking's own stamped rate wins (what was agreed at the time); older rows
    // fall back to the listing's current rate, then the standard rate — the same
    // rule the Earnings page uses, so the two figures agree.
    const listingRate: Record<string, number> = {};
    (listings || []).forEach((l: any) => {
        listingRate[l.id] = (l.commission_rate === null || l.commission_rate === undefined)
            ? DEFAULT_COMMISSION_PERCENT : Number(l.commission_rate);
        // "Published" includes a listing since paused ('hidden') — it was live.
        if (l.status === 'published' || l.status === 'hidden') {
            const k = monthKey(l.created_at);
            if (rows[k]) rows[k].listings += 1;
        }
    });

    (standing || []).forEach((b: any) => {
        const k = monthKey(b.created_at);
        if (!rows[k]) return;
        const gross = Number(b.total_price || 0);
        const rate = (b.commission_rate === null || b.commission_rate === undefined)
            ? (listingRate[b.listing_id] ?? DEFAULT_COMMISSION_PERCENT) : Number(b.commission_rate);
        rows[k].bookings += 1;
        rows[k].nights += nightsBetween(b.check_in, b.check_out);
        rows[k].value += gross;
        rows[k].commission += feeAmount(gross, rate);
    });

    (cancelled || []).forEach((b: any) => {
        const k = monthKey(b.cancelled_at);
        if (rows[k]) rows[k].cancellations += 1;
    });

    const table = buckets.map((b) => rows[b.key]);
    const totals = table.reduce((t, r) => ({
        signups: t.signups + r.signups,
        listings: t.listings + r.listings,
        bookings: t.bookings + r.bookings,
        nights: t.nights + r.nights,
        value: t.value + r.value,
        commission: t.commission + r.commission,
        cancellations: t.cancellations + r.cancellations,
    }), { signups: 0, listings: 0, bookings: 0, nights: 0, value: 0, commission: 0, cancellations: 0 });

    // A simple, dependency-free bar chart of booked value by month — the headline
    // growth line — rendered as inline SVG so the page ships no chart library and
    // no client JavaScript.
    const chartMax = Math.max(1, ...table.map((r) => r.value));
    const CHART_W = 720, CHART_H = 180, PAD_B = 24, PAD_T = 8;
    const barGap = 8;
    const barW = (CHART_W - barGap * (table.length - 1)) / table.length;

    const num = (n: number) => n.toLocaleString('en-GB');

    return (
        <div className="max-w-6xl mx-auto px-6 py-10">
            <Link href="/admin" className="text-sm text-slate-500 hover:underline">&larr; Owner tools</Link>

            <h1 className="text-2xl font-bold text-slate-900 mt-4 mb-1">Traffic and growth</h1>
            <p className="text-sm text-slate-500 mb-6">
                The last twelve months. Sign-ups, listings and cancellations are counted in the month they happened;
                bookings, nights, value and commission are for confirmed bookings by the month they were made.
                Visitor and page-view trends live in Vercel&rsquo;s dashboard (Analytics tab).
            </p>

            {/* Booked value by month — the headline line, as a plain SVG bar chart. */}
            <div className="border rounded-2xl p-5 mb-8">
                <div className="text-sm font-semibold text-slate-900 mb-3">Booked value by month</div>
                <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full h-auto" role="img" aria-label="Booked value by month">
                    {table.map((r, i) => {
                        const h = Math.round(((CHART_H - PAD_B - PAD_T) * r.value) / chartMax);
                        const x = i * (barW + barGap);
                        const y = CHART_H - PAD_B - h;
                        return (
                            <g key={r.key}>
                                <rect x={x} y={y} width={barW} height={h} rx={3} className="fill-emerald-600" />
                                <text x={x + barW / 2} y={CHART_H - PAD_B + 14} textAnchor="middle" className="fill-slate-400" style={{ fontSize: 9 }}>
                                    {r.label.split(' ')[0]}
                                </text>
                            </g>
                        );
                    })}
                </svg>
            </div>

            <div className="overflow-x-auto border rounded-2xl">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b bg-slate-50 text-left text-slate-500">
                            <th className="px-4 py-3 font-semibold">Month</th>
                            <th className="px-4 py-3 font-semibold text-right">Sign-ups</th>
                            <th className="px-4 py-3 font-semibold text-right">Listings</th>
                            <th className="px-4 py-3 font-semibold text-right">Bookings</th>
                            <th className="px-4 py-3 font-semibold text-right">Nights</th>
                            <th className="px-4 py-3 font-semibold text-right">Booked value</th>
                            <th className="px-4 py-3 font-semibold text-right">Commission</th>
                            <th className="px-4 py-3 font-semibold text-right">Cancellations</th>
                        </tr>
                    </thead>
                    <tbody>
                        {table.map((r) => (
                            <tr key={r.key} className="border-b last:border-0">
                                <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">{r.label}</td>
                                <td className="px-4 py-3 text-right text-slate-700">{num(r.signups)}</td>
                                <td className="px-4 py-3 text-right text-slate-700">{num(r.listings)}</td>
                                <td className="px-4 py-3 text-right text-slate-700">{num(r.bookings)}</td>
                                <td className="px-4 py-3 text-right text-slate-700">{num(r.nights)}</td>
                                <td className="px-4 py-3 text-right text-slate-700">{formatGBP(r.value)}</td>
                                <td className="px-4 py-3 text-right font-medium text-emerald-700">{formatGBP(r.commission)}</td>
                                <td className="px-4 py-3 text-right text-slate-700">{num(r.cancellations)}</td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-900">
                            <td className="px-4 py-3">12-month total</td>
                            <td className="px-4 py-3 text-right">{num(totals.signups)}</td>
                            <td className="px-4 py-3 text-right">{num(totals.listings)}</td>
                            <td className="px-4 py-3 text-right">{num(totals.bookings)}</td>
                            <td className="px-4 py-3 text-right">{num(totals.nights)}</td>
                            <td className="px-4 py-3 text-right">{formatGBP(totals.value)}</td>
                            <td className="px-4 py-3 text-right text-emerald-700">{formatGBP(totals.commission)}</td>
                            <td className="px-4 py-3 text-right">{num(totals.cancellations)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    );
}
