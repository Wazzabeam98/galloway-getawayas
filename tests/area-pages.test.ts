// The rules that decide whether an area landing page may be offered to Google.
//
// WHY THIS IS A TEST AND NOT A PARAGRAPH
//
// The whole value of these pages is that they are better than the thin
// auto-generated town page every big agency already has. The moment one of
// ours goes out unwritten, it stops being better than theirs and starts
// costing the rest of the site — a cluster of near-identical thin pages is
// read as a quality signal about the whole domain, not just about those pages.
//
// So "do not publish an empty one" cannot be a habit. Two gates, both here:
//
//   hasCopy()        somebody has written the introduction
//   isPublishable()  ...and there is at least one property to show
//
// And the two places that gate on them — the sitemap and the page's own
// robots tag — have to agree, because leaving a page out of a sitemap does
// not stop it being indexed from a link. That agreement is asserted below by
// reading both files, which is crude and catches the thing that actually goes
// wrong: one of them being changed on its own.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installAliases } from './helpers/stub';
import type { Area } from '@/config/areas';

// installAliases() patches require() so '@/...' resolves inside .test-build.
// It has to run BEFORE the modules are loaded, and an `import` statement is
// hoisted above every statement in the file — so these are require()d after
// the call, the way the other tests here do it. Getting this wrong is a
// "Cannot find module '@/config/areas'" at load time, not a subtle failure.
installAliases();

const fs = require('fs');
const path = require('path');

/* eslint-disable @typescript-eslint/no-var-requires */
const { AREAS, areaBySlug, areaForTownKey, hasCopy, isPublishable } = require('@/config/areas');
const { townKey } = require('@/lib/places');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function written(overrides: Partial<Area> = {}): Area {
    return {
        slug: 'test-town',
        name: 'Test Town',
        townKeys: ['testtown'],
        intro: ['A real paragraph about the place.'],
        metaDescription: 'A real description.',
        gettingThere: [],
        faqs: [],
        nearby: [],
        ...overrides,
    };
}

/* --------------------------------------------------------------- the gates */

test('an area with no copy is not publishable, however many properties it has', () => {
    const area = written({ intro: [] });
    assert.equal(hasCopy(area), false);
    assert.equal(isPublishable(area, 12), false);
});

test('whitespace is not copy', () => {
    // The failure this catches is somebody putting a placeholder in to make
    // the page render and forgetting it is now indexable.
    assert.equal(hasCopy(written({ intro: ['   ', '\n'] })), false);
});

test('a written area with nothing to stay in is not publishable either', () => {
    const area = written();
    assert.equal(hasCopy(area), true);
    assert.equal(isPublishable(area, 0), false,
        'a page promising cottages in a town with none is worse than no page');
});

test('written, and with somewhere to stay, is publishable', () => {
    assert.equal(isPublishable(written(), 1), true);
});

/* ------------------------------------------------------- shipping unwritten */

test('no area can reach Google yet — the written ones are all held', () => {
    // The copy is now written for nine towns, but every one of them carries
    // `hold: true`, so none is publishable and none is in the sitemap. Adding
    // the copy did not publish the pages; clearing a hold does. That keeps
    // "a page goes in front of Google" a decision somebody made, exactly as the
    // original build intended — the gate just moved from "is it written" to
    // "is it written AND released".
    //
    // WHEN YOU CLEAR A HOLD, this test fails and names the town. Read
    // AREA-BRIEF.md, check its attractions are still open, and add the slug to
    // the expected list below. That failure is the checkpoint, not a nuisance.
    const readyToPublish = (AREAS as Area[])
        .filter((a) => hasCopy(a) && !a.hold)
        .map((a) => a.slug);

    assert.deepEqual(
        readyToPublish, [],
        'These areas are written AND no longer held, so they can reach Google: '
        + readyToPublish.join(', ')
        + '\n\nIf that was deliberate, add them here. If not, restore hold: true.'
    );
});

/* ------------------------------------------------------------- the wiring */

