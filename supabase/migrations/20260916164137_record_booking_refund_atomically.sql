-- What has been refunded on a booking must only ever change inside the
-- database.
--
-- Two routes move it, and both do the same thing adjust_payout_balance was
-- written to stop: read bookings.amount_refunded into JavaScript, add the
-- amount just refunded, write the result back.
--
--   app/api/bookings/cancel       a guest calling their own stay off
--   app/api/bookings/host-refund  a host handing money back, stay standing
--
-- Both read amount_refunded BEFORE the Stripe refund and write the new total
-- AFTER it returns, so the gap is a network round trip to Stripe. A host
-- goodwill refund landing in the window of a guest cancel (or a second refund
-- of any kind) is read against a stale figure and overwritten: two refunds go
-- out at Stripe, the books record one. The stale figure also feeds the
-- `amount > refundable` guard, so the NEXT refund can be allowed to exceed
-- what is actually left. See AUDIT-FAILURE-PATHS-2026-09-14.md ranks 3–5.
--
-- Same fix as the host-debt one: move the arithmetic to where the row is
-- locked. `select ... for update` serialises two callers against the same
-- booking, `amount_refunded = amount_refunded + $1` reads and writes with no
-- window between, and the total is clamped at what was actually paid so two
-- overlapping refunds can never drive the record above the money in. The
-- clamp is not silent — the function returns how much it actually applied, so
-- a caller that asked to add more than there was room for knows a concurrent
-- refund overlapped and can report it, exactly as the payout run reports a
-- balance that came back lower than it expected.

create or replace function public.record_booking_refund(
    p_booking uuid,
    p_amount  numeric
)
returns table (
    new_amount_refunded numeric,
    amount_paid         numeric,
    applied             numeric,
    payment_status      text
)
language plpgsql
security definer
-- SECURITY DEFINER runs as the owner and ignores the caller's grants, so the
-- search_path is pinned rather than taken from whoever is calling.
set search_path = public
as $fn$
declare
    old_refunded numeric;
    v_paid       numeric;
    v_new        numeric;
    v_status     text;
begin
    -- The lock is the whole point: a second refund on the same booking waits
    -- here until this one has written, then reads the figure this one left.
    select round(coalesce(b.amount_refunded, 0), 2), round(coalesce(b.amount_paid, 0), 2)
      into old_refunded, v_paid
      from public.bookings b
     where b.id = p_booking
       for update;

    -- No booking by that id. The caller gets no row and can say so, rather
    -- than a cheerful zero that reads like a refund that recorded fine.
    if not found then
        return;
    end if;

    -- Never above what was paid, and a bad negative delta can never pull it
    -- below what has already gone back.
    v_new := least(v_paid, round(old_refunded + p_amount, 2));
    if v_new < old_refunded then
        v_new := old_refunded;
    end if;

    v_status := case when v_new >= v_paid then 'refunded' else 'partially_refunded' end;

    update public.bookings b
       set amount_refunded = v_new,
           payment_status  = v_status
     where b.id = p_booking;

    new_amount_refunded := v_new;
    amount_paid         := v_paid;
    applied             := round(v_new - old_refunded, 2);
    payment_status      := v_status;
    return next;
end;
$fn$;

-- SECURITY DEFINER functions are granted to PUBLIC by default, which would put
-- a function that edits a money column within reach of the browser key.
-- amount_refunded is revoked from the browser roles; the function that writes
-- it has to be as well. Only the service-role routes call it.
revoke all on function public.record_booking_refund(uuid, numeric) from public;
revoke all on function public.record_booking_refund(uuid, numeric) from anon;
revoke all on function public.record_booking_refund(uuid, numeric) from authenticated;
