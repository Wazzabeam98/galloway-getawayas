// The routes that move money, or decide who may touch a property, must report
// their failures somewhere a person will see.
//
// The pattern this pins down is the one `notify` had: a catch that writes to
// console.error and returns. On a server nobody is tailing, that is the same
// as saying nothing. A guest whose balance payment page never opened, a host
// whose Stripe onboarding broke, a co-host invitation that silently failed —
// all of them looked like a quiet afternoon from the owner's side.
//
// Deliberately a named list rather than every route under app/api. Two thirds
// of the routes here still do not report and that is a known, recorded piece
// of work; pinning the whole directory would fail on day one and be deleted.
// This list is the money- and access-path subset, and it only ever grows.
//
// Same shape as tests/admin-pages-guarded and tests/routes-verify-identity.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

const MUST_REPORT = [
    'app/api/notify/route.ts',
    'app/api/stripe/balance-checkout/route.ts',
    'app/api/stripe/connect/route.ts',
    'app/api/listings/save/route.ts',
    'app/api/listings/publish/route.ts',
    'app/api/listings/visibility/route.ts',
    'app/api/listing-access/route.ts',
    'app/api/listing-access/accept/route.ts',
    'app/api/booking-guests/route.ts',
    'app/api/booking-guests/accept/route.ts',
    'app/api/my-listings/route.ts',
];

// Comments stripped first. Three tests in this repo have failed because the
// pattern they searched for also appeared in the comment explaining why the
// thing was not done.
const code = (rel: string) =>
    fs.readFileSync(path.join(ROOT, rel), 'utf8')
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');

test('the listed routes all still exist', () => {
    for (const rel of MUST_REPORT) {
        assert.ok(
            fs.existsSync(path.join(ROOT, rel)),
            rel + ' is gone — remove it from this list deliberately, do not let the rule empty'
        );
    }
});

for (const rel of MUST_REPORT) {
    test(rel + ' reports its failures', () => {
        const src = code(rel);
        assert.ok(
            /logError\s*\(/.test(src),
            rel + ' has no logError call. A catch that only writes to console.error '
                + 'is silent to the owner — this route is on the money or access path.'
        );
    });

    test(rel + ' has no catch that only writes to the console', () => {
        const src = code(rel);
        // Every catch block, taken to the end of its own braces, must contain
        // a logError unless it does nothing but rethrow.
        const catches = src.split(/catch\s*\([^)]*\)\s*\{/).slice(1);
        catches.forEach((rest: string, i: number) => {
            let depth = 1;
            let body = '';
            for (const ch of rest) {
                if (ch === '{') depth++;
                if (ch === '}') { depth--; if (depth === 0) break; }
                body += ch;
            }
            if (!/console\.error/.test(body)) return;      // not the shape we are hunting
            if (/throw\b/.test(body)) return;              // passed upwards instead
            assert.ok(
                /logError\s*\(/.test(body),
                rel + ': catch block ' + (i + 1) + ' writes to console.error and nothing else. '
                    + 'Add a logError so it reaches /admin/errors.'
            );
        });
    });
}
