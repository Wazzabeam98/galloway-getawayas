// A returning applicant must see their state, not the picker.
//
// THE FAILURE THIS GUARDS
//
// Someone who has applied comes back to /services/join often — from the "your
// application" links in the decision emails, or by signing in again. What they
// have to see is "we're reviewing you", or the payout gate, not the empty
// category grid. The grid reads as though their application vanished.
//
// The client form does look their record up, but on a cold load straight after
// following an emailed link its getSession() can resolve to null before the
// auth cookie has hydrated, and it then falls back to the picker. So the lookup
// is ALSO done server-side, where the cookie is always present, and handed to
// the form as its starting point.
//
// These are read as source rather than rendered: the page is an async server
// component and the form is four thousand lines of client state, so loading
// either here would test the harness, not the rule. What matters is the shape —
// that the server resolves the record and the form opens FROM it, never on the
// picker when a record exists.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the join page resolves the signed-in owner\'s record server-side', () => {
    const page = read('app/services/join/page.tsx');

    // Cookies are read, so it cannot be statically rendered.
    assert.match(page, /export const dynamic = 'force-dynamic'/,
        'the page reads cookies and must be dynamic');

    // The identity is verified against the auth server, not a forgeable cookie.
    assert.match(page, /getUser\(\)/,
        'the owner must be resolved with getUser(), not getSession()');

    // One business per trade: the record is keyed on owner AND the trade asked
    // for, so it is exactly the application this page is showing.
    assert.match(page, /from\('service_providers'\)/);
    assert.match(page, /\.eq\('owner_id'/,
        'the lookup must be scoped to the signed-in owner');
    assert.match(page, /\.eq\('trade'/,
        'the lookup must be scoped to the trade in the URL');

    // And handed to the form as its starting point.
    assert.match(page, /initialResume=\{/,
        'the resolved record must be passed to ProviderSignUp');
});

test('the form opens from the resolved record, never on the picker when one exists', () => {
    const form = read('components/services/ProviderSignUp.tsx');

    // Status seeded from the record: this is what puts the pending panel (and
    // the payout gate) on screen on the first paint.
    assert.match(form, /useState\(initialResume\?\.status \|\| 'draft'\)/,
        'status must be seeded from initialResume so a returning applicant sees it immediately');

    // providerId seeded: a truthy providerId is what stops the guest category
    // picker deciding it still needs a category (guestNeedsCategory).
    assert.match(form, /useState<string \| null>\(initialResume\?\.id \?\? null\)/,
        'providerId must be seeded from initialResume');

    // And the step opens past the picker whenever there is a record to resume,
    // so the grid never flashes under the status panel.
    assert.match(form, /useState<StepKey>\(initialResume \? 'business' : 'trade'\)/,
        'a resumed application must open on the business step, not the trade picker');
});
