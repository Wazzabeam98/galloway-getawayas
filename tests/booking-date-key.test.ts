// The night a guest is charged for must be the night they clicked.
//
// The booking calendar hands the widget a Date at LOCAL midnight for the day
// the guest picked. BookingWidget stored it with `.toISOString().split('T')[0]`,
// which converts to UTC first — so in British Summer Time (UTC+1) local-midnight
// 6 October becomes 2026-10-05T23:00:00Z, and the guest is booked, charged and
// confirmed for the 5th. In GMT (winter) there is no shift, which is exactly
// why the bug lived on the site unseen for half the year.
//
// The fix points the widget at lib/pricing.dateKey — the SAME helper the server
// already keys nights with (app/api/stripe/checkout) — so widget and server can
// never disagree about which day a picked Date is. This pins that helper's
// timezone-safety.
//
// This test is PINNED TO BST. It sets the clock to Europe/London before any
// Date is made, and picks October dates that fall inside British Summer Time,
// so it reproduces the summer-only failure every time it runs — regardless of
// the machine's own timezone.

process.env.TZ = 'Europe/London';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

import { dateKey } from '@/lib/pricing';

test('a BST calendar pick keeps its day (does not slip to the day before)', () => {
    // What react-date-range gives the widget for "6 October 2026": local
    // midnight. In Europe/London on that date the offset is +1 (BST).
    const pickedSixthOct = new Date(2026, 9, 6);
    const pickedTenthOct = new Date(2026, 9, 10);

    // Guard: confirm we really are testing the BST case. If this ever fails,
    // the process did not pick up Europe/London and the test below would pass
    // for the wrong reason.
    assert.equal(
        pickedSixthOct.getTimezoneOffset(), -60,
        'expected a +1h (BST) offset for 6 Oct 2026 — test is not running in Europe/London',
    );

    assert.equal(dateKey(pickedSixthOct), '2026-10-06', 'check-in slipped a day');
    assert.equal(dateKey(pickedTenthOct), '2026-10-10', 'check-out slipped a day');
});

test('a GMT (winter) pick keeps its day too — the case that always worked', () => {
    // 6 January 2026 is GMT (offset 0), so even the old UTC conversion was
    // right here. Kept so a future change cannot fix summer by breaking winter.
    const pickedSixthJan = new Date(2026, 0, 6);
    assert.equal(pickedSixthJan.getTimezoneOffset(), 0, 'expected GMT for 6 Jan 2026');
    assert.equal(dateKey(pickedSixthJan), '2026-01-06');
});

test('the day the clocks go back keeps its date', () => {
    // BST ends 03:00 on Sunday 25 October 2026. A guest checking in that day
    // picks local midnight while still on BST (+1); the day must stay the 25th.
    const clocksBackDay = new Date(2026, 9, 25);
    assert.equal(dateKey(clocksBackDay), '2026-10-25');
});

test('the day the clocks go forward keeps its date', () => {
    // BST begins 01:00 on Sunday 29 March 2026. Local midnight that day is
    // still GMT (0); the day must stay the 29th.
    const clocksForwardDay = new Date(2026, 2, 29);
    assert.equal(dateKey(clocksForwardDay), '2026-03-29');
});
