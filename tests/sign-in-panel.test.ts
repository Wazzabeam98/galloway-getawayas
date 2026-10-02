// The Log in or sign up panel's rules (components/auth/AuthPanel), tested
// through the plain modules it is built on.
//
// What matters: one field takes a phone number or an email and the panel can
// tell which; only UK mobiles are ever texted; the same call creates-or-signs-in
// for both, so nothing reveals whether an account exists; the welcome-back
// screen masks the address; and a guest's dates survive a trip through the URL.

import { test } from 'node:test';
import assert from 'node:assert/strict';

/* eslint-disable @typescript-eslint/no-var-requires */
const id = require('../lib/signInIdentifier');
const code = require('../lib/signInCode');
const memory = require('../lib/signInMemory');
const draft = require('../lib/bookingDraftParams');
/* eslint-enable @typescript-eslint/no-var-requires */

test('an @ is an email, tidied', () => {
    assert.deepEqual(id.parseIdentifier('  Liam@Example.COM '), { kind: 'email', value: 'liam@example.com' });
});

test('UK mobiles in every way people type them become E.164', () => {
    for (const raw of ['07700 900123', '07700-900-123', '+44 7700 900123', '+44 (0)7700 900123', '447700900123', '0044 7700 900123']) {
        assert.deepEqual(id.parseIdentifier(raw), { kind: 'phone', value: '+447700900123' }, raw);
    }
});

test('landlines and foreign numbers are refused, never texted', () => {
    for (const raw of ['01557 500123', '+33 6 12 34 56 78', '+1 415 555 0100', '0770090012']) {
        const r = id.parseIdentifier(raw);
        assert.equal(r.kind, 'invalid', raw);
    }
});

test('nonsense and blanks get a plain message', () => {
    assert.equal(id.parseIdentifier('').kind, 'invalid');
    assert.equal(id.parseIdentifier('liam').kind, 'invalid');
    assert.equal(id.parseIdentifier('liam@').kind, 'invalid');
});

test('welcome back masks the address: recognisable, not readable', () => {
    assert.equal(id.maskEmail('liamworrall18@hotmail.com'), 'l••••••••8@hotmail.com');
    assert.equal(id.maskEmail('jo@x.com'), 'j•@x.com');
    assert.equal(id.maskPhone('+447700900123'), '07••• •••123');
    assert.equal(id.displayPhone('+447700900123'), '07700 900123');
});

function fakeClient(over: Record<string, any> = {}) {
    const calls: any[] = [];
    return {
        calls,
        client: {
            auth: {
                signInWithOtp: async (a: any) => { calls.push(['otp', a]); return over.otp ?? { error: null }; },
                verifyOtp: async (a: any) => { calls.push(['verify', a]); return over.verify ?? { data: { session: { user: { id: 'u1' } } }, error: null }; },
            },
        },
    };
}

test('email: one create-or-sign-in call, carrying the way back to the page', async () => {
    const { client, calls } = fakeClient();
    const r = await code.sendSignInCode(client, { kind: 'email', value: 'a@b.com' }, 'https://x/auth/callback?next=%2Fhomes%2F1');
    assert.equal(r.ok, true);
    assert.deepEqual(calls, [['otp', { email: 'a@b.com', options: { shouldCreateUser: true, emailRedirectTo: 'https://x/auth/callback?next=%2Fhomes%2F1' } }]]);
});

test('phone: the same create-or-sign-in call, by text', async () => {
    const { client, calls } = fakeClient();
    await code.sendSignInCode(client, { kind: 'phone', value: '+447700900123' });
    assert.deepEqual(calls, [['otp', { phone: '+447700900123', options: { shouldCreateUser: true, channel: 'sms' } }]]);
});

test('verify uses the matching type, and tidies a pasted code', async () => {
    const { client, calls } = fakeClient();
    await code.verifySignInCode(client, { kind: 'phone', value: '+447700900123' }, '123 456');
    await code.verifySignInCode(client, { kind: 'email', value: 'a@b.com' }, '123-456\n');
    assert.deepEqual(calls, [
        ['verify', { phone: '+447700900123', token: '123456', type: 'sms' }],
        ['verify', { email: 'a@b.com', token: '123456', type: 'email' }],
    ]);
});

test('a short code is refused before Supabase is asked', async () => {
    const { client, calls } = fakeClient();
    const r = await code.verifySignInCode(client, { kind: 'phone', value: '+447700900123' }, '123');
    assert.equal(r.ok, false);
    assert.equal(calls.length, 0);
});

