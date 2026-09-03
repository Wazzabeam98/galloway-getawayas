// Guard for the may_read_listing status fix (planted booking must not keep
// reading a listing the host has taken down). Static so it runs in CI and the
// web-editor paste path: the two status guards must stay in the migration that
// last (re)defined the function.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

test('may_read_listing still ignores planted bookings and revoked co-hosts', () => {
    const file = 'supabase/migrations/20260903152233_may_read_listing_ignores_planted_bookings.sql';
    const sql = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\s+/g, ' ');
    assert.match(
        sql, /b\.status\s*<>\s*'pending_payment'/,
        file + ' no longer excludes planted pending_payment bookings from may_read_listing — '
        + 'a stale planted row can keep reading a hidden listing again.'
    );
    assert.match(
        sql, /la\.status\s*=\s*'active'/,
        file + ' no longer requires an ACTIVE co-host — a revoked listing_access row keeps listing read.'
    );
});
