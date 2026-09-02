// The single rule for when a booking has become real enough to release private
// data: the property's exact address, arrival directions, wifi and door code,
// and either party's contact details (phone, email, home address).
//
// WHY THIS IS ONE FUNCTION AND NOT A CHECK REPEATED IN EVERY READER
//
// Four readers used to answer this question inline, and they drifted apart.
// Three of them handed out private data on the strength of a booking row merely
// EXISTING, without ever asking whether it was real:
//
//   - the profile_private view's counterparty branch (host email/phone/address/
//     Stripe id/payout balance),
//   - the arrival "Getting there" page (door code, wifi password, address),
//   - the /api/trips arrival attach (address, postcode, what3words),
//   - contactNumberVisible (the counterparty's phone).
//
// Any signed-in account can plant an unpaid `pending_payment` booking against
// ANY listing for free — the bookings INSERT policy allows it because the
// browser checkout has to create exactly that row — so "a booking joins us" is
// proof of nothing. The scheduled-message sender and upcomingUntilCheckout got
// the rule right (status = 'confirmed'); this is that rule, named once, so a
// fifth reader inherits it instead of re-deriving it and drifting again.
//
// WHAT 'confirmed' MEANS, AND WHAT EACH EXCLUDED STATE COSTS A REAL GUEST
//
//   pending_payment  a planted or abandoned row, no money moved — excluded.
//                    Also the few-seconds window between paying and the webhook
//                    landing: the stay is not yet confirmed, so the guest sees
//                    no arrival details for those seconds. They are booking, not
//                    arriving, so nothing is lost.
//   pending          paid, but the host has not accepted a request-to-book —
//                    excluded: there is no agreed stay to arrive at until they
//                    accept, and the address/door code should not go out before
//                    the host has said yes. Once accepted it flips to confirmed
//                    and everything appears.
//   confirmed        an instant-book paid stay, or a request the host accepted —
//                    ALLOWED. This is the only state that clears all of the above.
//   cancelled / declined / refunded / expired  over — excluded.
//
// THE SQL TWIN
//
// The profile_private view enforces the same rule in SQL (`and b.status =
// 'confirmed'` on its counterparty branch, migration 20260903_*). A database
// view cannot import this module, so the two are kept in step by hand — change
// one, change the other. There is no third copy.
export function bookingReleasesPrivateData(
    booking: { status?: string | null } | null | undefined,
): boolean {
    return booking?.status === 'confirmed';
}
