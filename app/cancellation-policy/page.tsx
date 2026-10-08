import type { Metadata } from 'next';
import { CANCELLATION_TIERS as TIERS } from '@/lib/cancellationTiers';

export const metadata: Metadata = {
    title: 'Cancellation & Refund Policy',
    description:
        'How cancellations and refunds work when you book a holiday let or an experience through Galloway Getaways.',
    alternates: { canonical: '/cancellation-policy' },
};

export default function CancellationPolicyPage() {
    return (
        <div className="max-w-3xl mx-auto px-6 py-12">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Cancellation &amp; Refund Policy</h1>
            <p className="text-sm text-slate-500 mb-10">Last updated 08/10/2026</p>

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
                        <strong>We don&apos;t keep anything out of your refund.</strong> There is no guest
                        service fee — you never paid one. Whatever the policy above gives back is what
                        reaches your card.
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

                <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">Guest experiences</h2>
                <p className="text-slate-700 mb-4">
                    Experiences you book around your stay — a chef, a sauna, a cake, a photographer and
                    the like — are provided by third-party providers, and we take the payment on the
                    provider&apos;s behalf. You can cancel an experience free of charge up to 48 hours
                    before it is due. Inside that window a refund is at the provider&apos;s discretion. A
                    provider may refund a confirmed booking at any time; where they do, the full amount is
                    returned to your card.
                </p>

                <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">Tradespeople</h2>
                <p className="text-slate-700 mb-4">
                    When we introduce you to a tradesperson, the job is arranged and paid for directly
                    between you and them. No money for the work passes through Galloway Getaways, so
                    cancellation and any refund for a job are matters between you and the tradesperson.
                </p>

                <h2 id="major-disruptive-events" className="text-xl font-bold text-slate-900 mt-8 mb-3 scroll-mt-24">Major disruptive events</h2>
                <p className="text-slate-700 mb-3">
                    A major disruptive event is something official that stops a stay going ahead. Only
                    these count:
                </p>
                <ul className="text-slate-700 space-y-2 mb-4 list-disc pl-5">
                    <li>a government travel restriction that stops you travelling to or staying at the property</li>
                    <li>an evacuation of the property or the area around it</li>
                    <li>police or the council closing access to the property</li>
                    <li>a widespread loss of power or water at the property</li>
                </ul>
                <p className="text-slate-700 mb-4">
                    If one of these stops your stay, message your host and ask them to cancel. When your
                    host cancels for a major disruptive event, you get back everything you have paid, and
                    your host pays no cancellation fee.
                </p>
                <p className="text-slate-700 mb-4">
                    <strong>Weather warnings don&apos;t count on their own</strong>, whatever their
                    colour, red included. Winter weather is something to expect in Dumfries &amp;
                    Galloway, so a booking affected by it follows the listing&apos;s cancellation policy.
                    Your host can choose to give back more than the policy does. Any extra refund is up to
                    them and comes out of their payout.
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
