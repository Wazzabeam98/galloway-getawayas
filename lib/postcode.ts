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

// The postcode found in a free-text address, or null. Used server-side to place a
// typed delivery address by its real council area (the D&G gate), so a match
// anywhere in the string is enough — the same forgiving rule hasUkPostcode uses.
export function extractUkPostcode(value: string | null | undefined): string | null {
    const m = String(value || '').match(UK_POSTCODE);
    return m ? m[0].replace(/\s+/g, ' ').trim() : null;
}
