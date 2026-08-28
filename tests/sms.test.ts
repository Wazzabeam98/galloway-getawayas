// The emergency text: one segment, one direction, one way to accept.
//
// Three things are pinned here, and each has already been got wrong somewhere
// in this project's history in a way nothing failed on:
//
//   LENGTH   over 160 GSM-7 characters and it silently splits and costs
//            double. Nothing errors; the bill just changes.
//   ALPHABET one curly apostrophe takes the whole message to UCS-2 at SEVENTY
//            characters a segment, so a 100-character text becomes two. This
//            is the likeliest way it gets broken — by somebody being tidy.
//   WORDS    the link is first because he reads it on a lock screen, and the
//            message says replies do not reach us because they cannot.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

import { emergencySms, isGsm7, toE164, SMS_LIMIT } from '@/lib/sms';
import { TRADES, tradeLabel } from '@/lib/serviceProviders';

// 32 characters, which is what randomBytes(24).toString('base64url') gives.
const TOKEN = 'A'.repeat(32);
const URL = 'https://gallowaygetaways.co.uk/e/' + TOKEN;

test('the message fits one segment, for every trade and the longest town', () => {
    // The realistic worst case rather than a convenient one: the longest trade
    // label against the longest coverage town.
    const towns = ['Kirkcudbright', 'Castle Douglas', 'Gatehouse of Fleet', 'Newton Stewart'];

    for (const trade of TRADES.map((t) => t.key)) {
        for (const town of towns) {
            const body = emergencySms(URL, tradeLabel(trade), town);

            assert.ok(
                body.length <= SMS_LIMIT,
                'over one segment (' + body.length + '): ' + body
            );
        }
    }
});

test('nothing in the message drops it out of GSM-7', () => {
    const body = emergencySms(URL, 'Painter & decorator', 'Gatehouse of Fleet');

    assert.ok(isGsm7(body), 'not GSM-7, so it costs 70 chars a segment: ' + body);

    // The specific characters that cause it, named so the failure explains
    // itself. A curly apostrophe is the one that gets typed by accident.
    for (const bad of ['’', '‘', '“', '”', '–', '—', '…']) {
        assert.equal(body.indexOf(bad), -1, 'contains a non-GSM-7 character');
    }
});

test('the link is first and the dead end is stated', () => {
    const body = emergencySms(URL, 'Plumber', 'Kirkcudbright');

    assert.ok(body.startsWith(URL), 'the link has to be first: ' + body);

    // He cannot reply — the sender is alphanumeric and cannot receive. If this
    // sentence ever goes, somebody thumbs "yes" at it, believes they have
    // answered, and the enquiry expires with the owner told to ring elsewhere.
    assert.ok(/repl(y|ies)/i.test(body), 'must say replies do not reach us: ' + body);

    assert.ok(/emergency/i.test(body), 'must say what it is: ' + body);
    assert.ok(body.indexOf('Kirkcudbright') !== -1, 'must say where: ' + body);
});

test('a long trade is trimmed before the town is', () => {
    // He can infer the trade from the link. He cannot infer whether it is
    // worth the drive, so the place survives.
    const body = emergencySms(URL, 'Painter & decorator', 'Gatehouse of Fleet');
    assert.ok(body.indexOf('Gatehouse of Fleet') !== -1, body);
    assert.ok(body.length <= SMS_LIMIT, body);
});

// --- who can actually be texted --------------------------------------------

test('a UK mobile is recognised however it was typed', () => {
    for (const raw of ['07700 900123', '+44 7700 900123', '07700900123', '(07700) 900123']) {
        assert.equal(toE164(raw), '+447700900123', 'failed on ' + raw);
    }
});

test('anything that is not a UK mobile is refused rather than guessed', () => {
    // A landline will not receive a text, and paying to send into nothing is
    // the better half of the failure — the worse half is a wrong number
    // belonging to somebody who never signed up for anything.
    assert.equal(toE164('01557 555 0117'), null, 'a landline is not a mobile');
    assert.equal(toE164('+353 86 1234567'), null, 'not ours to interpret');
    assert.equal(toE164('0770 090'), null, 'too short');
    assert.equal(toE164(''), null);
    assert.equal(toE164(null), null);
});
