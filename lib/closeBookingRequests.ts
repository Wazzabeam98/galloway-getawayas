// When a booking is cancelled or declined, nothing left open against it should
// still be actable: an in-flight change request would rewrite a dead booking,
// and an open money request (#182 Resolution Centre) would take or send money on
// a stay that is off. Both are closed here, from every path that ends a booking.
//
// Idempotent: it only touches rows still in an open state, so a re-run does
// nothing.
export async function closeOpenBookingRequests(admin: any, bookingId: string): Promise<void> {
    const now = new Date().toISOString();
    try {
        await admin.from('booking_change_requests')
            .update({ status: 'cancelled', updated_at: now })
            .eq('booking_id', bookingId)
            .in('status', ['pending', 'awaiting_guest_payment']);
    } catch { /* best-effort: the cancellation itself has already happened */ }
    try {
        await admin.from('booking_resolutions')
            .update({ status: 'cancelled', updated_at: now })
            .eq('booking_id', bookingId)
            .in('status', ['pending', 'countered', 'awaiting_guest_payment', 'awaiting_host_payment']);
    } catch { /* best-effort */ }
}
