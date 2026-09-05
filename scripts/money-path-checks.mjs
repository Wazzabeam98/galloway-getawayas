// The money-path migrations, and a read-only --check that proves each one is
// applied. These are the eleven the 1 Sept backfill left in the ledger as
// ASSUMPTIONS (backfilled, no checksum) — the ones whose correct application
// underpins payouts, refunds, double-booking and the money guards.
//
// A --check is a read-only query that returns ONE truthy value when the
// migration's effect is present in the schema. Attach one to the existing ledger
// row with:
//
//   node scripts/migrate.mjs --target prod <file> \
//     --record --note "<why>" --check "<the check>"
//
// migrate.mjs runs the check first; it only writes if the check passes, and
// --status re-runs it forever after. Run this file directly to print the exact
// command for each, for a target (it RUNS NOTHING):
//
//   node scripts/money-path-checks.mjs --target prod
//
// A note on what is NOT here: the 1 Sept backfill also left five DATA-only
// migrations as assumptions (a flag backfill, a subscription config, storage
// limits, a trial-timing change, and a one-time DELETE of test rows). A one-time
// DELETE cannot be proven after the fact — "gone" is indistinguishable from
// "never inserted" — so it stays an honest legacy assumption rather than carry a
// check that pretends otherwise. None of the five touches money.

export const MONEY_PATH_CHECKS = [
    {
        file: '20260831120000_host_debt_moves_atomically.sql',
        note: 'payout clamp AND lockdown: adjust_payout_balance is SECURITY DEFINER, does greatest(0, round(...)), and is not executable by anon or authenticated',
        // Both halves of this migration in one check: a clamped function a
        // signed-in stranger can call is still a hole. `has_function_privilege`
        // is used (not aclexplode) because it correctly accounts for PUBLIC
        // grants and defaults. Whitespace-tolerant on the clamp — the function
        // text is `greatest(\n  0`, so a naive like '%greatest(0%' gives a FALSE
        // fail; a wrong check is its own footgun.
        check: "select coalesce(bool_and(p.prosecdef and pg_get_functiondef(p.oid) ~ 'greatest\\(\\s*0' and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')), false) from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public' where p.proname = 'adjust_payout_balance'",
    },
    {
        file: '20260901000000_a_payout_transfer_is_recorded_once.sql',
        note: 'payout idempotency: one payout row per Stripe transfer',
        check: "select count(*) > 0 from pg_indexes where schemaname = 'public' and indexname = 'payouts_one_row_per_transfer'",
    },
    {
        file: '20260829090000_payments_one_row_per_intent.sql',
        note: 'payment idempotency: one payment row per payment intent',
        check: "select count(*) > 0 from pg_indexes where schemaname = 'public' and indexname = 'payments_one_row_per_intent'",
    },
    {
        file: '20260821030318_no_overlapping_confirmed_bookings.sql',
        note: 'no double-booking: the gist exclusion constraint on confirmed bookings',
        check: "select count(*) > 0 from pg_constraint where conname = 'bookings_no_overlapping_confirmed' and contype = 'x'",
    },
    {
        file: '20260829011000_a_booking_cannot_arrive_paid.sql',
        note: 'a booking cannot arrive paid: anon holds no table-level INSERT/UPDATE on bookings',
        check: "select count(*) = 0 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'bookings' and grantee = 'anon' and privilege_type in ('INSERT','UPDATE')",
    },
    {
        file: '20260828234004_bookings_revoke_public_read.sql',
        note: 'bookings are not publicly readable: anon holds no SELECT on bookings',
        check: "select count(*) = 0 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'bookings' and grantee = 'anon' and privilege_type = 'SELECT'",
    },
    {
        file: '20260822203006_cancellation_record_and_debt_settlement.sql',
        note: 'cancellation record: bookings.cancelled_at column present',
        check: "select count(*) > 0 from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name = 'cancelled_at'",
    },
    {
        file: '20260822231427_disputes.sql',
        note: 'disputes table present',
        check: "select to_regclass('public.disputes') is not null",
    },
    {
        file: '20260831150000_enquiry_cancellation.sql',
        note: 'enquiry cancellation: the service_enquiries status check constraint',
        check: "select count(*) > 0 from pg_constraint where conname = 'service_enquiries_status_check'",
    },
    {
        file: '20260828120000_bookings_cleaning_fee.sql',
        note: 'bookings.cleaning_fee column present',
        check: "select count(*) > 0 from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name = 'cleaning_fee'",
    },
    {
        file: '20260828234002_bookings_busy_nights_view.sql',
        note: 'the public availability view listing_busy_nights present',
        check: "select to_regclass('public.listing_busy_nights') is not null",
    },
];

// Run directly to print the commands (runs nothing).
if (import.meta.url === `file://${process.argv[1]}`) {
    const t = process.argv.includes('--target') ? process.argv[process.argv.indexOf('--target') + 1] : 'prod';
    console.log('\n  ' + MONEY_PATH_CHECKS.length + ' money-path checks for --target ' + t
        + ' — run one at a time, read each result:\n');
    for (const c of MONEY_PATH_CHECKS) {
        console.log('# ' + c.note);
        console.log('node scripts/migrate.mjs --target ' + t + ' supabase/migrations/' + c.file + ' \\');
        console.log('  --record --note ' + JSON.stringify(c.note) + ' \\');
        console.log('  --check ' + JSON.stringify(c.check) + '\n');
    }
}
