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
import { resolveJoinResume } from '@/lib/joinResume';
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
            // The same sign-up lives at a clean address; name it as the one
            // copy so the ?trade=guest spelling is never a duplicate.
            alternates: { canonical: '/business/experience' },
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

    const initialResume = await resolveJoinResume(trade);

    return <ProviderSignUp initialResume={initialResume} />;
}
