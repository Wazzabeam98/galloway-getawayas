// The money arithmetic: what a stay costs, what the platform keeps, and what
// comes back when somebody cancels.
//
// No database and no Stripe — this is the layer where a wrong number is a
// wrong number regardless of what the rest of the system does.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { quoteBooking, nightlyRate, dateFromKey, dateKey } from '../lib/pricing';
import { rateFor, netOfFee, feeAmount, DEFAULT_COMMISSION_PERCENT } from '../lib/fees';
import { refundFraction, freeCancelUntil } from '../lib/cancellation';

const d = dateFromKey;

const listing = {
    price_per_night: 100,
    weekend_price: 150,
    cleaning_fee: 50,
    pet_fee: 25,
    extra_guest_fee: 20,
    extra_guest_after: 2,
    extra_guest_period: 'night',
};

// --- what a night costs --------------------------------------------------

test('nightly rate follows the calendar', () => {
    // 2026-09-07 is a Monday; the 11th and 12th are Friday and Saturday.
    assert.equal(nightlyRate(d('2026-09-07'), listing, {}), 100);
    assert.equal(nightlyRate(d('2026-09-11'), listing, {}), 150, 'Friday is a weekend night');
    assert.equal(nightlyRate(d('2026-09-12'), listing, {}), 150, 'Saturday is a weekend night');
    assert.equal(nightlyRate(d('2026-09-13'), listing, {}), 100, 'Sunday is not');
});

test('a calendar override beats both the weekend and the standard rate', () => {
    assert.equal(nightlyRate(d('2026-09-11'), listing, { '2026-09-11': 80 }), 80);
    assert.equal(nightlyRate(d('2026-09-07'), listing, { '2026-09-07': 120 }), 120);
});

// FIX: `if (overrides[key])` treated a deliberate £0 night as no override at
// all and charged the standard rate.
test('an override of £0 is honoured, not treated as absent', () => {
    assert.equal(nightlyRate(d('2026-09-07'), listing, { '2026-09-07': 0 }), 0);

    const quote = quoteBooking(
        { price_per_night: 100, cleaning_fee: 0 },
        { '2026-09-08': 0 },
        d('2026-09-07'), d('2026-09-10'), 1, 0, 0
    );
    assert.equal(quote.nightsSubtotal, 200, 'the free night must not be charged');
});

// --- what a stay costs ---------------------------------------------------

test('a plain stay totals nights plus cleaning', () => {
    const q = quoteBooking(listing, {}, d('2026-09-07'), d('2026-09-10'), 2, 0, 0);
    assert.equal(q.nights, 3);
    assert.equal(q.nightsSubtotal, 300);
    assert.equal(q.total, 350);
});

test('weekend nights are picked up inside a stay', () => {
    const q = quoteBooking(listing, {}, d('2026-09-10'), d('2026-09-13'), 2, 0, 0);
    assert.equal(q.nightsSubtotal, 400, 'Thursday 100 + Friday 150 + Saturday 150');
});

test('extra guests are charged per night or once, as the listing says', () => {
    assert.equal(quoteBooking(listing, {}, d('2026-09-07'), d('2026-09-10'), 3, 0, 0).extraGuestTotal, 60);
    assert.equal(
        quoteBooking({ ...listing, extra_guest_period: 'stay' }, {}, d('2026-09-07'), d('2026-09-10'), 3, 0, 0).extraGuestTotal,
        20
    );
    assert.equal(
        quoteBooking(listing, {}, d('2026-09-07'), d('2026-09-10'), 2, 1, 0).extraGuestTotal, 60,
        'a child is still a guest'
    );
    assert.equal(quoteBooking(listing, {}, d('2026-09-07'), d('2026-09-10'), 2, 0, 0).extraGuestTotal, 0);
});

test('a pet is charged once however many there are', () => {
    assert.equal(quoteBooking(listing, {}, d('2026-09-07'), d('2026-09-10'), 2, 0, 1).petFeeTotal, 25);
    assert.equal(quoteBooking(listing, {}, d('2026-09-07'), d('2026-09-10'), 2, 0, 3).petFeeTotal, 25);
    assert.equal(quoteBooking(listing, {}, d('2026-09-07'), d('2026-09-10'), 2, 0, 0).petFeeTotal, 0);
});

test('a stay of no nights costs nothing', () => {
    assert.equal(quoteBooking(listing, {}, d('2026-09-07'), d('2026-09-07'), 2, 0, 0).total, 0);
    assert.equal(quoteBooking(listing, {}, d('2026-09-10'), d('2026-09-07'), 2, 0, 0).total, 0,
        'check-out before check-in is not a negative bill');
});

test('repeating decimals land on the penny', () => {
    const q = quoteBooking({ price_per_night: 33.33, cleaning_fee: 0 }, {}, d('2026-09-07'), d('2026-09-10'), 1, 0, 0);
    assert.equal(q.total, 99.99);
});

// --- commission ----------------------------------------------------------

