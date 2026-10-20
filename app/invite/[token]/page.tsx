import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import AcceptInvite from '@/components/AcceptInvite';
import { publicArea } from '@/lib/places';
import { inviteByToken } from '@/lib/cohostTargets';

export const dynamic = 'force-dynamic';

export default async function InvitePage({ params }: { params: { token: string } }) {
    const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        { auth: { persistSession: false } }
    );

    // A holiday let's invitation, or a business's — an experience or a trade
    // (lib/cohostTargets). Same page, same words where they apply.
    const found = await inviteByToken(admin, params.token, 'id, email, role, status, can_calendar, can_messages, can_bookings, can_listing, can_earnings');
    if (!found || found.invite.status === 'revoked') notFound();
    const { target, invite } = found;
    const isBusiness = target.kind === 'provider';

    const { data: parent } = await admin
        .from(target.parent)
        .select(isBusiness ? 'business_name' : 'title, location')
        .eq('id', invite.parent_id)
        .maybeSingle();
    const listing = parent
        ? { title: isBusiness ? (parent as any).business_name : (parent as any).title, location: isBusiness ? null : (parent as any).location }
        : null;

    const supabase = createServerComponentClient({ cookies });
    const { data: auth } = await supabase.auth.getSession();
    const signedInAs = (auth && auth.session && auth.session.user && auth.session.user.email) || '';

    const abilities: string[] = [];
    if (invite.role === 'staff') {
        abilities.push('See when guests arrive and leave');
    } else {
        if (invite.can_calendar) abilities.push('Manage the calendar and pricing');
        if (invite.can_messages) abilities.push('Read and reply to guest messages');
        if (invite.can_bookings) abilities.push(isBusiness ? 'Manage bookings and enquiries' : 'Accept and decline booking requests');
        if (invite.can_listing) abilities.push('Edit the listing');
        if (invite.can_earnings) abilities.push('See what the ' + target.noun + ' earns');
    }

    if (invite.status === 'active') {
        return (
            <div className="max-w-lg mx-auto px-6 py-20 text-center">
                <h1 className="text-2xl font-bold text-slate-900 mb-2">
                    You&apos;ve already accepted this
                </h1>
                <p className="text-slate-600 mb-8">
                    {listing?.title || (isBusiness ? 'The business' : 'The property')} is in your {isBusiness ? 'business dashboard' : 'hosting area'}.
                </p>
                <Link
                    href={target.homeUrl}
                    className="px-5 py-3 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl inline-block"
                >
                    {isBusiness ? "Go to your dashboard" : "Go to hosting"}
                </Link>
            </div>
        );
    }

    return (
        <div className="max-w-lg mx-auto px-6 py-14">
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mb-2">
                {invite.role === 'staff'
                    ? 'You\u2019ve been asked to help look after'
                    : 'You\u2019ve been invited to co-host'}
            </h1>
            <p className="text-lg text-slate-700 mb-1">{listing?.title || (isBusiness ? 'A business' : 'A property')}</p>
            {listing?.location && (
                <p className="text-sm text-slate-500 mb-8">{publicArea(listing.location)}</p>
            )}

            <div className="border rounded-2xl p-6 mb-6">
                <div className="text-sm font-semibold text-slate-900 mb-3">What you&apos;ll be able to do</div>
                <ul className="space-y-2">
                    {abilities.map((a) => (
                        <li key={a} className="text-sm text-slate-700 flex items-start gap-2">
                            <span className="text-emerald-700 mt-0.5">&#10003;</span>
                            {a}
                        </li>
                    ))}
                </ul>

                <div className="text-sm font-semibold text-slate-900 mt-5 mb-3">What you won&apos;t</div>
                <ul className="space-y-2 text-sm text-slate-500">
                    {invite.role === 'staff' && <li>See prices, messages or earnings</li>}
                    {invite.role === 'co_host' && !invite.can_earnings && (
                        <li>See what the {target.noun} earns</li>
                    )}
                    <li>Receive any of the money — payouts stay with the owner</li>
                    {isBusiness
                        ? <li>Change the payout details, subscription or billing, or close the account</li>
                        : <li>Cancel a confirmed booking, refund a guest, or delete the listing</li>}
                    <li>Invite anyone else</li>
                </ul>
            </div>

            <AcceptInvite
                token={params.token}
                inviteEmail={invite.email}
                signedInAs={signedInAs}
            />
        </div>
    );
}
