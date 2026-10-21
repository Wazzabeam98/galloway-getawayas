-- experience reviews close after fourteen days
--
-- WHAT THIS IS FOR, AND WHAT GOES WRONG WITHOUT IT.
--
-- A stay can be reviewed for 14 days after check-out and then the window shuts
-- (check_review_window: "The 14 day window for reviewing this stay has
-- closed."), as on Airbnb. An experience never shut: order_reviewable_by and
-- check_experience_review_window only asked that the day had passed, so a guest
-- could review an experience a year later. Both now close 14 days after the
-- experience's day, counted the way the stay's is — the last day to review is
-- service_date + 14, refused from the day after.
--
-- Both functions are otherwise exactly as their last versions left them
-- (order_reviewable_by from 20261004133346 — answers only for the caller;
-- check_experience_review_window from 20260915141500). `create or replace`
-- keeps their grants.
--
-- PRE-FLIGHT: not destructive. Two functions replaced; no table, row or grant
-- touched. Reviews already posted are unaffected. Safe to run twice.

create or replace function public.order_reviewable_by(p_order uuid, p_guest uuid)
    returns boolean
    language sql
    stable security definer
    set search_path to 'public'
as $function$
    select p_guest = auth.uid() and exists (
        select 1 from public.service_orders
        where id = p_order
          and guest_id = p_guest
          and status = 'confirmed'
          and service_date < current_date
          and current_date <= service_date + 14
    );
$function$;

create or replace function public.check_experience_review_window()
    returns trigger
    language plpgsql
    security definer
    set search_path to 'public'
    as $$
declare
  o record;
begin
  if new.review_type <> 'guest_to_provider' then
    return new;
  end if;

  select id, provider_id, status, service_date
    into o
    from public.service_orders
   where id = new.order_id;

  if o.id is null then
    raise exception 'That order does not exist.';
  end if;

  -- 'confirmed' is the paid-and-captured state. Cancelled / refunded / declined
  -- / expired / authorised are not it, and none earn a review.
  if o.status <> 'confirmed' then
    raise exception 'You can review an experience once it is booked and paid.';
  end if;

  if o.service_date >= current_date then
    raise exception 'You can leave a review once the experience has taken place.';
  end if;

  -- The stay's window, the stay's words (check_review_window).
  if current_date > o.service_date + 14 then
    raise exception 'The 14 day window for reviewing this experience has closed.';
  end if;

  -- Server-owned fields, taken from the order — never from the client.
  new.provider_id := o.provider_id;
  new.reviewee_id := (select owner_id from public.service_providers where id = o.provider_id);
  new.listing_id  := null;   -- a provider review is not about a cottage
  new.booking_id  := null;
  new.is_published := true;  -- single-sided: publishes on submit
  new.published_at := now();

  return new;
end;
$$;

notify pgrst, 'reload schema';

-- Read back:
--   select position('service_date + 14' in pg_get_functiondef('public.order_reviewable_by(uuid,uuid)'::regprocedure)) > 0;   -- true
--   select position('14 day window' in pg_get_functiondef('public.check_experience_review_window()'::regprocedure)) > 0;      -- true
--   select has_function_privilege('authenticated', 'public.order_reviewable_by(uuid,uuid)', 'execute');                   -- true
--   select has_function_privilege('anon', 'public.order_reviewable_by(uuid,uuid)', 'execute');                            -- false
