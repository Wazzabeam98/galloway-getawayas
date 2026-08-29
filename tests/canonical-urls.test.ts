// No page may claim to be a different page.
//
// The root layout carried `alternates: { canonical: '/' }`, and metadata is
// inherited — so every page that did not set its own canonical told Google it
// WAS the home page. Most set one, so the visible victim was the 404: a dead
// listing URL answered with `noindex`, then a SECOND robots tag from the
// layout saying `index, follow`, then a canonical pointing at the home page.
//
// noindex wins, so it was doing little harm. "Little harm" is not a reason to
// leave a page lying about which page it is, and the next public page added
// without a canonical would have inherited the same lie without anyone
// noticing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

// Comments stripped. Every one of these files explains in a comment what it
// deliberately does NOT do, and a check that cannot tell the explanation from
// the thing explained fails on a correct file. That has now happened twice in
// this session, which is why it is a helper.
const code = (rel: string) =>
    read(rel).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

test('the root layout does not hand out a canonical', () => {
    const body = code('app/layout.tsx');
    const meta = body.slice(body.indexOf('export const metadata'), body.indexOf('export default function'));
    assert.ok(
        !/alternates\s*:/.test(meta),
        'a canonical on the layout is inherited by every page that does not set one, '
        + 'so each of them claims to be whatever it points at'
    );
});

test('the home page sets its own', () => {
    assert.match(code('app/page.tsx'), /alternates:\s*\{\s*canonical:\s*'\/'/);
});

test('the not-found page says noindex itself', () => {
    // Rather than relying on Next's default and letting the layout argue with
    // it in a second tag.
    const body = code('app/not-found.tsx');
    assert.match(body, /export const metadata/);
    assert.match(body, /index:\s*false/);
});

test('the not-found page does not claim a canonical', () => {
    assert.ok(!/canonical/.test(code('app/not-found.tsx')));
});

test('every indexable public page sets a canonical of its own', () => {
    // The rule the layout used to hide. A page that is offered to Google and
    // has no canonical is a page that will be deduplicated against whatever it
    // inherits — and now it inherits nothing, which is honest but means each
    // one has to say.
    const PUBLIC_PAGES: Record<string, string> = {
        'app/page.tsx': 'the home page',
        'app/business/page.tsx': 'set up a business',
        'app/contact/page.tsx': 'contact',
        'app/terms/page.tsx': 'terms',
        'app/privacy/page.tsx': 'privacy',
        'app/cancellation-policy/page.tsx': 'cancellation policy',
        'app/services/page.tsx': 'the trade directory',
        'app/services/[trade]/layout.tsx': 'one trade',
        'app/homes/[id]/page.tsx': 'one listing',
        'app/holiday-cottages/[area]/page.tsx': 'one area',
    };

    const missing = Object.keys(PUBLIC_PAGES).filter((f) => {
        if (!exists(f)) return true;
        return !/canonical/.test(code(f));
    });

    assert.deepEqual(
        missing, [],
        'These are offered to Google with no canonical of their own:\n  '
        + missing.map((f) => `${f} — ${PUBLIC_PAGES[f]}`).join('\n  ')
        + '\n\nThe layout no longer supplies one, so each page has to say.'
    );
});

test('the pages with no canonical are the ones that are noindexed', () => {
    // The other half. A page without a canonical is fine precisely when it is
    // not being offered to Google — and if one of these stops being noindex,
    // it needs a canonical in the same change.
    for (const rel of [
        'app/addhome/layout.tsx',
        'app/services/join/layout.tsx',
    ]) {
        const body = code(rel);
        assert.ok(!/canonical/.test(body), rel + ' now sets a canonical — is it indexable?');
        assert.match(body, /index:\s*false/, rel + ' has no canonical and is not noindex');
    }
});
