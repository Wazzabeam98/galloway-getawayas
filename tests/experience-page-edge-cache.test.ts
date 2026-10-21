// The public experience page (/experiences/browse/[providerId]) is edge-cached:
// one copy of its HTML is served to everybody. These pin the three things that
// keep that safe and current.
//
//   1. NOTHING PER-VIEWER IN THE CACHED RENDER. The page and the shared view it
//      renders never read the session. Signed-in state, the review-reply box,
//      the viewer's own stays and the live calendar arrive after load from a
//      private, no-store route. A `cookies` read here would put one person's
//      details into the copy everyone gets (and makes Next 13 fail the render,
//      "Page changed from static to dynamic at runtime").
//   2. AN UNAPPROVED PROVIDER IS NEVER RENDERED THERE. The cached route only
//      redirects to a per-request preview route, which checks owner/admin.
//   3. EVERY SAVE REFRESHES IT. The write routes that change what the page shows
//      call lib/revalidatePublic, so an edit shows at once rather than after the
//      300s fallback.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// Code only — the header comments explain the rule using the very words the
// assertions forbid.
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PAGE = 'app/experiences/browse/[providerId]/page.tsx';
const VIEW = 'components/marketplace/ExperiencePageView.tsx';
const PREVIEW = 'app/experiences/browse/[providerId]/preview/page.tsx';
const LIVE = 'app/api/experiences/live/[providerId]/route.ts';

test('the public experience page is ISR and reads no session', () => {
    const page = code(PAGE);
    assert.match(page, /export const revalidate = \d+/);
    assert.doesNotMatch(page, /force-dynamic/);
    for (const src of [page, code(VIEW)]) {
        assert.doesNotMatch(src, /next\/headers/);
        assert.doesNotMatch(src, /\bcookies\b/);
        assert.doesNotMatch(src, /auth\.getUser|auth\.getSession|createServerComponentClient/);
        // The panels take signed-in state from the viewer context, not a prop.
        assert.doesNotMatch(src, /signedIn=/);
    }
    // Reviews are loaded with no viewer; canReply is decided after load.
    assert.match(page, /loadExperienceReviews\(admin, p\.id, null\)/);
});

test('an unapproved provider only ever gets a redirect from the cached route', () => {
    const page = code(PAGE);
    assert.match(page, /row\.status !== 'approved'/);
    assert.match(page, /redirect\(`\/experiences\/browse\/\$\{params\.providerId\}\/preview`\)/);
    assert.doesNotMatch(page, /loadOwnerPreviewProvider|OwnerPreviewBanner/);

    const preview = code(PREVIEW);
    assert.match(preview, /export const dynamic = 'force-dynamic'/);
    assert.match(preview, /robots: \{ index: false, follow: false \}/);
    assert.match(preview, /row\.owner_id === user\.id/);
    assert.match(preview, /await isAdmin\(user\.id\)/);
    // Approved → the public page; a stranger → browse. Never to the public page
    // for an unapproved one (the public page sends that back here: a loop).
    assert.match(preview, /row\.status === 'approved'\) redirect\(`\/experiences\/browse\/\$\{params\.providerId\}`\)/);
    assert.match(preview, /if \(!user \|\| !row\) redirect\('\/experiences\/browse'\)/);
});

test('the per-viewer route is private and never cached', () => {
    const live = code(LIVE);
    assert.match(live, /export const dynamic = 'force-dynamic'/);
    assert.match(live, /'Cache-Control': 'private, no-store'/);
    // Every response carries it.
    const responses = live.match(/NextResponse\.json\(/g) || [];
    const privateOnes = live.match(/headers: PRIVATE/g) || [];
    assert.equal(privateOnes.length, responses.length);
    // The viewer's own stays only, verified identity.
    assert.match(live, /auth\.getUser\(\)/);
    assert.match(live, /loadStayWindows\(admin, user\.id,/);
});

test('every save that changes an experience refreshes its cached page', () => {
    const writers: Array<[string, RegExp]> = [
        ['app/api/services/listing/save/route.ts', /revalidateExperience\(providerId\)/],
        ['app/api/services/listing/pause/route.ts', /revalidateExperience\(providerId\)/],
        ['app/api/admin/providers/visibility/route.ts', /revalidateExperience\(providerId\)/],
        ['app/api/admin/providers/route.ts', /revalidateExperiences\(ids\)/],
        ['app/api/services/slots/schedule/route.ts', /revalidateExperiencePage\(providerId\)/],
        ['app/api/services/slots/blocks/route.ts', /revalidateExperiencePage\(providerId\)/],
        ['app/api/services/slots/sessions/declare/route.ts', /revalidateExperiencePage\(providerId\)/],
        ['app/api/services/trade-blocks/route.ts', /revalidateExperiencePage\(providerId\)/],
        ['app/api/services/venue-point/route.ts', /revalidateExperiencePage\(providerId\)/],
        ['app/api/services/connect/route.ts', /revalidateExperience\(provider\.id\)/],
        ['app/api/cron/experience-ical-sync/route.ts', /revalidateExperiencePage\(feed\.provider_id\)/],
        ['app/api/services/reviews/route.ts', /revalidateExperiencePage\(/],
        ['app/api/admin/reviews/hide/route.ts', /revalidateExperiencePage\(moved\.provider_id\)/],
        ['lib/deactivateAccount.ts', /revalidateExperience\(p\.id\)/],
    ];
    for (const [file, pattern] of writers) assert.match(code(file), pattern, file);

    // An approval refreshes the provider's own page, not just the grids — before
    // it, that page's cached copy is the redirect to the preview.
    const lib = code('lib/revalidatePublic.ts');
    assert.match(lib, /revalidatePath\(`\/experiences\/browse\/\$\{id\}`\)/);
});
