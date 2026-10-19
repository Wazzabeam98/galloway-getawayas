// The four cancellation tiers, in one place, so the booking widget, the
// payment routes and any refund calculation can never disagree.
//
// These mirror the wording shown in the listing editor.

import { londonDayKey, shiftDayKey, ukDate, daysBetweenKeys } from './dayKey';

export type PolicyKey = 'Flexible' | 'Moderate' | 'Limited' | 'Firm' | 'Custom';

// The four fixed tiers. 'Custom' is not here because its one number is set per
// listing and stamped per booking, not fixed in this table — ruleFor() builds
// its rule from that number.
export type FixedPolicyKey = 'Flexible' | 'Moderate' | 'Limited' | 'Firm';

interface PolicyRule {
    fullRefundDaysBefore: number;   // full refund up to this many days before check-in
    halfRefundDaysBefore: number;   // 50% refund down to this many days before
}

const RULES: Record<FixedPolicyKey, PolicyRule> = {
    Flexible: { fullRefundDaysBefore: 1, halfRefundDaysBefore: 0 },
    Moderate: { fullRefundDaysBefore: 5, halfRefundDaysBefore: 0 },
    Limited: { fullRefundDaysBefore: 14, halfRefundDaysBefore: 7 },
    Firm: { fullRefundDaysBefore: 30, halfRefundDaysBefore: 7 },
};

// Custom: the host sets ONE whole number of days. Full refund up to that many
// days before check-in, nothing within it — no half-refund band, which is why
// both thresholds are the same number (refundFraction returns 1 at or beyond it
// and 0 inside it, with the 0.5 branch never reached). The bounds are the one
// place the "1 to 365" rule lives; the editor and the save route both ask
// cancelDaysProblem() so the client and the server can never disagree.
export const CUSTOM_MIN_DAYS = 1;
export const CUSTOM_MAX_DAYS = 365;

// What a brand-new listing gets, and what an existing listing that never had a
// policy chosen is moved to: Custom with this many days (no refund within 30
// days of check-in).
export const DEFAULT_CUSTOM_DAYS = 30;

export function policyOf(value: string | null | undefined): PolicyKey {
    if (
        value === 'Flexible' || value === 'Moderate' || value === 'Limited'
        || value === 'Firm' || value === 'Custom'
    ) {
        return value;
    }
    return 'Moderate';
}

// The shared validator for a Custom policy's day count. Returns a guest/host-
// readable problem string, or null when the value is a whole number in range.
// One function, called by the listing editor (client) and /api/listings/save
// (server), the way lib/stayRules is — a rule mirrored, never rewritten.
export function cancelDaysProblem(value: unknown): string | null {
    if (value === null || value === undefined || value === '') {
        return 'Enter the number of days before check-in that cancellations stop being refundable.';
    }
    const n = Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
        return 'The number of days must be a whole number.';
    }
    if (n < CUSTOM_MIN_DAYS || n > CUSTOM_MAX_DAYS) {
        return 'The number of days must be between ' + CUSTOM_MIN_DAYS + ' and ' + CUSTOM_MAX_DAYS + '.';
    }
    return null;
}

// A Custom policy's day count, coerced to a whole number in range. Falls back to
// the default rather than throwing, so a refund can always be worked out even if
// a stamped value is somehow missing or out of range — the conservative
// direction (30 days is stricter on the guest than, say, a stray 0 would be, and
// a refund is never computed against nonsense).
export function customDaysOf(value: unknown): number {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < CUSTOM_MIN_DAYS || n > CUSTOM_MAX_DAYS) {
        return DEFAULT_CUSTOM_DAYS;
    }
    return n;
}

// The refund rule for a policy. For the four fixed tiers it is the row in RULES;
// for Custom it is built from the stamped day count — full up to that many days
// before check-in, nothing inside it.
function ruleFor(policy: PolicyKey, customDays?: number | null): PolicyRule {
    if (policy === 'Custom') {
        const d = customDaysOf(customDays);
        return { fullRefundDaysBefore: d, halfRefundDaysBefore: d };
    }
    return RULES[policy];
}

// The last day (inclusive) a guest can cancel and get everything back, as a
// 'yyyy-mm-dd' key. Worked out on the calendar parts of the check-in date and
// shifted on the parts (lib/dayKey), never by flooring an instant — so it names
// the same calendar day whatever zone the code runs in. The old version floored
// to LOCAL midnight and was then stored through toISOString, which lands a day
// early under BST (check-in 6 Oct, Moderate → 30 Sept when it should be 1 Oct).
// A check-in as a 'yyyy-mm-dd' day key: a string is taken as-is; a picked Date
// (the booking widget) becomes its own calendar day, read on the parts — never
// through an instant, which lands a day early under BST.
function checkInKey(checkIn: string | Date): string {
    return typeof checkIn === 'string'
        ? String(checkIn).slice(0, 10)
        : `${checkIn.getFullYear()}-${String(checkIn.getMonth() + 1).padStart(2, '0')}-${String(checkIn.getDate()).padStart(2, '0')}`;
}

