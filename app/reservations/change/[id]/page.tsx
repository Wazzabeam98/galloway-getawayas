export const dynamic = 'force-dynamic';

import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { adminClient } from '@/lib/supabaseAdmin';
import { displayName, capitializeFirst } from '@/lib/utils';
import { ukLongDate } from '@/lib/dayKey';
import { round2 } from '@/lib/bookingChange';
import ChangeRequestActions from '@/components/reservations/ChangeRequestActions';

// The guest's view of a change their host proposed. Read through the service
// role (the table is service-role only) and gated to the guest it belongs to.
export default async function ChangeRequestPage({ params }: { params: { id: string } }) {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return (
            <div className="mx-auto max-w-lg px-4 py-16 text-center">
                <h1 className="text-xl font-bold text-slate-900">Please sign in</h1>
                <p className="mt-2 text-sm text-slate-500">Sign in to review this change from your host.</p>
                <Link href="/" className="mt-4 inline-block rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Go to Galloway Getaways</Link>
            </div>
        );
    }

    const admin = adminClient();
    const { data: chg } = await admin
        .from('booking_change_requests')
        .select('id, booking_id, host_id, guest_id, new_check_in, new_check_out, new_guests, new_children, new_pets, new_total, old_check_in, old_check_out, old_guests, old_children, old_pets, old_total, price_delta, status')
        .eq('id', params.id)
        .maybeSingle();
    if (!chg || chg.guest_id !== user.id) notFound();

    const { data: booking } = await admin.from('bookings').select('listing_id').eq('id', chg.booking_id).maybeSingle();
    const { data: listing } = booking ? await admin.from('listings').select('title').eq('id', booking.listing_id).maybeSingle() : { data: null };
    const { data: host } = await admin.from('profiles').select('full_name, preferred_name, show_full_name').eq('id', chg.host_id).maybeSingle();

    const hostReal = displayName(host, '');
    const hostFirst = hostReal ? capitializeFirst(hostReal.split(' ')[0]) : 'Your host';
    const stayName = (listing && listing.title) || 'your stay';
    const delta = round2(Number(chg.price_delta));
    const canAnswer = chg.status === 'pending';

    const datesChanged = chg.old_check_in !== chg.new_check_in || chg.old_check_out !== chg.new_check_out;
    const guestsChanged = chg.old_guests !== chg.new_guests || chg.old_children !== chg.new_children || chg.old_pets !== chg.new_pets;

    const guestLine = (g: number, c: number, p: number) =>
        g + ' guest' + (g === 1 ? '' : 's') + (c ? ' · ' + c + ' child' + (c === 1 ? '' : 'ren') : '') + (p ? ' · ' + p + ' pet' + (p === 1 ? '' : 's') : '');

    const statusLine: Record<string, string> = {
        accepted: 'You accepted this change. Your booking has been updated.',
        declined: 'You declined this change. Your booking is unchanged.',
        cancelled: hostFirst + ' withdrew this change, or the new dates were taken. Your booking is unchanged.',
        expired: 'This change request has expired.',
    };

    return (
        <div className="mx-auto min-h-[calc(100dvh-4rem)] max-w-lg px-4 py-8">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_6px_16px_rgba(0,0,0,0.12)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700">Change to your stay</p>
                <h1 className="mt-1.5 text-2xl font-bold text-slate-900">{hostFirst} proposed a change</h1>
                <p className="mt-1 text-sm text-slate-500">For your stay at {stayName}.</p>

                <div className="mt-5 space-y-3">
                    {datesChanged && (
                        <Diff label="Dates"
                            from={ukLongDate(String(chg.old_check_in)) + ' → ' + ukLongDate(String(chg.old_check_out))}
                            to={ukLongDate(String(chg.new_check_in)) + ' → ' + ukLongDate(String(chg.new_check_out))} />
                    )}
                    {guestsChanged && (
                        <Diff label="Guests"
                            from={guestLine(chg.old_guests, chg.old_children, chg.old_pets)}
                            to={guestLine(chg.new_guests, chg.new_children, chg.new_pets)} />
                    )}
                    <Diff label="Total" from={'£' + round2(chg.old_total).toFixed(2)} to={'£' + round2(chg.new_total).toFixed(2)} />
                </div>

                <div className="mt-5 rounded-xl bg-slate-50 p-3 text-[15px] text-slate-700">
                    {delta > 0
                        ? <>If you accept, you’ll pay an extra <strong>£{delta.toFixed(2)}</strong> to confirm the change.</>
                        : delta < 0
                            ? <>If you accept, you’ll be refunded <strong>£{Math.abs(delta).toFixed(2)}</strong> to your original card.</>
                            : <>There’s nothing extra to pay for this change.</>}
                </div>

                {canAnswer ? (
                    <ChangeRequestActions changeId={chg.id} delta={delta} />
                ) : (
                    <p className="mt-5 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{statusLine[chg.status] || 'This change is closed.'}</p>
                )}

                <p className="mt-4 text-[12px] text-slate-400">Nothing changes on your booking until you accept. Payments are handled securely by Stripe.</p>
            </div>
        </div>
    );
}

function Diff({ label, from, to }: { label: string; from: string; to: string }) {
    return (
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
            <span className="text-[13px] font-semibold text-slate-500">{label}</span>
            <span className="text-right text-[14px]">
                <span className="block text-slate-400 line-through">{from}</span>
                <span className="block font-semibold text-slate-900">{to}</span>
            </span>
        </div>
    );
}
