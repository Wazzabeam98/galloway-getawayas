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
    'description', 'dietary_note', 'does_gas', 'does_oil', 'exclusive_per_date',
    'experience_price', 'fulfilment', 'guest_details', 'headshot', 'hourly_rate',
    'lead_time_days', 'logo', 'owner_id', 'photos', 'pricing_choice', 'provider_name',
    'shape', 'slot_capacity', 'slot_length_minutes', 'slot_min_people', 'sms_opt_out',
    'trade', 'updated_at',
]);

// Everything else on service_providers: the platform sets it, never a browser
// write. The value is the reason — the decision, in writing. Keep them true.
const PLATFORM_ONLY: Record<string, string> = {
    id: 'primary key',
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
    // Service-role booking rule and server bookkeeping.
    cancellation_window_hours: 'booking rule read/written only via the service role',
    reminders_sent: 'server-side reminder bookkeeping',
    notify_user_ids: 'server-managed notify list',
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

test('provider-writable and platform-only lists are disjoint', () => {
    const overlap = [...PROVIDER_WRITABLE].filter((c) => c in PLATFORM_ONLY);
    assert.deepEqual(overlap, [], 'a column is in BOTH lists — decide which: ' + overlap.join(', '));
});

test('every platform-only column carries a written reason', () => {
    const blank = Object.entries(PLATFORM_ONLY).filter(([, r]) => !String(r || '').trim()).map(([c]) => c);
    assert.deepEqual(blank, [], 'these columns are platform-only with no reason: ' + blank.join(', '));
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

// DB half — wherever a TEST Supabase is configured. Reads SUPABASE_TEST_DB_URL
// from the process environment first (so CI can supply it as a secret) and falls
// back to .env.local (local + pre-push). Where neither exists the static lists
// still run; only the live-grant comparison is skipped.
function testDbUrl(): string | null {
    if (process.env.SUPABASE_TEST_DB_URL && process.env.SUPABASE_TEST_DB_URL.trim()) {
        return process.env.SUPABASE_TEST_DB_URL.trim();
    }
    try {
        const line = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')
            .find((l: string) => l.startsWith('SUPABASE_TEST_DB_URL='));
        return line ? line.slice('SUPABASE_TEST_DB_URL='.length).trim() : null;
    } catch { return null; }
}

const url = testDbUrl();
test('service_providers: every live column has a WRITE decision, matching the live INSERT and UPDATE grants',
    { skip: url ? false : 'no TEST db configured — static lists still checked' },
    async () => {
        const pg = require('pg');
        const client = new pg.Client({ connectionString: url });
        await client.connect();
        let cols: string[];
        let liveInsert: Set<string>;
        let liveUpdate: Set<string>;
        try {
            cols = (await client.query(
                "select column_name from information_schema.columns where table_name='service_providers' and table_schema='public'",
            )).rows.map((r: any) => r.column_name);
            const grantsFor = async (priv: string): Promise<Set<string>> => new Set<string>((await client.query(
                "select column_name from information_schema.column_privileges where table_name='service_providers' and grantee='authenticated' and privilege_type=$1",
                [priv],
            )).rows.map((r: any) => String(r.column_name)));
            liveInsert = await grantsFor('INSERT');
            liveUpdate = await grantsFor('UPDATE');
        } finally { await client.end(); }

        // (1) every live column is bucketed — a new one forces a decision.
        const unclassified = cols.filter((c) => !PROVIDER_WRITABLE.has(c) && !(c in PLATFORM_ONLY));
        assert.deepEqual(
            unclassified, [],
            'These service_providers columns are in neither PROVIDER_WRITABLE nor PLATFORM_ONLY — decide\n'
            + 'whether a signed-in provider may write each (add to the grant sweep + PROVIDER_WRITABLE, or to\n'
            + 'PLATFORM_ONLY with a reason):\n  ' + unclassified.join('\n  '),
        );

        // (2) the decision matches reality, in both directions, for INSERT and UPDATE.
        for (const [priv, live] of [['INSERT', liveInsert], ['UPDATE', liveUpdate]] as const) {
            const writableButNotGranted = [...PROVIDER_WRITABLE].filter((c) => cols.includes(c) && !live.has(c));
            assert.deepEqual(
                writableButNotGranted, [],
                `These columns are in PROVIDER_WRITABLE but authenticated cannot ${priv} them live — the grant\n`
                + `migration is missing or was reverted:\n  ` + writableButNotGranted.join('\n  '),
            );
            const platformButGranted = Object.keys(PLATFORM_ONLY).filter((c) => live.has(c));
            assert.deepEqual(
                platformButGranted, [],
                `These columns are marked PLATFORM_ONLY but authenticated CAN ${priv} them live — a grant leaked\n`
                + `them; revoke it, or move the column to PROVIDER_WRITABLE if the write is intended:\n  `
                + platformButGranted.join('\n  '),
            );
        }
    });
