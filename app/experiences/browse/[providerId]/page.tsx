import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabaseAdmin';
import { guestExperiencesOpen } from '@/lib/serviceOrders';
import { loadPublicMarketplace, pickProvider } from '@/lib/experiencesData';
import ExperienceListingBody from '@/components/marketplace/ExperienceListingBody';
import StandaloneBookingPanel from '@/components/marketplace/StandaloneBookingPanel';

export const dynamic = 'force-dynamic';

// The PUBLIC (bookingless) listing — readable logged out. Same body as the
// against-a-stay listing, so the two read as one page. The booking column is the
// only difference: a slot experience gets the standalone booking box (which
// prompts sign-in when logged out); a request shape (a chef, a made-to-order
// baker) is browsable but not standalone-bookable yet, so it says so honestly and
// points at booking it with a cottage stay — never a checkout that fails.
export default async function PublicListingPage({ params }: { params: { providerId: string } }) {
    const supabase = createServerComponentClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();

    const admin = adminClient();
    const mp = await loadPublicMarketplace(admin, guestExperiencesOpen());
    const p = pickProvider(mp, params.providerId);
    if (!p) redirect('/experiences/browse');

    const who = p.byline || p.business_name;
    const here = `/experiences/browse/${params.providerId}`;

    const panel = p.shape === 'slot' ? (
        <StandaloneBookingPanel
            signedIn={!!user}
            signInNext={here}
            provider={{
                id: p.id, who, shape: p.shape, fulfilment: p.fulfilment,
                slotCapacity: p.slotCapacity, minPeople: p.minPeople,
                items: p.items, sessions: p.sessions,
            }}
        />
    ) : (
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
            <div className="text-lg font-semibold text-slate-900">Book {who}</div>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
                {who} takes bookings as part of a cottage stay. Standalone booking for this kind of
                experience is coming soon.
            </p>
            <Link href="/"
                className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800">
                Find a cottage
            </Link>
        </div>
    );

    return (
        <ExperienceListingBody
            p={p}
            backHref="/experiences/browse"
            backLabel="All experiences"
            panel={panel}
        />
    );
}
