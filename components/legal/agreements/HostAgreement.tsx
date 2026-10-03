// THE HOST AGREEMENT — what a host accepts, on top of the Guest Terms,
// when they first submit a holiday-let listing (lib/agreements.ts, key 'host').
// The ONE copy: /terms/hosts renders it, and so does the listing flow's modal.
//
// The approved wording, final as of 03/10/2026 (version v1-2026-10-03).
//
// To change the wording: edit this file, then move `version` and `lastUpdated`
// for 'host' in lib/agreements.ts. Every host is asked to accept the new
// version the next time they sign in.
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
                disruption, and repeated cancellations may result in your listings being removed.
            </p>
        </div>
    );
}
