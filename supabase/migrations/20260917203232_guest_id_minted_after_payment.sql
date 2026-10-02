-- A guest account can be minted AFTER payment, not required before booking.
--
-- WHY. Today every experience checkout is login-gated: service_orders.guest_id
-- is NOT NULL, and a slot's 'holding' order (written before Stripe, to claim the
-- seat) is stamped with the signed-in user's id. That forces a brand-new guest
-- to make an account BEFORE they can pay. We want the opposite: let them pay,
-- and mint the account from the details they already entered only once the money
-- has confirmed — so no account exists for someone who never paid, and a
-- returning guest lands back on the one profile (matched on their email).
--
-- WHAT CHANGES. guest_id becomes NULLABLE, so a 'holding' slot order can exist
-- with no owner while it waits for payment. The webhook (and the reconciling
-- sweep) resolve-or-create the guest and backfill guest_id at the moment the
-- order becomes 'confirmed'. The contact typed at checkout is already captured
-- in the existing snapshot columns (guest_name / guest_phone / guest_email), so
-- nothing new is stored to carry a guest across the gap.
--
-- THE GUARD. A null owner is only ever legitimate for an order that has not been
-- paid: a live seat being held ('holding'), or one released unpaid ('expired').
-- Any order that reached a paid/confirmed state MUST have an owner — that is the
-- invariant this CHECK pins. It also forces the paid-recovery path in
-- cron/service-orders (which confirms a hold Stripe took money for but the
-- webhook missed) to mint the guest before it can flip the row to 'confirmed',
-- closing what would otherwise be an ownerless paid order.
--
-- SAFE ON EXISTING ROWS. Every current row has a guest_id (the column was NOT
-- NULL), so both the DROP NOT NULL and the new CHECK hold for all of them; the
-- constraint only ever bites a row created null under the new flow.

alter table "public"."service_orders"
    alter column "guest_id" drop not null;

alter table "public"."service_orders"
    add constraint "service_orders_guest_present_once_paid"
    check ("guest_id" is not null or "status" in ('holding', 'expired'));

-- PostgREST caches the schema; nudge it so the relaxed column is seen at once.
notify pgrst, 'reload schema';

-- Read back:
--   select is_nullable from information_schema.columns
--    where table_name='service_orders' and column_name='guest_id';
--   -- expect: YES
--
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.service_orders'::regclass
--      and conname = 'service_orders_guest_present_once_paid';
--   -- expect: CHECK (guest_id IS NOT NULL OR status IN ('holding','expired'))
