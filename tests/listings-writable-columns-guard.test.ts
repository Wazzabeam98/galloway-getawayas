// A new column on `listings` must not quietly inherit the wrong answer about
// whether a host may write it. Same shape as no-star-select-on-listings: the two
// lists below ARE the decision, made once, in writing. A column that is neither
// host-writable nor declared platform-only fails the guard by name.
//
// HOST_WRITABLE mirrors the UPDATE allow-list granted to `authenticated` in
// 20260903161233 — the columns addhome and account write directly. PLATFORM_ONLY
// is everything else: set by the platform (service role), the admin tools, a
// trigger, or computed — never by a browser UPDATE. The static half checks the
// two lists are disjoint and that HOST_WRITABLE matches the migration's grant;
// the DB half (pre-push, where a TEST project is configured) checks they exactly
// cover the live columns, so a column added later lands in neither and fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

// The host edits these directly (addhome wizard + account toggles).
const HOST_WRITABLE = new Set([
    'title', 'description', 'location', 'street_address', 'postcode', 'property_type',
    'privacy_type', 'bedrooms', 'beds', 'bathrooms', 'amenities', 'images', 'latitude',
    'longitude', 'price_per_night', 'max_guests', 'new_listing_promo', 'last_minute_discount',
    'weekly_discount', 'monthly_discount', 'check_in_method', 'check_in_time', 'check_in_end_time',
    'check_out_time', 'instant_book', 'instant_book_requires_phone', 'stl_licence_status',
    'stl_licence_number', 'stl_licence_expiry', 'host_id', 'status',
]);

// Everything else on listings: the platform sets it, never a browser UPDATE.
// The value is the reason — the decision, in writing.
const PLATFORM_ONLY: Record<string, string> = {
    id: 'primary key', created_at: 'set once', approved_at: 'moderation verdict (admin)',
    declined_at: 'moderation verdict (admin)', commission_rate: 'the platform cut (admin tool)',
    ical_token: 'private calendar-export secret (server-generated)',
    rating_avg: 'computed from reviews', rating_count: 'computed from reviews',
    rating_accuracy: 'computed from reviews', rating_checkin: 'computed from reviews',
    rating_cleanliness: 'computed from reviews', rating_communication: 'computed from reviews',
    rating_location: 'computed from reviews', rating_value: 'computed from reviews',
    review_note: 'moderation note', approx_latitude: 'derived from latitude',
    approx_longitude: 'derived from longitude',
    // written by the host but through /api/listings/save (service role), never a direct browser UPDATE:
    cleaning_fee: 'editor via service route', damage_deposit: 'editor via service route',
    pet_fee: 'editor via service route', extra_guest_fee: 'editor via service route',
    extra_guest_after: 'editor via service route', extra_guest_period: 'editor via service route',
    min_nights: 'editor via service route', max_nights: 'editor via service route',
    advance_notice: 'editor via service route', preparation_time: 'editor via service route',
    availability_window: 'editor via service route', cancellation_policy: 'editor via service route',
    non_refundable_option: 'editor via service route', additional_rules: 'editor via service route',
    events_allowed: 'editor via service route', smoking_allowed: 'editor via service route',
    commercial_photography_allowed: 'editor via service route', nearby: 'editor via service route',
    quiet_hours_enabled: 'editor via service route', quiet_hours_start: 'editor via service route',
    quiet_hours_end: 'editor via service route', plot_band: 'editor via service route',
    storey_band: 'editor via service route', weekend_price: 'editor via service route',
    instant_book_requires_verified_id: 'editor via service route',
    ical_import_url: 'editor via service route', checkin_start: 'legacy', checkin_end: 'legacy',
    checkout_time: 'legacy',
};

test('host-writable and platform-only lists are disjoint', () => {
    const overlap = [...HOST_WRITABLE].filter((c) => c in PLATFORM_ONLY);
    assert.deepEqual(overlap, [], 'a column is in BOTH lists — decide which: ' + overlap.join(', '));
});

test('HOST_WRITABLE matches the UPDATE grant in the migration', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20260903161233_listings_update_is_an_allow_list.sql'), 'utf8');
    const grant = (sql.match(/grant update \(([\s\S]*?)\) on/i) || [])[1] || '';
    const granted = new Set([...grant.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
    const onlyInTest = [...HOST_WRITABLE].filter((c) => !granted.has(c));
    const onlyInGrant = [...granted].filter((c) => !HOST_WRITABLE.has(c));
    assert.deepEqual(onlyInTest, [], 'in HOST_WRITABLE but not granted UPDATE: ' + onlyInTest.join(', '));
    assert.deepEqual(onlyInGrant, [], 'granted UPDATE but not in HOST_WRITABLE: ' + onlyInGrant.join(', '));
});

// DB half — only where a TEST Supabase is configured (pre-push, local). Skips in CI.
function envHasTestDb(): boolean {
    try {
        const t = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
        return /SUPABASE_TEST_DB_URL=.+yefoqcabuijcowoqewtc/.test(t);
    } catch { return false; }
}

test('every live listings column is classified — a new one forces a decision',
    { skip: envHasTestDb() ? false : 'no TEST db configured — static lists still checked' },
    async () => {
        const pg = require('pg');
        const url = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')
            .find((l: string) => l.startsWith('SUPABASE_TEST_DB_URL='))!.slice('SUPABASE_TEST_DB_URL='.length).trim();
        const client = new pg.Client({ connectionString: url });
        await client.connect();
        let cols: string[];
        try {
            cols = (await client.query("select column_name from information_schema.columns where table_name='listings' and table_schema='public'")).rows.map((r: any) => r.column_name);
        } finally { await client.end(); }
        const unclassified = cols.filter((c) => !HOST_WRITABLE.has(c) && !(c in PLATFORM_ONLY));
        assert.deepEqual(
            unclassified, [],
            'These listings columns are in neither HOST_WRITABLE nor PLATFORM_ONLY — decide whether a\n'
            + 'host may write each (add to the UPDATE grant + HOST_WRITABLE, or to PLATFORM_ONLY with a reason):\n  '
            + unclassified.join('\n  ')
        );
    });
