// Durations read in minutes up to 90, and in hours from 2 hours — the same
// everywhere a provider or a guest reads one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';
import { durationWords } from '../lib/durationWords';

installAliases();
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { durationLabel } = require('../components/marketplace/present');

test('minutes up to 90, hours from 2 hours', () => {
    assert.equal(durationWords(15), '15 min');
    assert.equal(durationWords(45), '45 min');
    assert.equal(durationWords(60), '60 min');
    assert.equal(durationWords(90), '90 min');
    assert.equal(durationWords(105), '105 min', 'under 2 hours stays in minutes');
    assert.equal(durationWords(120), '2 hr');
    assert.equal(durationWords(150), '2 hr 30 min');
    assert.equal(durationWords(480), '8 hr');
});

test('no length reads as nothing', () => {
    assert.equal(durationWords(0), '');
    assert.equal(durationWords(null), '');
    assert.equal(durationWords(-30), '');
});

test('the public experience page reads lengths the same way', () => {
    assert.equal(durationLabel(90), '90 min');
    assert.equal(durationLabel(150), '2 hr 30 min');
    assert.equal(durationLabel(0), null);
});
