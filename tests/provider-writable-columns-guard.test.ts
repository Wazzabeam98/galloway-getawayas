// A new column on `service_providers` must not quietly inherit the wrong answer
// about whether a signed-in provider (the `authenticated` role) may WRITE it.
//
// This is the write-side twin of select-grant-decision-guard, and the exact
// counterpart of listings-writable-columns-guard for the provider table. In
// 20260828202340 service_providers switched from a table grant to a column
// allow-list. The SELECT gap that caused (columns added later, never granted)
// was swept on 9 September; the WRITE gap was not, and a signed-in guest editing
// their own listing hit "permission denied for table service_providers" — the
// UPDATE touched columns (shape, the slot fields, the dietary note, the
// terms-acceptance jsonb) that `authenticated` had no INSERT/UPDATE on, so the
// whole statement was refused and the edit saved nothing.
//
// The two lists below ARE the decision, in writing. PROVIDER_WRITABLE is every
// column a browser may INSERT/UPDATE (RLS still limits WHICH row —
// owner_id = auth.uid()); PLATFORM_ONLY is everything else, set by the service
// role, the admin tools, a trigger, or computed — never a browser write. The
// static half checks the two lists are disjoint and cover nothing twice; the DB
// half (wherever a TEST project is configured — pre-push, local, or CI once the
// secret is wired) checks they exactly cover the live columns and match the live
// INSERT and UPDATE grants, so a column added later lands in neither and fails by
// name, and a grant that leaks a platform column fails too.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDbUrl, withTestDb, liveColumns, columnsGrantedTo } from './_testDb';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

// A signed-in provider writes these to their own row (the sign-up/edit wizard's
// service_providers UPDATE/INSERT). Contact details and based_line are written
// here even though their READ goes through a view/service role — write and read
// are separate decisions.
const PROVIDER_WRITABLE = new Set([
    'audience', 'based_line', 'billable_hourly_rate', 'business_name', 'callout_fee',
    'callout_waived', 'collection_postcode', 'collection_street', 'collection_town',
    'contact_email', 'contact_phone', 'covered_bands', 'custom_label', 'declarations',
    'description', 'dietary_note', 'does_emergency', 'does_gas', 'does_oil', 'does_scheduled', 'exclusive_per_date',
    'experience_price', 'flat_fee', 'fulfilment', 'guest_details', 'headshot', 'hourly_rate',
    'lead_time_days', 'logo', 'photos', 'pricing_choice', 'provider_name',
    'provides_quote', 'registration_number',
    'shape', 'slot_capacity', 'slot_length_minutes', 'slot_min_people',
    'slot_turnaround_minutes', 'sms_opt_out',
    'trade', 'updated_at',
]);

// Set ONCE at sign-up and never changed afterwards: a signed-in provider may
// INSERT it (the row policy pins owner_id = auth.uid(), so they cannot hand the
// business to anyone else even at creation), but UPDATE is REVOKED and a BEFORE
// UPDATE trigger blocks any change. This is the C1 fix (AUDIT 2026-10-31): a
// listing co-host could set owner_id to themselves and seize the business +
// redirect its Stripe payouts. INSERT-grantable, never UPDATE-grantable — if a
// later migration re-grants owner_id UPDATE, the DB half below fails by name.
const INSERT_ONLY: Record<string, string> = {
    owner_id: 'the business owner — set once at sign-up (INSERT, pinned owner_id = auth.uid()), never changed; UPDATE is revoked and a BEFORE UPDATE trigger (lock_service_providers_owner_id) refuses any change, so a listing co-host cannot seize the business (C1)',
};

