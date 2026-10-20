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

test('an archived order thread is kept out of the dot, like a booking', async () => {
    // The archived rule used to key on booking_id alone, so an archived order
    // (or enquiry) kept counting in the dot while the inbox had dropped it. Now
    // conversation_prefs carries (thread_kind, thread_id) and the dot drops it
    // too. Here: two unread messages, both on one order the person archived
    // AFTER they arrived — so the dot is zero.
    const { client } = fakeSupabase({
        messages: (state: any) => {
            const sel = state.ops.find((o: any) => o.op === 'select');
            const isHeadCount = !!(sel && sel.args[1] && sel.args[1].head);
            if (isHeadCount) return { count: 2, data: null, error: null };
            // The per-kind inbound query for the archived order.
            return {
                error: null,
                data: [
                    { order_id: 'o1', created_at: '2026-10-01T09:00:00Z', read_at: null },
                    { order_id: 'o1', created_at: '2026-10-01T09:05:00Z', read_at: null },
                ],
            };
        },
        conversation_prefs: {
            error: null,
            data: [{ thread_kind: 'order', thread_id: 'o1', archived_at: '2026-10-02T00:00:00Z' }],
        },
    });

    assert.equal(await unreadFor(client, 'user-1'), 0);
});

test('a message after the archive brings the order back into the dot', async () => {
    // Archiving is "done for now", not "mute": a newer inbound message
    // un-archives the thread, and its unread is counted again — for an order
    // exactly as for a booking.
    const { client } = fakeSupabase({
        messages: (state: any) => {
            const sel = state.ops.find((o: any) => o.op === 'select');
            const isHeadCount = !!(sel && sel.args[1] && sel.args[1].head);
            if (isHeadCount) return { count: 1, data: null, error: null };
            return {
                error: null,
                // One unread, arriving AFTER the archive stamp below.
                data: [{ order_id: 'o1', created_at: '2026-10-03T09:00:00Z', read_at: null }],
            };
        },
        conversation_prefs: {
            error: null,
            data: [{ thread_kind: 'order', thread_id: 'o1', archived_at: '2026-10-02T00:00:00Z' }],
        },
    });

    assert.equal(await unreadFor(client, 'user-1'), 1);
});
