// The provider sign-up.
//
// This used to be the trade picker, with the form on a route of its own at
// /services/join/apply. It is now one stepped modal and the trade is step one
// of it, so both live here — which is also where every link in the wild
// points: /business, and all four of the decision emails.
//
// The steps are in lib/joinSteps.ts and the form is in
// components/services/ProviderSignUp.tsx, which is a client component because
// the whole of it is state: what they have typed, which step they are on, and
// a draft written to local storage on every keystroke.
//
// WHY THIS PAGE RESOLVES THE EXISTING APPLICATION SERVER-SIDE
//
// A provider who has already applied comes back here often: from the "your
// application" links in the decision emails, or just by signing in again. What
// they must see is the state they are actually in — "we're reviewing you", or
// the payout gate — not the empty picker (the category grid for a guest, the
// blank About-you screen for a host), which reads as though their application
// vanished.
//
// The client form does look their record up, but it depends on a client-side
// getSession() that, on a cold load straight after following an emailed link,
// can resolve to null before the auth cookie has hydrated. When it does, a
// guest falls back to the category picker and a host to a blank first step. So
// the lookup is ALSO done here, on the server, where the cookie is always
// present, and the result is handed in as the starting point — the status
// shows on the first paint regardless of the client race. The client still
// refreshes it once hydrated; this only removes the window where a returning
// applicant sees the wrong thing.

import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { adminClient } from '@/lib/supabaseAdmin';
import ProviderSignUp from '@/components/services/ProviderSignUp';

// The layout's title ("Join as a trade") is right for a tradesperson, but the
// guest-experience sign-up runs on this same route with ?trade=guest, and a
// host setting up a food tour was seeing their browser tab say "Join as a
// trade". The trade is in the URL, so the title can follow it.
export function generateMetadata({ searchParams }: { searchParams?: { trade?: string } }): Metadata {
    if (searchParams?.trade === 'guest') {
        return {
            title: 'Host a guest experience',
            description: 'Offer an experience to guests staying across Dumfries & Galloway.',
        };
    }
    return {};
}

export const dynamic = 'force-dynamic';

export default async function JoinPage({
    searchParams,
}: {
    searchParams?: { trade?: string };
}) {
    const trade = String(searchParams?.trade || '');

    let initialResume:
        | { id: string; trade: string; status: string; business_name: string }
        | null = null;

    // Only worth a lookup once a trade is chosen — step one has no record to
    // resume, and a signed-out visitor has none either.
    if (trade) {
        const supabase = createServerComponentClient({ cookies });
        // getUser(), not getSession(): the identity is verified against the
        // auth server rather than read from a forgeable cookie, so the record
        // we hand back is the signed-in owner's own and no one else's.
        const { data: { user } } = await supabase.auth.getUser();

        if (user) {
            // Scoped to owner AND the trade in the URL. One business per trade,
            // so owner + trade names exactly one row — the application this page
            // is showing, never another person's and never a different trade of
            // the same person's. Read with the service role: a draft/pending row
            // is invisible to the browser roles by policy, and reading it here
            // is what lets the server hand the client a status it could not yet
            // see for itself.
            const admin = adminClient();
            const { data } = await admin
                .from('service_providers')
                .select('id, trade, status, business_name')
                .eq('owner_id', user.id)
                .eq('trade', trade)
                .maybeSingle();

            if (data) {
                initialResume = {
                    id: data.id,
                    trade: data.trade,
                    status: data.status,
                    business_name: data.business_name,
                };
            }
        }
    }

    return <ProviderSignUp initialResume={initialResume} />;
}
