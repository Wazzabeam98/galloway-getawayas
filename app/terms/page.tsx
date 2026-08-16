import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
    title: 'Terms & Conditions',
    description: 'The terms on which you use Galloway Getaways as a guest or a host.',
    alternates: { canonical: '/terms' },
};

export default function TermsPage() {
    return (
        <div className="max-w-3xl mx-auto px-6 py-12">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Terms &amp; Conditions</h1>
            <p className="text-sm text-slate-500 mb-10">Last updated 16 August 2026</p>

            <div className="text-slate-700 space-y-4">
                <h2 className="text-xl font-bold text-slate-900 pt-4">1. Who we are</h2>
                <p>
                    Galloway Getaways is operated by Galloway Getaways Ltd, a company registered in
                    Scotland (company number to be confirmed). You can reach us at{' '}
                    <a href="mailto:hello@gallowaygetaways.co.uk" className="text-emerald-700 underline">
                        hello@gallowaygetaways.co.uk
                    </a>
                    .
                </p>

                <h2 className="text-xl font-bold text-slate-900 pt-4">2. What we do</h2>
                <p>
                    We run a platform where hosts list self catering accommodation in Dumfries &amp;
                    Galloway and guests book it. The contract for the stay itself is between the guest and
                    the host. We are not the owner or operator of any property listed, and we do not
                    provide the accommodation.
                </p>

                <h2 className="text-xl font-bold text-slate-900 pt-4">3. Using the site</h2>
                <p>
                    You must be 18 or over to make a booking. You are responsible for keeping your account
                    details secure and for anything done through your account. Please give accurate
                    information when you register and keep it up to date.
                </p>

                <h2 className="text-xl font-bold text-slate-900 pt-4">4. Bookings and payment</h2>
                <p>
                    Prices are shown in pounds sterling and include our service fee, which is set out
                    before you pay. Payment is taken in full at the time of booking. A booking is only
                    confirmed once the host has accepted it, or immediately where the listing offers
                    Instant Book.
                </p>
                <p>
                    Payments are processed by Stripe. We do not store your card details.
                </p>

                <h2 className="text-xl font-bold text-slate-900 pt-4">5. Cancellations and refunds</h2>
                <p>
                    Each listing carries one of four cancellation policies, chosen by the host and shown
                    before you book. Full details are in our{' '}
                    <Link href="/cancellation-policy" className="text-emerald-700 underline">
                        Cancellation &amp; Refund Policy
                    </Link>
                    , which forms part of these terms.
                </p>

                <h2 className="text-xl font-bold text-slate-900 pt-4">6. If you are a host</h2>
                <p>
                    You are responsible for your property, for the accuracy of your listing, and for
                    meeting your legal obligations. That includes holding a valid short-term let licence
                    where one is required in Scotland and displaying the licence number on your listing,
                    having appropriate insurance, meeting fire and gas safety requirements, and paying any
                    tax due on your income.
                </p>
                <p>
                    We charge a service fee of 10% of the accommodation price, deducted from your payout.
                    Payouts are released after the guest has checked in.
                </p>
                <p>
                    You must honour confirmed bookings. Cancelling on a guest at short notice causes real
                    disruption, and repeated cancellations may result in your listings being removed.
                </p>

                <h2 className="text-xl font-bold text-slate-900 pt-4">7. Guest conduct</h2>
                <p>
                    Please treat the property as you would your own, respect the house rules and the number
                    of guests booked for, and leave it in a reasonable state. Hosts may charge for damage
                    beyond ordinary wear and tear.
                </p>

                <h2 className="text-xl font-bold text-slate-900 pt-4">8. Reviews</h2>
                <p>
                    Reviews may only be left by guests and hosts who have completed a booking. Reviews must
                    be honest and based on your own experience. We may remove reviews that are abusive,
                    discriminatory, or clearly not about the stay.
                </p>

                <h2 className="text-xl font-bold text-slate-900 pt-4">9. Our responsibility</h2>
                <p>
                    We take reasonable care to run the platform properly, but we do not own or inspect the
                    properties listed and cannot guarantee that a stay will meet your expectations. Our
                    liability to you is limited to the total amount you paid for the booking in question.
                </p>
                <p>
                    Nothing in these terms limits our liability for death or personal injury caused by our
                    negligence, for fraud, or for anything else that cannot be limited under UK law.
                </p>

                <h2 className="text-xl font-bold text-slate-900 pt-4">10. Suspending accounts</h2>
                <p>
                    We may suspend or close an account that breaches these terms, is used fraudulently, or
                    puts guests or hosts at risk.
                </p>

                <h2 className="text-xl font-bold text-slate-900 pt-4">11. Changes</h2>
                <p>
                    We may update these terms from time to time. The version in force when you make a
                    booking is the one that applies to it.
                </p>

                <h2 className="text-xl font-bold text-slate-900 pt-4">12. Law</h2>
                <p>
                    These terms are governed by the law of Scotland, and the Scottish courts have
                    jurisdiction. If you live elsewhere in the UK, you keep the right to bring a claim in
                    your local courts.
                </p>

                <h2 className="text-xl font-bold text-slate-900 pt-4">13. Complaints</h2>
                <p>
                    If something has gone wrong, email{' '}
                    <a href="mailto:support@gallowaygetaways.co.uk" className="text-emerald-700 underline">
                        support@gallowaygetaways.co.uk
                    </a>{' '}
                    and we will look into it.
                </p>
            </div>
        </div>
    );
}
