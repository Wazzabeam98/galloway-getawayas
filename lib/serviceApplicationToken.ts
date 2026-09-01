import { randomBytes, createHash } from 'crypto';

// The token in the "finish your application" link.
//
// WHY A THIRD TOKEN MODULE RATHER THAN REUSING ONE
//
// tests/enquiry-token.test.ts refuses to let any file outside a named list
// hash a token, and the right answer to that is to be named rather than to
// loosen it — the same call that was made when the billing token arrived.
//
// It cannot reuse the reply token. That one is 24 bytes because the SMS budget
// in emergencySms was measured against exactly 32 base64url characters, so its
// length is fixed by something that has nothing to do with this link. Sharing
// the mint would put an application link at the mercy of an SMS arithmetic
// change, which is precisely the silent coupling the guard exists to prevent.
//
// It cannot reuse the billing token either: that one is derived by HMAC so
// that four emails sent weeks apart all keep working. This one is single-use
// and replaced on every resend, so a random mint is what it wants.
//
// SERVER ONLY. It imports node crypto, so it must never be pulled into a
// client component — which is why the shared rules a browser also needs live
// in lib/serviceApplications.ts and the secret handling lives here.

// 32 bytes. Nothing constrains the length but the URL, and this link creates an
// account, so it is the longest of the three rather than the shortest.
const TOKEN_BYTES = 32;

export function newApplicationToken(): string {
    return randomBytes(TOKEN_BYTES).toString('base64url');
}

// Only the hash is ever stored. A read of service_applications must not be a
// set of working links — every one of them would create an account on somebody
// else's address, which is the entire thing this flow was rebuilt to stop.
export function hashApplicationToken(token: string): string {
    return createHash('sha256').update(String(token || '')).digest('hex');
}