test('Supabase wording never reaches the person', async () => {
    const { client } = fakeClient({ otp: { error: { message: 'Unsupported phone provider' } } });
    const r = await code.sendSignInCode(client, { kind: 'phone', value: '+447700900123' });
    assert.equal(r.ok, false);
    assert.match(r.message, /email address instead/);
    const v = fakeClient({ verify: { data: null, error: { message: 'Token has expired or is invalid' } } });
    const w = await code.verifySignInCode(v.client, { kind: 'email', value: 'a@b.com' }, '123456');
    assert.equal(w.ok, false);
    assert.doesNotMatch(w.message, /Token has/);
});

function store() {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

test('remembered account round-trips, and "Not you?" forgets it', () => {
    const s = store();
    memory.rememberAccount({ firstName: 'Liam', avatarUrl: null, kind: 'email', value: 'l@x.com' }, s);
    assert.equal(memory.readRemembered(s).firstName, 'Liam');
    memory.forgetAccount(s);
    assert.equal(memory.readRemembered(s), null);
});

test('storage that throws means "not remembered", never a crash', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    memory.rememberAccount({ firstName: 'Liam', avatarUrl: null, kind: 'email', value: 'l@x.com' }, broken);
    assert.equal(memory.readRemembered(broken), null);
    assert.equal(memory.readRemembered(null), null);
});

test('a code in flight is kept for its lifetime, then dropped', () => {
    const s = store();
    memory.savePending({ kind: 'email', value: 'a@b.com', at: 1000, next: null }, s);
    assert.equal(memory.readPending(1000 + 60_000, s).value, 'a@b.com');
    assert.equal(memory.readPending(1000 + memory.PENDING_TTL_MS + 1, s), null);
    assert.equal(memory.readPending(1000, s), null, 'expired entry is removed');
});

test('booking draft: dates and guests survive a round trip through the URL', () => {
    const p = draft.writeBookingDraft(new URLSearchParams('ref=email'), { checkIn: '2026-11-06', checkOut: '2026-11-09', adults: 2, children: 1, pets: 1 });
    assert.equal(p.toString(), 'ref=email&check_in=2026-11-06&check_out=2026-11-09&adults=2&children=1&pets=1');
    assert.deepEqual(draft.readBookingDraft(p, 6), { checkIn: '2026-11-06', checkOut: '2026-11-09', adults: 2, children: 1, pets: 1 });
});

test('booking draft: defaults leave the URL clean', () => {
    const p = draft.writeBookingDraft(new URLSearchParams('check_in=2026-11-06&adults=3'), { checkIn: null, checkOut: null, adults: 1, children: 0, pets: 0 });
    assert.equal(p.toString(), '');
});

test('booking draft: a hand-edited link never makes an impossible booking', () => {
    assert.deepEqual(draft.readBookingDraft(new URLSearchParams('check_in=2026-11-09&check_out=2026-11-06'), 4), { checkIn: null, checkOut: null, adults: 1, children: 0, pets: 0 });
    assert.equal(draft.readBookingDraft(new URLSearchParams('check_in=2026-02-30'), 4).checkIn, null);
    assert.equal(draft.readBookingDraft(new URLSearchParams('adults=40&children=9'), 4).adults, 4);
    assert.equal(draft.readBookingDraft(new URLSearchParams('adults=4&children=9'), 4).children, 0);
});

test('booking draft: day keys come from the local calendar day, not UTC', () => {
    // 23:30 local on 6 Nov — toISOString would say the 6th or 7th depending on
    // the zone; the day key must always say the 6th.
    assert.equal(draft.dateToKey(new Date(2026, 10, 6, 23, 30)), '2026-11-06');
    assert.equal(draft.keyToDate('2026-11-06').getDate(), 6);
});

test('the text provider refusing is our problem, never "check the number"', async () => {
    const err = { status: 422, code: 'sms_send_failed', message: 'Error sending confirmation OTP to provider: Primary compliance profile is not approved.' };
    const { client } = fakeClient({ otp: { error: err } });
    const r = await code.sendSignInCode(client, { kind: 'phone', value: '+447700900123' });
    assert.equal(r.ok, false);
    assert.match(r.message, /can’t send texts right now/);
    assert.doesNotMatch(r.message, /Check the number/);
    assert.equal(r.retryAfter, 0);
});
