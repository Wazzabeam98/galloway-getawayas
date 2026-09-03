-- payments and payouts are written ONLY by the platform (the Stripe webhook and
-- the payout cron, under the service role). Yet both carry table-level
-- INSERT/UPDATE grants to BOTH `anon` and `authenticated` on every column —
-- amount, settled_amount, status, host_id, stripe_transfer_id,
-- stripe_payment_intent_id, the lot (verified on test 2026-09-03).
--
-- It is not exploitable TODAY only because RLS is on and neither table has a
-- write policy — just a SELECT policy — so PostgREST denies the writes. That is
-- the whole safety margin: one `create policy ... for insert` on either table,
-- added for some unrelated reason, and a browser could mint a payout to itself or
-- rewrite a payment's amount. The grant should state the intent so a future
-- policy cannot silently open a money table.
--
-- Revoke the writes from the browser roles. SELECT is left as it is (guests and
-- hosts read their own payments; payouts are admin-read) — this touches only
-- INSERT/UPDATE. The service role holds its own grants and is unaffected, so the
-- webhook and the payout cron keep writing exactly as before.
--
-- No application code writes these tables as anon/authenticated (every writer is
-- adminClient/service role — verified), so nothing legitimate depends on the
-- grant. Pure defence-in-depth tightening; lands on production on its own.

revoke insert, update, delete on "public"."payments" from "anon", "authenticated";
revoke insert, update, delete on "public"."payouts" from "anon", "authenticated";

-- Read back — no INSERT/UPDATE/DELETE for the browser roles on either table:
--   select table_name, grantee, privilege_type from information_schema.role_table_grants
--    where table_name in ('payments','payouts') and grantee in ('anon','authenticated')
--      and privilege_type in ('INSERT','UPDATE','DELETE');
--   -- expected: no rows
