// No page a stranger can reach may ask `listings` for every column.
//
// WHY. `anon` no longer holds a table-level grant on `listings` — it is given a
// named list, and the exact coordinates, street address, postcode, ical_token
// and commission_rate are not on it. So `select('*')` is REFUSED for anon.
// That is deliberate, and it is the standing protection: a sensitive column
// added later cannot reach the page source by being swept up by a star.
//
// It is also how the live listing page broke for about a minute on 28 August
// 2026. The grant was revoked on production before the code that names its
// columns was deployed; the running bundle still asked for `select('*')`, was
// refused, and every listing page said "This listing couldn't be found". The
// anon-exposure canary said "nothing leaking" throughout, because it answers
// what a stranger can READ and never whether the site works.
//
// This test is the cheap half of that lesson: it cannot tell you the grants are
// right, but it can tell you a star has appeared somewhere a stranger will hit.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// It does not ban `select('*')` on listings outright. Three screens use it and
// are staying that way on purpose: they are signed-in-only, `authenticated`
// keeps its table grant, and hand-listing forty columns across three large
// forms trades a silently missing field for no security gain. They are named
// below, with why. Anything NOT named has to justify itself by being added
// here, which is the point — the list is the decision, made once, in writing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * Files allowed to ask `listings` for every column. EMPTY, and it has to stay
 * empty: since 20260903154419, `authenticated` no longer holds a table grant on
 * `listings` either — it has a named safe-column allow-list, and the sensitive
 * columns (street_address, coords, ical_token, commission_rate) are owner-only
 * through `listing_private`. So a `select('*')` on `listings` is now refused for
 * a signed-in user just as it is for a stranger. The three host screens that
 * used to star-select `listings` (the wizard, the editor, account settings) now
 * star-select `listing_private` instead, which IS still a whole-row grant and is
 * fine. Add a file here only if `authenticated` regains a table grant on
 * `listings` — which it should not.
 */
const SIGNED_IN_ONLY: Record<string, string> = {};

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (['node_modules', '.git', '.next', '.test-build'].includes(entry.name)) continue;
        if (entry.isDirectory()) sourceFiles(rel, out);
        else if (/\.tsx?$/.test(entry.name)) out.push(rel);
    }
    return out;
}

/**
 * Every read of `listings` that asks for every column, and whether THAT READ
 * goes through the service key.
 *
 * Per read, not per file. The first version of this asked whether the file
 * mentioned `adminClient` anywhere, and app/homes/[id]/page.tsx uses both
 * clients — the session one for the listing, the service one elsewhere — so the
 * public page was classified as service-key and excused. Reintroducing the
 * exact bug this test exists for did not fail it. Found by mutation testing,
 * which is the only reason it is written this way.
 */
