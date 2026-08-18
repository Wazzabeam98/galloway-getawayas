import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatUk } from '@/lib/cancellation';

export const dynamic = 'force-dynamic';

// Deliberately readable without being signed in.
//
// Coming back from Stripe on a phone, the browser sometimes doesn't hand the
// session cookie over, and a guest who has just paid several hundred pounds
// must not land on a login screen wondering whether it worked. The booking id
// is a random identifier that only that guest has been given, and this page
// shows nothing beyond what they already know: their own stay and what they
// just paid. No email, no host details, nothing about anyone else.
export default async function BookingConfirmed({ params }: { params: { id: string } }) {
    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );

    const { data: booking } = await admin
        .from('bookings')
        .select('id, listing_id, check_in, check_out, guests, total_price, status, payment_status, amount_paid, balance_amount, balance_due_date, free_cancel_until')
        .eq('id', params.id)
        .maybeSingle();

    if (!booking) notFound();

    const { data: listing } = await admin
        .from('listings')
        .select('title, location')
        .eq('id', booking.listing_id)
        .maybeSingle();

    const paid = Number(booking.amount_paid || 0);
    const balance = Number(booking.balance_amount || 0);
    const settled = booking.payment_status === 'paid'
        || booking.payment_status === 'deposit_paid'
        || paid > 0;

    // The webhook usually beats the guest back here, but not always.
    if (!settled) {
        return (
            <div className="max-w-xl mx-auto px-6 py-16 text-center">
                <h1 className="text-2xl font-bold text-slate-900 mb-2">
                    We&apos;re just confirming your payment
                </h1>
                <p className="text-slate-600">
                    This usually takes a few seconds. Refresh this page in a moment and your
                    booking should be here. Nothing has gone wrong, and you won&apos;t be charged
                    twice.
                </p>
                <div className="mt-8">
                    <Link
                        href={'/booking-confirmed/' + booking.id}
                        className="px-5 py-3 bg-slate-900 text-white text-sm font-semibold rounded-xl inline-block"
                    >
                        Refresh
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-xl mx-auto px-6 py-14">
            <div className="text-center mb-10">
                <div className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto mb-4 text-2xl">
                    &#10003;
                </div>
                <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-2">
                    Payment received
                </h1>
                <p className="text-slate-600">
                    {booking.status === 'confirmed'
                        ? 'Your stay is confirmed. We\u2019ve emailed you the details.'
                        : 'Your host has been asked to confirm these dates, and we\u2019ll email you as soon as they do. If they decline, you get everything back.'}
                </p>
            </div>

            <div className="border rounded-2xl p-6 space-y-4">
                <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Where</div>
                    <div className="font-semibold text-slate-900">
                        {(listing && listing.title) || 'Your stay'}
                    </div>
                    {listing && listing.location && (
                        <div className="text-sm text-slate-500">{listing.location}</div>
                    )}
                </div>

                <div className="border-t pt-4">
                    <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">When</div>
                    <div className="text-slate-800">
                        {formatUk(new Date(booking.check_in))} &rarr;{' '}
                        {formatUk(new Date(booking.check_out))}
                    </div>
                </div>

                <div className="border-t pt-4">
                    <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Paid today</div>
                    <div className="text-xl font-bold text-slate-900">£{paid.toFixed(2)}</div>
                    {balance > 0 && (
                        <p className="text-sm text-slate-600 mt-1">
                            The remaining <strong>£{balance.toFixed(2)}</strong>
                            {booking.balance_due_date
                                ? ' is taken from the same card on ' + formatUk(new Date(booking.balance_due_date)) + '.'
                                : ' is due before your stay.'}{' '}
                            You can pay it sooner from your trips page if you&apos;d rather.
                        </p>
                    )}
                    {balance <= 0 && (
                        <p className="text-sm text-slate-600 mt-1">
                            Nothing further to pay.
                        </p>
                    )}
                </div>

                {booking.free_cancel_until && (
                    <div className="border-t pt-4">
                        <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">
                            Free cancellation
                        </div>
                        <div className="text-slate-800">
                            Until {formatUk(new Date(booking.free_cancel_until))}
                        </div>
                    </div>
                )}
            </div>

            <div className="mt-8 text-center space-y-3">
                <Link
                    href="/trips"
                    className="px-5 py-3 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl inline-block transition"
                >
                    View your trips
                </Link>
                <p className="text-xs text-slate-400">
                    You may need to sign in again to see your trips. Your booking is confirmed
                    either way.
                </p>
            </div>
        </div>
    );
}
