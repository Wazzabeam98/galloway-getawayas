-- One service order per Stripe PaymentIntent.
--
-- The request path holds a card at Checkout and the order row is born from the
-- checkout.session.completed webhook. When that webhook never lands, the cron
-- reconcile sweep rebuilds the order from Stripe instead. Both create the row
-- through the same function (lib/requestOrder.ts), which is idempotent on the
-- held PaymentIntent — it looks for an existing row before inserting. But a
-- sweep pass and a finally-arriving webhook can reach the same session in the
-- same instant, each past its own SELECT before either INSERTs.
--
-- This index is the backstop the slot path leans on the DB for too: the
-- database, not a read that can be raced, guarantees one order per PaymentIntent.
-- The loser of the race gets a clean 23505, which lib/requestOrder.ts reads as
-- "already created" — no duplicate booking, no second provider email, no double
-- capture — rather than two rows for one held card.
--
-- Partial, on non-null only: a 'holding' slot row and a genuinely unpaid order
-- both carry a null stripe_payment_intent_id until a webhook writes one, and
-- NULL is distinct from NULL in a unique index, so those rows are unaffected and
-- many can coexist.
--
-- Structural, loses no data. Safe to run twice.

create unique index if not exists service_orders_one_per_payment_intent
    on public.service_orders (stripe_payment_intent_id)
    where stripe_payment_intent_id is not null;
