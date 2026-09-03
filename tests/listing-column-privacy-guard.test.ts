// Guard for the listings column-privacy fix. Static, so it runs in CI and on the
// web-editor paste path: the sensitive columns must stay off authenticated's
// SELECT grant, the owner view must exist, and the four owner reads must keep
// pointing at it (a paste that reverts one to .from('listings').select('*')
// silently re-exposes street_address / ical_token / commission_rate).

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the listings column-privacy migration revokes the table SELECT and builds listing_private', () => {
    const sql = read('supabase/migrations/20260903154419_listing_private_columns.sql').replace(/\s+/g, ' ');
    assert.match(sql, /revoke select on "?public"?\."?listings"? from "?authenticated"?/i,
        'the table-level SELECT is no longer revoked — a column-level revoke alone does nothing, so the sensitive columns leak again.');
    assert.match(sql, /create or replace view "?public"?\."?listing_private"?/i,
        'listing_private view is gone — the owner has no way to read their own sensitive columns.');
    for (const col of ['street_address', 'ical_token', 'commission_rate', 'latitude', 'longitude', 'postcode']) {
        // the sensitive columns must NOT appear in the authenticated grant list
        const grantList = (sql.match(/grant select \(([^)]*)\) on "?public"?\."?listings"?/i) || [])[1] || '';
        assert.ok(!new RegExp('\\b' + col + '\\b').test(grantList),
            col + ' is back in authenticated\'s SELECT allow-list — it must stay owner-only via listing_private.');
    }
});

test('the four owner reads still go through listing_private, not listings', () => {
    const readers: [string, RegExp][] = [
        ['app/edit-listing/[id]/page.tsx', /from\('listing_private'\)\s*\.select\('\*'\)/],
        ['app/account/page.tsx', /from\('listing_private'\)\.select\('\*'\)\.eq\('host_id'/],
        ['app/services/[trade]/page.tsx', /from\('listing_private'\)/],
    ];
    for (const [file, re] of readers) {
        assert.match(read(file), re,
            file + ' no longer reads its own listing through listing_private — it will 401 on the revoked columns, or leak them if the revoke is reverted.');
    }
    // addhome reads its draft through the view too
    assert.match(read('app/addhome/page.tsx'), /from\('listing_private'\)/,
        'addhome no longer loads its draft through listing_private.');
});
