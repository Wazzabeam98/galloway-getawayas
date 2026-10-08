// THE HOST AGREEMENT — what a host accepts, on top of the Guest Terms,
// when they first submit a holiday-let listing (lib/agreements.ts, key 'host').
// The ONE copy: /terms/hosts renders it, and so does the listing flow's modal.
//
// The approved wording as of 08/10/2026 (version v2-2026-10-08: the
// cancellation fee and major disruptive events added).
//
// To change the wording: edit this file, then move `version` and `lastUpdated`
// for 'host' in lib/agreements.ts. There is no re-prompt at sign-in: a host on
// an older version is asked to agree again only when they next submit a listing
// that has never been live (/api/listings/publish).
export default function HostAgreement() {
    return (
        <div className="text-slate-700 space-y-4">
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
                disruption, and repeated cancellations may result in your listings being removed. If
                you cancel a confirmed booking, the guest is refunded in full and a cancellation fee of
                5% of the booking comes off your next payout.
            </p>
            <p>
                <strong>Major disruptive events.</strong> If something official stops a confirmed stay
                going ahead (a government travel restriction, an evacuation, police or the council
                closing access to the property, or a widespread loss of power or water at the
                property), you may cancel the booking choosing &ldquo;A major disruptive event stops
                this stay&rdquo;. The guest is refunded in full. You pay no cancellation fee and receive
                no payout for the cancelled dates. If you have already been paid for them, that amount
                is taken back, and anything that cannot be taken back from that payout comes off your
                next one. A weather warning of any colour, including red, does not count on its own:
                a booking affected by weather follows your cancellation policy, and any refund beyond
                it is your decision and comes from your payout.
            </p>
        </div>
    );
}