test('every area has a unique slug', () => {
    const seen = new Set<string>();
    for (const area of AREAS as Area[]) {
        assert.ok(!seen.has(area.slug), 'duplicate slug: ' + area.slug);
        seen.add(area.slug);
    }
});

test('no town belongs to two areas', () => {
    // Two areas claiming one town would put the same properties on both pages
    // and make them compete with each other for the same search.
    const owner: Record<string, string> = {};
    for (const area of AREAS as Area[]) {
        for (const key of area.townKeys) {
            assert.equal(owner[key], undefined,
                `"${key}" is claimed by both ${owner[key]} and ${area.slug}`);
            owner[key] = area.slug;
        }
    }
});

test('every nearby link points at an area that exists', () => {
    // A dead internal link is worse than no link, and these are written by
    // hand in the same file.
    for (const area of AREAS as Area[]) {
        for (const slug of area.nearby) {
            assert.ok(areaBySlug(slug), `${area.slug} links to "${slug}", which is not an area`);
        }
    }
});

test('no area links to itself', () => {
    for (const area of AREAS as Area[]) {
        assert.ok(area.nearby.indexOf(area.slug) === -1, area.slug + ' lists itself as nearby');
    }
});

test('townKeys are in the form townKey() actually produces', () => {
    // townKey() lower-cases and strips everything that is not a letter. A key
    // written "castle-douglas" or "Castle Douglas" would match no listing
    // ever, and nothing would look broken — the page would just be
    // permanently empty.
    for (const area of AREAS as Area[]) {
        for (const key of area.townKeys) {
            assert.equal(key, townKey(key),
                `"${key}" in ${area.slug} is not a townKey — it would match nothing`);
        }
    }
});

test('the name of each area maps back to itself through townKey', () => {
    // Belt and braces on the above: the town as a person writes it must land
    // on one of the keys the area claims.
    for (const area of AREAS as Area[]) {
        assert.ok(
            area.townKeys.indexOf(townKey(area.name)) !== -1,
            `${area.slug} is called "${area.name}", which townKey()s to `
            + `"${townKey(area.name)}" — not in [${area.townKeys.join(', ')}]`
        );
    }
});

test('a listing town finds its area', () => {
    assert.equal(areaForTownKey(townKey('Kirkcudbright, Dumfries and Galloway'))?.slug, 'kirkcudbright');
    assert.equal(areaForTownKey(townKey('18 Dovecroft, Kirkcudbright, Dumfries and Galloway'))?.slug,
        'kirkcudbright', 'a stored street address still resolves to the town');
    assert.equal(areaForTownKey(townKey('Gatehouse of Fleet, Dumfries and Galloway'))?.slug,
        'gatehouse-of-fleet', 'a multi-word town survives the key');
    assert.equal(areaForTownKey('somewhereelse'), null);
});

/* ------------------------------------------- the two gates have to agree */

test('the sitemap will not offer an area that has no copy', () => {
    const body = read('app/sitemap.xml/route.ts');
    assert.ok(body.includes('hasCopy'),
        'app/sitemap.xml/route.ts no longer checks hasCopy — an unwritten page can now be crawled');
    assert.ok(/holiday-cottages/.test(body),
        'the sitemap does not mention the area pages at all');
});

test('the page will not tell Google to index an area that has no copy', () => {
    const body = read('app/holiday-cottages/[area]/page.tsx');
    assert.ok(body.includes('hasCopy'),
        'the page no longer checks hasCopy');
    assert.ok(/index: false/.test(body),
        'the page no longer emits noindex — a sitemap omission alone does not stop indexing');
});

test('the area page has exactly one h1', () => {
    // The listing page shipped with two for months. Cheap to check, and the
    // check is what stops it happening again on a page built to rank.
    const body = read('app/holiday-cottages/[area]/page.tsx');
    const opens = (body.match(/<h1[\s>]/g) || []).length;
    assert.equal(opens, 1, 'found ' + opens + ' h1 elements');
});

test('the area page sets a canonical URL', () => {
    const body = read('app/holiday-cottages/[area]/page.tsx');
    assert.ok(/alternates:\s*\{\s*canonical/.test(body));
});
