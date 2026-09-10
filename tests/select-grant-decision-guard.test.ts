// A new column on a column-grant table must not quietly inherit the wrong answer
// about whether a signed-in user (the `authenticated` role) may READ it.
//
// In 20260828202340 service_providers switched from a table SELECT grant to a
// column allow-list (revoke the table, grant named columns). profiles is the
// same shape. That was the right move for privacy — but nothing made *adding a
// column* force a grant decision, so four later migrations added columns and
// never touched the allow-list. The browser 403'd on them; the provider sign-up
// wizard, reading its own record, rendered a blank form over a real one. This
// guard closes that cause: the two maps below ARE the decision, made once, in
// writing. GRANTED lists the columns a signed-in user may SELECT; REVOKED lists
// every column that stays server-role-only, each with the reason it is private.
// A column that is in neither fails the DB half by name — so the next column
// added can't land without someone deciding, and recording why.
//
// The reason strings on REVOKED are the whole point: they are the privacy intent
// this table's schema no longer states on its own. Keep them true.
//
// GRANTED records the *current* grant, not a re-audit of it: this guard forces a
// decision on new columns, it does not re-litigate columns already granted. A
// read-side audit of whether each granted column should be readable is separate.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

type TableDecision = {
    table: string;
    granted: Set<string>;
    revoked: Record<string, string>;
};

const TABLES: TableDecision[] = [
    {
        table: 'service_providers',
        // A signed-in user may SELECT these. The provider sign-up wizard reads
        // its own record back through most of them (RLS still limits WHICH rows);
        // the listing and public reads go through the service role.
        granted: new Set([
            'approved_at', 'approved_digest', 'audience', 'billable_hourly_rate', 'business_name',
            'callout_fee', 'callout_waived', 'changes_pending_at', 'commission_rate', 'covered_bands',
            'created_at', 'custom_label', 'declarations', 'declined_at', 'description', 'dietary_note',
            'does_gas', 'does_oil', 'guest_details', 'headshot', 'hourly_rate', 'id', 'kind',
            'fulfilment', 'lead_time_days', 'logo', 'notify_user_ids', 'owner_id', 'photos', 'plan', 'pricing_choice',
            'review_note', 'settlement', 'shape', 'slot_capacity', 'slot_length_minutes', 'sms_opt_out',
            'status', 'submitted_at', 'subscription_status', 'trade', 'trial_ends_at', 'updated_at',
        ]),
        revoked: {
            based_line: 'server-derived display line; the wizard dropped it from its select — unread by any browser',
            provider_name: 'retired with the "Your name" step; dropped from the wizard select — unread by any browser',
            category_assigned_at: 'admin audit — when the category was assigned; no provider reads it',
            category_assigned_by: 'admin audit — who assigned the category; no provider reads it',
            cancellation_window_hours: 'booking rule read only via the service role in the order/booking routes',
            exclusive_per_date: 'booking rule read only via the service role in the order/booking routes',
            experience_price: 'legacy price column; unread anywhere',
            collection_street: 'the provider’s collection/pickup street line; private, released only server-side on a confirmed (paid) order — never anon/authenticated; the owner reads their own back via the provider_private view',
            collection_town: 'the town of the collection address; private on the table (owner reads it back via provider_private); its public copy is based_line, which the wizard writes from it — the column itself is never guest-readable',
            collection_postcode: 'the provider’s collection/pickup postcode; private, released only server-side on a confirmed (paid) order — never anon/authenticated; the owner reads their own back via the provider_private view',
            contact_email: 'private contact detail — revoked in 20260828202340 (contact details are not public)',
            contact_phone: 'private contact detail — revoked in 20260828202340 (contact details are not public)',
            billing_token_hash: 'secret hash for billing links; server-role only',
            reminders_sent: 'server-side reminder bookkeeping',
            stripe_account_id: 'Stripe connected-account id; server-role only',
            stripe_customer_id: 'Stripe customer id; server-role only',
            stripe_subscription_id: 'Stripe subscription id; server-role only',
            stripe_charges_enabled: 'Stripe account state; server-role only',
            stripe_payouts_enabled: 'Stripe account state; server-role only',
            stripe_details_submitted: 'Stripe onboarding state; server-role only',
            stripe_requirements_due: 'Stripe onboarding requirements; server-role only',
            stripe_mcc: 'Stripe merchant category code; server-role only',
            stripe_product_description: 'Stripe product metadata; server-role only',
            stripe_updated_at: 'Stripe sync timestamp; server-role only',
        },
    },
    {
        table: 'profiles',
        granted: new Set([
            'avatar_url', 'created_at', 'full_name', 'host_bio', 'id', 'identity_verified',
            'identity_verified_at', 'is_admin', 'is_host', 'preferred_name', 'show_full_name',
            'trading_name', 'welcome_message', 'welcome_message_enabled',
        ]),
        revoked: {
            email: 'private contact detail — not public',
            phone: 'private contact detail — not public',
            residential_address: 'private PII — not public',
            payout_balance_owed: 'money owed to the platform; server/admin only',
            stripe_account_id: 'Stripe connected-account id; server-role only',
            stripe_charges_enabled: 'Stripe account state; server-role only',
            stripe_payouts_enabled: 'Stripe account state; server-role only',
            stripe_details_submitted: 'Stripe onboarding state; server-role only',
            stripe_requirements_due: 'Stripe onboarding requirements; server-role only',
            stripe_updated_at: 'Stripe sync timestamp; server-role only',
        },
    },
];

