-- package notice on orders
--
-- WHAT THIS IS FOR, AND WHAT GOES WRONG WITHOUT IT.
--
-- A guest who already has a confirmed, paid stay covering the experience date
-- is told at the experience checkout that the booking is for that experience
-- only — not part of a package with their stay, and not protected as one
-- (lib/packageNotice.ts). These two columns record, against the order, which
-- wording they were shown and when, the way the terms acceptance is recorded.
-- Without them the order routes' insert names columns that do not exist and the
-- order is refused at the database — so this must reach production BEFORE the
-- code that writes them.
--
-- Both are null when the notice did not apply (no covering stay). Written only
-- by the server with the service role: the slot book route directly, and the
-- request/cart path through lib/requestOrder.ts from the Stripe session's
-- server-written metadata. service_orders has no grant to anon or
-- authenticated, so the browser can neither read nor write these; no grant is
-- added here on purpose.
--
-- PRE-FLIGHT: none needed — two nullable columns, no default, no rewrite.

ALTER TABLE public.service_orders
    ADD COLUMN IF NOT EXISTS package_notice_version text,
    ADD COLUMN IF NOT EXISTS package_notice_shown_at timestamptz;

COMMENT ON COLUMN public.service_orders.package_notice_version IS
    'Version of the package notice shown above the pay button (lib/packageNotice.PACKAGE_NOTICE_VERSION) because the guest had a confirmed, paid stay covering the experience date. Null when it did not apply.';
COMMENT ON COLUMN public.service_orders.package_notice_shown_at IS
    'When the guest was shown the package notice at checkout (server time). Null when it did not apply.';
