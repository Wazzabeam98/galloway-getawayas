// A trade's day off refuses an enquiry for that day.
//
// The intent: a host can't send a plumber planned work on a day the plumber has
// blocked off, nor an emergency call-out on a day off — the same way a host's
// blocked date refuses a booking. "Soon" names no day, so a day off never
// refuses it.
//
// PROVE IT FAILS FIRST: drop the slot_blocks check from
// app/api/services/enquiries/route.ts, or make enquiryDayKey return null for an
// emergency, and this goes red.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';
installAliases();
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { enquiryDayKey, blockedDayProblem } = require('../lib/serviceEnquiries');

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

test('planned work is for the day the host picked', () => {
    assert.equal(enquiryDayKey('planned', '2026-11-12', '2026-10-20'), '2026-11-12');
    assert.equal(blockedDayProblem('planned').field, 'preferred_date');
});

test('an emergency is for today', () => {
    assert.equal(enquiryDayKey('emergency', null, '2026-10-20'), '2026-10-20');
    // A stale date field on an emergency is not the day it is for.
    assert.equal(enquiryDayKey('emergency', '2026-11-12', '2026-10-20'), '2026-10-20');
});

test('"soon" names no day, so a day off never refuses it', () => {
    assert.equal(enquiryDayKey('soon', '2026-11-12', '2026-10-20'), null);
});

test('the enquiry route checks the trade’s blocked days before sending', () => {
    const route = fs.readFileSync(path.join(ROOT, 'app/api/services/enquiries/route.ts'), 'utf8');
    const check = route.indexOf("from('slot_blocks')");
    const insert = route.indexOf(".insert({ ...row, reference: enquiryReference() })");
    assert.ok(check > 0, 'the route must read slot_blocks');
    assert.ok(insert > check, 'the day-off check must run before the enquiry is written');
    assert.match(route, /enquiryDayKey\(draft\.urgency, draft\.preferred_date, londonDayKey\(\)\)/);
});
