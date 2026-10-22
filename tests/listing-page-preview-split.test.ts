// The cottage page (/homes/[id]) is edge-cached: one copy of its HTML is served
// to everybody. Since #467 it read the session for a draft or pending listing,
// which Next 13 refuses inside a cached page — every draft page answered 500, so
// no host could preview their unpublished listing. These pin the fix: the same
// split as the experience page (#491).
//
//   1. The cached route and the page body never read the session. A non-public
//      listing only ever gets a redirect there.
//   2. The preview route is per-request and lets in exactly the owner, a co-host
//      with listing access, or an admin; anyone else is sent away.
//   3. The links that open a not-yet-public listing go straight to the preview.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// Code only — the comments explain the rule using the words it forbids.
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PAGE = 'app/homes/[id]/page.tsx';
const VIEW = 'app/homes/[id]/HomeView.tsx';
const PREVIEW = 'app/homes/[id]/preview/page.tsx';

test('the cached listing page and its body read no session', () => {
    assert.match(code(PAGE), /export const revalidate = \d+/);
    for (const f of [PAGE, VIEW]) {
        const src = code(f);
        assert.doesNotMatch(src, /force-dynamic/, f);
        assert.doesNotMatch(src, /next\/headers/, f);
        assert.doesNotMatch(src, /\bcookies\b/, f);
        assert.doesNotMatch(src, /auth\.getUser|auth\.getSession|createServerComponentClient/, f);
    }
});

test('a listing that is not public only ever gets a redirect from the cached route', () => {
    const view = code(VIEW);
    assert.match(view, /PUBLICLY_VISIBLE\.indexOf\(home\.status\) === -1/);
    assert.match(view, /if \(isPreview && !preview\) redirect\(`\/homes\/\$\{params\.id\}\/preview`\)/);
    // The redirect comes before the page is built: nothing about the listing is
    // rendered on the way.
    assert.ok(view.indexOf('redirect(`/homes/${params.id}/preview`)') < view.indexOf('isListingBookable(home)'));
});

test('the preview route is per-request and lets in only owner, co-host with listing access, admin', () => {
    const preview = code(PREVIEW);
    assert.match(preview, /export const dynamic = 'force-dynamic'/);
    assert.match(preview, /robots: \{ index: false, follow: false \}/);
    assert.match(preview, /auth\.getUser\(\)/);
    assert.match(preview, /row\.host_id === user\.id/);
    assert.match(preview, /checkListing\(user\.id, params\.id, 'can_listing'\)/);
    assert.match(preview, /await isAdmin\(user\.id\)/);
    assert.match(preview, /if \(!viewer\) redirect\('\/'\)/);
    assert.match(preview, /if \(!user \|\| !row \|\| row\.deactivated_at\) redirect\('\/'\)/);
    // Public by now → its real page. Never a non-public one back to /homes/[id],
    // which would send it straight here again.
    assert.match(preview, /PUBLICLY_VISIBLE\.indexOf\(row\.status\) !== -1\) \{\s*redirect\(`\/homes\/\$\{params\.id\}`\)/);
});

test('the links to a not-yet-public listing open its preview', () => {
    assert.match(read('app/dashboard/page.tsx'), /\{isWaiting && \(\s*<Link\s*href=\{`\/homes\/\$\{item\.id\}\/preview`\}/);
    assert.match(read('components/admin/ListingReviewQueue.tsx'), /href=\{`\/homes\/\$\{item\.id\}\/preview`\}/);
    assert.match(read('components/admin/AdminListingRow.tsx'), /'\/homes\/' \+ id \+ '\/preview'/);
});
