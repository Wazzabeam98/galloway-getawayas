-- The per-night prices behind a booking's accommodation subtotal, kept on the
-- booking so a guest can see what each night cost.
--
-- PRE-FLIGHT: none needed. This adds a nullable column and touches no existing
-- row. Safe to run twice; safe to run on both projects.
--
-- WHY THE BOOKING HAS TO CARRY ITS OWN COPY
--
-- `bookings` stores `total_price` and, since the cleaning-fee migration beside
-- this, a couple of stamped line items — but never the accommodation breakdown.
-- The nightly series (which nights got the weekend rate, which a hand-set
-- calendar override, what each cost) is computed at checkout by quoteBooking
-- and thrown away. So a guest querying a weekend rate can only be shown the
-- subtotal and asked to take the total on trust, and we could not reconstruct
-- the split honestly either: `calendar_overrides` is host-mutable after the
-- booking, so recomputing later reads a calendar that may have changed.
--
-- This is the same failure the cleaning_fee and commission_rate columns already
-- fix for their numbers: the fee back in full on cancellation needs to know
-- what the fee WAS. The accommodation split needs the same treatment. So it is
-- stamped at checkout and never rewritten — this booking's history stays true
-- to what was actually agreed at the time.
--
-- SHAPE: a JSON array, one entry per night, in stay order:
--   [{ "date": "2026-09-11", "rate": 150, "kind": "weekend" }, ...]
-- `kind` is one of base | weekend | override — the reason the night cost what
-- it did, so the guest reads why a night was dearer, not just that it was.
--
-- WHY IT IS NULLABLE AND HAS NO DEFAULT
--
-- Null means "this booking predates the column and we do not know its split".
-- The breakdown view reads null as "show the single accommodation line, marked
-- as an estimate from current rates" rather than inventing a per-night series
-- for a stay we never stamped. Backfilling from the listing would be inventing
-- evidence against a calendar that has since moved.

alter table public.bookings
    add column if not exists nightly_breakdown jsonb;

comment on column public.bookings.nightly_breakdown is
    'The per-night accommodation prices for this booking, an ordered JSON array '
    'of { date, rate, kind } stamped by /api/stripe/checkout and never '
    'rewritten. Null on bookings made before the column existed, which the '
    'breakdown view shows as a single estimated line. See lib/pricing.ts '
    'quoteBooking().nightly.';
