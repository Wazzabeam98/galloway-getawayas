// An email that did not send has to reach somebody.
//
// sendEmail returns a boolean and never throws — correct, because a
// notification that fails must not break the booking that triggered it. But
// twenty call sites take that boolean and fifteen throw it away, including
// every one that matters: the 72/48/24 balance-failure ladder, the host payout
// notice, the booking confirmation, the guest refund email.
//
// So a guest is never told their card failed, loses the booking to a deadline
// they never saw, and nothing anywhere says so. console.error is a Vercel log
// nobody reads.
//
// The fix is inside sendEmail rather than at fifteen call sites — one chance to
// get it right instead of fifteen chances to do it differently — and the
// contract is unchanged: still returns false, still never throws.
//
// THE ADDRESSES IN HERE ARE DELIBERATELY NOT RESERVED ONES ANY MORE.
//
// Every recipient in this file used to be a .test address, which since
// 1 September 2026 sendEmail declines to send to at all. That made seven of
// these tests pass for the wrong reason overnight — and it is the same shape
// as the bug it was catching: a suite that only ever exercised addresses the
// product refuses could not have told anyone the product was sending to them.
// They are ordinary-looking addresses now, on a TLD that exists.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubModule, clearModule, installAliases } from './helpers/stub';

installAliases();

function load(fetchImpl: any, opts: { key?: string | null } = {}) {
    const reported: any[] = [];

    stubModule('@/lib/logError', {
        logError: async (message: string, detail: any, context: any) => {
            reported.push({ message, detail, context });
        },
    });

    if (opts.key === null) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = opts.key || 're_test_key';

    (global as any).fetch = fetchImpl;

    clearModule('@/lib/email');
    const email = require('../lib/email');
    return { email, reported };
}

const ok = async () => ({ ok: true, status: 200, text: async () => '' });
const rejected = async () => ({ ok: false, status: 422, text: async () => 'invalid recipient' });
const unreachable = async () => { throw new Error('ECONNREFUSED'); };

/* ---------------------------------------------------------- it still behaves */

test('a send that works returns true and says nothing', async () => {
    const { email, reported } = load(ok);
    assert.equal(await email.sendEmail('a@b.co.uk', 'Subject', '<p>x</p>'), true);
    assert.deepEqual(reported, [], 'a quiet success must stay quiet');
});

test('a rejected send still returns false rather than throwing', async () => {
    // The contract the fifteen call sites rely on. If this ever throws, a
    // failed notification starts breaking the booking that triggered it.
    const { email } = load(rejected);
    assert.equal(await email.sendEmail('a@b.co.uk', 'Subject', '<p>x</p>'), false);
});

test('an unreachable Resend still returns false rather than throwing', async () => {
    const { email } = load(unreachable);
    assert.equal(await email.sendEmail('a@b.co.uk', 'Subject', '<p>x</p>'), false);
});

/* ------------------------------------------------------------ and now it says */

test('a rejected send is reported', async () => {
    const { email, reported } = load(rejected);
    await email.sendEmail('guest@somewhere.co.uk', 'Your card was declined', '<p>x</p>');

    assert.equal(reported.length, 1);
    assert.match(reported[0].message, /Resend rejected/);
    assert.equal(reported[0].detail.status, 422);
});

test('the report names WHICH email did not arrive', async () => {
    // "a notification failed" is not actionable. "the balance reminder to this
    // guest failed" is the difference between chasing it and not knowing.
    const { email, reported } = load(rejected);
    await email.sendEmail('guest@somewhere.co.uk', 'We could not take the balance for your stay', '<p>x</p>');

    assert.match(reported[0].message, /guest@somewhere\.co\.uk/);
    assert.equal(reported[0].detail.subject, 'We could not take the balance for your stay');
});

test('the report does not carry the body', async () => {
    // These carry names, dates, amounts and door codes. The subject says which
    // email it was; the body would put all of it in the error log.
    const { email, reported } = load(rejected);
    await email.sendEmail('a@b.co.uk', 'Subject', '<p>SECRET-BODY-CONTENT</p>');

    assert.ok(!JSON.stringify(reported).includes('SECRET-BODY-CONTENT'));
});

test('an unreachable Resend is reported', async () => {
    const { email, reported } = load(unreachable);
    await email.sendEmail('a@b.co.uk', 'Subject', '<p>x</p>');

    assert.equal(reported.length, 1);
    assert.match(reported[0].message, /could not reach Resend/);
});

test('a missing API key is reported, loudly', async () => {
    // The catastrophic one: nothing at all is being emailed, and every other
    // symptom looks like something else.
    const { email, reported } = load(ok, { key: null });
    assert.equal(await email.sendEmail('a@b.co.uk', 'Subject', '<p>x</p>'), false);

    assert.equal(reported.length, 1);
    assert.match(reported[0].message, /NOTHING is being emailed/);
});

test('a missing recipient is reported', async () => {
    const { email, reported } = load(ok);
    assert.equal(await email.sendEmail('', 'Subject', '<p>x</p>'), false);
    assert.equal(reported.length, 1);
});

/* ------------------------------------------------------------- fanning out */

