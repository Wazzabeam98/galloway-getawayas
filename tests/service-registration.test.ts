// Who is allowed to do the work, and how we know.
//
// Three kinds of work are restricted by law rather than by skill: gas, oil and
// electrics. Getting this wrong sends somebody unregistered to a guest's
// boiler, so it is guarded twice — once by what the rules say, and once by the
// thing that makes a tick mean anything at all.
//
// The rule worth the most tests is the one nobody would think to write: a
// registration that WAS checked stops counting the moment its number changes.
// Without it, the sequence is get checked, then edit the number, and the badge
// stays up saying something nobody ever verified.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const {
    requiredSchemes,
    offerableSchemes,
    registrationVerified,
    registrationExpired,
    registrationBlockers,
    registrationProblems,
    asksAboutFuel,
    isPartP,
} = require('@/lib/serviceProviders');

// --- who is asked ----------------------------------------------------------

test('only the plumber is asked about gas and oil', () => {
    assert.equal(asksAboutFuel('plumber'), true);

    for (const trade of ['electrician', 'joiner', 'roofer', 'painter', 'handyman', 'sponge']) {
        assert.equal(asksAboutFuel(trade), false, trade + ' is not asked about fuel');
    }
});

test('a trade with no restricted work needs nothing and is offered nothing', () => {
    for (const trade of ['joiner', 'roofer', 'painter', 'handyman']) {
        assert.deepEqual(requiredSchemes({ trade }), [], trade + ' needs no registration');
        assert.deepEqual(offerableSchemes({ trade }), [], trade + ' is not asked for one');
    }
});

test('a handyman cannot claim a scheme even by ticking the fuel questions', () => {
    // The toggles are not on their form, so a payload carrying them is either
    // a stale draft or somebody poking at it. Either way the answer is no.
    assert.deepEqual(offerableSchemes({ trade: 'handyman', does_gas: true, does_oil: true }), []);
    assert.deepEqual(requiredSchemes({ trade: 'handyman', does_gas: true }), []);
});

// --- what is required ------------------------------------------------------

test('an electrician always needs a competent person scheme', () => {
    assert.deepEqual(requiredSchemes({ trade: 'electrician' }), ['part_p']);

    // Which body is theirs to say, so all four are on offer.
    const offered = offerableSchemes({ trade: 'electrician' });
    assert.deepEqual(offered.slice().sort(), ['part_p_elecsa', 'part_p_napit', 'part_p_niceic', 'part_p_stroma']);
    for (const scheme of offered) assert.equal(isPartP(scheme), true);
});

test('a plumber needs nothing until they say what they do', () => {
    assert.deepEqual(requiredSchemes({ trade: 'plumber' }), []);
    assert.deepEqual(requiredSchemes({ trade: 'plumber', does_gas: true }), ['gas_safe']);
    assert.deepEqual(requiredSchemes({ trade: 'plumber', does_oil: true }), ['oftec']);
});

// The case that broke the first design, and the reason registrations are a
// table rather than a pair of columns on the listing. Most of Galloway is off
// the gas grid, so gas in the towns and oil everywhere else is one ordinary
// plumber, holding two numbers from two bodies at once.
test('a plumber who does gas and oil needs both numbers, not one', () => {
    const both = requiredSchemes({ trade: 'plumber', does_gas: true, does_oil: true });

    assert.deepEqual(both.slice().sort(), ['gas_safe', 'oftec']);
    assert.equal(both.length, 2, 'one column pair could only ever have held one of these');
});

// --- what "checked" means --------------------------------------------------

const checked = (number: string, verifiedNumber?: string) => ({
    scheme: 'gas_safe',
    number,
    verified_at: '2026-08-01T00:00:00.000Z',
    verified_number: verifiedNumber === undefined ? number : verifiedNumber,
});

test('a number nobody has looked at is not verified', () => {
    assert.equal(registrationVerified({ scheme: 'gas_safe', number: '123456' }), false);
});

test('a number that was looked at is verified', () => {
    assert.equal(registrationVerified(checked('123456')), true);
});

// The whole point. No cron job, no trigger, nothing to remember to clear.
test('editing the number un-verifies it in the same breath', () => {
    const wasChecked = checked('123456');
    const edited = { ...wasChecked, number: '654321' };

    assert.equal(registrationVerified(wasChecked), true);
    assert.equal(registrationVerified(edited), false,
        'the number on the row is not the number anybody checked');
});

