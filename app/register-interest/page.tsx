import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import RegisterInterest from '@/components/interest/RegisterInterest';
import { businessSignupsOpen } from '@/lib/serviceOrders';

// Read on every request: the answer depends on BUSINESS_SIGNUPS_OPEN, which
// must never be frozen into a page built before it was set.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'Register your interest — Galloway Getaways',
    description:
        'Tell us you’d like to list a holiday let, host a guest experience, or offer a service in '
        + 'Dumfries & Galloway, and we’ll be in touch when we open.',
};

// A full-screen takeover, the same shape as /business and the provider wizard.
//
// Only while sign-ups are held. Once BUSINESS_SIGNUPS_OPEN is on there is
// nothing to wait for, so an old link or bookmark goes straight to the real
// start — the same switch as the homepage bar and the /business tiles.
//
// `?type=` preselects the tile when the visitor arrived from a section that
// already said which kind of business it was asking for (the homepage's
// experiences panel sends guest_experience). Anything else is ignored.
const TYPES = ['holiday_let', 'guest_experience', 'tradesman'] as const;

export default function RegisterInterestPage({
    searchParams,
}: {
    searchParams: { type?: string | string[] };
}) {
    if (businessSignupsOpen()) redirect('/business');
    const type = typeof searchParams.type === 'string' ? searchParams.type : '';
    const initial = (TYPES as readonly string[]).includes(type) ? (type as (typeof TYPES)[number]) : null;
    return <RegisterInterest initialCategory={initial} />;
}
