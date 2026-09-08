// The home card features exactly ONE trip and the trips page leads with one,
// so when two stays share a check-in date the ordering is not cosmetic — it
// decides which stay a guest sees with its door code and directions beside it.
// Before this, the sort used `a.check_in < b.check_in ? -1 : 1`, which never
// returns 0: equal-keyed rows were reordered by whatever the database happened
// to return, so the featured stay could flip between requests.
//
// These tests pin the intent: featuring is DETERMINISTIC, and the tie-break is
// check-in, then check-out, then booking id. They import the comparator by a
// relative path so it runs under plain node with no alias resolution.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareTripsByStart } from '../lib/bookingOrder';

type B = { id: string; check_in: string; check_out: string };

// What every surface does: order by the comparator, take the first.
const featured = (rows: B[]) => rows.slice().sort(compareTripsByStart)[0];

test('two stays sharing a check-in: the same one is featured whatever order they arrive in', () => {
    // Same check-in; the shorter stay (earlier check-out) is the tie-break.
    const shorter: B = { id: 'zzzz', check_in: '2026-09-10', check_out: '2026-09-13' };
    const longer: B = { id: 'aaaa', check_in: '2026-09-10', check_out: '2026-09-14' };

    assert.equal(featured([shorter, longer]).id, 'zzzz');
    assert.equal(featured([longer, shorter]).id, 'zzzz', 'must not depend on input order');
});

test('check-in wins over check-out — the soonest arrival is always featured', () => {
    const soonestArrival: B = { id: 'b', check_in: '2026-09-10', check_out: '2026-12-31' };
    const laterArrival: B = { id: 'a', check_in: '2026-09-11', check_out: '2026-09-12' };

    assert.equal(featured([laterArrival, soonestArrival]).id, 'b');
    assert.equal(featured([soonestArrival, laterArrival]).id, 'b');
});

test('same check-in AND check-out: booking id is the final, always-unique tie-break', () => {
    const a: B = { id: 'aaaa-1111', check_in: '2026-09-10', check_out: '2026-09-13' };
    const b: B = { id: 'bbbb-2222', check_in: '2026-09-10', check_out: '2026-09-13' };

    assert.equal(featured([a, b]).id, 'aaaa-1111');
    assert.equal(featured([b, a]).id, 'aaaa-1111', 'id tie-break must be order-independent');
});

test('it is a proper total order — antisymmetric, and 0 only for the same booking', () => {
    const a: B = { id: 'a', check_in: '2026-09-10', check_out: '2026-09-13' };
    const b: B = { id: 'b', check_in: '2026-09-10', check_out: '2026-09-14' };

    assert.equal(compareTripsByStart(a, a), 0, 'a row compared with itself is equal');
    assert.equal(
        Math.sign(compareTripsByStart(a, b)),
        -Math.sign(compareTripsByStart(b, a)),
        'compare(a,b) must be the negation of compare(b,a)',
    );
    assert.notEqual(compareTripsByStart(a, b), 0, 'two different bookings never compare equal');
});
