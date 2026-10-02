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
export default function RegisterInterestPage() {
    if (businessSignupsOpen()) redirect('/business');
    return <RegisterInterest />;
}
