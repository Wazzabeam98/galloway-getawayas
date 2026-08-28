// Walking a queue of decisions, shared by both review screens.
//
// The rules here are the ones that decide what a launch morning feels like:
// a failure part-way must not hide the successes, the same thing named twice
// must not be decided twice, and an approval nobody was told about has to be
// said out loud rather than folded into a count.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idsFrom, decideBatch, summarise, MAX_BATCH } from '../lib/reviewQueue';

test('one id or many, from the same body', () => {
    // The existing per-row buttons post `id`; the bulk controls post `ids`.
    // Both shapes work so the old buttons keep working unchanged.
    assert.deepEqual(idsFrom({ id: 'a' }), ['a']);
    assert.deepEqual(idsFrom({ ids: ['a', 'b'] }), ['a', 'b']);
    assert.deepEqual(idsFrom({}), []);
    assert.deepEqual(idsFrom(null), []);
});

test('the same id named twice is decided once', () => {
    // A checkbox and a row button can both name the same thing. Deciding it
    // twice is how somebody gets two emails.
    assert.deepEqual(idsFrom({ ids: ['a', 'a', 'b', 'a'] }), ['a', 'b']);
});

test('blank and missing ids are dropped rather than attempted', () => {
    assert.deepEqual(idsFrom({ ids: ['a', '', null, undefined, '  ', 'b'] }), ['a', 'b']);
});

test('every id is decided, and every one is reported', async () => {
    const seen: string[] = [];
    const result = await decideBatch(['a', 'b', 'c'], async (id) => {
        seen.push(id);
        return { ok: true, emailed: true };
    });

    assert.deepEqual(seen, ['a', 'b', 'c']);
    assert.equal(result.decided, 3);
    assert.equal(result.failed, 0);
    assert.equal(result.outcomes.length, 3);
});

test('decisions run one at a time, not together', async () => {
    // Each decision reads a row, checks its status and writes it back. Running
    // them together lets two decisions on the same row interleave, and the
    // status check is the only thing stopping a stale click deciding twice.
    let running = 0;
    let overlapped = false;

    await decideBatch(['a', 'b', 'c', 'd'], async () => {
        running += 1;
        if (running > 1) overlapped = true;
        await new Promise((r) => setTimeout(r, 5));
        running -= 1;
        return { ok: true };
    });

    assert.equal(overlapped, false, 'two decisions were in flight at once');
});

test('a failure part-way through does not stop the rest', async () => {
    const result = await decideBatch(['a', 'b', 'c'], async (id) => (
        id === 'b' ? { ok: false, error: 'Already live.' } : { ok: true }
    ));

    assert.equal(result.decided, 2);
    assert.equal(result.failed, 1);
    assert.equal(result.outcomes[1].error, 'Already live.');
    assert.equal(result.ok, true, 'the batch did something, so it is not a whole-page error');
});

test('a thrown error is one row failing, not the batch', async () => {
    // Otherwise nine approvals are lost because the tenth row was odd.
    const result = await decideBatch(['a', 'b'], async (id) => {
        if (id === 'a') throw new Error('the database said no');
        return { ok: true };
    });

    assert.equal(result.decided, 1);
    assert.equal(result.failed, 1);
    assert.match(result.outcomes[0].error || '', /the database said no/);
});

test('an approval nobody was told about is counted separately', async () => {
    // It happened. The person is still waiting to hear. Folding that into
    // "10 done" is how somebody sits waiting for an email that never came.
    const result = await decideBatch(['a', 'b'], async (id) => (
        { ok: true, emailed: id !== 'b' }
    ));

    assert.equal(result.decided, 2);
    assert.equal(result.unemailed, 1);
    assert.match(result.summary, /1 could not be emailed/);
});

test('the summary says what actually happened', () => {
    assert.equal(summarise(0, 0, 0), 'Nothing to do.');
    assert.equal(summarise(1, 0, 0), '1 done.');
    assert.equal(summarise(10, 0, 0), '10 done.');
    assert.equal(summarise(9, 1, 0), '9 done, 1 failed.');
    assert.match(summarise(9, 1, 2), /9 done, 1 failed\. 2 could not be emailed/);
});

test('there is a ceiling on one press', () => {
    // Not a page size — a blast radius. Both routes refuse more than this.
    assert.ok(MAX_BATCH > 10, 'ten properties on a launch morning must fit');
    assert.ok(MAX_BATCH <= 100, 'one press should not be able to decide everything');
});