// Everything else on service_providers: the platform sets it, never a browser
// write. The value is the reason — the decision, in writing. Keep them true.
const PLATFORM_ONLY: Record<string, string> = {
    vat_name: 'VAT registration (number + registered name); private to the owner, written/read by /api/account/vat with the service role only, published only via the booking/order supplier snapshot on that guest\'s receipt',
    vat_number: 'VAT registration (number + registered name); private to the owner, written/read by /api/account/vat with the service role only, published only via the booking/order supplier snapshot on that guest\'s receipt',
    vat_registered: 'VAT registration (number + registered name); private to the owner, written/read by /api/account/vat with the service role only, published only via the booking/order supplier snapshot on that guest\'s receipt',
    admin_hidden_at: 'admin take-down tombstone — set and cleared only by the admin provider-visibility route (service role); consulted server-side by isLiveToGuests/visibleInDirectory and by the public SELECT policy, never browser-read (mirrors owner_paused)',
    id: 'primary key',
    ical_token: 'system-generated calendar-export secret; never provider-written (default gen_random_uuid())',
    created_at: 'set once',
    kind: 'pricing shape — not the applicant’s to set; the column check refuses a bad row anyway',
    // Status / moderation lifecycle — a provider who could write status could approve
    // themselves. The one legit status write goes through submit_service_provider (SECURITY DEFINER).
    status: 'approval state — self-approval risk; written only via submit_service_provider',
    review_note: 'moderation note (admin/service role)',
    submitted_at: 'status lifecycle — set by submit_service_provider / service role',
    approved_at: 'moderation verdict (service role)',
    approved_digest: 'snapshot of the approved listing (service role)',
    declined_at: 'moderation verdict (service role)',
    changes_pending_at: 'set when an approved provider edits — service role',
    // Money / subscription — service role only.
    commission_rate: 'the platform cut (admin/service role)',
    settlement: 'payout settlement state (service role)',
    plan: 'subscription plan (billing/service role)',
    trial_ends_at: 'subscription trial end (billing/service role)',
    subscription_status: 'subscription state (billing webhook/service role)',
    billing_token_hash: 'secret hash for billing links; server-role only',
    // Admin audit — who/when a category was assigned (the label itself is custom_label, writable).
    category_assigned_at: 'admin audit — when the category was assigned',
    category_assigned_by: 'admin audit — who assigned the category',
    // The venue map point — geocoded by the server, never typed by a provider.
    venue_lat: 'venue map point, server-written from the collection postcode (lib/venuePoint.ts)',
    venue_lng: 'venue map point, server-written from the collection postcode (lib/venuePoint.ts)',
    show_precise_location: 'Location-sharing flag — written only through the provider editor\'s service-role save route (/api/services/listing/save, ownership-checked), never a browser write (mirrors listings.show_precise_location)',
    // Service-role booking rule and server bookkeeping.
    cancellation_window_hours: 'booking rule read/written only via the service role',
    delivery_fee: 'made-to-order delivery fee — written only via the listing editor\'s service-role route (ownership-checked), never a direct browser write',
    delivery_radius_miles: 'enforced delivery radius — written only via the listing editor\'s service-role route (ownership-checked), never a direct browser write',
    owner_paused: 'owner take-down flag — written only via the listing editor\'s service-role route (ownership-checked), never a direct browser write, so it is not in the write allow-list',
    deactivated_at: 'reversible deactivation tombstone — written only by the SECURITY DEFINER deactivate/reactivate routines, never a browser write',
    reminders_sent: 'server-side reminder bookkeeping',
    notify_user_ids: 'server-managed notify list',
    display_order: 'public display order for the experiences grid — set ONLY by the admin arrange route (/api/admin/arrange, is_admin + service role), never a browser write; granted to no browser role (the grid reads it via the service role)',
    // Stripe — every field is set by the connect/webhook flow under the service role.
    stripe_account_id: 'Stripe connected-account id; service role only',
    stripe_customer_id: 'Stripe customer id; service role only',
    stripe_subscription_id: 'Stripe subscription id; service role only',
    stripe_charges_enabled: 'Stripe account state; service role only',
    stripe_payouts_enabled: 'Stripe account state; service role only',
    stripe_details_submitted: 'Stripe onboarding state; service role only',
    stripe_requirements_due: 'Stripe onboarding requirements; service role only',
    stripe_mcc: 'Stripe merchant category code; service role only',
    stripe_product_description: 'Stripe product metadata; service role only',
    stripe_updated_at: 'Stripe sync timestamp; service role only',
};

test('provider-writable, insert-only and platform-only lists are disjoint', () => {
    const inWritableAndPlatform = [...PROVIDER_WRITABLE].filter((c) => c in PLATFORM_ONLY);
    const inWritableAndInsertOnly = [...PROVIDER_WRITABLE].filter((c) => c in INSERT_ONLY);
    const inInsertOnlyAndPlatform = Object.keys(INSERT_ONLY).filter((c) => c in PLATFORM_ONLY);
    const overlap = [...inWritableAndPlatform, ...inWritableAndInsertOnly, ...inInsertOnlyAndPlatform];
    assert.deepEqual(overlap, [], 'a column is in more than one list — decide which: ' + overlap.join(', '));
});

