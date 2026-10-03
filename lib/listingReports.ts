// The "Report this listing" reasons, and the one rule for a valid report.
//
// Imported by BOTH the guest-facing modal (components/ReportListing.tsx) and
// the server route (app/api/listings/report/route.ts), so the client cannot
// offer a reason the server would reject, and the server never trusts a reason
// the client could have faked. One list, one validator — the house rule.
//
// The reasons, wording and order mirror Airbnb's live flow exactly (confirmed
// against the real report modal). Keep them spare: five short phrases, no
// sub-reasons, no examples, no help text.

export type ReportReasonKey =
    | 'inaccurate_incorrect'
    | 'not_real_place'
    | 'scam'
    | 'offensive'
    | 'something_else';

export const REPORT_REASONS: Array<{ key: ReportReasonKey; label: string }> = [
    { key: 'inaccurate_incorrect', label: 'It’s inaccurate or incorrect' },
    { key: 'not_real_place', label: 'It’s not a real place to stay' },
    { key: 'scam', label: 'It’s a scam' },
    { key: 'offensive', label: 'It’s offensive' },
    { key: 'something_else', label: 'It’s something else' },
];

// Longest detail we store, matched by the route's slice and the textarea's
// maxLength so client and server agree to the character.
export const REPORT_DETAILS_MAX = 2000;

const REASON_KEYS = new Set(REPORT_REASONS.map((r) => r.key));

export function reasonLabel(key: string): string {
    const found = REPORT_REASONS.find((r) => r.key === key);
    return found ? found.label : key;
}

export type ReportInput = { reason?: unknown; details?: unknown };

// The single shared check. Returns a cleaned report or the first thing wrong
// with it, so the modal and the route give the identical answer.
//
// Detail is REQUIRED: Airbnb's is "if required", but a report with a reason and
// no word of why is nothing a person can act on — and on a ten-property site
// where everyone knows each other, an empty "it's a scam" against a friend's
// cottage is worse than no report. One line is enough; we do not demand more.
export function validateReport(
    input: ReportInput
): { ok: true; reason: ReportReasonKey; details: string } | { ok: false; error: string } {
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    const details = typeof input.details === 'string' ? input.details.trim().slice(0, REPORT_DETAILS_MAX) : '';

    if (!reason || !REASON_KEYS.has(reason as ReportReasonKey)) {
        return { ok: false, error: 'Choose a reason for reporting this listing.' };
    }
    if (!details) {
        return { ok: false, error: 'Add a little detail so we know what to look at.' };
    }

    return { ok: true, reason: reason as ReportReasonKey, details };
}
