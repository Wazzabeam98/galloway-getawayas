// Commission is stored TWO different ways, and the two must never be crossed.
//
// WHAT THE CONVENTION IS (audit 2026-10-21, finding F4):
//
//   STAYS        bookings.commission_rate, listings.commission_rate  -> PERCENT
//                (e.g. 10 means 10%). Consumed by lib/fees.ts, which divides by
//                100: feeAmount(gross, 10) takes 10% off.
//
//   EXPERIENCES  service_providers.commission_rate,                   -> FRACTION
//                service_orders.commission_rate                        (0.10 = 10%).
//                Consumed by lib/experienceFunds.ts providerSharePence,
//                which multiplies directly: fee = kept * rate.
//
// Each subsystem is internally consistent and the streams never cross in the
// code today (experience payouts prefer the frozen platform_fee; stay payouts
// use feeAmount). But crossing them is CATASTROPHIC AND SILENT:
//   - a stay's 10 fed to providerSharePence as a fraction = a 1000% fee
//     (the provider is paid nothing), and
//   - an experience's 0.10 fed to feeAmount as a percent = a 0.1% fee
//     (the platform keeps almost nothing).
//
// This guard pins the two conventions in the two helper functions. If anyone
// ever changes feeAmount to stop treating its argument as a percent, or
// providerSharePence to stop treating its rate as a fraction, the build goes
// red here — before the mistake reaches money. It does NOT change how money is
// calculated; it only locks in what the calculation already does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

// experienceFunds pulls in moneyAlert -> @/lib/email at require time, so the
// '@/...' alias has to be registered before those modules load. installAliases()
// runs here (a plain statement, not a hoisted import), and the money modules are
// require()'d AFTER it — the same ordering the route tests use.
installAliases();
const { feeAmount, netOfFee, DEFAULT_COMMISSION_PERCENT } = require('../lib/fees');
const { providerSharePence } = require('../lib/experienceFunds');

test('STAYS: lib/fees treats the rate as a PERCENT (divides by 100)', () => {
    assert.equal(feeAmount(1000, 10), 100, '10 means 10% of £1000 = £100');
    assert.equal(netOfFee(1000, 10), 900, 'the host keeps £900');
    assert.equal(feeAmount(200, 10), 20);
    assert.equal(feeAmount(100, 0), 0, '0% takes nothing');
    assert.equal(feeAmount(100, 100), 100, '100% takes everything');
    // The platform default is a PERCENT, not a fraction.
    assert.equal(DEFAULT_COMMISSION_PERCENT, 10);
    assert.equal(feeAmount(500, DEFAULT_COMMISSION_PERCENT), 50);
});

test('EXPERIENCES: providerSharePence treats the rate as a FRACTION (multiplies)', () => {
    // £100 charged, 0.10 fraction -> £10 fee, provider keeps £90 (in pence).
    assert.equal(
        providerSharePence({ amountPence: 10000, refundedPence: 0, commissionRate: 0.10 }),
        9000,
    );
    // A missing rate defaults to the 0.10 FRACTION, never the percent 10.
    assert.equal(
        providerSharePence({ amountPence: 10000, refundedPence: 0, commissionRate: null }),
        9000,
    );
    // A frozen platform fee (a money amount in pence) is used directly.
    assert.equal(
        providerSharePence({ amountPence: 10000, refundedPence: 0, platformFeePence: 2500 }),
        7500,
    );
});

test('crossing the conventions is wrong, which is why they must stay separate', () => {
    // A stay's PERCENT (10) mistakenly used as an experience FRACTION pays the
    // provider NOTHING (fee = kept * 10 overwhelms the whole amount). This is
    // the silent failure the convention split exists to avoid — asserted so the
    // danger is documented, not so the behaviour is desired.
    assert.equal(
        providerSharePence({ amountPence: 10000, refundedPence: 0, commissionRate: 10 }),
        0,
    );
    // An experience's FRACTION (0.10) mistakenly used as a stay PERCENT takes a
    // 0.1% fee instead of 10% — the platform keeps almost nothing.
    assert.equal(feeAmount(10000, 0.10), 10, '0.10 as a percent = 0.1% of £10000 = £10, not £1000');
});
