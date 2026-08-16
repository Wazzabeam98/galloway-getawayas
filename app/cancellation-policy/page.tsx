import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Cancellation & Refund Policy',
    description:
        'How cancellations and refunds work when you book a holiday let through Galloway Getaways.',
    alternates: { canonical: '/cancellation-policy' },
};

const TIERS = [
    {
        name: 'Flexible',
        full: 'Full refund if you cancel more than 1 day before check-in.',
        partial: '50% refund if you cancel within 1 day of check-in.',
    },
    {
        name: 'Moderate',
        full: 'Full refund if you cancel more than 5 days before check-in.',
        partial: '50% refund if you cancel within 5 days of check-in.',
    },
    {
        name: 'Limited',
        full: 'Full refund if you cancel more than 14 days before check-in.',
        partial: '50% refund if you cancel 7 to 14 days before check-in. No refund within 7 days.',
    },
    {
        name: 'Firm',
        full: 'Full refund if you cancel more than 30 days before check-in.',
        partial: '50% refund if you cancel 7 to 30 days before check-in. No refund within 7 days.',
    },
];

export default function CancellationPolicyPage() {
    return (
        <div className="max-w-3xl mx-auto px-6 py-12">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Cancellation &amp; Refund Policy</h1>
            <p className="text-sm text-slate-500 mb-10">Last updated 16 August 2026</p>

            <div className="prose prose-slate max-w-none">
                <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">How it works</h2>
                <p className="text-slate-700 mb-4">
                    Every property on Galloway Getaways has one of four cancellation policies, chosen by
                    the host. You can see which one applies before you book, and the date your free
                    cancellation period ends is shown on your booking confirmation.
                </p>

                <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">The four policies</h2>
                <div className="not-prose border rounded-2xl divide-y mb-6">
                    {TIERS.map((tier) => (
                        <div key={tier.name} className="p-5">
                            <div className="font-semibold text-slate-900 mb-2">{tier.name}</div>
                            <ul className="text-sm text-slate-600 space-y-1">
                                <li>{tier.full}</li>
                                <li>{tier.partial}</li>
                            </ul>
                        </div>
                    ))}
                </div>

                <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">What is and isn&apos;t refunded</h2>
                <ul className="text-slate-700 space-y-2 mb-4 list-disc pl-5">
                    <li>
                        <strong>Cleaning fees</strong> are always refunded in full, whenever you cancel,
                        because the clean does not take place.
                    </li>
                    <li>
                        <strong>Our service fee</strong> is not refunded. Where a refund is due, it is
                        calculated on the accommodation cost and any refundable extras, and our fee is
                        deducted.
                    </li>
                    <li>
                        <strong>Refunds are returned to the card you paid with.</strong> Depending on your
                        bank, this usually takes 5 to 10 working days to appear.
                    </li>
                </ul>

                <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">Non-refundable bookings</h2>
                <p className="text-slate-700 mb-4">
                    Some hosts offer a discounted rate in exchange for a non-refundable booking. Where you
                    choose that option, it is made clear before you pay, and no refund is available if you
                    cancel.
                </p>

                <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">If the host cancels</h2>
                <p className="text-slate-700 mb-4">
                    If a host cancels a confirmed booking, you receive a full refund including all fees.
                    We will also help you find alternative accommodation where we can.
                </p>

                <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">Circumstances outside anyone&apos;s control</h2>
                <p className="text-slate-700 mb-4">
                    If a stay cannot go ahead because of something neither you nor the host could
                    reasonably control — severe weather, a government restriction, or damage making the
                    property unsafe — contact us. We will review the circumstances and may offer a full
                    refund regardless of the policy on the listing.
                </p>

                <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">How to cancel</h2>
                <p className="text-slate-700 mb-4">
                    Sign in, go to <strong>Your trips</strong>, open the booking and choose to cancel. The
                    refund due is shown before you confirm. If you have trouble, email{' '}
                    <a href="mailto:support@gallowaygetaways.co.uk" className="text-emerald-700 underline">
                        support@gallowaygetaways.co.uk
                    </a>
                    .
                </p>

                <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">Your legal rights</h2>
                <p className="text-slate-700 mb-4">
                    Holiday accommodation booked for a specific date is exempt from the 14-day cancellation
                    right that applies to most online purchases, under the Consumer Contracts Regulations
                    2013. The policies above are what apply instead. Nothing here affects your other rights
                    under UK consumer law.
                </p>

                <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">Questions</h2>
                <p className="text-slate-700">
                    Email{' '}
                    <a href="mailto:support@gallowaygetaways.co.uk" className="text-emerald-700 underline">
                        support@gallowaygetaways.co.uk
                    </a>{' '}
                    and we will come back to you.
                </p>
            </div>
        </div>
    );
}