test('a verified_at with nothing behind it counts for nothing', () => {
    // What a provider writing their own row would produce if the column-level
    // grants ever came off. It still fails, which is the second lock.
    assert.equal(
        registrationVerified({ scheme: 'gas_safe', number: '123456', verified_at: '2026-08-01T00:00:00.000Z' }),
        false
    );
    assert.equal(
        registrationVerified({ scheme: 'gas_safe', number: '123456', verified_at: '2026-08-01T00:00:00.000Z', verified_number: '' }),
        false
    );
});

test('expired is not the same as unverified', () => {
    const today = new Date('2026-08-25T00:00:00.000Z');
    const live = { ...checked('123456'), expires_at: '2027-01-01' };
    const lapsed = { ...checked('123456'), expires_at: '2026-01-01' };

    assert.equal(registrationExpired(live, today), false);
    assert.equal(registrationExpired(lapsed, today), true);

    // Still verified — it was genuinely checked. It has just run out, which
    // reads differently in the queue and is a different job to fix.
    assert.equal(registrationVerified(lapsed), true);
});

test('no expiry date is not an expired one', () => {
    assert.equal(registrationExpired(checked('123456')), false);
    assert.equal(registrationExpired({ ...checked('123456'), expires_at: 'not a date' }), false);
});

// --- what stops an approval ------------------------------------------------

const gasPlumber = { trade: 'plumber', does_gas: true };

test('a missing number stops the approval', () => {
    const stops = registrationBlockers(gasPlumber, []);
    assert.equal(stops.length, 1);
    assert.match(stops[0], /Gas Safe/);
});

test('a blank number is the same as no number', () => {
    assert.equal(registrationBlockers(gasPlumber, [{ scheme: 'gas_safe', number: '   ' }]).length, 1);
});

test('an unchecked number stops the approval', () => {
    const stops = registrationBlockers(gasPlumber, [{ scheme: 'gas_safe', number: '123456' }]);
    assert.equal(stops.length, 1);
    assert.match(stops[0], /not been checked/);
});

test('a checked number lets it through', () => {
    assert.deepEqual(registrationBlockers(gasPlumber, [checked('123456')]), []);
});

test('an expired registration stops the approval', () => {
    const today = new Date('2026-08-25T00:00:00.000Z');
    const stops = registrationBlockers(
        gasPlumber,
        [{ ...checked('123456'), expires_at: '2026-01-01' }],
        today
    );

    assert.equal(stops.length, 1);
    assert.match(stops[0], /expired/);
});

test('a plumber doing both is stopped by whichever half is missing', () => {
    const both = { trade: 'plumber', does_gas: true, does_oil: true };
    const stops = registrationBlockers(both, [checked('123456')]);

    assert.equal(stops.length, 1, 'the gas side is fine');
    assert.match(stops[0], /OFTEC/);
});

test('any of the four schemes satisfies an electrician', () => {
    for (const scheme of ['part_p_niceic', 'part_p_napit', 'part_p_elecsa', 'part_p_stroma']) {
        const row = { scheme, number: 'E12345', verified_at: '2026-08-01T00:00:00.000Z', verified_number: 'E12345' };
        assert.deepEqual(registrationBlockers({ trade: 'electrician' }, [row]), [], scheme + ' is enough');
    }
});

test('a joiner is never blocked', () => {
    assert.deepEqual(registrationBlockers({ trade: 'joiner' }, []), []);
});

// --- what the provider is told ---------------------------------------------

test('the form asks for a missing number but says nothing about checking', () => {
    const problems = registrationProblems(gasPlumber, []);

    assert.equal(problems.length, 1);
    assert.equal(problems[0].field, 'registration_gas_safe');

    // Whether it has been checked is not theirs to see and not theirs to
    // change, so it must never appear as something to fix on their form.
    assert.equal(/checked/i.test(problems[0].message), false);
});

test('a number that is there satisfies the form, checked or not', () => {
    // The provider has done their part. The rest is ours, and holding their
    // application open over our own queue would be telling them off for it.
    assert.deepEqual(registrationProblems(gasPlumber, [{ scheme: 'gas_safe', number: '123456' }]), []);
});

test('the electrician is told to pick a scheme, not to find a Part P number', () => {
    const problems = registrationProblems({ trade: 'electrician' }, []);

    assert.equal(problems.length, 1);
    assert.equal(problems[0].field, 'registration_part_p');
    assert.match(problems[0].message, /scheme/);
});