export function freeCancelUntilKey(
    checkIn: string | Date,
    policy: string | null | undefined,
    customDays?: number | null
): string {
    return shiftDayKey(checkInKey(checkIn), -ruleFor(policyOf(policy), customDays).fullRefundDaysBefore);
}

// The same day as a Date anchored at UTC midnight, so it stands for one calendar
// day and nothing else. For callers that still compare or format a Date.
export function freeCancelUntil(
    checkIn: string | Date,
    policy: string | null | undefined,
    customDays?: number | null
): Date {
    return new Date(freeCancelUntilKey(checkIn, policy, customDays) + 'T00:00:00.000Z');
}

// What proportion of what they've paid comes back, cancelling today.
//
// Worked out on London day keys — the same part arithmetic freeCancelUntilKey and
// cancellationSummary use — not by subtracting two instants floored to LOCAL
// midnight. The old instant maths compared a UTC-midnight check-in against a
// local-midnight "today", which drifts a day on a boundary date under BST (and on
// any runtime behind UTC), so the fraction could disagree with the free-cancel
// date shown right beside it. Day keys make the boundary land on the same day
// everywhere.
export function refundFraction(
    checkIn: string | Date,
    policy: string | null | undefined,
    on?: Date,
    customDays?: number | null
): number {
    const rule = ruleFor(policyOf(policy), customDays);
    const daysBefore = daysBetweenKeys(londonDayKey(on || new Date()), checkInKey(checkIn));

    if (daysBefore >= rule.fullRefundDaysBefore) return 1;
    if (daysBefore >= rule.halfRefundDaysBefore) return 0.5;
    return 0;
}

// A user-facing date, DD/MM/YYYY — the one format the site shows. Taken as the
// London calendar day of the instant and formatted from that key, so a date
// built at UTC midnight (new Date('2026-10-09')) reads the 9th whatever zone
// the server or the browser runs in, instead of slipping a day behind UTC.
export function formatUk(date: Date): string {
    if (!date || isNaN(date.getTime())) return '';
    return ukDate(londonDayKey(date));
}


// What the guest should actually be told, right now, for these dates.
//
// Printing a "free cancellation until" date only makes sense while that
// date is still in the future. Book a place for tonight on a Moderate
// policy and the full-refund window closed five days ago — so say what
// applies instead of printing a date that has been and gone.
export interface CancellationSummary {
    kind: 'free' | 'partial' | 'none';
    headline: string;
    detail: string;
}

export function cancellationSummary(
    checkIn: string | Date | null | undefined,
    policy: string | null | undefined,
    on?: Date,
    customDays?: number | null,
    nonRefundable?: boolean
): CancellationSummary | null {
    if (!checkIn) return null;

    // A non-refundable booking has no free window and no tier: the guest took
    // 10% off in exchange for keeping nothing back. Said plainly, with no
    // cleaning-fee caveat — on a non-refundable booking the cleaning fee does
    // not come back either (see refundDue).
    if (nonRefundable) {
        return {
            kind: 'none',
            headline: 'Non-refundable',
            detail:
                'You chose the non-refundable price, so if you cancel you won’t get '
                + 'a refund. A host cancellation still returns everything.',
        };
    }

    const key = policyOf(policy);
    const untilKey = freeCancelUntilKey(checkIn, policy, customDays);
    const todayKey = londonDayKey(on || new Date());

    // Inclusive: the last free day is itself still free — a full refund still
    // applies on it (refundFraction returns 1 that day). The old strict `>`
    // flipped the state to "partial" on that exact day, telling a guest that
    // cancelling would cost them while it was still free.
    if (todayKey <= untilKey) {
        return {
            kind: 'free',
            headline: 'Free cancellation until ' + ukDate(untilKey),
            detail: 'Cancel before then and you get everything back.',
        };
    }

    const fraction = refundFraction(checkIn, policy, on, customDays);

    // Both of these used to describe the fraction alone, which is no longer
    // the whole rule: the cleaning fee comes back whatever the tier says. A
    // guest reading "non-refundable" and then receiving money would have no
    // way to tell whether we had made a mistake.
    if (fraction >= 0.5) {
        return {
            kind: 'partial',
            headline: '50% refund if you cancel',
            detail:
                'These dates are inside the host\u2019s ' +
                key.toLowerCase() +
                ' cancellation window, so half of what you pay is refundable. '
                + 'Any cleaning fee comes back in full either way, because the '
                + 'clean would not take place.',
        };
    }

    return {
        kind: 'none',
        headline: 'Non-refundable dates',
        detail:
            'These dates are inside the host\u2019s ' +
            key.toLowerCase() +
            ' cancellation window, so what you pay for the stay can\u2019t be '
            + 'refunded if you cancel. Any cleaning fee still comes back in '
            + 'full, because the clean would not take place.',
    };
}

// (freeCancelDateOrNull is gone. Nothing stores this date any more — the
// checkout route used to, through toISOString, which is the drift this change
// removes. Every surface now computes the deadline live from freeCancelUntilKey,
// so there is one answer and it cannot be stale.)

