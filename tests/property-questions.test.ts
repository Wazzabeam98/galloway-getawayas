// The garden / window question moved from the listing editor to the enquiry:
// asked of a host enquiring with a gardener or window cleaner, and nobody else.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const { propertyQuestionFor, propertyAnswer, propertyAnswerLabel } = require('@/lib/propertyQuestions');

test('a gardener is asked about the garden, a window cleaner about the windows', () => {
    assert.equal(propertyQuestionFor('trees')?.column, 'plot_band');
    assert.equal(propertyQuestionFor('droplet')?.column, 'storey_band');
});

test('no other trade is asked either question', () => {
    for (const t of ['plumber', 'electrician', 'joiner', 'roofer', 'painter', 'handyman', 'bin', 'other', 'sponge', '']) {
        assert.equal(propertyQuestionFor(t), null, t);
    }
});

test('only a real option for that trade is accepted', () => {
    assert.deepEqual(propertyAnswer('trees', 'plot_garden'), { column: 'plot_band', key: 'plot_garden' });
    assert.deepEqual(propertyAnswer('droplet', 'storeys_two'), { column: 'storey_band', key: 'storeys_two' });
    // The other trade's option, junk, or nothing is not an answer.
    assert.equal(propertyAnswer('trees', 'storeys_two'), null);
    assert.equal(propertyAnswer('droplet', 'plot_garden'), null);
    assert.equal(propertyAnswer('trees', 'lawn; drop table'), null);
    assert.equal(propertyAnswer('plumber', 'plot_garden'), null);
});

test('a blank answer is never an instruction to clear one already saved', () => {
    assert.equal(propertyAnswer('trees', ''), null);
    assert.equal(propertyAnswer('droplet', null), null);
});

test('the tradesman sees the saved answer in words', () => {
    assert.match(propertyAnswerLabel('trees', { plot_band: 'plot_yard' }) || '', /Courtyard/);
    assert.match(propertyAnswerLabel('droplet', { storey_band: 'storeys_two' }) || '', /Two floors/);
    assert.equal(propertyAnswerLabel('trees', { plot_band: null }), null);
    assert.equal(propertyAnswerLabel('plumber', { plot_band: 'plot_yard' }), null);
});
