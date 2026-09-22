// A single, forgiving UK-postcode check, shared by the client (to hold the Send
// button and hint) and the order route (to refuse). It only asks that a postcode
// is present somewhere in the address — the box used to accept a single
// character, so a chef could be sent to "a" with nowhere to go.
//
// The pattern is the standard UK outward+inward shape (e.g. DG6 4JA, EC1A 1BB, M1
// 1AE), matched anywhere in the string and case-insensitively; the space between
// the two halves is optional.
const UK_POSTCODE = /\b[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}\b/;

export function hasUkPostcode(value: string | null | undefined): boolean {
    return UK_POSTCODE.test(String(value || ''));
}
