import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { requireAdmin } from '@/lib/access';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DEFAULT_COMMISSION_PERCENT, feeAmount } from '@/lib/fees';
import { adminName } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function AdminEarnings({
    searchParams,
}: {
    searchParams?: { year?: string };
}) {
    const supabase = createServerComponentClient({ cookies });
    // One rule, in lib/access. It was written out nine times, byte for
    // byte, and every copy was correct — but nothing made the tenth so.
    const authUser = await requireAdmin();
    // Owners see across every host, so the figures are read with the service
    // key rather than through the signed-in user's own row permissions.
    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );

    const thisYear = new Date().getFullYear();
    const year = Number(searchParams?.year) || thisYear;
    const from = year + '-01-01';
    const to = year + '-12-31';

    // Confirmed stays only — a pending booking isn't money, and a cancelled
    // one never was.
    const { data: bookings } = await admin
        .from('bookings')
        .select('listing_id, host_id, total_price, check_in, status, commission_rate')
        .eq('status', 'confirmed')
        .gte('check_in', from)
        .lte('check_in', to);

    const rows = bookings || [];

    const { data: listings } = await admin
        .from('listings')
        .select('id, title, host_id, commission_rate');

    const { data: hosts } = await admin
        .from('profiles')
        .select('id, full_name, preferred_name, show_full_name');

    const hostNames: Record<string, string> = {};
    (hosts || []).forEach((h: any) => {
        hostNames[h.id] = adminName(h, 'Host');
    });

    const listingRate: Record<string, number> = {};
    (listings || []).forEach((l: any) => {
        listingRate[l.id] =
            l.commission_rate === null || l.commission_rate === undefined
                ? DEFAULT_COMMISSION_PERCENT
                : Number(l.commission_rate);
    });

    // A booking's own stamped rate wins, since that is what was agreed at the
    // time. Older bookings fall back to the listing's current rate.
    const rateOf = (b: any) =>
        b.commission_rate === null || b.commission_rate === undefined
            ? listingRate[b.listing_id] ?? DEFAULT_COMMISSION_PERCENT
            : Number(b.commission_rate);

    const totals: Record<string, { gross: number; commission: number; nights: number; count: number }> = {};

    rows.forEach((b: any) => {
        const gross = Number(b.total_price || 0);
        const entry = totals[b.listing_id] || { gross: 0, commission: 0, nights: 0, count: 0 };
        entry.gross += gross;
        entry.commission += feeAmount(gross, rateOf(b));
        entry.count += 1;
        totals[b.listing_id] = entry;
    });

    const table = (listings || [])
        .map((l: any) => {
            const t = totals[l.id] || { gross: 0, commission: 0, nights: 0, count: 0 };
            return {
                id: l.id,
                title: l.title || 'Untitled listing',
                host: hostNames[l.host_id] || 'Host',
                gross: t.gross,
                commission: t.commission,
                count: t.count,
            };
        })
        .sort((a, b) => b.gross - a.gross);

    const grandGross = table.reduce((sum, r) => sum + r.gross, 0);
    const grandCommission = table.reduce((sum, r) => sum + r.commission, 0);
    const years = [thisYear, thisYear - 1, thisYear - 2];

    return (
        <div className="max-w-4xl mx-auto px-6 py-10">
            <Link href="/admin" className="text-sm text-slate-500 hover:underline">
                &larr; Owner tools
            </Link>

            <h1 className="text-2xl font-bold text-slate-900 mt-4 mb-1">Earnings by property</h1>
            <p className="text-sm text-slate-500 mb-6">
                Confirmed stays checking in during {year}, highest first.
            </p>

            <div className="flex gap-2 mb-8">
                {years.map((y) => (
                    <Link
                        key={y}
                        href={'/admin/earnings?year=' + y}
                        className={
                            'px-4 py-2 rounded-xl text-sm font-semibold border transition ' +
                            (y === year
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'text-slate-600 hover:border-slate-900')
                        }
                    >
                        {y}
                    </Link>
                ))}
            </div>

            <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="border rounded-2xl p-5">
                    <div className="text-sm text-slate-500 mb-1">Guest bookings total</div>
                    <div className="text-2xl font-bold text-slate-900">
                        £{grandGross.toFixed(2)}
                    </div>
                </div>
                <div className="border rounded-2xl p-5">
                    <div className="text-sm text-slate-500 mb-1">Commission earned</div>
                    <div className="text-2xl font-bold text-emerald-700">
                        £{grandCommission.toFixed(2)}
                    </div>
                </div>
            </div>

            {table.length === 0 ? (
                <p className="text-slate-500">No confirmed bookings for {year} yet.</p>
            ) : (
                <div className="space-y-3">
                    {table.map((r, i) => (
                        <div
                            key={r.id}
                            className="border rounded-2xl p-5 flex items-center justify-between gap-4 flex-wrap"
                        >
                            <div className="flex items-center gap-4 min-w-0">
                                <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                                    {i + 1}
                                </div>
                                <div className="min-w-0">
                                    <div className="font-semibold text-slate-900 truncate">{r.title}</div>
                                    <div className="text-sm text-slate-500">
                                        {r.host} &middot; {r.count} booking{r.count === 1 ? '' : 's'}
                                    </div>
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="font-semibold text-slate-900">£{r.gross.toFixed(2)}</div>
                                <div className="text-sm text-slate-500">
                                    £{r.commission.toFixed(2)} commission
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