// ---------------------------------------------------------------------------
// What actually comes back
// ---------------------------------------------------------------------------

/**
 * The one place a refund amount is worked out.
 *
 * WHY THIS EXISTS. The rule was written out three times — in
 * /api/stripe/refund, /api/bookings/cancel and the balance job — and predicted
 * a fourth and fifth time on Your trips and the host's booking screen. Five
 * copies of a money rule is how a guest gets shown one figure and refunded a
 * different one, which is the failure this project keeps meeting. Everything
 * asks here now.
 *
 * THE CLEANING FEE COMES BACK WHOLE. The published cancellation policy says
 * so — "always refunded in full, whenever you cancel, because the clean does
 * not take place" — and until 28 August 2026 the code took a flat fraction of
 * everything instead, cleaning included. The page is the promise; this is the
 * code catching up to it, decided deliberately rather than by editing the page.
 *
 * Three consequences worth knowing, all chosen on purpose:
 *
 *   - It applies INSIDE the non-refundable window. "Whenever you cancel" is
 *     what is published, so a guest calling off a Firm booking the day before
 *     still gets the cleaning fee. Cancellations that used to refund nothing
 *     now refund something, and a Stripe call happens where none did before.
 *
 *   - A guest who paid only the deposit gets the cleaning fee whole, then the
 *     policy share of what is left of what they paid. On a £400 booking with a
 *     £60 clean and a £100 deposit, cancelling in a 50% band returns £80 of
 *     that £100, not £50. Accepted knowingly: the alternative needs a sentence
 *     on the policy page that nobody reads.
 *
 *   - The host bears it, less our commission. The payout run pays
 *     netOfFee(amount_paid - amount_refunded), so a bigger refund comes 90% out
 *     of the host and 10% out of us, automatically. That is the right split:
 *     the host loses the fee but also loses the cost of the clean.
 */
export interface RefundInput {
    /** What has actually been collected from the guest, not the headline total. */
    amountPaid: number;
    /** Anything already given back, so a second refund cannot repeat the first. */
    alreadyRefunded: number;
    /** As stamped on the booking. Null on bookings older than the column. */
    cleaningFee: number | null | undefined;
    checkIn: string | Date;
    policy: string | null | undefined;
    /**
     * A Custom policy's stamped day count. Ignored for the four fixed tiers.
     */
    customDays?: number | null;
    /**
     * The guest chose the non-refundable price (10% off) at checkout, stamped
     * on the booking. A guest cancelling then gets nothing back — not even the
     * cleaning fee — which is the bargain they accepted. A host cancellation
     * (hostCancelling) still returns everything, so this is read only for a
     * guest cancel.
     */
    nonRefundable?: boolean;
    /**
     * A host calling a stay off, or declining one, returns everything whatever
     * the tier says — the tier exists for a guest changing their mind.
     */
    hostCancelling?: boolean;
    /** For tests. Defaults to today. */
    on?: Date;
}

export function refundDue(input: RefundInput): number {
    const paid = Number(input.amountPaid || 0);
    const already = Number(input.alreadyRefunded || 0);
    const refundable = round2(paid - already);

    // Nothing left to give back. Not an error — the caller still cancels.
    if (refundable <= 0) return 0;

    // Never the tier, and never the cleaning arithmetic either: everything
    // still held goes back.
    if (input.hostCancelling) return refundable;

    // The guest took the non-refundable price. They keep the 10% they saved;
    // they get nothing back on a cancellation, the cleaning fee included. This
    // sits above the tier and the cleaning-fee rule on purpose — it is the whole
    // point of the cheaper rate, and it is the one case where the cleaning fee
    // does NOT come back (every refundable tier still returns it in full below).
    if (input.nonRefundable) return 0;

    // The cleaning fee comes back once, not once per refund. An earlier
    // partial refund is treated as having returned it first, which is the
    // conservative direction — it can never be handed over twice, and a
    // booking that has already had more back than the clean was worth simply
    // falls through to the ordinary fraction.
    const stampedCleaning = Number(input.cleaningFee || 0);
    const cleaningStillOwed = Math.max(0, round2(stampedCleaning - already));

    // And it can never exceed what the guest actually paid. A deposit smaller
    // than the cleaning fee returns the deposit, not the fee.
    //
    // This is the only cap, deliberately. An earlier draft also clamped the
    // final figure to `refundable`, and mutation testing showed the two were
    // equivalent — either could be deleted with every test still green,
    // because each hid the other. Capping here alone keeps `rest` at or above
    // zero, which makes `cleaning + rest * fraction <= refundable` true by
    // arithmetic instead of by a second clamp nothing can tell is working.
    const cleaning = Math.min(cleaningStillOwed, refundable);

    const fraction = refundFraction(input.checkIn, input.policy, input.on, input.customDays);
    const rest = round2(refundable - cleaning);

    return round2(cleaning + rest * fraction);
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}
