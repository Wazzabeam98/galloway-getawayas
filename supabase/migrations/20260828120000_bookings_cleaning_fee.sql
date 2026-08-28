-- What the guest was charged for the clean, kept on the booking.
--
-- PRE-FLIGHT: none needed. This adds a nullable column and touches no
-- existing row. Safe to run twice; safe to run on both projects.
--
-- WHY THE BOOKING HAS TO CARRY ITS OWN COPY
--
-- The published cancellation policy promises the cleaning fee back in full
-- whenever a guest cancels, because the clean does not take place. To honour
-- that, a refund has to know what the cleaning fee WAS.
--
-- `bookings` has never held one. It stores `total_price` and no line items at
-- all — the quote is worked out at checkout from the listing and only the
-- total is kept. Reading `listings.cleaning_fee` at refund time would use
-- whatever the host has changed it to since, which is wrong in the direction
-- that costs somebody money, and there is a scripted payment scenario for a
-- price changing mid-booking precisely because that happens.
--
-- So it is stamped at checkout and never rewritten, exactly like
-- `commission_rate` beside it: this booking's history stays true to what was
-- actually agreed at the time.
--
-- WHY IT IS NULLABLE AND HAS NO DEFAULT
--
-- Null means "this booking predates the column and we do not know". The refund
-- rule reads null as zero, so every existing booking keeps behaving exactly as
-- it does today rather than being handed a number nobody can vouch for.
-- Backfilling from the listing would be inventing evidence.
--
-- There is nothing to backfill in any case: production held five bookings when
-- this was written, all cancelled, none with any money ever taken.
--
-- FILENAME: this one carries a full timestamp rather than the date-only prefix
-- the older files use, because eight migrations share the prefix 20260822 and
-- their order within that day is decided by nothing but alphabetical sorting.

alter table public.bookings
    add column if not exists cleaning_fee numeric(10,2);

comment on column public.bookings.cleaning_fee is
    'The cleaning fee charged on this booking, stamped by /api/stripe/checkout '
    'and never rewritten. Null on bookings made before the column existed, '
    'which the refund rule reads as zero. Refunded in full whenever a booking '
    'is cancelled — see lib/cancellation.ts refundDue().';
