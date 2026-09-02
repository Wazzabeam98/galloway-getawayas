// cancellationPosition() — the one place the guest-facing cancellation POSITION
// is worked out, so Your trips, the home card and the messages pane can never
// tell the guest three different stories. The amount it reports is exactly what
// refundDue() would pay, so the position and the figure the guest commits
// against are the same arithmetic, not two copies of it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancellationPosition } from '../lib/cancellationView';
import { refundDue, freeCancelUntil } from '../lib/cancellation';

const d = (iso: string) => new Date(iso + 'T12:00:00');
const CHECK_IN = '2026-10-01';

test('inside the full-refund window: free, with the last free day', () => {
    const pos = cancellationPosition({ checkIn: CHECK_IN, policy: 'Moderate', on: d('2026-09-20') });
    assert.equal(pos.kind, 'free');
    assert.ok(pos.freeUntil instanceof Date);
    assert.equal(pos.freeUntil!.getTime(), freeCancelUntil(CHECK_IN, 'Moderate').getTime());
});

test('in a 50% band: partial, and never a free date', () => {
    // Limited: full refund >=14 days out, 50% down to 7. Seven days out is the band.
    const pos = cancellationPosition({ checkIn: CHECK_IN, policy: 'Limited', on: d('2026-09-24') });
    assert.equal(pos.kind, 'partial');
    assert.equal(pos.freeUntil, null);
});

test('inside the non-refundable period: none', () => {
    const pos = cancellationPosition({ checkIn: CHECK_IN, policy: 'Firm', on: d('2026-09-30') });
    assert.equal(pos.kind, 'none');
    assert.equal(pos.freeUntil, null);
});

test('the amount is exactly what refundDue would pay', () => {
    const money = { amountPaid: 400, alreadyRefunded: 0, cleaningFee: 60 };
    const on = d('2026-09-27'); // Moderate: 4 days out, the 50% band
    const pos = cancellationPosition({ checkIn: CHECK_IN, policy: 'Moderate', on, ...money });
    const direct = refundDue({ checkIn: CHECK_IN, policy: 'Moderate', on, ...money });
    assert.equal(pos.amount, direct);
    assert.equal(pos.paidSoFar, 400);
});

test('without money fields, the state still resolves and the amount is zero', () => {
    const pos = cancellationPosition({ checkIn: CHECK_IN, policy: 'Firm', on: d('2026-09-30') });
    assert.equal(pos.kind, 'none');
    assert.equal(pos.amount, 0);
    assert.equal(pos.paidSoFar, 0);
});

test('paidSoFar nets off what has already been refunded', () => {
    const pos = cancellationPosition({
        checkIn: CHECK_IN, policy: 'Moderate', on: d('2026-09-27'),
        amountPaid: 400, alreadyRefunded: 100, cleaningFee: 0,
    });
    assert.equal(pos.paidSoFar, 300);
});
