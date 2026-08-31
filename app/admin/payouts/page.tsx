import { logError } from '@/lib/logError';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { requireAdmin } from '@/lib/access';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DEFAULT_COMMISSION_PERCENT, netOfFee, feeAmount } from '@/lib/fees';
import { displayName } from '@/lib/utils';
import { formatUk } from '@/lib/cancellation';
import { outstandingOf, debtReason, debtExplanation, round2 } from '@/lib/hostDebt';

export const dynamic = 'force-dynamic';

export default async function AdminPayouts() {
    const supabase = createServerComponentClient({ cookies });
    // One rule, in lib/access. It was written out nine times, byte for
    // byte, and every copy was correct — but nothing made the tenth so.
    const authUser = await requireAdmin();
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
    // `profiles`, not `profile_private`. That view is scoped by auth.uid() in
    // its own WHERE clause — which is part of the view body, so it applies to
    // the service key too, and auth.uid() is null there. It returned NOTHING,
    // every time, to this page. Proved against the test project: the same
    // service key gets 0 rows from the view and 13 from the table.
    //
    // So every host on this page was drawn with the fallback name, every
    // `owed` was zero, and the running-total half of the check below was
    // always £0.00 — it was comparing real debts against nothing and reporting
    // whatever it found. The view's own definition intends admins to see
    // everything; reading it with a key that has no session defeated that.
    //
    // The page is admin-only via requireAdmin, and reads bookings, listings
    // and payouts through the same admin client.
    const { data: hosts, error: hostsError } = await admin
        .from('profiles')
        .select('id, full_name, preferred_name, show_full_name, stripe_account_id, stripe_payouts_enabled, payout_balance_owed');

    if (hostsError) {
        await logError('admin/payouts: could not load the hosts', hostsError, {
            path: 'admin/payouts',
        });
    }

    const listingTitle: Record<string, string> = {};
    const listingRate: Record<string, number> = {};
    (listings || []).forEach((l: any) => {
        listingTitle[l.id] = l.title || 'Untitled listing';
        listingRate[l.id] =
            l.commission_rate === null || l.commission_rate === undefined
                ? DEFAULT_COMMISSION_PERCENT
                : Number(l.commission_rate);
    });

    // Itemised, not just a total. "Liam Worrall — £0.05" is unanswerable if a
    // host queries it: the panel has to say which property, which dates, and
    // what it was for, so it can be traced back to a booking.
    const { data: debtRows } = await admin
        .from('payouts')
        .select('id, booking_id, host_id, amount, kind, status, note, created_at, settled_amount')
        .eq('status', 'owed')
        .order('created_at', { ascending: true });

    const debts = (debtRows || []).filter((d: any) => outstandingOf(d) > 0);

    const debtBookingIds = Array.from(new Set(debts.map((d: any) => d.booking_id).filter(Boolean)));
    const { data: debtBookings } = debtBookingIds.length
        ? await admin
            .from('bookings')
            .select('id, listing_id, check_in, check_out, total_price, cancelled_at, cancelled_by_role')
            .in('id', debtBookingIds)
        : { data: [] };

    const debtBooking: Record<string, any> = {};
    (debtBookings || []).forEach((b: any) => { debtBooking[b.id] = b; });

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

            {debts.length > 0 && (
                <div className="border border-amber-300 bg-amber-50 rounded-2xl p-5 mb-8">
                    <div className="font-semibold text-amber-900 mb-1">Owed back by hosts</div>
                    <p className="text-sm text-amber-800 mb-4">
                        Each of these comes off that host&apos;s next payout automatically. The
                        reasons are not the same, so each says its own.
                    </p>

                    <ul className="space-y-3">
                        {debts.map((d: any) => {
                            const b = d.booking_id ? debtBooking[d.booking_id] : null;
                            const host = hostInfo[d.host_id];
                            const left = outstandingOf(d);
                            const charged = Math.abs(Number(d.amount || 0));

                            return (
                                <li
                                    key={d.id}
                                    className="border border-amber-200 bg-white rounded-xl p-4"
                                >
                                    <div className="flex items-baseline justify-between gap-4 flex-wrap">
                                        <div className="font-semibold text-slate-900">
                                            {(host && host.name) || 'Host'}
                                        </div>
                                        <div className="font-bold text-amber-800">
                                            £{left.toFixed(2)}
                                            {left < charged && (
                                                <span className="font-normal text-xs text-amber-700">
                                                    {' '}of £{charged.toFixed(2)}, part recovered
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="text-sm text-slate-700 mt-1">
                                        {debtReason(d.kind)}
                                    </div>

                                    {b ? (
                                        <div className="text-sm text-slate-500 mt-0.5">
                                            {listingTitle[b.listing_id] || 'Listing'} &middot;{' '}
                                            {formatUk(new Date(b.check_in))} &rarr;{' '}
                                            {formatUk(new Date(b.check_out))} &middot; £
                                            {Number(b.total_price || 0).toFixed(2)} booking
                                            {b.cancelled_by_role
                                                ? ' · cancelled by the ' + b.cancelled_by_role
                                                : ''}
                                        </div>
                                    ) : (
                                        <div className="text-sm text-slate-500 mt-0.5">
                                            Not linked to a booking
                                        </div>
                                    )}

                                    <div className="text-xs text-slate-500 mt-2">
                                        {debtExplanation(d.kind)}
                                    </div>

                                    <div className="text-xs text-slate-400 mt-1">
                                        Charged {formatUk(new Date(d.created_at))}
                                        {d.note ? ' · ' + d.note : ''}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>

                    {/* The itemised rows and profiles.payout_balance_owed are
                        the same money counted two ways. If they ever disagree,
                        one of them is wrong and somebody needs to know which
                        before a host is told a figure.

                        PER HOST, not site-wide. This compared the sum of every
                        debt row against the sum of every running total, so one
                        host £70 light and another £70 heavy cancelled exactly
                        and it stayed silent while both were wrong. A warning
                        that two errors can hide inside is not a warning. */}
                    {(() => {
                        const itemisedBy: Record<string, number> = {};
                        debts.forEach((d: any) => {
                            itemisedBy[d.host_id] = round2((itemisedBy[d.host_id] || 0) + outstandingOf(d));
                        });

                        // Every host who appears on either side. A host with
                        // debt rows and a zero total is exactly as wrong as one
                        // with a total and no rows, and looking only at hosts
                        // who have rows would miss the second.
                        const ids = Array.from(new Set([
                            ...Object.keys(itemisedBy),
                            ...(hosts || []).map((h: any) => h.id),
                        ]));

                        const off = ids
                            .map((id) => ({
                                id,
                                name: (hostInfo[id] && hostInfo[id].name) || 'Unknown host',
                                itemised: round2(itemisedBy[id] || 0),
                                total: round2((hostInfo[id] && hostInfo[id].owed) || 0),
                            }))
                            .filter((r) => Math.abs(r.itemised - r.total) >= 0.005);

                        if (off.length === 0) return null;

                        return (
                            <div className="text-xs font-semibold text-red-700 mt-4 space-y-1">
                                {off.map((r) => (
                                    <p key={r.id}>
                                        {r.name}: these lines come to £{r.itemised.toFixed(2)} but the
                                        running total on the host record says £{r.total.toFixed(2)}.
                                        They should match — check before quoting either at them.
                                    </p>
                                ))}
                            </div>
                        );
                    })()}
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
