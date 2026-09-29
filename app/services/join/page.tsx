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

import type { Metadata } from 'next';
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

export default function JoinPage() {
    return <ProviderSignUp />;
}