function starSelectsOn(table: string): { file: string; service: boolean }[] {
    const found: { file: string; service: boolean }[] = [];

    for (const file of ['app', 'components', 'lib'].flatMap((d) => sourceFiles(d))) {
        const source = fs.readFileSync(path.join(ROOT, file), 'utf8');

        // The receiver of the call — `supabase.from(...)` or `admin.from(...)` —
        // then how that name was assigned, which is what says which key it holds.
        const reads = new RegExp("(\\w+)\\s*\\.\\s*from\\(\\s*'" + table + "'\\s*\\)", 'g');
        let match: RegExpExecArray | null;

        while ((match = reads.exec(source)) !== null) {
            const tail = source.slice(match.index + match[0].length, match.index + match[0].length + 220);
            const select = /\.select\(\s*(['"`])([\s\S]*?)\1/.exec(tail);
            if (!select || select[2].trim() !== '*') continue;

            // How the receiver was built, read from the assignment itself
            // rather than from its callee name. `createClient` is NOT a
            // service-key signal — app/sitemap.ts calls it with the anon key,
            // and treating the name as proof excused a genuinely public page.
            // Only the service role's own helper, or the key by name, counts.
            const receiver = match[1];
            const assignment = new RegExp('const\\s+' + receiver + '\\s*=[\\s\\S]{0,200}').exec(source);
            const madeBy = assignment ? assignment[0] : '';

            const service = /adminClient|SERVICE_ROLE/.test(madeBy);
            found.push({ file, service });
            break;
        }
    }

    return found;
}

const starSelectsOnListings = () => starSelectsOn('listings');

test('no anon-reachable query asks listings for every column', () => {
    const offenders = starSelectsOnListings()
        .filter((hit) => !hit.service)
        .filter((hit) => !(hit.file in SIGNED_IN_ONLY))
        .map((hit) => hit.file);

    assert.deepEqual(
        offenders, [],
        'These read listings with a star and are not on the signed-in-only list:\n  '
        + offenders.join('\n  ')
        + '\n\nNeither anon nor authenticated holds a table grant on listings, so a star'
        + '\nis refused for everyone and the page renders as "couldn’t be found". Name the'
        + '\nsafe columns, or read the owner’s own row through listing_private (whole-row).'
    );
});

test('the signed-in-only list has not rotted', () => {
    // A list of exceptions nobody prunes stops being a decision and becomes
    // noise. If one of these has since been converted, or moved, say so rather
    // than carrying a permission for a file that no longer needs it.
    const stars = starSelectsOnListings().map((hit) => hit.file);

    const stale = Object.keys(SIGNED_IN_ONLY).filter((file) => {
        if (!fs.existsSync(path.join(ROOT, file))) return true;
        return !stars.includes(file);
    });

    assert.deepEqual(
        stale, [],
        'These are excused from the rule but no longer need to be:\n  ' + stale.join('\n  ')
        + '\n\nRemove them from SIGNED_IN_ONLY.'
    );
});

test('the public listing page names its columns', () => {
    // The one that actually broke. Asserted by name rather than left to the
    // rule above, so a failure says which page is down rather than which rule
    // was tripped.
    const page = fs.readFileSync(path.join(ROOT, 'app/homes/[id]/page.tsx'), 'utf8');

    assert.match(page, /approx_latitude/, 'the public page must read the rounded pin');
    assert.doesNotMatch(page, /home\.latitude|home\.longitude/,
        'the public page is reading exact coordinates, which anon cannot select');

    // EVERY read in the file, not the first. There are two — generateMetadata
    // and the page itself — and checking only the first meant the page's own
    // query could go back to a star unnoticed. That is exactly what happened
    // when this was mutation-tested.
    const reads = [...page.matchAll(/from\(\s*'listings'\s*\)/g)];
    assert.ok(reads.length > 0, 'the public page no longer reads listings — check this test still makes sense');

    const starred = reads.filter((r) => {
        const tail = page.slice(r.index!, r.index! + 400);
        return /\.select\(\s*(['"`])\s*\*\s*\1/.test(tail);
    });

    assert.equal(
        starred.length, 0,
        `${starred.length} of the ${reads.length} listings reads on the public page asks for `
        + 'every column. anon is refused and the page renders as "couldn’t be found".'
    );
});


/* -------------------------------------------------------------------------- */
/* THE SAME RULE, ON reviews                                                   */
/* -------------------------------------------------------------------------- */
//
// Added after the site audit found app/homes/[id]/page.tsx reading `reviews`
// with a star — on the same page, for the same strangers, one table away from
// everything above.
//
// It matters for a different reason from `listings`, and the difference is
// worth writing down. anon HAS a column grant on every column of `reviews`, so
// a star is not refused: it succeeds, and quietly puts `booking_id` and
// `reviewee_id` into the page source. Those tie a named guest to a specific
// stay. Nothing breaks, nothing errors, and the leak is invisible — which is
// the worse of the two failures, because the listings one at least announced
// itself by making the page say "couldn't be found".

const REVIEWS_SIGNED_IN_ONLY: Record<string, string> = {
    'app/account/page.tsx':
        'the data download. Reads only the signed-in person’s own reviews, '
        + 'and they are entitled to every column of their own.',
    'app/dashboard/reviews/page.tsx':
        'the host’s own reviews. Every read is .eq(reviewee_id, session.user.id) '
        + 'or scoped to their own bookings, and /dashboard is behind the '
        + 'middleware, so it never renders for a stranger. booking_id and '
        + 'reviewee_id are their own business here — the reviewee IS them.',
};

test('no anon-reachable query asks reviews for every column', () => {
    const offenders = starSelectsOn('reviews')
        .filter((hit) => !hit.service)
        .filter((hit) => !(hit.file in REVIEWS_SIGNED_IN_ONLY))
        .map((hit) => hit.file);

    assert.deepEqual(
        offenders, [],
        'These read reviews with a star and are not on the signed-in-only list:\n  '
        + offenders.join('\n  ')
        + '\n\nUnlike listings, anon can read every column of reviews — so a star here'
        + '\nSUCCEEDS and puts booking_id and reviewee_id into the page source, which'
        + '\nties a named guest to a specific stay. Name the columns.'
    );
});

test('the reviews exception list has not rotted', () => {
    const stars = starSelectsOn('reviews').map((hit) => hit.file);

    const stale = Object.keys(REVIEWS_SIGNED_IN_ONLY).filter((file) => {
        if (!fs.existsSync(path.join(ROOT, file))) return true;
        return !stars.includes(file);
    });

    assert.deepEqual(
        stale, [],
        'These are excused from the reviews rule but no longer need to be:\n  '
        + stale.join('\n  ') + '\n\nRemove them from REVIEWS_SIGNED_IN_ONLY.'
    );
});

test('the public listing page does not leak who reviewed which booking', () => {
    // The specific regression, named, so a failure says what came back rather
    // than only that a rule was broken.
    const page = fs.readFileSync(path.join(ROOT, 'app/homes/[id]/page.tsx'), 'utf8');
    const read = /from\(\s*'reviews'\s*\)[\s\S]{0,400}?\.select\(\s*'([^']*)'/.exec(page);

    assert.ok(read, 'the reviews read has moved — this test needs updating deliberately');

    const columns = read![1].split(',').map((c) => c.trim());
    for (const secret of ['booking_id', 'reviewee_id', 'is_published', 'published_at']) {
        assert.ok(
            !columns.includes(secret),
            secret + ' is being sent to the public listing page'
        );
    }
    assert.ok(columns.includes('rating'), 'and it still has to render the review');
    assert.ok(columns.includes('comment'));
});
