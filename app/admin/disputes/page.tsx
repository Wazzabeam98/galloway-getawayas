export const dynamic = 'force-dynamic';

import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { requireAdmin } from '@/lib/access';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { adminClient } from '@/lib/supabaseAdmin';
import { formatUk } from '@/lib/cancellation';
import { guidanceFor, deadlineText, isUrgent, isMoneyAtRisk, isInquiry } from '@/lib/disputes';

// Chargebacks, and what to send back.
//
// The platform carries full liability, and Stripe's window is short — a
// dispute nobody assembles evidence for is lost by default rather than on the
// facts. So this leads with the deadline, not the amount.

export default async function AdminDisputes() {
    const supabase = createServerComponentClient({ cookies });
    // One rule, in lib/access. It was written out nine times, byte for
    // byte, and every copy was correct — but nothing made the tenth so.
    const authUser = await requireAdmin();
    const admin = adminClient();

    const { data: disputes } = await admin
        .from('disputes')
        .select('*')
        .order('evidence_due_by', { ascending: true, nullsFirst: true });

    const rows = disputes || [];
    const bookingIds = Array.from(new Set(rows.map((d: any) => d.booking_id).filter(Boolean)));

    const { data: bookings } = bookingIds.length
        ? await admin
            .from('bookings')
            .select('id, listing_id, check_in, check_out, guest_id, total_price')
            .in('id', bookingIds)
        : { data: [] };

    const bookingById: Record<string, any> = {};
    (bookings || []).forEach((b: any) => { bookingById[b.id] = b; });

    const listingIds = Array.from(new Set((bookings || []).map((b: any) => b.listing_id)));
    const { data: listings } = listingIds.length
        ? await admin.from('listings').select('id, title').in('id', listingIds)
        : { data: [] };

    const listingTitle: Record<string, string> = {};
    (listings || []).forEach((l: any) => { listingTitle[l.id] = l.title || 'Untitled listing'; });

    const now = new Date();
    const open = rows.filter((d: any) => !d.closed_at);
    const settled = rows.filter((d: any) => d.closed_at);
    const atRisk = open
        .filter((d: any) => isMoneyAtRisk(d))
        .reduce((sum: number, d: any) => sum + Number(d.amount || 0), 0);
    const inquiries = open.filter((d: any) => isInquiry(d.status)).length;

    return (
        <div className="max-w-3xl mx-auto px-6 py-10">
            <Link href="/admin" className="text-sm text-slate-500 hover:underline">
                &larr; Owner tools
            </Link>

            <h1 className="text-2xl font-bold text-slate-900 mt-4 mb-1">Chargebacks</h1>
            <p className="text-sm text-slate-500 mb-8">
                Galloway Getaways carries the liability for these. Stripe decides them on the
                evidence sent before the deadline &mdash; one nobody answers is lost by default.
            </p>

            {open.length === 0 ? (
                <div className="border rounded-2xl p-10 text-center">
                    <h2 className="font-semibold text-slate-800">No open chargebacks</h2>
                    <p className="text-sm text-slate-500 mt-1">
                        You&apos;ll get an email the moment one is raised.
                    </p>
                </div>
            ) : (
                <>
                    {/* Red only when money has actually gone. An early warning
                        still needs answering, but colouring it as a loss —
                        and saying Stripe has taken money it has not — is how a
                        banner stops being believed. */}
                    {atRisk > 0 ? (
                        <div className="border border-red-300 bg-red-50 rounded-2xl p-5 mb-6">
                            <div className="font-semibold text-red-900">
                                £{atRisk.toFixed(2)} taken back by Stripe, across{' '}
                                {open.length - inquiries}{' '}
                                {open.length - inquiries === 1 ? 'chargeback' : 'chargebacks'}
                            </div>
                            <p className="text-sm text-red-800 mt-1">
                                It comes back only if they are won.
                                {inquiries > 0 && (
                                    <>
                                        {' '}There {inquiries === 1 ? 'is also 1' : 'are also ' + inquiries}{' '}
                                        early {inquiries === 1 ? 'warning' : 'warnings'} below, where no
                                        money has gone yet.
                                    </>
                                )}
                            </p>
                        </div>
                    ) : (
                        <div className="border border-amber-300 bg-amber-50 rounded-2xl p-5 mb-6">
                            <div className="font-semibold text-amber-900">
                                {inquiries === 1 ? '1 early warning' : inquiries + ' early warnings'} to answer
                            </div>
                            <p className="text-sm text-amber-800 mt-1">
                                No money has been taken. The card network has flagged the charge, and a
                                good response now is what stops it becoming a chargeback.
                            </p>
                        </div>
                    )}

                    <div className="space-y-5">
                        {open.map((d: any) => {
                            const booking = d.booking_id ? bookingById[d.booking_id] : null;
                            const dueBy = d.evidence_due_by ? new Date(d.evidence_due_by) : null;
                            const urgent = isUrgent(dueBy, now);
                            const guidance = guidanceFor(d.reason);

                            return (
                                <div
                                    key={d.id}
                                    className={`border rounded-2xl p-6 ${urgent ? 'border-red-400' : 'border-slate-200'}`}
                                >
                                    <div className="flex items-baseline justify-between gap-4 flex-wrap">
                                        <div className={`font-bold ${urgent ? 'text-red-700' : 'text-slate-900'}`}>
                                            {deadlineText(dueBy, now)}
                                        </div>
                                        <div className="text-right">
                                            <div className="font-bold text-slate-900">
                                                £{Number(d.amount || 0).toFixed(2)}
                                            </div>
                                            {isInquiry(d.status) && (
                                                <div className="text-xs font-semibold text-amber-700">
                                                    early warning — not yet taken
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {dueBy && (
                                        <div className="text-sm text-slate-500 mt-0.5">
                                            Evidence due {formatUk(dueBy)}
                                        </div>
                                    )}

                                    <p className="text-sm text-slate-700 mt-3">{guidance.meaning}</p>

                                    <div className="text-sm text-slate-500 mt-3">
                                        {booking ? (
                                            <>
                                                {listingTitle[booking.listing_id] || 'Listing'} &middot;{' '}
                                                {formatUk(new Date(booking.check_in))} &rarr;{' '}
                                                {formatUk(new Date(booking.check_out))} &middot; £
                                                {Number(booking.total_price || 0).toFixed(2)} booking
                                            </>
                                        ) : (
                                            'Not matched to a booking — check the charge in Stripe'
                                        )}
                                    </div>

                                    <div className="mt-4 grid md:grid-cols-2 gap-4">
                                        <div>
                                            <div className="text-xs font-semibold text-slate-900 uppercase tracking-wide mb-1">
                                                What to gather
                                            </div>
                                            <ul className="text-sm text-slate-600 list-disc pl-4 space-y-1">
                                                {guidance.evidence.map((e) => <li key={e}>{e}</li>)}
                                            </ul>
                                        </div>
                                        <div>
                                            <div className="text-xs font-semibold text-slate-900 uppercase tracking-wide mb-1">
                                                What we already hold
                                            </div>
                                            <ul className="text-sm text-slate-600 list-disc pl-4 space-y-1">
                                                {guidance.weHold.map((e) => <li key={e}>{e}</li>)}
                                            </ul>
                                        </div>
                                    </div>

                                    <div className="mt-5 flex flex-wrap gap-3">
                                        {booking && (
                                            <Link
                                                href={'/dashboard/bookings/' + booking.id}
                                                className="px-4 py-2 border border-slate-300 hover:border-slate-900 text-sm font-semibold rounded-lg"
                                            >
                                                The booking
                                            </Link>
                                        )}
                                        {booking && (
                                            <Link
                                                href={'/messages/' + booking.id}
                                                className="px-4 py-2 border border-slate-300 hover:border-slate-900 text-sm font-semibold rounded-lg"
                                            >
                                                The message thread
                                            </Link>
                                        )}
                                    </div>

                                    <p className="text-xs text-slate-400 mt-4">
                                        Stripe reason code: {d.reason || 'not given'} &middot; status:{' '}
                                        {d.status || 'unknown'} &middot; {d.stripe_dispute_id}
                                    </p>

                                    {/* Submitting is final and cannot be revised, which is why
                                        nothing here does it. */}
                                    <p className="text-xs text-slate-500 mt-2">
                                        Evidence is submitted in Stripe, by a person. Nothing on this page
                                        sends anything &mdash; a submission cannot be revised once made.
                                    </p>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            {settled.length > 0 && (
                <div className="mt-10">
                    <h2 className="text-sm font-semibold text-slate-900 mb-3">Closed</h2>
                    <div className="space-y-2">
                        {settled.map((d: any) => (
                            <div key={d.id} className="flex justify-between text-sm border-b pb-2">
                                <span className="text-slate-600">
                                    £{Number(d.amount || 0).toFixed(2)} &middot; {d.reason || 'no reason given'}
                                </span>
                                <span className={d.funds_reinstated_at || d.status === 'won'
                                    ? 'font-semibold text-emerald-700'
                                    : 'font-semibold text-slate-500'}>
                                    {d.funds_reinstated_at || d.status === 'won' ? 'Won' : 'Lost'}
                                    {d.closed_at ? ' · ' + formatUk(new Date(d.closed_at)) : ''}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
