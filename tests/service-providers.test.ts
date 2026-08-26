// The rules a provider sign-up is held to, and the distance maths that decides
// who gets shown to whom.
//
// Worth testing before there is any UI on top: coversPoint is what will decide
// whether a baker in Dumfries is offered to a cottage in Stranraer, and a sign
// error in it would be invisible on screen and wrong in every result.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const {
    submitProblems,
    canSubmit,
    milesBetween,
    coversPoint,
    tradeLabel,
} = require('@/lib/serviceProviders');

const complete = {
    business_name: 'Solway Sparkle',
    trade: 'sponge',
    description: 'Changeover cleans and deep cleans for holiday cottages across the Stewartry.',
    contact_email: 'hello@solwaysparkle.test',
    audience: 'host',
    areaCount: 1,
    // A banded trade has to price at least one band before it can be sent.
    // See tests/service-pricing.test.ts for the rule itself.
    prices: { beds_1_2: { price: '60' } },
};

test('a complete application can be sent', () => {
    assert.deepEqual(submitProblems(complete), []);
    assert.equal(canSubmit(complete), true);
});

test('each missing piece is named, and named once', () => {
    const problems = submitProblems({});
    const fields = problems.map((p: any) => p.field).sort();

    // No trade means no pricing shape, so pricing has nothing to complain
    // about yet — the trade problem stands in for it.
    assert.deepEqual(fields, ['areas', 'audience', 'business_name', 'contact_email', 'description', 'trade']);
    assert.equal(new Set(fields).size, fields.length, 'no field should be reported twice');
});

test('covering nowhere is a problem — that is how a provider reaches nobody', () => {
    const problems = submitProblems({ ...complete, areaCount: 0 });
    assert.equal(problems.length, 1);
    assert.equal(problems[0].field, 'areas');
});

test('a one-word description is not a description', () => {
    const problems = submitProblems({ ...complete, description: 'Cleaning.' });
    assert.equal(problems.some((p: any) => p.field === 'description'), true);
});

test('an email without an @ is caught', () => {
    const problems = submitProblems({ ...complete, contact_email: 'hello.solwaysparkle.test' });
    assert.equal(problems.some((p: any) => p.field === 'contact_email'), true);
});

// Kirkcudbright to Castle Douglas is about 10 miles by road and a little under
// 9 as the crow flies. Real coordinates, so a sign error or a radians mistake
// shows up as a wildly wrong number rather than a plausible one.
const KIRKCUDBRIGHT = { lat: 54.8362, lng: -4.0530 };
const CASTLE_DOUGLAS = { lat: 54.9375, lng: -3.9319 };
const STRANRAER = { lat: 54.9021, lng: -5.0269 };

test('distance between two real towns is right', () => {
    const d = milesBetween(KIRKCUDBRIGHT.lat, KIRKCUDBRIGHT.lng, CASTLE_DOUGLAS.lat, CASTLE_DOUGLAS.lng);
    assert.ok(d > 7 && d < 10, 'Kirkcudbright to Castle Douglas should be 7-10 miles, got ' + d);
});

test('distance is the same measured either way', () => {
    const there = milesBetween(KIRKCUDBRIGHT.lat, KIRKCUDBRIGHT.lng, STRANRAER.lat, STRANRAER.lng);
    const back = milesBetween(STRANRAER.lat, STRANRAER.lng, KIRKCUDBRIGHT.lat, KIRKCUDBRIGHT.lng);
    assert.equal(Math.round(there), Math.round(back));
});

test('a point is nought miles from itself', () => {
    assert.equal(Math.round(milesBetween(54.8362, -4.053, 54.8362, -4.053)), 0);
});

test('a ten mile radius from Kirkcudbright reaches Castle Douglas but not Stranraer', () => {
    const areas = [{ centre_lat: KIRKCUDBRIGHT.lat, centre_lng: KIRKCUDBRIGHT.lng, radius_miles: 10 }];

    assert.equal(coversPoint(areas, CASTLE_DOUGLAS.lat, CASTLE_DOUGLAS.lng), true);
    assert.equal(coversPoint(areas, STRANRAER.lat, STRANRAER.lng), false,
        'Stranraer is roughly 37 miles away and must not be covered');
});

test('two circles cover two towns without covering the gap', () => {
    const areas = [
        { centre_lat: KIRKCUDBRIGHT.lat, centre_lng: KIRKCUDBRIGHT.lng, radius_miles: 4 },
        { centre_lat: STRANRAER.lat, centre_lng: STRANRAER.lng, radius_miles: 4 },
    ];

    assert.equal(coversPoint(areas, KIRKCUDBRIGHT.lat, KIRKCUDBRIGHT.lng), true);
    assert.equal(coversPoint(areas, STRANRAER.lat, STRANRAER.lng), true);
    assert.equal(coversPoint(areas, CASTLE_DOUGLAS.lat, CASTLE_DOUGLAS.lng), false,
        'the middle is not covered just because both ends are');
});

test('no areas covers nothing', () => {
    assert.equal(coversPoint([], KIRKCUDBRIGHT.lat, KIRKCUDBRIGHT.lng), false);
});

test('an unknown trade still reads as something', () => {
    assert.equal(tradeLabel('sponge'), 'Cleaning');
    assert.equal(tradeLabel('nonsense'), 'Service');
});

// There is no trial, so there is nothing here to test. TRIAL_DAYS and
// trialEndsAt() are gone from lib/serviceProviders.ts rather than left unused:
// it is 10% per job from the first job, and a dormant trial helper is one
// query away from putting "Free for 90 days" back on a page.