test('sendEmailToAll reports each address that failed', async () => {
    // One director getting the email must not make a bounce to the other look
    // fine — the one who did not get it is the one who might have been
    // handling it.
    let n = 0;
    const { email, reported } = load(async () => {
        n += 1;
        return n === 1
            ? { ok: true, status: 200, text: async () => '' }
            : { ok: false, status: 422, text: async () => 'no' };
    });

    const result = await email.sendEmailToAll(['a@b.co.uk', 'c@d.co.uk'], 'Chargeback opened', '<p>x</p>');

    assert.deepEqual(result.sent, ['a@b.co.uk']);
    assert.deepEqual(result.failed, ['c@d.co.uk']);
    assert.equal(reported.length, 1, 'the one that failed, and only that one');
    assert.match(reported[0].message, /c@d\.co\.uk/);
});

/* ------------------------------------------------- and it cannot break a send */

test('a logger that throws does not turn a failed email into a failed booking', () => {
    // report() has its own try/catch for exactly this. lib/logError already
    // never throws; this is here so that a change to it cannot take the
    // booking down with it.
    const fs = require('fs');
    const path = require('path');
    const body = fs.readFileSync(path.resolve(__dirname, '..', '..', 'lib/email.ts'), 'utf8');
    const reportFn = body.slice(body.indexOf('async function report('), body.indexOf('export async function sendEmail'));
    assert.match(reportFn, /try\s*\{/);
    assert.match(reportFn, /catch/);
});

/* -------------------------------------------------- reserved TLDs, centrally */

// lib/testAddresses.ts existed since seeded tradesmen started ringing the real
// alert bell, and its comment said the decision was made "on the address, not
// on an environment variable". It was — at 5 of the 22 files that send mail.
// The other 17 sent anyway, and Resend's log showed `delivery_delayed` against
// .test recipients as recently as the night of 31 August. Bounces to domains
// that cannot exist are what sending reputation is scored on.
//
// The check now lives in sendEmail, which every message passes through.

test('nothing is sent to a reserved test domain', async () => {
    let called = false;
    const { email, reported } = load(async () => { called = true; return { ok: true, status: 200, text: async () => '' }; });

    const result = await email.sendEmail('morag@gallowaynight.test', 'You have been paid £435.00', '<p>x</p>');

    assert.equal(called, false, 'Resend must not be reached at all');
    assert.equal(result, true, 'and it is not reported as a failure — that is the noise this removes');
    assert.deepEqual(reported, [], 'nothing goes to /admin/errors either');
});

test('the other three reserved TLDs are covered too', async () => {
    for (const address of ['a@b.example', 'a@b.invalid', 'a@b.localhost']) {
        let called = false;
        const { email } = load(async () => { called = true; return { ok: true, status: 200, text: async () => '' }; });
        assert.equal(await email.sendEmail(address, 'Subject', '<p>x</p>'), true);
        assert.equal(called, false, address + ' should never reach Resend');
    }
});

test('a real address is still sent to', async () => {
    // The half that matters: this must not have quietly become a mail blackhole.
    let sentTo: any = null;
    const { email } = load(async (_url: string, init: any) => {
        sentTo = JSON.parse(init.body).to;
        return { ok: true, status: 200, text: async () => '' };
    });

    assert.equal(await email.sendEmail('morag@gallowaygetaways.co.uk', 'Subject', '<p>x</p>'), true);
    assert.deepEqual(sentTo, ['morag@gallowaygetaways.co.uk']);
});

test('a domain that merely contains a reserved word is not suppressed', async () => {
    // "protest.com" ends in "test" as text but its TLD is .com, and there is a
    // real person behind it. isAutomatedTestAddress matches on the TLD for
    // exactly this reason; this holds it there.
    let called = false;
    const { email } = load(async () => { called = true; return { ok: true, status: 200, text: async () => '' }; });

    await email.sendEmail('someone@protest.com', 'Subject', '<p>x</p>');
    assert.equal(called, true, 'protest.com is a real domain');
});

test('suppression happens before the missing-key alarm', async () => {
    // A local run with no RESEND_API_KEY should not report "NOTHING is being
    // emailed" for mail that was never going anywhere in the first place.
    const { email, reported } = load(ok, { key: null });

    assert.equal(await email.sendEmail('seed@gallowayseed.test', 'Subject', '<p>x</p>'), true);
    assert.deepEqual(reported, [], 'no alarm for a suppressed address');

    // …but a real address with no key still shouts.
    const real = load(ok, { key: null });
    assert.equal(await real.email.sendEmail('a@b.co.uk', 'Subject', '<p>x</p>'), false);
    assert.equal(real.reported.length, 1);
});

test('sendEmailToAll suppresses only the reserved addresses in the list', async () => {
    const seen: string[] = [];
    const { email } = load(async (_url: string, init: any) => {
        seen.push(JSON.parse(init.body).to[0]);
        return { ok: true, status: 200, text: async () => '' };
    });

    const result = await email.sendEmailToAll(
        ['liam@gallowaygetaways.co.uk', 'runner@gallowayseed.test'],
        'Chargeback opened',
        '<p>x</p>'
    );

    assert.deepEqual(seen, ['liam@gallowaygetaways.co.uk'], 'only the real one reaches Resend');
    assert.deepEqual(result.failed, [], 'and the suppressed one is not counted as a failure');
});
