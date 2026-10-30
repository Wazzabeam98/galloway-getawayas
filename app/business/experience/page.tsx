import type { Metadata } from 'next';
import { resolveJoinResume } from '@/lib/joinResume';
import ProviderSignUp from '@/components/services/ProviderSignUp';

// The guest-experience sign-up at a clean address. It is the same wizard as
// /services/join?trade=guest — that spelling keeps working for links already
// out in emails — but every link on the site now points here, so no internal
// link carries a query string for Google to treat as a second page.
//
// noindex like the rest of the sign-up (app/services/join/layout.tsx): it is a
// form, not a search result. Deliberately NOT in robots.txt's Disallow list, so
// Google can actually read the noindex and the canonical.
export const metadata: Metadata = {
    title: 'Host a guest experience',
    description: 'Offer an experience to guests staying across Dumfries & Galloway.',
    alternates: { canonical: '/business/experience' },
    robots: { index: false, follow: true },
};

export const dynamic = 'force-dynamic';

export default async function BusinessExperiencePage() {
    const initialResume = await resolveJoinResume('guest');
    return <ProviderSignUp initialResume={initialResume} defaultTrade="guest" />;
}
