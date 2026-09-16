import type { Metadata } from 'next';
import RegisterInterest from '@/components/interest/RegisterInterest';

export const metadata: Metadata = {
    title: 'Register your interest — Galloway Getaways',
    description:
        'Tell us you’d like to list a holiday let, host a guest experience, or offer a service in '
        + 'Dumfries & Galloway, and we’ll be in touch when we open.',
};

// A full-screen takeover, the same shape as /business and the provider wizard.
export default function RegisterInterestPage() {
    return <RegisterInterest />;
}
