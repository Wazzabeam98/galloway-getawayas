import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getImageUrl } from '@/lib/utils';
import { formatUk } from '@/lib/cancellation';
import AcceptTripInvite from '@/components/AcceptTripInvite';

export const dynamic = 'force-dynamic';

export default async function TripInvitePage({ params }: { params: { token: string } }) {
    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );

    const { data: invite } = await admin
        .from('booking_guests')
        .select('id, booking_id, email, status, invited_by')
        .eq('invite_token', params.token)
        .maybeSingle();

    if (!invite || invite.status === 'removed') notFound();

    const { data: booking } = await admin
        .from('bookings')
        .select('id, listing_id, check_in, check_out, status, guests')
        .eq('id', invite.booking_id)
        .maybeSingle();

    if (!booking) notFound();

    const { data: listing } = await admin
        .from('listings')
        .select('title, location, images')
        .eq('id', booking.listing_id)
        .maybeSingle();

    const { data: booker } = await admin
        .from('profiles')
        .select('full_name, preferred_name')
        .eq('id', invite.invited_by)
        .maybeSingle();

    const bookerName = (booker && (booker.preferred_name || booker.full_name)) || 'Someone';

    const supabase = createServerComponentClient({ cookies });
    const { data: auth } = await supabase.auth.getSession();
    const signedInAs = (auth && auth.session && auth.session.user && auth.session.user.email) || '';

    const image =
        listing && listing.images && listing.images.length > 0
            ? getImageUrl(listing.images[0])
            : null;

    if (invite.status === 'active') {
        return (
            <div className="max-w-lg mx-auto px-6 py-20 text-center">
                <h1 className="text-2xl font-bold text-slate-900 mb-2">You&apos;re on this trip</h1>
                <p className="text-slate-600 mb-8">
                    {listing?.title || 'The stay'} is in your trips.
                </p>
                <Link
                    href="/trips"
                    className="px-5 py-3 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl inline-block"
                >
                    See your trips
                </Link>
            </div>
        );
    }

    return (
        <div className="max-w-lg mx-auto px-6 py-14">
            <p className="text-sm text-slate-500 mb-2">{bookerName} has added you to a trip</p>

            <div className="border rounded-2xl overflow-hidden mb-6">
                {image && (
                    <img src={image} alt={listing?.title || ''} className="w-full h-52 object-cover" />
                )}
                <div className="p-5">
                    <h1 className="text-xl font-bold text-slate-900">
                        {listing?.title || 'A property'}
                    </h1>
                    {listing?.location && (
                        <p className="text-sm text-slate-500">{listing.location}</p>
                    )}
                    <p className="text-slate-800 mt-3">
                        {formatUk(new Date(booking.check_in))} &rarr;{' '}
                        {formatUk(new Date(booking.check_out))}
                    </p>
                </div>
            </div>

            <div className="border rounded-2xl p-5 mb-6">
                <div className="text-sm font-semibold text-slate-900 mb-2">What you&apos;ll get</div>
                <ul className="space-y-1.5 text-sm text-slate-700">
                    <li>The address and how to get in</li>
                    <li>The dates, and anything the host tells you</li>
                    <li>A way to message the host directly</li>
                </ul>

                <div className="text-sm font-semibold text-slate-900 mt-4 mb-2">What you won&apos;t</div>
                <ul className="space-y-1.5 text-sm text-slate-500">
                    <li>What was paid — that&apos;s between {bookerName} and us</li>
                    <li>Any way to change or cancel the booking</li>
                </ul>
            </div>

            <AcceptTripInvite
                token={params.token}
                inviteEmail={invite.email}
                signedInAs={signedInAs}
            />
        </div>
    );
}