test('every platform-only and insert-only column carries a written reason', () => {
    const blank = [...Object.entries(PLATFORM_ONLY), ...Object.entries(INSERT_ONLY)]
        .filter(([, r]) => !String(r || '').trim()).map(([c]) => c);
    assert.deepEqual(blank, [], 'these columns have no reason: ' + blank.join(', '));
});

test('the write sweep migration grants exactly the columns it should', () => {
    const sql = fs.readFileSync(
        path.join(ROOT, 'supabase/migrations/20260912202042_sweep_the_service_providers_write_grants_for_owner_editable_.sql'),
        'utf8',
    );
    const block = (sql.match(/grant insert,\s*update\s*\(([\s\S]*?)\)\s*on/i) || [])[1] || '';
    const swept = new Set([...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
    // The nine this migration adds. Every one must be in PROVIDER_WRITABLE, and
    // none may be a PLATFORM_ONLY column.
    const notWritable = [...swept].filter((c) => !PROVIDER_WRITABLE.has(c));
    assert.deepEqual(notWritable, [], 'the sweep grants columns not in PROVIDER_WRITABLE: ' + notWritable.join(', '));
    const leakedPlatform = [...swept].filter((c) => c in PLATFORM_ONLY);
    assert.deepEqual(leakedPlatform, [], 'the sweep grants PLATFORM_ONLY columns: ' + leakedPlatform.join(', '));
});

// DB half — wherever a TEST Supabase is configured (CI's repo secret, or
// .env.local locally; see tests/_testDb.ts). Where neither exists the static
// lists still run; only the live-grant comparison is skipped.
const url = testDbUrl();
test('service_providers: every live column has a WRITE decision, matching the live INSERT and UPDATE grants',
    { skip: url ? false : 'no TEST db configured — static lists still checked' },
    async () => {
        const { cols, liveInsert, liveUpdate } = await withTestDb(url!, async (client) => ({
            cols: await liveColumns(client, 'service_providers'),
            liveInsert: await columnsGrantedTo(client, 'service_providers', 'authenticated', 'INSERT'),
            liveUpdate: await columnsGrantedTo(client, 'service_providers', 'authenticated', 'UPDATE'),
        }));

        // (1) every live column is bucketed — a new one forces a decision.
        const unclassified = cols.filter((c) => !PROVIDER_WRITABLE.has(c) && !(c in INSERT_ONLY) && !(c in PLATFORM_ONLY));
        assert.deepEqual(
            unclassified, [],
            'These service_providers columns are in none of PROVIDER_WRITABLE, INSERT_ONLY or PLATFORM_ONLY —\n'
            + 'decide whether a signed-in provider may write each (add to the grant sweep + PROVIDER_WRITABLE, to\n'
            + 'INSERT_ONLY if it is set once at creation, or to PLATFORM_ONLY with a reason):\n  ' + unclassified.join('\n  '),
        );

        // (2) the decision matches reality, in both directions. PROVIDER_WRITABLE
        // is INSERT- and UPDATE-grantable; INSERT_ONLY (owner_id) is INSERT-grantable
        // but never UPDATE-grantable — the C1 lock — and PLATFORM_ONLY is neither.
        const expected = {
            INSERT: new Set([...PROVIDER_WRITABLE, ...Object.keys(INSERT_ONLY)]),
            UPDATE: PROVIDER_WRITABLE,
        } as const;
        const forbidden = {
            INSERT: new Set(Object.keys(PLATFORM_ONLY)),
            UPDATE: new Set([...Object.keys(PLATFORM_ONLY), ...Object.keys(INSERT_ONLY)]),
        } as const;
        for (const [priv, live] of [['INSERT', liveInsert], ['UPDATE', liveUpdate]] as const) {
            const expectedButNotGranted = [...expected[priv]].filter((c) => cols.includes(c) && !live.has(c));
            assert.deepEqual(
                expectedButNotGranted, [],
                `These columns should be ${priv}-grantable to authenticated but are not live — the grant\n`
                + `migration is missing or was reverted:\n  ` + expectedButNotGranted.join('\n  '),
            );
            const forbiddenButGranted = [...forbidden[priv]].filter((c) => live.has(c));
            assert.deepEqual(
                forbiddenButGranted, [],
                `These columns must NOT be ${priv}-grantable to authenticated but CAN be written live — a grant\n`
                + `leaked them (for owner_id this is the C1 seizure hole); revoke it, or re-bucket the column:\n  `
                + forbiddenButGranted.join('\n  '),
            );
        }
    });
