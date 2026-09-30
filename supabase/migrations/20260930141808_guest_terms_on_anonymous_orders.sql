-- guest terms on anonymous standalone orders
--
-- WHAT THIS IS FOR, AND WHAT GOES WRONG WITHOUT IT.
--
-- A guest buying a standalone experience without signing in ticks the Guest
-- Terms at checkout, but has no account to record the acceptance against — their
-- account is minted from the Stripe payer email only after payment (the webhook
-- / the reconcile sweep). So the acceptance is carried on the order: the version
-- they were shown, and the checkout time they ticked it. The moment the account
-- is minted the acceptance is written against it (agreement_acceptances) with
-- this version and this time — not the account-creation time. If the account is
-- never minted, the fact stays here on the order, so we can always show what the
-- guest agreed to.
--
-- These mirror the notice columns already on the table (lta_notice_*,
-- package_notice_*): a version and a timestamp, written only by the server with
-- the service role — the slot book route directly on the held order, and the
-- request/cart path through lib/requestOrder.ts from the Stripe session's
-- server-written metadata. service_orders has no grant to anon or authenticated,
-- so the browser can neither read nor write these; no grant is added here.
--
-- Both are null when there is nothing to carry: a signed-in booker (recorded
-- through /api/agreements before the order), or a guest who already agreed. As the
-- order routes' insert names these columns, this must reach production BEFORE
-- the code that writes them.
--
-- PRE-FLIGHT: none needed — two nullable columns, no default, no rewrite.

ALTER TABLE public.service_orders
    ADD COLUMN IF NOT EXISTS guest_terms_version text,
    ADD COLUMN IF NOT EXISTS guest_terms_accepted_at timestamptz;

COMMENT ON COLUMN public.service_orders.guest_terms_version IS
    'For an anonymous standalone booker: the Guest Terms version they ticked at checkout (lib/agreements.AGREEMENTS.guest.version), carried until the account is minted from the Stripe payer email and recorded against it. Null when it did not apply (signed-in booker, or already agreed).';
COMMENT ON COLUMN public.service_orders.guest_terms_accepted_at IS
    'When the anonymous booker ticked the Guest Terms at checkout (server checkout time, never the browser clock and never the later account-creation time). Recorded as the acceptance time against the minted account. Null when it did not apply.';
