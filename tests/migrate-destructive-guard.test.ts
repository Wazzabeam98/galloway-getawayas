// What the migration runner treats as losing data.
//
// scripts/migrate.mjs refuses anything that loses rows or columns unless
// --destructive is typed as well as --apply. The whole value of that is its
// precision: a guard that demands the magic word for things which plainly do
// not need it teaches people to type the magic word, and then it is not a
// guard any more.
//
// THE RULE MOVED TO scripts/sqlRisk.cjs SO THIS FILE COULD EXIST. It used to
// live inside migrate.mjs, where the only way to exercise it was to run the
// script — which loads .env.local and dies without it. The first version of
// these tests shelled out to it: green on this machine, red in CI, which is
// no test at all for the rule that decides whether a migration may drop a
// table. Now the classifier is imported directly and touches nothing.
//
// Both directions below were found the hard way while revoking grants on
// profiles.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const path = require('path');
/* eslint-disable @typescript-eslint/no-var-requires */
const { classify } = require(
    path.resolve(__dirname, '..', '..', 'scripts', 'sqlRisk.cjs')
);

const losesData = (sql: string): string[] => classify(sql).destructive;

/* ------------------------------------------------- what must still be caught */

test('a plain truncate loses data', () => {
    assert.deepEqual(losesData('truncate table public.rate_limit_hits;'), ['truncate']);
});

test('a truncate hidden in a DO block loses data too', () => {
    // This one got through. The scan stripped $$...$$ along with the comments
    // and string literals — right for naming statements in the plan, wrong
    // for deciding whether data is lost, because a DO body is code that runs.
    // Proven by running it: the guard waved it past and truncated a table on
    // the test project.
    assert.deepEqual(
        losesData('do $$ begin truncate table public.rate_limit_hits; end $$;'),
        ['truncate'],
        'a DO block is executable code, not a string literal'
    );
});

test('drop table, drop schema and drop owned all lose data', () => {
    assert.deepEqual(losesData('drop table public.x;'), ['drop table']);
    assert.deepEqual(losesData('drop schema public cascade;'), ['drop schema']);
    assert.deepEqual(losesData('drop owned by anon;'), ['drop owned']);
});

test('a delete with no where loses data, one with a where does not', () => {
    assert.deepEqual(losesData('delete from public.x;'), ['delete without a where']);
    assert.deepEqual(losesData('delete from public.x where id = 1;'), []);
});

test('dropping a column loses data', () => {
    assert.deepEqual(losesData('alter table public.x drop column y;'), ['drop column']);
});

/* ----------------------------------------- what must NOT need the magic word */

test('REVOKING truncate does not lose data', () => {
    // The opposite of destructive: it takes the ability away. The guard read
    // the word and demanded --destructive for a statement that removes a
    // permission, which is exactly how the word stops meaning anything.
    assert.deepEqual(losesData('revoke truncate on table public.profiles from anon;'), []);
});

test('revoking several at once, truncate among them, does not lose data', () => {
    assert.deepEqual(
        losesData('revoke delete, truncate, trigger, references on table public.profiles from anon;'),
        []
    );
});

test('granting does not lose data', () => {
    assert.deepEqual(losesData('grant select (full_name) on table public.profiles to anon;'), []);
});

test('a truncate DESCRIBED in a comment does not count', () => {
    // The reason comments are stripped at all: these migrations quote their
    // own old statements in the header.
    assert.deepEqual(losesData('-- we used to truncate this\nselect 1;'), []);
});

/* -------------------------------------------- and the narrowing is not a hole */

test('a revoke followed by a real truncate is still caught', () => {
    // Permission statements are cut out before the scan. That must not swallow
    // what comes after them.
    assert.deepEqual(
        losesData('revoke truncate on table public.profiles from anon;\ntruncate table public.x;'),
        ['truncate']
    );
});

test('a real truncate before a revoke is still caught', () => {
    assert.deepEqual(
        losesData('truncate table public.x;\nrevoke truncate on table public.profiles from anon;'),
        ['truncate']
    );
});

test('a revoke is still reported as structural', () => {
    // It stops needing the extra flag; it does not stop being named in the
    // plan. Somebody reading the output should still see it.
    assert.ok(classify('revoke truncate on table public.profiles from anon;').structural.includes('revoke'));
});

test('a read-only query is not a write', () => {
    assert.equal(classify('select 1;').writes, false);
    assert.equal(classify('revoke select on table x from anon;').writes, true);
});
