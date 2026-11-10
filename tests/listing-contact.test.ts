// No contact details in a listing — Airbnb's rule (lib/listingContact).
//
// Unlike lib/contactDetails (messages: count, never block), this one BLOCKS a
// save, so the cases that matter as much as what it catches are what it must
// leave alone: "@" used as "at", a postcode, a price, a year, "e.g.", a
// what3words. A false positive here stops an honest host saving their
// description.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const {
    listingContactKind, listingContactProblem, listingContactProblems, LISTING_CONTACT_MESSAGE,
} = require('@/lib/listingContact');
const { publishProblems, newProblems } = require('@/lib/listingRules');

const kind = (t: string) => listingContactKind(t);

// --- what it catches ---------------------------------------------------------

test('an email address, including one with the ending left off', () => {
    assert.equal(kind('email me at bob@thecroft.co.uk'), 'email');
    assert.equal(kind('Book direct: pods@thecroft'), 'email');
    assert.equal(kind('PODS@TheCroft for dates'), 'email');
});

test('a phone number, however it is spaced', () => {
    for (const n of ['07700 900123', '07700900123', '07700-900-123', '+44 7700 900123', '(01557) 330 123', '01557.330.123']) {
        assert.equal(kind('ring us on ' + n), 'phone', n);
    }
});

test('a web address, with or without www or https', () => {
    for (const w of ['https://thecroftpods.com', 'www.thecroftpods.com', 'thecroftpods.co.uk', 'see thecroft.scot/book', 'instagram.com/thecroft']) {
        assert.equal(kind('more at ' + w), 'web', w);
    }
});

test('a social handle', () => {
    assert.equal(kind('Follow us @thecroftpods'), 'handle');
    assert.equal(kind('@the_croft on Instagram'), 'handle');
    assert.equal(kind('(insta: @croft.pods)'), 'handle');
});

// --- what it must leave alone ------------------------------------------------

test('@ used for "at" in ordinary writing', () => {
    for (const t of [
        'Check in @ 4pm, check out @ 10am',
        'Breakfast @8am in the farmhouse',
        'Tea@4 on the lawn',
        'Relax @home after a day on the beach',
        'Sunsets @ the harbour are the best in Galloway',
    ]) {
        assert.equal(kind(t), null, t);
    }
});

test('postcodes, prices, dates, years and room counts', () => {
    for (const t of [
        'Kirkcudbright DG6 4JX, 2 minutes from the harbour',
        '£1,250 a week in high season',
        'Open 01/04/2026 to 31/10/2026',
        'Built 1890, renovated 2019-2024',
        'Sleeps 2-4 in 2 bedrooms, 1.5 bathrooms',
        'Wifi up to 900 Mbps',
        'Approx. 5 miles to the beach, e.g. Sandyhills',
        'A short walk to the beach.Cottage sleeps four',
        'Milk from the village.Co-op is two minutes away',
        'Find us with ///loud.cats.pace',
    ]) {
        assert.equal(kind(t), null, t);
    }
});

test('an empty field is clean', () => {
    assert.equal(kind(''), null);
    assert.equal(kind(null as any), null);
});

// --- across a listing --------------------------------------------------------

test('names the field and uses the agreed wording', () => {
    const p = listingContactProblem({ title: 'Cosy cottage', additional_rules: 'Text 07700 900123 if late' });
    assert.equal(p.field, 'additional_rules');
    assert.equal(p.label, 'house rules');
    assert.ok(p.message.endsWith(LISTING_CONTACT_MESSAGE));
    assert.equal(LISTING_CONTACT_MESSAGE, 'To keep guests safe and bookings protected, contact details can’t go in your listing; guests can message you once they book.');
});

test('only the fields present are read — a price change never trips on an old description', () => {
    assert.equal(listingContactProblem({ price_per_night: 120 }), null);
});

test('wifi and what3words are not read', () => {
    assert.equal(listingContactProblem({ wifi_name: 'croft@home', what3words: '///loud.cats.pace' }), null);
});

test('admin flags list every field that carries one', () => {
    const labels = listingContactProblems({
        title: 'The Croft', description: 'call 07700900123', checkout_note: 'www.croft.com', arrival_directions: 'Left at the gate',
    }).map((p: any) => p.label);
    assert.deepEqual(labels, ['description', 'checkout instructions']);
});

// --- the publish rule ----------------------------------------------------------

test('a title or description with contact details fails publishing at the title step', () => {
    const rule = publishProblems({ title: 'Croft pods @thecroft', description: 'Lovely' }).find((r: any) => r.key === 'contact_details');
    assert.ok(rule);
    assert.equal(rule.step, 7);
    assert.equal(publishProblems({ title: 'Croft pods', description: 'Lovely' }).some((r: any) => r.key === 'contact_details'), false);
});

test('a clean listing cannot have contact details added by an edit', () => {
    const before = { title: 'Croft pods', description: 'Lovely' };
    const after = { title: 'Croft pods', description: 'Lovely — book at thecroft.co.uk' };
    assert.ok(newProblems(before, after).some((r: any) => r.key === 'contact_details'));
});
