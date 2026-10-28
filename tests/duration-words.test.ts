// Durations read in minutes below an hour and in hours & minutes from one hour
// up (the Airbnb rule) — the same everywhere a provider or a guest reads one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';
import { durationWords } from '../lib/durationWords';

installAliases();
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { durationLabel } = require('../components/marketplace/present');

test('minutes below an hour, hours & minutes from one hour', () => {
    assert.equal(durationWords(15), '15 min');
    assert.equal(durationWords(45), '45 min');
    assert.equal(durationWords(60), '1 hr');
    assert.equal(durationWords(75), '1 hr 15 min');
    assert.equal(durationWords(90), '1 hr 30 min');
    assert.equal(durationWords(105), '1 hr 45 min');
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
    assert.equal(durationLabel(90), '1 hr 30 min');
    assert.equal(durationLabel(150), '2 hr 30 min');
    assert.equal(durationLabel(0), null);
});
