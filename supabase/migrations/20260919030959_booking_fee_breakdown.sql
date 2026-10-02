-- Freeze the remaining fee lines on a booking, the same way the cleaning fee and
-- the per-night series already are.
--
-- A booking stores its total, its cleaning_fee (20260…), and its per-night split
-- (nightly_breakdown, PR #120). But the pet fee and the extra-guest fee were
-- computed at checkout by quoteBooking and thrown away — so the trip-card
-- breakdown had no honest way to show them as their own lines and rolled them
-- into the accommodation figure (total − cleaning), where the per-night rates no
-- longer summed to what was shown.
--
-- These two columns are the same idea as cleaning_fee and nightly_breakdown:
-- stamped once at purchase from the server-side quote, never rewritten, so the
-- breakdown a guest reads is what they were charged even after the host changes
-- the listing's fees. Nullable: bookings made before this column existed carry
-- null, and the trip card falls back to a single figure for them, exactly as it
-- does for a missing nightly_breakdown.
--
-- Safe to run twice.

alter table public.bookings
    add column if not exists pet_fee numeric;

alter table public.bookings
    add column if not exists extra_guest_fee numeric;

comment on column public.bookings.pet_fee is
    'The pet fee charged on this booking, frozen at checkout from the server quote (quoteBooking.petFeeTotal). Null for bookings made before the column existed. Read-only to the guest; written only by the checkout route via the service role, like cleaning_fee.';

comment on column public.bookings.extra_guest_fee is
    'The extra-guest fee charged on this booking, frozen at checkout from the server quote (quoteBooking.extraGuestTotal). Null for bookings predating the column. Written only server-side, like cleaning_fee.';