test('a missing or unreadable rate falls back to the standard one', () => {
    assert.equal(rateFor({ commission_rate: null }), DEFAULT_COMMISSION_PERCENT);
    assert.equal(rateFor({}), DEFAULT_COMMISSION_PERCENT);
    assert.equal(rateFor(null), DEFAULT_COMMISSION_PERCENT);
    assert.equal(rateFor({ commission_rate: 'nonsense' as any }), DEFAULT_COMMISSION_PERCENT,
        'a glitch must not quietly give away free hosting');
});

test('a deliberate zero rate is honoured', () => {
    assert.equal(rateFor({ commission_rate: 0 }), 0);
    assert.equal(netOfFee(1000, 0), 1000);
    assert.equal(feeAmount(1000, 0), 0);
});

// FIX: netOfFee and feeAmount were each rounded from the gross independently,
// so on about a quarter of pence-ending totals they summed to a penny more
// than was collected. The host was transferred one figure and emailed another.
test('what the host keeps plus what the platform takes equals what was paid', () => {
    const rates = [10, 12.5, 15, 7.5, 20, 0, 33.33];
    let checked = 0;

    for (let pennies = 1; pennies <= 500000; pennies++) {   // up to £5,000
        const gross = pennies / 100;
        for (const rate of rates) {
            const net = netOfFee(gross, rate);
            const fee = feeAmount(gross, rate);
            assert.ok(
                Math.abs(net + fee - gross) < 0.0000001,
                `£${gross} at ${rate}%: host ${net} + platform ${fee} = ${net + fee}`
            );
            checked++;
        }
    }

    assert.ok(checked > 3000000, 'expected to have checked every penny to £5,000');
});

test('the penny that used to go missing', () => {
    // The exact case: both halves rounded up and invented a penny.
    assert.equal(netOfFee(100.05, 10) + feeAmount(100.05, 10), 100.05);
    assert.equal(netOfFee(0.05, 10) + feeAmount(0.05, 10), 0.05);
    assert.equal(netOfFee(100.04, 12.5) + feeAmount(100.04, 12.5), 100.04);
});

// --- cancellation --------------------------------------------------------
// Checked against the wording published to hosts in the listing editor and to
// guests at /cancellation-policy. These are a promise, so they are pinned.

const CI = '2026-10-01';

test('Flexible: full refund up to 1 day before, 50% inside it', () => {
    assert.equal(refundFraction(CI, 'Flexible', d('2026-09-29')), 1);
    assert.equal(refundFraction(CI, 'Flexible', d('2026-09-30')), 1, 'exactly 1 day before');
    assert.equal(refundFraction(CI, 'Flexible', d('2026-10-01')), 0.5, 'the day itself');
});

test('Moderate: full refund up to 5 days before, 50% inside it', () => {
    assert.equal(refundFraction(CI, 'Moderate', d('2026-09-26')), 1, 'exactly 5 days before');
    assert.equal(refundFraction(CI, 'Moderate', d('2026-09-27')), 0.5, 'four days out');
    assert.equal(refundFraction(CI, 'Moderate', d('2026-10-01')), 0.5);
});

test('Limited: full to 14 days, half from 14 down to 7, nothing inside 7', () => {
    assert.equal(refundFraction(CI, 'Limited', d('2026-09-17')), 1);
    assert.equal(refundFraction(CI, 'Limited', d('2026-09-18')), 0.5);
    assert.equal(refundFraction(CI, 'Limited', d('2026-09-24')), 0.5, 'exactly 7 days');
    assert.equal(refundFraction(CI, 'Limited', d('2026-09-25')), 0, 'six days is inside the window');
});

test('Firm: full to 30 days, half from 30 down to 7, nothing inside 7', () => {
    assert.equal(refundFraction(CI, 'Firm', d('2026-09-01')), 1);
    assert.equal(refundFraction(CI, 'Firm', d('2026-09-02')), 0.5);
    assert.equal(refundFraction(CI, 'Firm', d('2026-09-24')), 0.5);
    assert.equal(refundFraction(CI, 'Firm', d('2026-09-25')), 0);
});

test('nothing comes back once the stay has started', () => {
    for (const policy of ['Flexible', 'Moderate', 'Limited', 'Firm']) {
        assert.equal(refundFraction(CI, policy, d('2026-10-02')), 0, policy);
    }
});

test('an unknown or missing policy is treated as Moderate', () => {
    assert.equal(refundFraction(CI, 'Nonsense', d('2026-09-26')), 1);
    assert.equal(refundFraction(CI, null, d('2026-09-26')), 1);
    assert.equal(refundFraction(CI, undefined, d('2026-09-27')), 0.5);
});

test('the stored free-cancel date matches the tier that produced it', () => {
    const expected: Record<string, number> = { Flexible: 1, Moderate: 5, Limited: 14, Firm: 30 };
    for (const policy of Object.keys(expected)) {
        assert.equal(
            dateKey(freeCancelUntil(CI, policy)),
            dateKey(new Date(2026, 9, 1 - expected[policy])),
            policy
        );
    }
});
