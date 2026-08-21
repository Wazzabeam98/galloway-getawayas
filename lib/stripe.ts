// Talks to Stripe over its REST API using plain fetch, so nothing needs
// installing. Stripe expects form-encoded bodies with bracket notation for
// nested fields, which is what encodeForm builds.
//
// Server-side only — never import this into a 'use client' file.

export const STRIPE_API = 'https://api.stripe.com/v1';

export function stripeKey(): string {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    return key;
}

// { a: 1, b: { c: 2 }, d: [3] }  ->  a=1&b[c]=2&d[0]=3
function encodeForm(obj: Record<string, any>, prefix?: string): string {
    const parts: string[] = [];

    Object.keys(obj).forEach(function (key) {
        const value = obj[key];
        if (value === undefined || value === null) return;

        const name = prefix ? prefix + '[' + key + ']' : key;

        if (Array.isArray(value)) {
            value.forEach(function (item, i) {
                if (item !== null && typeof item === 'object') {
                    parts.push(encodeForm(item, name + '[' + i + ']'));
                } else {
                    parts.push(encodeURIComponent(name + '[' + i + ']') + '=' + encodeURIComponent(String(item)));
                }
            });
        } else if (typeof value === 'object') {
            parts.push(encodeForm(value, name));
        } else {
            parts.push(encodeURIComponent(name) + '=' + encodeURIComponent(String(value)));
        }
    });

    return parts.filter(Boolean).join('&');
}

export async function stripeRequest(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, any>,
    idempotencyKey?: string
): Promise<any> {
    const headers: Record<string, string> = {
        Authorization: 'Bearer ' + stripeKey(),
        'Stripe-Version': '2024-06-20',
    };

    // Stripe takes this as a header, not a field. Send the same key twice and
    // it replays the original response instead of charging again — which is
    // what protects a guest from a double charge if a job repeats.
    if (idempotencyKey) {
        headers['Idempotency-Key'] = idempotencyKey;
    }

    let url = STRIPE_API + path;
    let payload: string | undefined;

    if (method === 'POST') {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        payload = body ? encodeForm(body) : '';
    } else if (body) {
        const qs = encodeForm(body);
        if (qs) url = url + '?' + qs;
    }

    const res = await fetch(url, { method: method, headers: headers, body: payload });
    const data = await res.json();

    if (!res.ok) {
        const message = (data && data.error && data.error.message) || 'Stripe request failed';
        // Carry Stripe's own classification through. A caller that has to tell
        // 'their balance was short' apart from 'the request was malformed'
        // cannot do it from the message text alone.
        const error: any = new Error(message);
        error.stripeCode = data && data.error && data.error.code;
        error.stripeType = data && data.error && data.error.type;
        error.stripeStatus = res.status;
        throw error;
    }

    return data;
}

// Verifies the signature Stripe puts on every webhook, so nobody can post
// fake events to the endpoint. Uses node's crypto — no dependency.
export async function verifyStripeSignature(
    rawBody: string,
    signatureHeader: string | null,
    secret: string
): Promise<boolean> {
    if (!signatureHeader || !secret) return false;

    const parts = signatureHeader.split(',');
    let timestamp = '';
    const signatures: string[] = [];

    parts.forEach(function (part) {
        const bits = part.split('=');
        if (bits[0] === 't') timestamp = bits[1];
        if (bits[0] === 'v1') signatures.push(bits[1]);
    });

    if (!timestamp || signatures.length === 0) return false;

    // Reject anything older than five minutes — stops a captured request
    // being replayed later.
    const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
    if (isNaN(age) || age > 300 || age < -300) return false;

    const crypto = await import('crypto');
    const expected = crypto
        .createHmac('sha256', secret)
        .update(timestamp + '.' + rawBody)
        .digest('hex');

    let match = false;
    signatures.forEach(function (sig) {
        try {
            if (
                sig.length === expected.length &&
                crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
            ) {
                match = true;
            }
        } catch (err) {
            // length mismatch — not a match
        }
    });

    return match;
}
