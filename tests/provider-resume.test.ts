// A returning applicant must see their state, not the picker.
//
// THE FAILURE THIS GUARDS
//
// Someone who has applied comes back to /services/join often — from the "your
// application" links in the decision emails, or by signing in again. What they
// have to see is "we're reviewing you", or the payout gate, not the empty
// picker (the category grid for a guest, the blank first step for a host). The
// picker reads as though their application vanished.
//
// The client form does look their record up, but on a cold load straight after
// following an emailed link its getSession() can resolve to null before the
// auth cookie has hydrated, and it then falls back to the picker. So the lookup
// is ALSO done server-side, where the cookie is always present, and handed to
// the form as its starting point.
//
// These are read as source rather than rendered: the page is an async server
// component and the form is thousands of lines of client state, so loading
// either here would test the harness, not the rule. What matters is the shape —
// that the server resolves the record scoped to the OWNER (never someone
// else's application), and that the form opens FROM it, never on the picker
// when a record exists.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the join page resolves the signed-in owner\'s record server-side', () => {
    // The lookup moved into lib/joinResume.ts (Oct 2026) so the clean
    // guest-experience address, /business/experience, resolves a returning
    // applicant exactly as /services/join does. Both pages must still call it,
    // stay dynamic, and hand the record to the form; the lookup itself is held
    // to the same rules as before, in its new home.
    const lookup = read('lib/joinResume.ts');
    for (const rel of ['app/services/join/page.tsx', 'app/business/experience/page.tsx']) {
        const page = read(rel);
        // Cookies are read, so it cannot be statically rendered.
        assert.match(page, /export const dynamic = 'force-dynamic'/,
            rel + ' reads cookies and must be dynamic');
        assert.match(page, /await resolveJoinResume\(/,
            rel + ' must resolve the applicant server-side');
        // And handed to the form as its starting point.
        assert.match(page, /initialResume=\{initialResume\}/,
            rel + ': the resolved record must be passed to ProviderSignUp');
    }

    // The identity is verified against the auth server, not a forgeable cookie.
    assert.match(lookup, /getUser\(\)/,
        'the owner must be resolved with getUser(), not getSession()');

    // One business per trade: the record is keyed on owner AND the trade asked
    // for, so it is exactly the application this page is showing — never another
    // person's row, and never a different trade of the same person's.
    assert.match(lookup, /from\('service_providers'\)/);
    assert.match(lookup, /\.eq\('owner_id'/,
        'the lookup must be scoped to the signed-in owner, so no one is seeded with another owner\'s application');
    assert.match(lookup, /\.eq\('trade'/,
        'the lookup must be scoped to the trade in the URL');
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

    // And the step opens past the picker whenever there is a SENT record to
    // resume, so the grid never flashes under the status panel. 'g_you' is the
    // opener both flows share and where the hydrated openingStep lands a host.
    // The one exception is a guest experience still in draft: it opens on step
    // one with nothing picked, like a newcomer (Liam, 5 Oct 2026) — there is no
    // status panel for it to flash under.
    assert.match(form, /initialResume && !\(audienceForTrade\(initialResume\.trade\) === 'guest' && initialResume\.status === 'draft'\)\s*\? 'g_you'\s*: 'trade'/,
        'a resumed (sent) application must open past the picker; a guest draft opens on step one');
});
