// Spotting contact details in a message — as a measurement, never a block.
//
// The tests that matter most here are the ones about what it must NOT flag.
// A false positive costs nothing while this only counts, but the moment
// anybody is tempted to turn it into a filter, these are the cases that say
// why not: a Gas Safe number, a postcode and a price are all just digits, and
// on a site whose pitch is that registration numbers are public, a wall built
// on this would block the product.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const { contactSignal, contactSignalSummary } = require('@/lib/contactDetails');

const flags = (text: string) => contactSignal(text).looksLikeContact;
const kinds = (text: string) => contactSignal(text).kinds;

// --- what it should catch --------------------------------------------------

test('an email address', () => {
    assert.equal(flags('drop me a line at bob@solwayplumbing.co.uk'), true);
    assert.deepEqual(kinds('bob@solwayplumbing.co.uk'), ['email']);
});

test('a mobile number, however it is spaced', () => {
    for (const number of [
        '07700 900123',
        '07700900123',
        '07700-900-123',
        '+44 7700 900123',
        '(07700) 900123',
    ]) {
        assert.equal(flags('ring me on ' + number), true, number + ' is a phone number');
    }
});

test('a landline', () => {
    assert.equal(flags('the office is 01557 330000'), true);
});

test('a number read out in words', () => {
    // The way somebody writes it when they suspect they should not be.
    assert.equal(flags('oh seven seven double oh, nine hundred'), true);
    assert.equal(kinds('oh seven seven double oh').indexOf('spelled_out') !== -1, true);
});

test('being asked to move to another app', () => {
    assert.deepEqual(kinds('easier on whatsapp'), ['off_platform_app']);
    assert.equal(flags('I am on Telegram'), true);
});

test('the summary names the kinds and never the text', () => {
    const summary = contactSignalSummary('bob@example.com or 07700 900123');

    assert.equal(summary, 'email,phone');
    assert.equal(summary.indexOf('bob'), -1, 'the address itself is never in the log line');
    assert.equal(summary.indexOf('900123'), -1, 'nor the number');
});

test('an ordinary message is not flagged', () => {
    assert.equal(contactSignalSummary('The key safe code is by the back door.'), null);
});

// --- what it must NOT catch ------------------------------------------------
//
// Every one of these is a real message somebody will send on this site.

test('a Gas Safe number is not a phone number', () => {
    // Six digits. If this ever flagged, the site would be flagging the exact
    // thing it asks providers to publish.
    assert.equal(flags('my Gas Safe number is 123456'), false);
});

test('a postcode is not a phone number', () => {
    assert.equal(flags('the cottage is DG6 4JG'), false);
});

test('a price is not a phone number', () => {
    assert.equal(flags('call-out is £45 and then £30 an hour'), false);
});

test('a date and time are not a phone number', () => {
    assert.equal(flags('I can come on 26/08/2026 at 14:30'), false);
});

test('a house number is not a phone number', () => {
    assert.equal(flags('it is number 12, second on the left'), false);
});

test('a boiler model is not a phone number', () => {
    assert.equal(flags('it is a Worcester Bosch 8000'), false);
});

test('ordinary counting is not a number read out', () => {
    // Two number words in a sentence is English, not a phone number.
    assert.equal(flags('there are one or two things to look at'), false);
    assert.equal(flags('it has a double bed and a single'), false);
});

test('nothing at all is not a signal', () => {
    assert.equal(flags(''), false);
    assert.equal(flags(null as any), false);
    assert.equal(flags(undefined as any), false);
});
