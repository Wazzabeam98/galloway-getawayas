import Link from 'next/link';

// The full Terms & Conditions — ONE copy. The /terms page renders it, and so
// does the "I agree to the terms and conditions" panel at the end of the
// holiday-let sign-up, so what a host agrees to is exactly what /terms says.
//
// Change the wording here, then move TERMS_LAST_UPDATED / HOST_TERMS_VERSION in
// lib/hostTerms.ts: every host who agreed to the old version is asked to agree
// again the next time they submit a listing.
export default function TermsBody() {
    return (
        <div className="text-slate-700 space-y-4">
            <h2 className="text-xl font-bold text-slate-900 pt-4">1. Who we are</h2>
            <p>
                Galloway Getaways is operated by Galloway Getaways Ltd, a company registered in
                Scotland (company number SC899385), registered office 17b King Street, Castle
                Douglas, DG7 1AA. You can reach us at{' '}
                <a href="mailto:hello@gallowaygetaways.co.uk" className="text-emerald-700 underline">
                    hello@gallowaygetaways.co.uk
                </a>
                .
            </p>

            <h2 className="text-xl font-bold text-slate-900 pt-4">2. What we do</h2>
            <p>
                We run a platform in Dumfries &amp; Galloway that brings people together in three
                ways. Hosts list self catering accommodation and guests book it. Local providers
                offer experiences — a private chef, a sauna, a cake, a photographer and the like —
                which a guest can book around their stay. And we introduce hosts and guests to local
                tradespeople for jobs such as plumbing, electrical work and joinery.
            </p>
            <p>
                In each case the service is provided by someone else — the host, the provider or the
                tradesperson — and not by us. We are not the owner or operator of any property
                listed, we do not provide any experience, and we do not carry out any job. What we
                provide is the platform that lets you find each other, book, and where relevant pay.
            </p>

            <h2 className="text-xl font-bold text-slate-900 pt-4">3. Using the site</h2>
            <p>
                You must be 18 or over to make a booking or to list. You are responsible for keeping
                your account details secure and for anything done through your account. Please give
                accurate information when you register and keep it up to date.
            </p>

            <h2 className="text-xl font-bold text-slate-900 pt-4">4. Booking a stay</h2>
            <p>
                The accommodation is provided by the host, not by us. The contract for the stay is
                directly between you and the host. In arranging and taking payment for that stay,
                Galloway Getaways acts as agent for the host: we handle the booking and payment on
                the host&apos;s behalf, but the stay itself is the host&apos;s to provide and the
                agreement for it is between you and them.
            </p>
            <p>
                A booking is only confirmed once the host has accepted it, or immediately where the
                listing offers Instant Book.
            </p>

            <h2 className="text-xl font-bold text-slate-900 pt-4">5. Price and payment for a stay</h2>
            <p>
                Prices are shown in pounds sterling. The price you see is the price you pay — we
                do not add a booking fee or a service fee to your total. It covers the nightly
                rate for your dates plus any cleaning, pet or extra-guest charges the host has
                set, itemised in full before you confirm.
            </p>
            <p>
                You can pay the whole amount when you book, or pay a 25% deposit and the rest
                later. Where you pay a deposit, the balance is charged automatically to the card
                you used, 30 days before check-in. We email you when it is taken, and if it does
                not go through we will contact you before anything is cancelled. Booking within
                30 days of check-in means the full amount is taken at the time of booking.
            </p>
            <p>
                The host authorises us to collect payment from you on their behalf as their agent,
                to deduct our agreed commission, and to remit the balance to the host. Paying us for
                your stay discharges what you owe the host for it. Payments are processed by Stripe;
                we do not store your card details.
            </p>

            <h2 className="text-xl font-bold text-slate-900 pt-4">6. Cancellations and refunds</h2>
            <p>
                Each listing carries one of four cancellation policies, chosen by the host and shown
                before you book. Full details are in our{' '}
                <Link href="/cancellation-policy" className="text-emerald-700 underline">
                    Cancellation &amp; Refund Policy
                </Link>
                , which forms part of these terms.
            </p>

            <h2 className="text-xl font-bold text-slate-900 pt-4">7. If you are a host</h2>
            <p>
                You are responsible for your property, for the accuracy of your listing, and for
                meeting your legal obligations. That includes holding a valid short-term let licence
                where one is required in Scotland and displaying the licence number on your listing,
                having appropriate insurance, meeting fire and gas safety requirements, and paying any
                tax due on your income.
            </p>
            <p>
                You appoint us as your agent to market your listing, take bookings and collect payment
                from guests on your behalf. We charge a commission of 10% of the accommodation price,
                which we deduct before remitting the balance to you. Payouts are released after the
                guest has checked in.
            </p>
            <p>
                You must honour confirmed bookings. Cancelling on a guest at short notice causes real
                disruption, and repeated cancellations may result in your listings being removed.
            </p>

            <h2 className="text-xl font-bold text-slate-900 pt-4">8. Guest conduct</h2>
            <p>
                Please treat the property as you would your own, respect the house rules and the number
                of guests booked for, and leave it in a reasonable state. Hosts may charge for damage
                beyond ordinary wear and tear.
            </p>

            <h2 className="text-xl font-bold text-slate-900 pt-4">9. Guest experiences</h2>
            <p>
                Some local providers offer experiences you can book around your stay, such as a
                private chef, a sauna, a cake or a photographer. The experience is provided by that
                third-party provider, not by us, and the contract for it is directly between you and
                the provider. Where you pay for an experience through our checkout, we take that
                payment on the provider&apos;s behalf; the provider, not Galloway Getaways, is the
                one you are buying from.
            </p>
            <p>
                We are not responsible for the performance of the experience or for the acts or
                omissions of the provider. Providers are reviewed before they can appear on the
                platform, but our approval is not a warranty or representation as to any
                provider&apos;s skills, quality, suitability, qualifications or credentials. The
                provider is responsible for delivering the experience, for its safety, and for their
                own legal obligations, such as food hygiene registration and insurance.
            </p>

            <h2 className="text-xl font-bold text-slate-900 pt-4">10. Tradespeople</h2>
            <p>
                We introduce hosts and guests to local tradespeople for jobs such as plumbing,
                electrical work and joinery. When you are introduced to a tradesperson, any contract
                for the work is directly between you and them. No money for the job passes through us —
                the tradesperson quotes and is paid directly by you — so cancellation, refunds and the
                quality of the work are matters between you and the tradesperson.
            </p>
            <p>
                We are not responsible for the performance of the work or for the acts or omissions of
                the tradesperson. Tradespeople are reviewed before they can appear on the platform, but
                our approval is not a warranty or representation as to any tradesperson&apos;s skills,
                quality, suitability, qualifications or credentials.
            </p>

            <h2 className="text-xl font-bold text-slate-900 pt-4">11. Reviews</h2>
            <p>
                Reviews may only be left by people who have completed a booking. Reviews must be honest
                and based on your own experience. We may remove reviews that are abusive,
                discriminatory, or clearly not about the stay or service.
            </p>

            <h2 className="text-xl font-bold text-slate-900 pt-4">12. Our responsibility</h2>
            <p>
                We take reasonable care to run the platform properly, but we do not own or inspect the
                properties listed, we do not deliver the experiences, and we do not carry out the jobs,
                so we cannot guarantee that a stay, an experience or a job will meet your expectations.
                Our liability to you is limited to the total amount you paid to us in connection with
                the booking in question.
            </p>
            <p>
                Nothing in these terms limits our liability for death or personal injury caused by our
                negligence, for fraud, or for anything else that cannot be limited under UK law.
            </p>

            <h2 className="text-xl font-bold text-slate-900 pt-4">13. Suspending accounts</h2>
            <p>
                We may suspend or close an account that breaches these terms, is used fraudulently, or
                puts guests, hosts or providers at risk.
            </p>

            <h2 className="text-xl font-bold text-slate-900 pt-4">14. Changes</h2>
            <p>
                We may update these terms from time to time. The version in force when you make a
                booking is the one that applies to it.
            </p>

            <h2 className="text-xl font-bold text-slate-900 pt-4">15. Law</h2>
            <p>
                These terms are governed by the law of Scotland, and the Scottish courts have
                jurisdiction. If you live elsewhere in the UK, you keep the right to bring a claim in
                your local courts.
            </p>

            <h2 className="text-xl font-bold text-slate-900 pt-4">16. Complaints</h2>
            <p>
                If something has gone wrong, email{' '}
                <a href="mailto:support@gallowaygetaways.co.uk" className="text-emerald-700 underline">
                    support@gallowaygetaways.co.uk
                </a>{' '}
                and we will look into it.
            </p>
        </div>
    );
}
