// The deposit balance-due date: computed on the calendar parts so it names the
// same day in every zone — 30 days before check-in, not a day early under BST.
//
// The bug this pins down: the checkout route stored the due date as
//   new Date(check_in) → setDate(getDate() - 30) → toISOString().split('T')[0]
// which mixes a UTC-parsed midnight with local-time arithmetic. For check-ins
// that parse in GMT but whose date-minus-30 lands in BST — roughly 26 Oct to
// 24 Nov — that kept 00:00 local in a +1h zone, so toISOString rolled back a day
// and the balance was scheduled (and the failure ladder started) a day early.
//
// Runs identically under TZ=UTC and TZ=Europe/London — that is the whole point.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balanceDueKey, BALANCE_DAYS_BEFORE_CHECKIN } from '../lib/balanceDue';
import { daysBetweenKeys, shiftDayKey } from '../lib/dayKey';

test('the reported window: check-in 20 Nov → balance due 21 Oct (not 20 Oct)', () => {
    // Check-in parses in GMT (after the 25 Oct 2026 fall-back); 30 days earlier
    // is 21 Oct, which is still BST. The old toISOString store landed 20 Oct.
    assert.equal(balanceDueKey('2026-11-20'), '2026-10-21');
});

test('a check-in right at the edge of the window still lands true', () => {
    // 26 Oct check-in: 30 days before is 26 Sept (BST both ends here).
    assert.equal(balanceDueKey('2026-10-26'), '2026-09-26');
    // 24 Nov check-in (top of the reported window): 25 Oct, the fall-back day.
    assert.equal(balanceDueKey('2026-11-24'), '2026-10-25');
});

test('it is exactly 30 calendar days before, across a DST boundary', () => {
    // Spanning the autumn fall-back (25 Oct 2026) and the spring-forward.
    for (const checkIn of ['2026-11-20', '2026-11-01', '2026-04-20', '2026-01-15', '2026-07-31']) {
        assert.equal(
            daysBetweenKeys(balanceDueKey(checkIn), checkIn),
            BALANCE_DAYS_BEFORE_CHECKIN,
            `${checkIn} should be exactly 30 days after its balance-due day`,
        );
    }
});

test('accepts a Date and reads its own calendar day', () => {
    // A Date at noon can never be pulled across a boundary by a ±1h clock change.
    assert.equal(balanceDueKey(new Date('2026-11-20T12:00:00')), '2026-10-21');
});

test('the legacy computation it replaces really did land a day early', () => {
    // Reconstruct what the old code did, but pinned to a +1h (BST) local zone so
    // the failure is deterministic regardless of the test runner's TZ: a 00:00
    // wall clock in BST is 23:00 UTC the day before.
    const legacyUnderBst = (checkInKey: string) => {
        // 30 days before, as the calendar intends:
        const target = shiftDayKey(checkInKey, -30);
        const [y, m, d] = target.split('-').map(Number);
        // The old setDate path produced midnight *local*; in BST that is 23:00
        // UTC the previous day, and toISOString then took that previous day.
        const asIfLocalMidnightBst = new Date(Date.UTC(y, m - 1, d, 0) - 60 * 60 * 1000);
        return asIfLocalMidnightBst.toISOString().split('T')[0];
    };
    assert.equal(legacyUnderBst('2026-11-20'), '2026-10-20'); // a day early — the bug
    assert.equal(balanceDueKey('2026-11-20'), '2026-10-21');  // the fix
});
