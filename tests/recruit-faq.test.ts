// The sign-up FAQs promise numbers — a commission, a deposit, a window, a fee.
// Each was checked against the code when the FAQ went up (4 Oct 2026). This
// holds every one of them to the constant that decides it, so a change to the
// code that would turn an answer into a false promise fails here, naming the
// answer, instead of quietly going live.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const { RECRUIT_FAQ } = require('../lib/recruitFaq');
const { DEFAULT_COMMISSION_PERCENT } = require('../lib/fees');
const { CONFIRM_WINDOW_HOURS } = require('../lib/serviceOrders');
const { TRIAL_MONTHS, SUBSCRIPTION_MONTHLY, COMING_SOON_TRADES, DEFAULT_SERVICE_COMMISSION } = require('../lib/serviceProviders');
const { GRACE_DAYS } = require('../lib/serviceSubscription');
const { URGENCY_LEVELS } = require('../lib/serviceEnquiries');
const { ARRIVAL_SECRETS_LEAD_DAYS } = require('../lib/bookingWindows');
const { BALANCE_DAYS_BEFORE_CHECKIN } = require('../lib/balanceDue');

const answer = (aud: string, q: string): string => {
    const item = RECRUIT_FAQ[aud].find((i: any) => i.q === q);
    assert.ok(item, `${aud}: no question "${q}"`);
    return item.a.join(' ');
};

test('every answer has a question and at least one paragraph, and no question repeats', () => {
    for (const aud of ['host', 'experience', 'trade']) {
        const qs = RECRUIT_FAQ[aud].map((i: any) => i.q);
        assert.ok(qs.length >= 8, aud + ' has a real list');
        assert.equal(new Set(qs).size, qs.length, aud + ' repeats a question');
        for (const i of RECRUIT_FAQ[aud]) assert.ok(i.a.length && i.a.every((p: string) => p.trim().length > 10), i.q);
    }
});

test('nothing internal leaks: no staff names, no unbuilt promises, no unbacked claims', () => {
    const all = JSON.stringify(RECRUIT_FAQ);
    for (const banned of [/\bLiam\b/, /\bJamie\b/, /solicitor/i, /business insurance/i, /star rating/i, /special offer/i]) {
        assert.doesNotMatch(all, banned);
    }
});

test('host: commission, payouts, deposit, balance, door code', () => {
    assert.match(answer('host', 'What does it cost me?'), new RegExp(DEFAULT_COMMISSION_PERCENT + '% commission'));
    assert.match(read('vercel.json'), /"0 \*\/3 \* \* \*"/, 'calendar import runs every three hours');
    assert.match(answer('host', 'Can I stay on Airbnb and Booking.com too?'), /every three hours/);
    assert.match(read('app/api/stripe/checkout/route.ts'), /DEPOSIT_FRACTION = 0\.25/);
    const pay = answer('host', 'How do guests pay?');
    assert.match(pay, /25% deposit/);
    assert.match(pay, new RegExp(BALANCE_DAYS_BEFORE_CHECKIN + ' days before arrival'));
    assert.match(read('app/api/cron/balance-charges/route.ts'), /MAX_ATTEMPTS = 3;[\s\S]*MAX_ATTEMPTS_AUTHENTICATION = 7;/);
    assert.match(answer('host', 'Is my address public?'), new RegExp('from ' + ARRIVAL_SECRETS_LEAD_DAYS + ' days before arrival'));
});

test('host: the four cancellation policies are exactly the code’s', () => {
    const text = answer('host', 'Can I pick my cancellation policy?');
    // Read from the source: lib/cancellation.ts is a money-path file (WATCHED),
    // so its RULES table is not exported just for this test.
    const rules: Record<string, { fullRefundDaysBefore: number; halfRefundDaysBefore: number }> = {};
    for (const m of read('lib/cancellation.ts').matchAll(/(\w+): \{ fullRefundDaysBefore: (\d+), halfRefundDaysBefore: (\d+) \}/g)) {
        rules[m[1]] = { fullRefundDaysBefore: Number(m[2]), halfRefundDaysBefore: Number(m[3]) };
    }
    const names = Object.keys(rules);
    assert.deepEqual([...names].sort(), ['Firm', 'Flexible', 'Limited', 'Moderate']);
    for (const n of names) {
        const r = rules[n];
        assert.match(text, new RegExp(n + ': full refund up to ' + r.fullRefundDaysBefore + ' days?'), n);
        if (r.halfRefundDaysBefore > 0) assert.match(text, new RegExp(n + '[^.]*50% between ' + r.halfRefundDaysBefore + ' and ' + r.fullRefundDaysBefore), n);
        else assert.match(text, new RegExp(n + '[^.]*50% after that'), n);
    }
});

test('host: a host cancelling pays the 5% the refund route takes', () => {
    assert.match(read('app/api/stripe/refund/route.ts'), /total_price \|\| 0\) \* 0\.05/);
    assert.match(answer('host', 'What if I cancel on a guest?'), /5% of the booking/);
});

test('experience: 10% commission, 48-hour requests, 90% paid out', () => {
    assert.equal(DEFAULT_SERVICE_COMMISSION, 0.10);
    assert.match(answer('experience', 'What does it cost me?'), /10%/);
    assert.match(answer('experience', 'How does the money work?'), /90%[^.]*10%/);
    assert.match(answer('experience', 'Do I have to accept every booking?'), new RegExp('within ' + CONFIRM_WINDOW_HOURS + ' hours'));
});

test('trade: free months, monthly fee, grace, answer windows, coming soon', () => {
    assert.equal(TRIAL_MONTHS, 6);
    assert.match(answer('trade', 'What does it cost?'), new RegExp('six months are free, then it’s £' + SUBSCRIPTION_MONTHLY + ' a month'));
    assert.equal(GRACE_DAYS, 7);
    assert.match(answer('trade', 'What happens when the free period ends?'), /seven days after the free period ends/);
    const mins = URGENCY_LEVELS.map((u: any) => u.minutes);
    assert.deepEqual(mins, [20, 48 * 60, 120 * 60]);
    assert.match(answer('trade', 'How long do I have to answer?'), /20 minutes for an emergency, 48 hours for soon, five days for planned/);
    assert.deepEqual([...COMING_SOON_TRADES], ['sponge']);
    assert.match(answer('trade', 'Which trades can join?'), /Cleaning shows as coming soon/);
});
