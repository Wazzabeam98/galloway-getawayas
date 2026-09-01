// What the Messages badge counts.
//
// It must count exactly what the Messages page can show, and on 31 August 2026
// it stopped doing so. Messages became polymorphic that afternoon — a message
// hangs off either a booking or an enquiry — and unreadFor filters only on
// recipient_id and read_at. So a job-thread message started incrementing the
// badge, while the unified inbox is keyed on bookings
// (api/messages/threads/route.ts drives from bookings.map(b => b.id)) and
// surfacing job threads there was explicitly deferred.
//
// The result is a badge pointing at a page that cannot account for it. Job
// threads already carry their own unread badge where they live — on the host's
// enquiries list and the tradesman's Upcoming work — so the fix is to make
// this count only what it can send somebody to, not to widen the inbox.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSupabase, installAliases } from './helpers/stub';

installAliases();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { unreadFor } = require('../lib/badgeCounts');

test('the badge counts booking messages only', async () => {
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

    assert.equal(excluded, true,
        'a job-thread message must not raise a badge on a page that cannot show it');
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
