import { randomBytes, createHash } from 'crypto';

// The reply token, minted in one place and recognised in one place.
//
// WHY THIS FILE EXISTS
//
// The token was generated in the create route and hashed independently in
// three files — the create route, the respond route and the reply page — each
// with its own `createHash('sha256').update(token).digest('hex')`. All three
// agreed, which is exactly why it was worth fixing: the day one of them
// changed, nothing would fail. The token would be written under one hash and
// looked up under another, and the only symptom is a reply link that 404s.
//
// A tradesman does not report a link that says "this has expired" — he assumes
// he is late and gets on with his day. The host is told nobody answered. The
// enquiry expires. Nothing errors, nothing is logged, and the loss looks
// exactly like a tradesman who could not be bothered.
//
// So: one mint, one hash, and a test that asserts nothing else hashes a token.
//
// SERVER ONLY. It imports node crypto, so it must never be pulled into a
// client component — which is why it is here rather than in
// lib/serviceEnquiries.ts, whose rules are shared with the browser.

// 24 bytes is 32 base64url characters, which is what the SMS message budget
// was measured against. Changing it changes the length of every reply link and
// the arithmetic in emergencySms.
const TOKEN_BYTES = 24;

export function newReplyToken(): string {
    return randomBytes(TOKEN_BYTES).toString('base64url');
}

// Only the hash is ever stored. A leaked database row must not be a working
// reply link, and nothing needs to read the token back — the email is the only
// place it exists in the clear.
export function hashReplyToken(token: string): string {
    return createHash('sha256').update(String(token || '')).digest('hex');
}
