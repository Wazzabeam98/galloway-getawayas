// The nightly photo backup proves its copy by reading the bucket back
// (lib/backupVerify). What matters: a snapshot only counts as taken when every
// photo is in the bucket at the size Supabase reported, and the manifest is
// there too. Uploads that "did not throw" are not proof.

import { test } from 'node:test';
import assert from 'node:assert/strict';

/* eslint-disable @typescript-eslint/no-var-requires */
const { verifySnapshot } = require('../lib/backupVerify');
/* eslint-enable @typescript-eslint/no-var-requires */

const DAY = '2026-10-08';
const files = [
    { bucket: 'listings', path: 'a/1.jpg', size: 100 },
    { bucket: 'listings', path: 'a/2.jpg', size: 200 },
    { bucket: 'listings-removed', path: 'b/3.jpg', size: 300 },
];
const held = (entries: [string, number][]) => new Map<string, number>(entries);
const full = (): [string, number][] => [
    ['storage/2026-10-08/listings/a/1.jpg', 100],
    ['storage/2026-10-08/listings/a/2.jpg', 200],
    ['storage/2026-10-08/listings-removed/b/3.jpg', 300],
    ['storage/2026-10-08/manifest.json', 999],
];

test('a complete snapshot verifies', () => {
    assert.deepEqual(verifySnapshot(DAY, files, held(full())), []);
});

test('a photo missing from the bucket fails the run', () => {
    const problems = verifySnapshot(DAY, files, held(full().filter(([k]) => !k.endsWith('2.jpg'))));
    assert.equal(problems.length, 1);
    assert.match(problems[0], /1 file\(s\) missing.*a\/2\.jpg/);
});

test('a photo at the wrong size fails the run', () => {
    const entries = full().map(([k, v]): [string, number] => (k.endsWith('3.jpg') ? [k, 12] : [k, v]));
    assert.match(verifySnapshot(DAY, files, held(entries))[0], /wrong size.*3\.jpg/);
});

test('a snapshot without its manifest does not count, even with every photo', () => {
    const problems = verifySnapshot(DAY, files, held(full().filter(([k]) => !k.endsWith('manifest.json'))));
    assert.deepEqual(problems, ['manifest.json missing from the bucket']);
});

test('yesterday\'s copy does not stand in for today\'s', () => {
    const yesterday = full().map(([k, v]): [string, number] => [k.replace(DAY, '2026-10-07'), v]);
    assert.equal(verifySnapshot(DAY, files, held(yesterday)).length, 2);
});
