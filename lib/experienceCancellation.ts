// Custom cancellation for a guest experience — the holiday-let's Custom
// (lib/cancellation, lib/bookingDisplay), built the same way: the provider's own
// number of days before the experience, full refund before and none after.
//
// Stored as that many days in service_providers.cancellation_window_hours
// (days × 24) with guest_details.cancellation_custom set, so orders stamp it and
// refunds read it exactly as every other window (lib/orderCancelTerms,
// guestMayCancelFree). Its own module: lib/serviceProviders' pricing guard
// refuses any arithmetic on hours there, and the experience side never imports
// the watched money-path lib/cancellation.

// The holiday-let's limits (lib/cancellation CUSTOM_MIN_DAYS /
// CUSTOM_MAX_DAYS / DEFAULT_CUSTOM_DAYS), kept here as their own constants so
// the experience side never imports the watched money-path module.
export const EXPERIENCE_CUSTOM_MIN_DAYS = 1;
export const EXPERIENCE_CUSTOM_MAX_DAYS = 365;
export const EXPERIENCE_DEFAULT_CUSTOM_DAYS = 30;

// The one rule for the Custom days, run by the editor (the picker greys Save) and
// by the save route (the server refuses the same) — the holiday-let's
// cancelDaysProblem, worded for an experience. Null when the value is fine.
export function experienceCustomDaysProblem(value: unknown): string | null {
    const raw = String(value == null ? '' : value).trim();
    if (raw === '') return 'Enter the number of days before the experience that cancellations stop being refundable.';
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return 'The number of days must be a whole number.';
    if (n < EXPERIENCE_CUSTOM_MIN_DAYS || n > EXPERIENCE_CUSTOM_MAX_DAYS) {
        return 'The number of days must be between ' + EXPERIENCE_CUSTOM_MIN_DAYS + ' and ' + EXPERIENCE_CUSTOM_MAX_DAYS + '.';
    }
    return null;
}

// The stored window, in Custom's days (hours ÷ 24), within the limits — the
// default when there is nothing usable.
export function experienceCustomDaysOf(hours: number | null | undefined): number {
    const d = Math.round((Number(hours) || 0) / 24);
    if (!Number.isFinite(d) || d < EXPERIENCE_CUSTOM_MIN_DAYS) return EXPERIENCE_DEFAULT_CUSTOM_DAYS;
    return Math.min(EXPERIENCE_CUSTOM_MAX_DAYS, d);
}

// Custom in words — the holiday-let's customPolicyWords, worded for an
// experience: "Full refund up to 30 days before the experience. No refund after that."
export function experienceCustomWords(days: number): string {
    const d = Math.max(EXPERIENCE_CUSTOM_MIN_DAYS, Math.round(Number(days) || 0));
    return 'Full refund up to ' + d + ' day' + (d === 1 ? '' : 's') + ' before the experience. No refund after that.';
}
