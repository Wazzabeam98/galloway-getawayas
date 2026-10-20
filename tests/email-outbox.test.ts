// The email retry queue: a failed send is recorded, then re-sent by the job
// until it works or a few attempts have passed — so a booking, cancellation or
// payout email is no longer lost to one bad moment at Resend.
//
// What is held here, with the reason:
//   - a failed send is queued, carrying the Idempotency-Key its first attempt
//     used, so a retry of a send that actually went through is not a double;
//   - nothing is queued that a retry cannot fix (a reserved test address, a
//     missing API key) or that would be noise;
//   - the drain claims each due row once, marks a success sent, backs a failure
//     off, and gives up after a bounded number of attempts;
//   - sendEmail itself queues on failure, with the SAME key it gave Resend.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

const { queueFailedEmail, drainEmailOutbox } = require('../lib/emailOutbox');

/* ------------------------------------------------------------ a tiny database */

// Supports just the chains email_outbox uses: upsert(onConflict,ignoreDuplicates),
// update().eq().eq().select('*'), delete().in().lt(), select().eq().lte().order().limit().
function fakeDb(rows: any[] = []) {
    let n = rows.length;
    function from(_table: string) {
        const filters: ((r: any) => boolean)[] = [];
        let op: 'select' | 'update' | 'delete' | 'upsert' = 'select';
        let patch: any = null;
        let upsertOpts: any = {};
        let limit = Infinity;
        const b: any = {
            select() { return b; },
            eq(c: string, v: any) { filters.push((r) => r[c] === v); return b; },
            in(c: string, vs: any[]) { filters.push((r) => vs.includes(r[c])); return b; },
            lt(c: string, v: any) { filters.push((r) => r[c] < v); return b; },
            lte(c: string, v: any) { filters.push((r) => r[c] <= v); return b; },
            order() { return b; },
            limit(x: number) { limit = x; return b; },
            update(p: any) { op = 'update'; patch = p; return b; },
            delete() { op = 'delete'; return b; },
            upsert(p: any, o: any) { op = 'upsert'; patch = p; upsertOpts = o || {}; return b; },
            then(resolve: any, reject: any) {
                try {
                    if (op === 'upsert') {
                        const key = upsertOpts.onConflict;
                        const existing = key ? rows.find((r) => r[key] === patch[key]) : null;
                        if (existing && upsertOpts.ignoreDuplicates) return resolve({ data: null, error: null });
                        if (existing) Object.assign(existing, patch);
                        else rows.push({ id: 'id' + (++n), created_at: new Date().toISOString(), ...patch });
                        return resolve({ data: null, error: null });
                    }
                    const hit = rows.filter((r) => filters.every((f) => f(r)));
                    if (op === 'update') { hit.forEach((r) => Object.assign(r, patch)); return resolve({ data: hit.map((r) => ({ ...r })), error: null }); }
                    if (op === 'delete') { hit.forEach((r) => rows.splice(rows.indexOf(r), 1)); return resolve({ data: null, error: null }); }
                    return resolve({ data: hit.slice(0, limit).map((r) => ({ ...r })), error: null });
                } catch (e) { return reject(e); }
            },
        };
        return b;
    }
    return { rows, from };
}

const past = () => new Date(Date.now() - 60000).toISOString();
const future = () => new Date(Date.now() + 3600000).toISOString();

/* ------------------------------------------------------------- recording */

test('a failed send is queued as a pending row with its key', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const db = fakeDb();
    await queueFailedEmail('guest@somewhere.co.uk', 'Your card was declined', '<p>x</p>', 'key-1', db);

    assert.equal(db.rows.length, 1);
    assert.equal(db.rows[0].idempotency_key, 'key-1');
    assert.equal(db.rows[0].to_email, 'guest@somewhere.co.uk');
    assert.equal(db.rows[0].status, 'pending');
    assert.equal(db.rows[0].attempts, 0);
    assert.ok(db.rows[0].next_attempt_at, 'a retry time is set');
});

test('a reserved test address is never queued', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const db = fakeDb();
    await queueFailedEmail('seed@gallowayseed.test', 'Subject', '<p>x</p>', 'key-2', db);
    assert.equal(db.rows.length, 0);
});

test('nothing is queued when there is no API key — a retry cannot help', async () => {
    delete process.env.RESEND_API_KEY;
    const db = fakeDb();
    await queueFailedEmail('a@b.co.uk', 'Subject', '<p>x</p>', 'key-3', db);
    assert.equal(db.rows.length, 0);
    process.env.RESEND_API_KEY = 're_test';
});

test('the same failed send is queued once, not once per attempt', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const db = fakeDb();
    await queueFailedEmail('a@b.co.uk', 'Subject', '<p>x</p>', 'same-key', db);
    await queueFailedEmail('a@b.co.uk', 'Subject', '<p>x</p>', 'same-key', db);
    assert.equal(db.rows.length, 1);
});

