export const dynamic = 'force-dynamic';

import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { adminClient } from '@/lib/supabaseAdmin';
import { displayName, capitializeFirst } from '@/lib/utils';
import GuestResolutionActions from '@/components/resolutions/GuestResolutionActions';
import { Paperclip } from 'lucide-react';

// The guest's view of a money request from their host. Read through the service
// role (the table is service-role only) and gated to the guest it belongs to.
export default async function ResolutionPage({ params }: { params: { id: string } }) {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return (
            <div className="mx-auto max-w-lg px-4 py-16 text-center">
                <h1 className="text-xl font-bold text-slate-900">Please sign in</h1>
                <p className="mt-2 text-sm text-slate-500">Sign in to view this request from your host.</p>
                <Link href="/" className="mt-4 inline-block rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Go to Galloway Getaways</Link>
            </div>
        );
    }

    const admin = adminClient();
    const { data: res } = await admin
        .from('booking_resolutions')
        .select('id, booking_id, host_id, guest_id, direction, reason, amount, counter_amount, note, status, created_at')
        .eq('id', params.id)
        .maybeSingle();
    if (!res || res.guest_id !== user.id) notFound();

    const { data: booking } = await admin.from('bookings').select('listing_id').eq('id', res.booking_id).maybeSingle();
    const { data: listing } = booking ? await admin.from('listings').select('title').eq('id', booking.listing_id).maybeSingle() : { data: null };
    const { data: host } = await admin.from('profiles').select('full_name, preferred_name, show_full_name').eq('id', res.host_id).maybeSingle();
    const { data: attachments } = await admin.from('booking_resolution_attachments').select('id, content_type').eq('resolution_id', res.id);

    // A real first name when the host has one; otherwise a natural fallback that
    // still reads as a sentence ("Your host requested £X").
    const hostReal = displayName(host, '');
    const hostFirst = hostReal ? capitializeFirst(hostReal.split(' ')[0]) : 'Your host';
    const stayName = (listing && listing.title) || 'your stay';
    const amount = Math.round(Number(res.amount) * 100) / 100;
    const isRequest = res.direction === 'request';
    const canAnswer = isRequest && res.status === 'pending';
    // The guest accepted but hasn't finished paying — offer them the way back
    // into the same Checkout session rather than a fresh accept.
    const canResume = isRequest && res.status === 'awaiting_guest_payment';

    const statusLine: Record<string, string> = {
        paid: 'You paid this request. Thank you.',
        countered: 'You suggested £' + (Number(res.counter_amount || 0)).toFixed(2) + '. Waiting for ' + hostFirst + ' to respond.',
        declined: 'You declined this request. It has been sent to us to resolve.',
        escalated: 'This request is with Galloway Getaways to resolve.',
        cancelled: hostFirst + ' withdrew this request. There’s nothing for you to do.',
        expired: 'This request has expired.',
        completed: 'Completed.',
    };

    return (
        <div className="mx-auto min-h-[calc(100dvh-4rem)] max-w-lg px-4 py-8">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700">
                    {res.reason === 'damage' ? 'Damage or extra cleaning' : 'Extra services'}
                </p>
                <h1 className="mt-1.5 text-2xl font-bold text-slate-900">
                    {hostFirst} requested £{amount.toFixed(2)}
                </h1>
                <p className="mt-1 text-sm text-slate-500">For your stay at {stayName}.</p>

                {res.note && (
                    <p className="mt-4 whitespace-pre-line rounded-xl bg-slate-50 p-3 text-[15px] leading-relaxed text-slate-700">“{res.note}”</p>
                )}

                {(attachments || []).length > 0 && (
                    <div className="mt-4">
                        <p className="text-[13px] font-semibold text-slate-700">Attachments</p>
                        <ul className="mt-1.5 space-y-1">
                            {(attachments || []).map((a: any) => (
                                <li key={a.id}>
                                    <a href={'/api/bookings/resolutions/attachment/' + a.id} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-emerald-700 underline underline-offset-4">
                                        <Paperclip className="h-3.5 w-3.5" /> View attachment
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {canAnswer ? (
                    <GuestResolutionActions resolutionId={res.id} amount={amount} guestFirst={hostFirst} />
                ) : canResume ? (
                    <GuestResolutionActions resolutionId={res.id} amount={amount} guestFirst={hostFirst} resumeOnly />
                ) : (
                    <p className="mt-5 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{statusLine[res.status] || 'This request is closed.'}</p>
                )}

                <p className="mt-4 text-[12px] text-slate-400">
                    Payments are handled securely by Stripe. If you don’t respond within 72 hours, Galloway Getaways may step in to help resolve it.
                </p>
            </div>
        </div>
    );
}
