// Where a guest's cancellation stands, right now — for the screen, not for the
// ledger.
//
// The one place the guest-facing cancellation POSITION is worked out, so the
// Cancel line on Your trips, the home-page card and the messages detail pane can
// never tell the guest three different things: a card saying "free until Friday"
// while the cancel screen charges half is the same failure as a price mismatch.
//
// It lives OUTSIDE lib/cancellation.ts on purpose. That file is the money path —
// fingerprinted by the payment-scenario guard, and the actual refund arithmetic
// (refundDue) lives there and must not gain a display concern. This only
// COMPOSES those primitives into the three states a guest reads; the £ figure it
// reports is refundDue's, unchanged, so the position and the amount the guest
// commits against are the same sum, not a copy of it.

// Relative, not '@/lib/cancellation': this module is executed by a unit test,
// and the '@/' alias is a build-time path that Node cannot resolve at runtime.
import { freeCancelUntilKey, refundFraction, refundDue } from './cancellation';
import { londonDayKey } from './dayKey';

//   free    — the full-refund window is still open; `freeUntil` is its last day
//   partial — inside a 50% band; `amount` is exactly what refundDue would pay
//   none    — non-refundable dates; `amount` is whatever refundDue still returns
//             (the cleaning fee comes back even here — see refundDue)
//
// The state (kind + freeUntil) is derived from the dates and the policy alone,
// so a surface that only knows those — the shared messages pane, seen by host
// and guest — can state the position as a fact without the money fields. Pass
// the money fields too and `amount`/`paidSoFar` are filled in for the guest's
// own surfaces.
export interface CancellationPositionInput {
    checkIn: string | Date;
    policy: string | null | undefined;
    // Optional — only needed for the exact £ figure. Omit to state the position
    // as a fact without a personalised amount.
    amountPaid?: number | null;
    alreadyRefunded?: number | null;
    cleaningFee?: number | null;
    /** For tests, and to match a caller's own clock. Defaults to today. */
    on?: Date;
}

export interface CancellationPosition {
    kind: 'free' | 'partial' | 'none';
    /**
     * The last free day as a 'yyyy-mm-dd' key; only set when kind is 'free'.
     * Formatting from the key (lib/dayKey ukLongDate) is what keeps every
     * surface printing the same day — a Date run through the runtime's zone is
     * how the deadline drifted between the cards and the stored column.
     */
    freeUntilKey: string | null;
    /** The same day as a UTC-midnight Date, for callers that want one. */
    freeUntil: Date | null;
    /** What refundDue would pay back right now. 0 when no money fields given. */
    amount: number;
    /** Paid minus already refunded. 0 when no money fields given. */
    paidSoFar: number;
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

export function cancellationPosition(input: CancellationPositionInput): CancellationPosition {
    const freeKey = freeCancelUntilKey(input.checkIn, input.policy);
    const todayKey = londonDayKey(input.on || new Date());

    const paidSoFar = round2(Number(input.amountPaid || 0) - Number(input.alreadyRefunded || 0));
    const amount = refundDue({
        amountPaid: Number(input.amountPaid || 0),
        alreadyRefunded: Number(input.alreadyRefunded || 0),
        cleaningFee: input.cleaningFee,
        checkIn: input.checkIn,
        policy: input.policy,
        on: input.on,
    });

    // Inclusive: the last free day is still free (see cancellationSummary).
    if (todayKey <= freeKey) {
        return {
            kind: 'free',
            freeUntilKey: freeKey,
            freeUntil: new Date(freeKey + 'T00:00:00.000Z'),
            amount,
            paidSoFar,
        };
    }

    const fraction = refundFraction(input.checkIn, input.policy, input.on);
    return {
        kind: fraction >= 0.5 ? 'partial' : 'none',
        freeUntilKey: null,
        freeUntil: null,
        amount,
        paidSoFar,
    };
}
