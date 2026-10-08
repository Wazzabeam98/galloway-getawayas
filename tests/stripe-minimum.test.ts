// Stripe will not take a GBP payment under £0.30 (lib/stripeMinimum). What
// matters: the stay checkout refuses such a total itself, and a deposit split
// never leaves either half — today's payment or the balance charged later —
// under the minimum.

import { test } from 'node:test';
import assert from 'node:assert/strict';

/* eslint-disable @typescript-eslint/no-var-requires */
const m = require('../lib/stripeMinimum');
/* eslint-enable @typescript-eslint/no-var-requires */

test('£0.30 is chargeable, a penny under is not', () => {
    assert.equal(m.belowStripeMinimum(0.3), false);
    assert.equal(m.belowStripeMinimum(0.29), true);
    assert.equal(m.belowStripeMinimum(0), true);
    assert.equal(m.belowStripeMinimum(250), false);
    // Float noise from adding fees must not tip a real 30p under.
    assert.equal(m.belowStripeMinimum(0.1 + 0.2), false);
    assert.equal(m.belowStripeMinimum(NaN), true);
});

test('a deposit split is only used when both halves can be charged', () => {
    assert.equal(m.depositSplitChargeable(25, 75), true);
    // £1.00 stay: 25p now is under the minimum.
    assert.equal(m.depositSplitChargeable(0.25, 0.75), false);
    // A balance under the minimum would fail off-session 30 days out.
    assert.equal(m.depositSplitChargeable(0.3, 0.29), false);
});