// Static half — runs everywhere, including the web-editor paste path: the two
// buckets must never overlap (a column can't be both readable and private).
for (const { table, granted, revoked } of TABLES) {
    test(`${table}: granted and revoked buckets are disjoint`, () => {
        const overlap = [...granted].filter((c) => c in revoked);
        assert.deepEqual(overlap, [], `a ${table} column is in BOTH buckets — decide which: ${overlap.join(', ')}`);
    });

    test(`${table}: every revoked column carries a reason`, () => {
        const blank = Object.entries(revoked).filter(([, why]) => !why || !why.trim()).map(([c]) => c);
        assert.deepEqual(blank, [], `these ${table} columns are revoked with no written reason: ${blank.join(', ')}`);
    });
}

// DB half — only where a TEST Supabase is configured (pre-push, local, CI-against-
// test). This is the gate: it reads the live schema and grants so a column added
// later that no one bucketed fails by name, and a decision that diverges from the
// live grant (a stripe column accidentally granted, business_name revoked) fails too.
function testDbUrl(): string | null {
    try {
        const line = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')
            .find((l: string) => l.startsWith('SUPABASE_TEST_DB_URL='));
        return line ? line.slice('SUPABASE_TEST_DB_URL='.length).trim() : null;
    } catch { return null; }
}

for (const { table, granted, revoked } of TABLES) {
    const url = testDbUrl();
    test(`${table}: every live column has a SELECT-grant decision, and it matches the live grant`,
        { skip: url ? false : 'no TEST db configured — static buckets still checked' },
        async () => {
            const pg = require('pg');
            const client = new pg.Client({ connectionString: url });
            await client.connect();
            let cols: string[];
            let liveGranted: Set<string>;
            try {
                cols = (await client.query(
                    "select column_name from information_schema.columns where table_name=$1 and table_schema='public'",
                    [table],
                )).rows.map((r: any) => r.column_name);
                liveGranted = new Set((await client.query(
                    "select column_name from information_schema.column_privileges where table_name=$1 and grantee='authenticated' and privilege_type='SELECT'",
                    [table],
                )).rows.map((r: any) => r.column_name));
            } finally { await client.end(); }

            // (1) every live column is bucketed — a new one forces a decision
            const unclassified = cols.filter((c) => !granted.has(c) && !(c in revoked));
            assert.deepEqual(
                unclassified, [],
                `These ${table} columns are in neither GRANTED nor REVOKED — decide whether a signed-in\n`
                + `user may read each (add to the allow-list migration + GRANTED, or to REVOKED with a reason):\n  `
                + unclassified.join('\n  '),
            );

            // (2) the decision matches reality — divergence in either direction is loud
            const shouldBeGrantedButIsnt = [...granted].filter((c) => cols.includes(c) && !liveGranted.has(c));
            assert.deepEqual(
                shouldBeGrantedButIsnt, [],
                `These ${table} columns are in GRANTED but authenticated cannot SELECT them live — the grant\n`
                + `migration is missing or was reverted:\n  ` + shouldBeGrantedButIsnt.join('\n  '),
            );
            const revokedButLiveGranted = Object.keys(revoked).filter((c) => liveGranted.has(c));
            assert.deepEqual(
                revokedButLiveGranted, [],
                `These ${table} columns are marked REVOKED (private) but authenticated CAN SELECT them live —\n`
                + `a grant leaked them; revoke it, or move the column to GRANTED if the read is intended:\n  `
                + revokedButLiveGranted.join('\n  '),
            );
        });
}