test('recording never throws, even if the insert blows up', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const broken = { from() { throw new Error('db down'); } } as any;
    await queueFailedEmail('a@b.co.uk', 'Subject', '<p>x</p>', 'key-4', broken); // must not reject
});

/* --------------------------------------------------------------- draining */

test('a due row that sends is marked sent, with its key handed to the sender', async () => {
    const db = fakeDb([{ id: 'r1', idempotency_key: 'k1', to_email: 'a@b.co.uk', subject: 'S', html: '<p>x</p>', status: 'pending', attempts: 0, next_attempt_at: past(), created_at: new Date().toISOString() }]);
    let seenKey: string | undefined;
    const send = async (_to: string, _s: string, _h: string, key?: string) => { seenKey = key; return true; };

    const tally = await drainEmailOutbox(db, send);
    assert.equal(tally.sent, 1);
    assert.equal(seenKey, 'k1', 'the retry reuses the stored idempotency key');
    assert.equal(db.rows[0].status, 'sent');
});

test('a row not yet due is left alone', async () => {
    const db = fakeDb([{ id: 'r1', idempotency_key: 'k1', to_email: 'a@b.co.uk', subject: 'S', html: '<p>x</p>', status: 'pending', attempts: 0, next_attempt_at: future(), created_at: new Date().toISOString() }]);
    let called = false;
    const tally = await drainEmailOutbox(db, async () => { called = true; return true; });
    assert.equal(called, false, 'the future-dated row is not sent');
    assert.equal(tally.claimed, 0);
    assert.equal(db.rows[0].status, 'pending');
});

test('a failing send backs off and stays pending with one more attempt', async () => {
    const db = fakeDb([{ id: 'r1', idempotency_key: 'k1', to_email: 'a@b.co.uk', subject: 'S', html: '<p>x</p>', status: 'pending', attempts: 0, next_attempt_at: past(), created_at: new Date().toISOString() }]);
    const tally = await drainEmailOutbox(db, async () => false);
    assert.equal(tally.retrying, 1);
    assert.equal(db.rows[0].status, 'pending');
    assert.equal(db.rows[0].attempts, 1);
    assert.ok(db.rows[0].next_attempt_at > new Date().toISOString(), 'the next attempt is in the future');
});

test('a send that keeps failing is given up on after the last attempt', async () => {
    const db = fakeDb([{ id: 'r1', idempotency_key: 'k1', to_email: 'a@b.co.uk', subject: 'S', html: '<p>x</p>', status: 'pending', attempts: 5, next_attempt_at: past(), created_at: new Date().toISOString() }]);
    const tally = await drainEmailOutbox(db, async () => false);
    assert.equal(tally.failed, 1);
    assert.equal(db.rows[0].status, 'failed');
    assert.equal(db.rows[0].attempts, 6);
});

test('a sender that throws is treated as a failure, not a crash', async () => {
    const db = fakeDb([{ id: 'r1', idempotency_key: 'k1', to_email: 'a@b.co.uk', subject: 'S', html: '<p>x</p>', status: 'pending', attempts: 0, next_attempt_at: past(), created_at: new Date().toISOString() }]);
    const tally = await drainEmailOutbox(db, async () => { throw new Error('boom'); });
    assert.equal(tally.retrying, 1);
    assert.equal(db.rows[0].attempts, 1);
});

/* --------------------------------------------- sendEmail wires into the queue */

test('sendEmail queues a failed send with the same key it gave Resend', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    process.env.RESEND_API_KEY = 're_test';

    const db = fakeDb();
    stubModule('@/lib/supabaseAdmin', { adminClient: () => db });
    stubModule('@/lib/pushOutbox', { recordEmailPush: async () => null });
    stubModule('@/lib/logError', { logError: async () => {} });

    let sentKey: string | undefined;
    (global as any).fetch = async (_url: string, init: any) => {
        sentKey = init.headers['Idempotency-Key'];
        return { ok: false, status: 500, text: async () => 'resend down' };
    };

    // Re-load emailOutbox too, so it re-captures the stubbed adminClient rather
    // than the real one bound when this file first required it.
    clearModule('@/lib/emailOutbox');
    clearModule('@/lib/email');
    const email = require('../lib/email');
    const ok = await email.sendEmail('guest@somewhere.co.uk', 'Your booking is confirmed', '<p>x</p>');

    assert.equal(ok, false, 'the send still reports failure');
    assert.ok(sentKey, 'Resend was given an Idempotency-Key');
    assert.equal(db.rows.length, 1, 'the failed send was queued');
    assert.equal(db.rows[0].idempotency_key, sentKey, 'the queued key matches the one Resend got');

    clearModule('@/lib/email');
    clearModule('@/lib/emailOutbox');
    clearModule('@/lib/supabaseAdmin');
    clearModule('@/lib/pushOutbox');
    clearModule('@/lib/logError');
});
