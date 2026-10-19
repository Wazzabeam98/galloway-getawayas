// First and last name — what the site promises (Liam, 19 Oct 2026):
//
//  - every account gives a first AND a last name, checked by one rule that the
//    form and the server both run (validatePersonName), and the server is the
//    only writer of the two columns;
//  - a brand-new account is asked on "Finish signing up"; a returning one never
//    is (mustFinishSignUp); an older nameless one is asked when it opens a
//    wizard or publishes (needsPersonName);
//  - Google's names are only ever a pre-fill the person confirms;
//  - NOTHING takes the first word of a business name as a person's name. A host
//    whose account said "The Dark Sky Dome" was shown as "Hosted by The".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';

installAliases();

const fs = require('fs');
const path = require('path');
/* eslint-disable @typescript-eslint/no-var-requires */
const { validatePersonName, needsPersonName, mustFinishSignUp, suggestedName, FINISH_SIGNUP_FROM } = require('@/lib/personName');
const { firstName, hostByline, greetingName, displayName } = require('@/lib/utils');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const DOME = { full_name: 'The Dark Sky Dome', first_name: null, last_name: null, preferred_name: null, show_full_name: true };
const MORAG = { full_name: 'Morag MacLellan', first_name: 'Morag', last_name: 'MacLellan', preferred_name: null, show_full_name: true };

/* ------------------------------------------------------------- the rule */

test('both names are required, and tidied', () => {
    assert.deepEqual(validatePersonName('  Morag ', ' Mac  Lellan '), { ok: true, first: 'Morag', last: 'Mac Lellan' });
    const noFirst = validatePersonName('', 'MacLellan');
    assert.equal(noFirst.ok, false);
    assert.equal(noFirst.field, 'first');
    const noLast = validatePersonName('Morag', '   ');
    assert.equal(noLast.ok, false);
    assert.equal(noLast.field, 'last');
});

test('an email, a phone number or punctuation alone is not a name', () => {
    assert.equal(validatePersonName('morag@example.com', 'X').ok, false);
    assert.equal(validatePersonName('07700900123', 'X').ok, false);
    assert.equal(validatePersonName('---', 'X').ok, false);
    assert.equal(validatePersonName('Morag', 'x'.repeat(51)).ok, false);
    // Hyphens, apostrophes and other alphabets are names.
    assert.equal(validatePersonName("Siân", "O'Neill-Smith").ok, true);
});

test('an account owes a name until it has both halves', () => {
    assert.equal(needsPersonName(DOME), true);
    assert.equal(needsPersonName({ first_name: 'Morag', last_name: '' }), true);
    assert.equal(needsPersonName(null), true);
    assert.equal(needsPersonName(MORAG), false);
});

test('Finish signing up is for new accounts only — a returning account never sees it', () => {
    const before = '2026-10-01T10:00:00Z';
    const after = new Date(Date.parse(FINISH_SIGNUP_FROM) + 60000).toISOString();
    assert.equal(mustFinishSignUp(DOME, before), false);
    assert.equal(mustFinishSignUp(DOME, after), true);
    assert.equal(mustFinishSignUp(MORAG, after), false);
    assert.equal(mustFinishSignUp(DOME, null), false);
    // Seed and scenario accounts (reserved .test addresses) are not stopped on
    // every page; real addresses are.
    assert.equal(mustFinishSignUp(DOME, after, 'host-ready@gallowayseed.test'), false);
    assert.equal(mustFinishSignUp(DOME, after, 'morag@example.com'), true);
});

test("Google's names are a pre-fill, given/family name first", () => {
    assert.deepEqual(suggestedName(null, { given_name: 'Morag', family_name: 'MacLellan', name: 'X Y' }), { first: 'Morag', last: 'MacLellan' });
    assert.deepEqual(suggestedName(null, { full_name: 'Morag Anne MacLellan' }), { first: 'Morag', last: 'Anne MacLellan' });
    assert.deepEqual(suggestedName({ first_name: 'Mo', last_name: null }, { name: 'Morag MacLellan' }), { first: 'Mo', last: '' });
    // A business typed into the old Full name box is not guessed at.
    assert.deepEqual(suggestedName(DOME, {}), { first: '', last: '' });
});

/* --------------------------------- never the first word of a business name */

test('a first name is the account’s own, never the first word of something longer', () => {
    assert.equal(firstName(MORAG, 'Host'), 'Morag');
    assert.equal(firstName(DOME, ''), '');
    assert.notEqual(firstName(DOME, 'Host'), 'The');
});

test('"Hosted by" shows the business name WHOLE when there is no first name', () => {
    assert.equal(hostByline(DOME, null, 'your host'), 'The Dark Sky Dome');
    assert.equal(hostByline({ ...DOME, full_name: '' }, 'Sauna at the Sea', 'your host'), 'Sauna at the Sea');
    assert.equal(hostByline({ ...DOME, full_name: '', trading_name: 'Dome Ltd' }, 'Sauna', 'your host'), 'Dome Ltd');
    assert.equal(hostByline({ ...DOME, full_name: '' }, null, 'your host'), 'your host');
    assert.equal(hostByline(MORAG, 'Sauna at the Sea', 'your host'), 'Morag');
});

test('the privacy switch still hides a legal name; a preferred name still wins', () => {
    assert.equal(firstName({ ...MORAG, show_full_name: false }, 'Guest'), 'Guest');
    assert.equal(firstName({ ...MORAG, preferred_name: 'Mo' }, 'Guest'), 'Mo');
    assert.equal(displayName(MORAG, 'Guest'), 'Morag MacLellan');
});

test('an email greets the account by its own first name, never "Hi The"', () => {
    assert.equal(greetingName(MORAG, 'there'), 'Morag');
    assert.equal(greetingName(DOME, 'there'), 'there');
    assert.equal(greetingName({ ...MORAG, show_full_name: false }, 'there'), 'Morag');
});

/* ------------------------------------------- where the rule has to hold */

test('the listing page never cuts the host name down to its first word', () => {
    const src = read('app/homes/[id]/page.tsx');
    assert.equal(/hostName\.split\(/.test(src), false, 'the listing page splits the host name again');
    assert.ok(src.indexOf('hostByline(') !== -1);
});

test('the name route validates with the shared helper and is the one writer', () => {
    const src = read('app/api/account/name/route.ts');
    assert.ok(src.indexOf('validatePersonName(') !== -1, 'the route no longer runs the shared check');
    assert.ok(src.indexOf('getUser()') !== -1, 'the route must verify who is calling');
    const mig = read('supabase/migrations/20261019153817_profiles_first_and_last_name.sql');
    assert.equal(/grant\s+(insert|update)[^;]*first_name/i.test(mig), false, 'the browser must not be able to write the names');
});
