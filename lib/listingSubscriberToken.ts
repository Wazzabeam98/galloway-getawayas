import { randomBytes, createHash } from 'crypto';

// The token in the "confirm you want these emails" link sent to a listing's
// extra notification address (lib/listingNotifyEmail, the
// listing_notification_subscribers table).
//
// WHY ITS OWN MODULE. tests/enquiry-token.test.ts refuses to let any file
// outside a named list hash a token, and the right answer is to be named rather
// than to loosen it — the call made for the billing and application tokens
// before this one. It cannot share theirs: the reply token's length is fixed by
// an SMS budget, and the billing token is an HMAC so that several emails keep
// working for weeks. This one is single-use and replaced on every resend, so a
// fresh random mint, stored only as its hash and cleared the moment it is used,
// is exactly what it wants.
//
// SERVER ONLY. It imports node crypto, so it must never be pulled into a client
// component — the shared rules a browser also needs live in
// lib/notificationEmails.ts, which has no secret handling.

// 32 bytes. Nothing constrains the length but the URL, and this link opts an
// address in to receiving mail, so it is generous.
const TOKEN_BYTES = 32;

export function newSubscriberToken(): string {
    return randomBytes(TOKEN_BYTES).toString('base64url');
}

// Only the hash is ever stored. A read of listing_notification_subscribers must
// not be a set of working confirm links — each one opts an address in to a
// listing's mail — so the raw token lives only in the one email that carries it.
export function hashSubscriberToken(token: string): string {
    return createHash('sha256').update(String(token || '')).digest('hex');
}
