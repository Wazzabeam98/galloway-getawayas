import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DEFAULT_COMMISSION_PERCENT, netOfFee, feeAmount } from '@/lib/fees';
import { displayName } from '@/lib/utils';
import { formatUk } from '@/lib/cancellation';

export const dynamic = 'force-dynamic';

export default async function AdminPayouts() {
    const supabase = createServerComponentClient({ cookies });
    const { data: auth } = await supabase.auth.getSession();

    if (!auth || !auth.session || !auth.session.user) notFound();

    const { data: me } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', auth.session.user.id)
        .maybeSingle();

    if (!me || me.is_admin !== true) notFound();

    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );

    // Only stays that are actually happening and actually paid for.
    const { data: bookings } = await admin
        .from('bookings')
        .select('id, listing_id, host_id, check_in, check_out, total_price, status, payment_status, commission_rate, paid_out_at, payout_amount, payout_transfer_id')
        .eq('status', 'confirmed')
        .eq('payment_status', 'paid')
        .order('check_in', { ascending: true });

    const rows = bookings || [];

    const { data: listings } = await admin.from('listings').select('id, title, commission_rate');
    const { data: hosts } = await admin
        .from('profiles')
        .select('id, full_name, preferred_name, show_full_name, stripe_account_id, stripe_payouts_enabled, payout_balance_owed');

    const listingTitle: Record<string, string> = {};
    const listingRate: Record<string, number> = {};
    (listings || []).forEach((l: any) => {
        listingTitle[l.id] = l.title || 'Untitled listing';
        listingRate[l.id] =
            l.commission_rate === null || l.commission_rate === undefined
                ? DEFAULT_COMMISSION_PERCENT
                : Number(l.commission_rate);
    });

    const hostInfo: Record<string, any> = {};
    (hosts || []).forEach((h: any) => {
        hostInfo[h.id] = {
            name: displayName(h, 'Host'),
            connected: !!h.stripe_account_id,
            payoutsOn: h.stripe_payouts_enabled === true,
            owed: Number(h.payout_balance_owed || 0),
        };
    });

    const rateOf = (b: any) =>
        b.commission_rate === null || b.commission_rate === undefined
            ? listingRate[b.listing_id] ?? DEFAULT_COMMISSION_PERCENT
            : Number(b.commission_rate);

    // A stay is due for payout the day after check-in.
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dueDate = (checkIn: string) => {
        const d = new Date(checkIn);
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + 1);
        return d;
    };

    const paid: any[] = [];
    const due: any[] = [];
    const upcoming: any[] = [];

    rows.forEach((b: any) => {
        const rate = rateOf(b);
        const gross = Number(b.total_price || 0);
        const entry = {
            id: b.id,
            title: listingTitle[b.listing_id] || 'Untitled listing',
            host: hostInfo[b.host_id] || { name: 'Host', connected: false, payoutsOn: false },
            checkIn: b.check_in,
            gross: gross,
            rate: rate,
            net: netOfFee(gross, rate),
            fee: feeAmount(gross, rate),
            paidOutAt: b.paid_out_at,
            payoutAmount: b.payout_amount,
            when: dueDate(b.check_in),
        };

        if (b.paid_out_at) paid.push(entry);
        else if (entry.when.getTime() <= today.getTime()) due.push(entry);
        else upcoming.push(entry);
    });

    const sum = (list: any[], key: string) =>
        list.reduce((total, r) => total + Number(r[key] || 0), 0);

    const Section = ({ title, note, list, showPaidDate }: any) => (
        <div className="mb-10">
            <h2 className="text-lg font-semibold text-slate-900 mb-1">{title}</h2>
            <p className="text-sm text-slate-500 mb-4">{note}</p>

            {list.length === 0 ? (
                <p className="text-sm text-slate-400 border rounded-2xl p-5">Nothing here.</p>
            ) : (
                <div className="space-y-3">
                    {list.map((r: any) => (
                        <div
                            key={r.id}
                            className="border rounded-2xl p-5 flex items-start justify-between gap-4 flex-wrap"
                        >
                            <div className="min-w-0">
                                <div className="font-semibold text-slate-900 truncate">{r.title}</div>
                                <div className="text-sm text-slate-500">
                                    {r.host.name} &middot; checks in {formatUk(new Date(r.checkIn))}
                                </div>
                                {showPaidDate ? (
                                    <div className="text-xs text-emerald-700 mt-1">
                                        Paid {formatUk(new Date(r.paidOutAt))}
                                    </div>
                                ) : !r.host.connected ? (
                                    <div className="text-xs text-amber-700 mt-1">
                                        This host hasn&apos;t set up payouts yet
                                    </div>
                                ) : !r.host.payoutsOn ? (
                                    <div className="text-xs text-amber-700 mt-1">
                                        Stripe hasn&apos;t enabled payouts on this host&apos;s account yet
                                    </div>
                                ) : (
                                    <div className="text-xs text-slate-400 mt-1">
                                        Due {formatUk(r.when)}
                                    </div>
                                )}
                            </div>
                            <div className="text-right">
                                <div className="font-semibold text-slate-900">£{r.net.toFixed(2)}</div>
                                <div className="text-xs text-slate-500">
                                    £{r.gross.toFixed(2)} guest &middot; £{r.fee.toFixed(2)} fee
                                    {r.rate === 0 ? ' (no commission)' : ' (' + r.rate + '%)'}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );

    return (
        <div className="max-w-4xl mx-auto px-6 py-10">
            <Link href="/admin" className="text-sm text-slate-500 hover:underline">
                &larr; Owner tools
            </Link>

            <h1 className="text-2xl font-bold text-slate-900 mt-4 mb-1">Payouts</h1>
            <p className="text-sm text-slate-500 mb-8">
                What each host is owed on confirmed, fully paid stays. Payouts are due the day
                after check-in.
            </p>

            {(hosts || []).some((h: any) => Number(h.payout_balance_owed || 0) > 0) && (
                <div className="border border-amber-300 bg-amber-50 rounded-2xl p-5 mb-8">
                    <div className="font-semibold text-amber-900 mb-1">Owed back by hosts</div>
                    <p className="text-sm text-amber-800 mb-3">
                        A refund went out after these hosts had been paid, and it couldn&apos;t be
                        taken back from their Stripe balance. It comes off their next payout
                        automatically.
                    </p>
                    <ul className="text-sm text-amber-900 space-y-1">
                        {(hosts || [])
                            .filter((h: any) => Number(h.payout_balance_owed || 0) > 0)
                            .map((h: any) => (
                                <li key={h.id}>
                                    {displayName(h, 'Host')} &mdash;{' '}
                                    <strong>£{Number(h.payout_balance_owed).toFixed(2)}</strong>
                                </li>
                            ))}
                    </ul>
                </div>
            )}

            <div className="grid grid-cols-3 gap-4 mb-10">
                <div className="border rounded-2xl p-5">
                    <div className="text-sm text-slate-500 mb-1">Due now</div>
                    <div className="text-xl font-bold text-amber-700">
                        £{sum(due, 'net').toFixed(2)}
                    </div>
                </div>
                <div className="border rounded-2xl p-5">
                    <div className="text-sm text-slate-500 mb-1">Upcoming</div>
                    <div className="text-xl font-bold text-slate-900">
                        £{sum(upcoming, 'net').toFixed(2)}
                    </div>
                </div>
                <div className="border rounded-2xl p-5">
                    <div className="text-sm text-slate-500 mb-1">Paid out</div>
                    <div className="text-xl font-bold text-emerald-700">
                        £{sum(paid, 'net').toFixed(2)}
                    </div>
                </div>
            </div>

            <Section
                title="Due now"
                note="Check-in has passed and the money is ready to go."
                list={due}
            />
            <Section
                title="Upcoming"
                note="Paid for, but the stay hasn't started yet."
                list={upcoming}
            />
            <Section
                title="Already paid out"
                note="Sent to the host's own bank account."
                list={paid}
                showPaidDate
            />
        </div>
    );
}
