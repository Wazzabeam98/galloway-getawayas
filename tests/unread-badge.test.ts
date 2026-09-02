// What the Messages badge counts.
//
// It must count exactly what the person can open. Between 31 August and the
// unified-inbox pass (2 September 2026) that meant BOOKING threads only, because
// the Messages page could not open the enquiry or order kinds — a badge pointing
// at a thread the page can't show teaches people to ignore the badge. That
// filter was a placeholder, guarded by this test so it could not be removed
// alone.
//
// The unified inbox landed all three kinds: /messages (guests + hosts) carries
// booking, host-enquiry and guest-order threads, and /services/messages carries
// the provider's enquiry and order threads. Every unread message is now openable
// somewhere the person can reach, so the badge counts all of it — the filter is
// gone, and this test now guards that it stays gone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSupabase, installAliases } from './helpers/stub';

installAliases();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { unreadFor } = require('../lib/badgeCounts');

test('the badge counts every thread kind, not booking threads only', async () => {
    let ops: any[] = [];

    const { client } = fakeSupabase({
        messages: (state: any) => {
            ops = state.ops;
            return { count: 0, data: [], error: null };
        },
    });

    await unreadFor(client, 'user-1');

    const excluded = ops.some((o: any) =>
        o.op === 'not' && o.args[0] === 'booking_id' && o.args[1] === 'is' && o.args[2] === null);

    assert.equal(excluded, false,
        'the unified inbox can open all three kinds, so none is filtered out of the badge');
});

test('it still only counts what is addressed to this person and unopened', async () => {
    // The two conditions that were always right, kept honest while the third
    // was added.
    let ops: any[] = [];

    const { client } = fakeSupabase({
        messages: (state: any) => { ops = state.ops; return { count: 0, data: [], error: null }; },
    });

    await unreadFor(client, 'user-1');

    assert.equal(ops.some((o: any) => o.op === 'eq' && o.args[0] === 'recipient_id' && o.args[1] === 'user-1'), true);
    assert.equal(ops.some((o: any) => o.op === 'is' && o.args[0] === 'read_at' && o.args[1] === null), true);
});

test('nothing unread is nothing to count, without a second query', async () => {
    let prefsAsked = false;

    const { client } = fakeSupabase({
        messages: { count: 0, data: [], error: null },
        conversation_prefs: () => { prefsAsked = true; return { data: [], error: null }; },
    });

    assert.equal(await unreadFor(client, 'user-1'), 0);
    assert.equal(prefsAsked, false, 'the archived lookup is only worth doing when something is unread');
});
