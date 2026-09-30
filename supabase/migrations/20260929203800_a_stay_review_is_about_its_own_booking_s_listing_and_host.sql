-- a stay review is about its own booking's listing and host
--
-- WHAT THIS IS FOR, AND WHAT GOES WRONG WITHOUT IT.
--
-- The review form sends listing_id and reviewee_id from the browser, and the
-- insert policy and check_review_window only ever looked at booking_id. So a
-- guest with ONE finished stay could post a review — and move the star rating
-- — of any other cottage and host on the site, just by changing two ids in
-- the request. Proven on TEST on 29 Sep 2026: a guest's review of their own
-- stay was accepted against a different listing.
--
-- The fix is the same one the experience reviews already use: the fields that
-- say WHO and WHAT a review is about are server-owned, taken from the booking
-- in the trigger, whatever the client sent. A guest_to_host review is about
-- the booking's listing and host; a host_to_guest review is about its guest.
-- The window rules are unchanged.
--
-- PRE-FLIGHT: none needed. It replaces a function body only; no data changes,
-- nothing can refuse to apply. Existing rows are not rewritten.

create or replace function public.check_review_window()
    returns trigger
    language plpgsql
    security definer
    set search_path to 'public'
    as $$
declare
  b record;
begin
  -- A guest-experience review is not about a booking; its own trigger handles it.
  if new.review_type = 'guest_to_provider' then
    return new;
  end if;

  select check_out, listing_id, host_id, guest_id
    into b
    from public.bookings
   where id = new.booking_id;

  if b.check_out is null then
    raise exception 'That booking does not exist.';
  end if;

  if current_date < b.check_out then
    raise exception 'You can leave a review once the stay has finished.';
  end if;

  if current_date > b.check_out + 14 then
    raise exception 'The 14 day window for reviewing this stay has closed.';
  end if;

  -- Server-owned: what and whom the review is about come from the booking.
  new.listing_id := b.listing_id;
  if new.review_type = 'guest_to_host' then
    new.reviewee_id := b.host_id;
  elsif new.review_type = 'host_to_guest' then
    new.reviewee_id := b.guest_id;
  end if;

  return new;
end;
$$;
