export const dynamic = 'force-dynamic';

import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { requireAdmin } from '@/lib/access';
import Link from 'next/link';
import { adminClient } from '@/lib/supabaseAdmin';
import { formatUk } from '@/lib/cancellation';
import { outcomeLabel } from '@/lib/adminResolutions';
import ResolveResolutionForm from '@/components/admin/ResolveResolutionForm';
import { formatGBP } from '@/lib/formatMoney';
import DecideHostDebtForm from '@/components/admin/DecideHostDebtForm';
import { outstandingOf } from '@/lib/hostDebt';
import { DEBT_SELECT, attachBookings, debtTitle, debtFigures, type HostDebt } from '@/lib/hostDebtView';

// The admin side of the stay Resolution Centre — where a money request the guest
// declined, or let run past the 72h deadline, comes to be adjudicated. The
// escalation alert emails link here.
//
// No money moves on this page. An escalated request is one the guest never paid,
// so there is nothing to send back; the admin records who the platform sided
// with and why, and that closes it. A genuine refund of something already paid
// is a Send-money action on the booking, not here.

function reasonLabel(reason: string | null): string {
    if (reason === 'damage') return 'Damage / reimbursement';
    if (reason === 'extra_services') return 'Extra services';
    return 'Money request';
}

export default async function AdminResolutions() {
    // Every owner page checks for itself; hiding the link is tidiness, not
    // security. This is what actually keeps people out.
    await requireAdmin();
    const admin = adminClient();

    const { data: all } = await admin
        .from('booking_resolutions')
        .select('id, booking_id, host_id, guest_id, direction, reason, amount, counter_amount, note, status, escalated_at, resolved_at, admin_outcome, admin_note, created_at')
        .eq('status', 'escalated')
        .order('escalated_at', { ascending: true, nullsFirst: true });

    const rows = all || [];
    const open = rows.filter((r: any) => !r.resolved_at);
    const closed = rows.filter((r: any) => r.resolved_at);

    // The context each card needs: booking, listing title, the two parties, and
    // any attachments. Batched, so the page is a handful of queries, not one per
    // row.
    const bookingIds = Array.from(new Set(rows.map((r: any) => r.booking_id).filter(Boolean)));
    const { data: bookings } = bookingIds.length
        ? await admin.from('bookings').select('id, listing_id, check_in, check_out, total_price').in('id', bookingIds)
        : { data: [] };
    const bookingById: Record<string, any> = {};
    (bookings || []).forEach((b: any) => { bookingById[b.id] = b; });

    const listingIds = Array.from(new Set((bookings || []).map((b: any) => b.listing_id)));
    const { data: listings } = listingIds.length
        ? await admin.from('listings').select('id, title').in('id', listingIds)
        : { data: [] };
    const listingTitle: Record<string, string> = {};
    (listings || []).forEach((l: any) => { listingTitle[l.id] = l.title || 'Untitled listing'; });

    const personIds = Array.from(new Set(rows.flatMap((r: any) => [r.host_id, r.guest_id]).filter(Boolean)));
    const { data: people } = personIds.length
        ? await admin.from('profiles').select('id, full_name, preferred_name').in('id', personIds)
        : { data: [] };
    const nameById: Record<string, string> = {};
    (people || []).forEach((p: any) => { nameById[p.id] = p.full_name || p.preferred_name || 'Unknown'; });

    const resolutionIds = rows.map((r: any) => r.id);
    const { data: attachments } = resolutionIds.length
        ? await admin.from('booking_resolution_attachments').select('id, resolution_id, content_type').in('resolution_id', resolutionIds)
        : { data: [] };
    const attByResolution: Record<string, any[]> = {};
    (attachments || []).forEach((a: any) => {
        (attByResolution[a.resolution_id] = attByResolution[a.resolution_id] || []).push(a);
    });

    // Host debts a host has disputed — money they owe the platform (a clawback
    // shortfall, a cancellation fee) that they say is wrong. The same queue and
    // the same alert email as an escalated request; these DO move money, in the
    // sense that the decision decides whether the payout run takes it again.
    const { data: disputedRows } = await admin
        .from('payouts')
        .select(DEBT_SELECT)
        .eq('status', 'disputed')
        .order('disputed_at', { ascending: true });
    const disputedDebts = await attachBookings(admin, (disputedRows || []) as HostDebt[]);
    const debtHostIds = Array.from(new Set(disputedDebts.map((d) => d.host_id)));
    const { data: debtHosts } = debtHostIds.length
        ? await admin.from('profiles').select('id, full_name, preferred_name').in('id', debtHostIds)
        : { data: [] };
    (debtHosts || []).forEach((p: any) => { nameById[p.id] = p.full_name || p.preferred_name || 'Unknown'; });

    return (
        <div className="max-w-3xl mx-auto px-6 py-10">
            <Link href="/admin" className="text-sm text-slate-500 hover:underline">&larr; Owner tools</Link>

            <h1 className="text-2xl font-bold text-slate-900 mt-4 mb-1">Money disputes</h1>
            <p className="text-sm text-slate-500 mb-8">
                Money requests a guest declined, or let run past the 72-hour deadline. Nothing here
                moves money &mdash; a request that was never paid has nothing to refund. Record who
                the platform sides with and why, and both parties are told.
            </p>

            {open.length === 0 ? (
                <div className="border rounded-2xl p-10 text-center">
                    <h2 className="font-semibold text-slate-800">Nothing waiting</h2>
                    <p className="text-sm text-slate-500 mt-1">You&apos;ll get an email the moment a request is escalated.</p>
                </div>
            ) : (
                <div className="space-y-5">
                    {open.map((r: any) => {
                        const booking = r.booking_id ? bookingById[r.booking_id] : null;
                        const atts = attByResolution[r.id] || [];
                        return (
                            <div key={r.id} className="border border-slate-200 rounded-2xl p-6">
                                <div className="flex items-baseline justify-between gap-4 flex-wrap">
                                    <div className="font-bold text-slate-900">{reasonLabel(r.reason)}</div>
                                    <div className="font-bold text-slate-900">{formatGBP(r.amount || 0)}</div>
                                </div>
                                <div className="text-sm text-slate-500 mt-0.5">
                                    {nameById[r.host_id] || 'Host'} &rarr; {nameById[r.guest_id] || 'Guest'}
                                    {r.escalated_at ? ' · escalated ' + formatUk(new Date(r.escalated_at)) : ''}
                                </div>

                                <div className="text-sm text-slate-500 mt-3">
                                    {booking ? (
                                        <>
                                            {listingTitle[booking.listing_id] || 'Listing'} &middot;{' '}
                                            {formatUk(new Date(booking.check_in))} &rarr; {formatUk(new Date(booking.check_out))} &middot;{' '}
                                            {formatGBP(booking.total_price || 0)} booking
                                        </>
                                    ) : 'Not matched to a booking'}
                                </div>

                                {r.note && (
                                    <p className="text-sm text-slate-700 mt-3 whitespace-pre-line">
                                        <span className="font-semibold">Their note: </span>{r.note}
                                    </p>
                                )}
                                {r.counter_amount != null && (
                                    <p className="text-sm text-slate-500 mt-2">
                                        Guest suggested {formatGBP(r.counter_amount)} instead.
                                    </p>
                                )}

                                {atts.length > 0 && (
                                    <div className="mt-3">
                                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-900 mb-1">Attachments</div>
                                        <div className="flex flex-wrap gap-2">
                                            {atts.map((a: any, i: number) => (
                                                <a key={a.id} href={'/api/bookings/resolutions/attachment/' + a.id}
                                                    target="_blank" rel="noopener noreferrer"
                                                    className="px-3 py-1.5 border border-slate-300 hover:border-slate-900 text-sm rounded-lg">
                                                    File {i + 1}{a.content_type ? ' · ' + String(a.content_type).split('/')[1] : ''}
                                                </a>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="mt-4 flex flex-wrap gap-3">
                                    {booking && (
                                        <Link href={'/dashboard/bookings/' + booking.id}
                                            className="px-4 py-2 border border-slate-300 hover:border-slate-900 text-sm font-semibold rounded-lg">
                                            The booking
                                        </Link>
                                    )}
                                    {r.booking_id && (
                                        <Link href={'/messages/' + r.booking_id}
                                            className="px-4 py-2 border border-slate-300 hover:border-slate-900 text-sm font-semibold rounded-lg">
                                            The message thread
                                        </Link>
                                    )}
                                </div>

                                <ResolveResolutionForm resolutionId={r.id} />
                            </div>
                        );
                    })}
                </div>
            )}

            <section id="host-debts" className="mt-12 scroll-mt-24">
                <h2 className="text-lg font-bold text-slate-900">Host debts under dispute</h2>
                <p className="text-sm text-slate-500 mb-5">
                    Money a host owes the platform that they say is wrong. It is not being taken from
                    their payouts while it waits here. Uphold, reduce or write it off; the host is told.
                </p>
                {disputedDebts.length === 0 ? (
                    <div className="border rounded-2xl p-8 text-center text-sm text-slate-500">
                        No disputed host debts.
                    </div>
                ) : (
                    <div className="space-y-5">
                        {disputedDebts.map((d) => {
                            const f = debtFigures(d);
                            return (
                                <div key={d.id} className="border border-slate-200 rounded-2xl p-6">
                                    <div className="flex items-baseline justify-between gap-4 flex-wrap">
                                        <div className="font-bold text-slate-900">{debtTitle(d)}</div>
                                        <div className="font-bold text-slate-900">{formatGBP(outstandingOf(d))}</div>
                                    </div>
                                    <div className="text-sm text-slate-500 mt-0.5">
                                        {nameById[d.host_id] || 'Host'} owes the platform
                                        {d.disputed_at ? ' · disputed ' + formatUk(new Date(d.disputed_at)) : ''}
                                    </div>
                                    <div className="text-sm text-slate-500 mt-3">
                                        {d.booking
                                            ? <>{d.booking.listing_title || 'Listing'} &middot; {formatUk(new Date(d.booking.check_in || ''))} &rarr; {formatUk(new Date(d.booking.check_out || ''))}</>
                                            : 'Not tied to one booking'}
                                        {' · '}{formatGBP(f.original)} charged, {formatGBP(f.recovered)} recovered so far
                                    </div>
                                    {d.note && <p className="text-sm text-slate-500 mt-2">{d.note}</p>}
                                    {d.dispute_reason && (
                                        <p className="text-sm text-slate-700 mt-3 whitespace-pre-line">
                                            <span className="font-semibold">The host says: </span>{d.dispute_reason}
                                        </p>
                                    )}
                                    {d.booking && (
                                        <div className="mt-4">
                                            <Link href={'/dashboard/bookings/' + d.booking.id}
                                                className="px-4 py-2 border border-slate-300 hover:border-slate-900 text-sm font-semibold rounded-lg">
                                                The booking
                                            </Link>
                                        </div>
                                    )}
                                    <DecideHostDebtForm payoutId={d.id} outstanding={outstandingOf(d)} />
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {closed.length > 0 && (
                <div className="mt-10">
                    <h2 className="text-sm font-semibold text-slate-900 mb-3">Closed</h2>
                    <div className="space-y-2">
                        {closed.map((r: any) => (
                            <div key={r.id} className="border-b pb-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-slate-600">{formatGBP(r.amount || 0)} &middot; {reasonLabel(r.reason)}</span>
                                    <span className="font-semibold text-slate-700">
                                        {outcomeLabel(r.admin_outcome)}{r.resolved_at ? ' · ' + formatUk(new Date(r.resolved_at)) : ''}
                                    </span>
                                </div>
                                {r.admin_note && <p className="text-slate-500 mt-1 whitespace-pre-line">{r.admin_note}</p>}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
