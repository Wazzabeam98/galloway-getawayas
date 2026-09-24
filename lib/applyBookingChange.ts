// Rewrite a booking to a change request's proposed stay, once, atomically.
//
// The one place a change is applied, called from both the respond route (a
// refund or a zero-cost change) and the Stripe webhook (after the guest pays a
// price increase). The database's own exclusion constraint
// (bookings_no_overlapping_confirmed) is the availability guard: if the new
// dates collide with another confirmed stay, the UPDATE raises 23P01 and NOTHING
// changes — the guest stays on their original dates. The caller decides what to
// do with the money in that case.
//
// Money is settled by the caller BEFORE (a charge, via the webhook) or is
// applied here and refunded AFTER (a refund — see the respond route), so this
// only rewrites the booking and recomputes the outstanding balance from the
// amounts the caller has already written.

export interface ChangeRow {
    id: string;
    booking_id: string;
    new_check_in: string;
    new_check_out: string;
    new_guests: number;
    new_children: number;
    new_pets: number;
    new_total: number;
}

export interface ApplyResult {
    ok: boolean;
    oversold: boolean;   // the new dates were taken by another confirmed stay
    gone: boolean;       // the booking was cancelled/declined out from under it
    error?: any;
}

function round2(v: number): number {
    return Math.round(Number(v || 0) * 100) / 100;
}

// Rewrites the booking to the proposed stay. Runs at most once because the
// caller claims the change row ('pending' → 'accepted') as its own once-only
// guard around this call; a redelivery or double-click that loses that claim
// never reaches here.
export async function applyBookingChange(admin: any, change: ChangeRow): Promise<ApplyResult> {
    // Read the live amounts so the balance is recomputed from truth, not the
    // snapshot taken at request time.
    const { data: booking } = await admin
        .from('bookings')
        .select('id, amount_paid, amount_refunded, status')
        .eq('id', change.booking_id)
        .maybeSingle();
    if (!booking) return { ok: false, oversold: false, gone: true, error: 'booking vanished' };

    // Re-read the state at apply time: a booking cancelled (or declined) while
    // the change was in flight must not be silently rewritten back to life.
    if (booking.status !== 'confirmed' && booking.status !== 'pending') {
        return { ok: false, oversold: false, gone: true, error: 'booking is ' + booking.status };
    }

    const netPaid = round2(Number(booking.amount_paid || 0) - Number(booking.amount_refunded || 0));
    const balance = round2(Math.max(0, Number(change.new_total) - netPaid));

    const { error } = await admin
        .from('bookings')
        .update({
            check_in: change.new_check_in,
            check_out: change.new_check_out,
            guests: change.new_guests,
            children: change.new_children,
            pets: change.new_pets,
            total_price: round2(Number(change.new_total)),
            balance_amount: balance,
        })
        .eq('id', change.booking_id);

    if (error) {
        // 23P01 is the exclusion constraint: the new dates were taken while this
        // change was in flight. Nothing was written.
        return { ok: false, oversold: error.code === '23P01', gone: false, error };
    }
    return { ok: true, oversold: false, gone: false };
}
