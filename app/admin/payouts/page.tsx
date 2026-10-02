import { logError } from '@/lib/logError';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { requireAdmin } from '@/lib/access';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DEFAULT_COMMISSION_PERCENT, netOfFee, feeAmount } from '@/lib/fees';
import { adminName } from '@/lib/utils';
import { formatUk } from '@/lib/cancellation';
import { outstandingOf, debtReason, debtExplanation, round2 } from '@/lib/hostDebt';
import { formatGBP } from '@/lib/formatMoney';

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
        // The same set the payout run pays (app/api/cron/host-payouts): a stay
        // with a partial refund is still owed its remainder.
        .in('payment_status', ['paid', 'partially_refunded'])
        .order('check_in', { ascending: true });

    const rows = bookings || [];

    const { data: listings } = await admin.from('listings').select('id, title, commission_rate, host_id, status');
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
            name: adminName(h, 'Host'),
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
    const held: any[] = [];
    const upcoming: any[] = [];

    rows.forEach((b: any) => {
        const rate = rateOf(b);
        const gross = Number(b.total_price || 0);
        const entry = {
            id: b.id,
            title: listingTitle[b.listing_id] || 'Untitled listing',
            host: hostInfo[b.host_id] || { name: 'Host', connected: false, payoutsOn: false },
            hostId: b.host_id,
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
        // HELD: due, but the host has no payouts. The payout run skips these
        // and retries every day; the first run after Stripe enables the host
        // (the account.updated webhook) pays them. Nothing is lost.
        else if (entry.when.getTime() <= today.getTime() && !entry.host.payoutsOn) held.push(entry);
        else if (entry.when.getTime() <= today.getTime()) due.push(entry);
        else upcoming.push(entry);
    });

    const sum = (list: any[], key: string) =>
        list.reduce((total, r) => total + Number(r[key] || 0), 0);

    // Every host with a listing that's live, paused or waiting for approval,
    // and where their payouts stand — so a host who's live but can't be paid
    // is visible here before any money is waiting on them.
    const hostIdsWithListings = Array.from(new Set((listings || [])
        .filter((l: any) => l.status === 'published' || l.status === 'hidden' || l.status === 'pending_review')
        .map((l: any) => l.host_id)
        .filter(Boolean)));
    const payoutStatus = hostIdsWithListings.map((id) => {
        const h = hostInfo[id] || { name: 'Host', connected: false, payoutsOn: false };
        const heldFor = held.filter((r) => r.hostId === id);
        const upcomingFor = upcoming.filter((r) => r.hostId === id);
        return {
            id,
            name: h.name,
            state: h.payoutsOn ? 'on' : h.connected ? 'started' : 'none',
            held: sum(heldFor, 'net'),
            heldCount: heldFor.length,
            upcomingCount: upcomingFor.length,
        };
    }).sort((a, b) => (a.state === 'on' ? 1 : 0) - (b.state === 'on' ? 1 : 0) || b.held - a.held);

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
                                <div className="font-semibold text-slate-900">{formatGBP(r.net)}</div>
                                <div className="text-xs text-slate-500">
                                    {formatGBP(r.gross)} guest &middot; {formatGBP(r.fee)} fee
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
                                            {formatGBP(left)}
                                            {left < charged && (
                                                <span className="font-normal text-xs text-amber-700">
                                                    {' '}of {formatGBP(charged)}, part recovered
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
                                            {formatUk(new Date(b.check_out))} &middot;{' '}
                                            {formatGBP(b.total_price || 0)} booking
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
                                        {r.name}: these lines come to {formatGBP(r.itemised)} but the
                                        running total on the host record says {formatGBP(r.total)}.
                                        They should match — check before quoting either at them.
                                    </p>
                                ))}
                            </div>
                        );
                    })()}
                </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
                <div className="border rounded-2xl p-5">
                    <div className="text-sm text-slate-500 mb-1">Held</div>
                    <div className="text-xl font-bold text-rose-700">
                        {formatGBP(sum(held, 'net'))}
                    </div>
                </div>
                <div className="border rounded-2xl p-5">
                    <div className="text-sm text-slate-500 mb-1">Due now</div>
                    <div className="text-xl font-bold text-amber-700">
                        {formatGBP(sum(due, 'net'))}
                    </div>
                </div>
                <div className="border rounded-2xl p-5">
                    <div className="text-sm text-slate-500 mb-1">Upcoming</div>
                    <div className="text-xl font-bold text-slate-900">
                        {formatGBP(sum(upcoming, 'net'))}
                    </div>
                </div>
                <div className="border rounded-2xl p-5">
                    <div className="text-sm text-slate-500 mb-1">Paid out</div>
                    <div className="text-xl font-bold text-emerald-700">
                        {formatGBP(sum(paid, 'net'))}
                    </div>
                </div>
            </div>

            <div className="mb-10">
                <h2 className="text-lg font-semibold text-slate-900 mb-1">Hosts&apos; payout status</h2>
                <p className="text-sm text-slate-500 mb-4">
                    Every host with a live, paused or pending listing. A listing goes live on approval
                    whether or not payouts are set up; their money is held until they are.
                </p>
                {payoutStatus.length === 0 ? (
                    <p className="text-sm text-slate-400 border rounded-2xl p-5">No hosts with listings yet.</p>
                ) : (
                    <div className="border rounded-2xl divide-y">
                        {payoutStatus.map((h) => (
                            <div key={h.id} className="flex items-center justify-between gap-4 p-4 flex-wrap">
                                <div className="min-w-0">
                                    <div className="font-semibold text-slate-900 truncate">{h.name}</div>
                                    <div className="text-xs text-slate-500">
                                        {h.upcomingCount} upcoming {h.upcomingCount === 1 ? 'stay' : 'stays'}
                                        {h.heldCount > 0 ? ' · ' + h.heldCount + ' held' : ''}
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    {h.held > 0 && <span className="text-sm font-semibold text-rose-700">{formatGBP(h.held)} held</span>}
                                    <span className={'rounded-full px-2.5 py-1 text-xs font-semibold '
                                        + (h.state === 'on' ? 'bg-emerald-50 text-emerald-800' : h.state === 'started' ? 'bg-amber-50 text-amber-800' : 'bg-rose-50 text-rose-800')}>
                                        {h.state === 'on' ? 'Payouts on' : h.state === 'started' ? 'Started, not finished' : 'Not set up'}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <Section
                title="Held"
                note="Check-in has passed, but the host hasn't finished setting up payouts. Paid automatically on the first payout run after Stripe enables them."
                list={held}
            />
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
