-- Reviews, extended from cottage stays to guest experiences.
--
-- WHAT THIS DOES, AND WHY IT EXTENDS RATHER THAN DUPLICATES
--
-- The reviews table already carries a guest's review of a cottage stay. A guest
-- reviewing a yoga session is doing the same thing, so the same table carries
-- it. The differences are three, and only three:
--
--   * a stay is a `bookings` row; an experience is a `service_orders` row (and a
--     standalone experience purchase has no booking and no listing at all).
--   * a stay has a host; an experience has a provider — a `service_providers`
--     row owned by a person (owner_id), shown to guests by first name only.
--   * a stay review is double-blind against the host's review of the guest; a
--     provider never reviews a guest, so there is nothing to hide behind. An
--     experience review is single-sided and publishes on submit.
--
-- WHAT STAYS EXACTLY THE SAME
--
--   * only a COMPLETED purchase earns a review. For a stay that is a confirmed
--     booking whose check-out has passed. For an experience it is a service
--     order that is `confirmed` (which is the paid-and-captured state — the
--     provider's accept captures the payment intent, see
--     app/api/services/orders/respond/route.ts) whose service_date has passed.
--     Enforced the same way: an RLS INSERT policy that only admits the guest's
--     own qualifying orders, PLUS a BEFORE-INSERT trigger, PLUS the client belt.
--   * the star mechanic, first-name display, and the provider's one public
--     reply (reusing the host_reply columns).
--
-- WHAT IS DELIBERATELY NOT COPIED
--
--   * no stored rating aggregate on service_providers. That table already
--     refuses to keep counters — "a stored count is one missed write away from
--     being wrong" (20260824050425_service_providers.sql). The listing page
--     computes count and average on read, the same way it computes bookingsCount.
--     So there is no aggregate trigger and no rating columns here.
--   * no double-blind, no pairing cron. Publishes on submit.
--   * the six cottage category ratings (cleanliness, check-in, location…) do not
--     describe an experience, so an experience review carries the overall rating
--     and the comment only. The category columns stay null. No invented scores.
--
-- Safe to run twice. Test first, then (on Liam's say-so) production.

begin;

-- ---------------------------------------------------------------- columns

-- The anchor to the experience. A soft cascade: if the order goes, so does the
-- review of it, exactly as a review dies with its booking.
alter table public.reviews
    add column if not exists order_id uuid references public.service_orders(id) on delete cascade;

-- Which provider the review is about. Derivable from the order, but stored so
-- the listing page reads reviews by provider in one indexed query. The trigger
-- below fills it from the order and never trusts the client with it.
alter table public.reviews
    add column if not exists provider_id uuid references public.service_providers(id) on delete cascade;

-- The takedown signal. Distinct from is_published on purpose: is_published is
-- the (cottage) double-blind machinery, hidden_at is "an owner removed this,
-- and here is why". Null means visible. Set by the admin route only.
alter table public.reviews
    add column if not exists hidden_at timestamptz;
alter table public.reviews
    add column if not exists hidden_reason text;
-- Who took it down. The row audits its own takedown, so the trail does not need
-- admin_actions (which is listing-shaped) taught about reviews.
alter table public.reviews
    add column if not exists hidden_by uuid references public.profiles(id) on delete set null;

comment on column public.reviews.order_id is
    'The service order this review is of, for a guest-experience review. Null for a cottage-stay review, which uses booking_id instead — the anchor is one or the other, never neither, never both (see reviews_anchor_matches_type).';
comment on column public.reviews.provider_id is
    'The service_providers row this review is about. Filled from the order by the check_experience_review_window trigger; never written by a browser client.';
comment on column public.reviews.hidden_at is
    'When an owner took this review down. Null means visible. Respected by every public SELECT policy, so a hidden review is gone for guests and for the provider, not merely filtered in the app. Set only by the admin route, via the service role.';

-- ------------------------------------------------------ booking_id nullable
--
-- booking_id was NOT NULL, and that was the only thing guaranteeing a review
-- was attached to a stay. Relaxing it would let a row exist attached to
-- nothing. The CHECK below is the replacement guarantee, and it says more than
-- NOT NULL did: the anchor must MATCH the review type. A cottage review must
-- carry a booking and no order; an experience review must carry an order and no
-- booking; neither, both, or the wrong one for the type is refused.

alter table public.reviews alter column booking_id drop not null;

alter table public.reviews drop constraint if exists reviews_anchor_matches_type;
alter table public.reviews add constraint reviews_anchor_matches_type check (
    (review_type in ('guest_to_host','host_to_guest')
        and booking_id is not null and order_id is null)
    or
    (review_type = 'guest_to_provider'
        and order_id is not null and booking_id is null)
);

-- Allow the new review_type. The old constraint listed only the two stay types.
alter table public.reviews drop constraint if exists reviews_review_type_check;
alter table public.reviews add constraint reviews_review_type_check check (
    review_type in ('guest_to_host','host_to_guest','guest_to_provider')
);

-- One review per (order, reviewer). The existing unique indexes key on
-- booking_id, which is null for an experience review — and NULLs are distinct,
-- so those indexes do NOT stop a guest reviewing one order twice. This does.
create unique index if not exists reviews_one_per_order_idx
    on public.reviews (order_id, reviewer_id)
    where order_id is not null;

-- Read path for the listing page: reviews of one provider, newest first.
create index if not exists reviews_provider_published_idx
    on public.reviews (provider_id, is_published)
    where review_type = 'guest_to_provider';

-- --------------------------------------------------- the completed-order gate
--
-- Layer 1 of 3: RLS. A guest may insert a provider review only for their own
-- service order that is confirmed (paid) and whose date has passed. A cancelled,
-- refunded, declined, expired or still-authorised order is not 'confirmed', so
-- none of them qualify. Someone else's order is not theirs to review.
--
-- The eligibility test reads service_orders, and a guest has no SELECT grant on
-- that table — the app only ever reads an order server-side, through the
-- service role. So the test lives in a SECURITY DEFINER function that reads the
-- order as owner and hands back a plain yes/no. A non-qualifying order returns
-- false, which reads as a clean policy refusal, not a permission error — and no
-- new read surface is opened on service_orders.

create or replace function public.order_reviewable_by(p_order uuid, p_guest uuid)
    returns boolean
    language sql
    security definer
    stable
    set search_path to 'public'
    as $$
    select exists (
        select 1 from public.service_orders
        where id = p_order
          and guest_id = p_guest
          and status = 'confirmed'
          and service_date < current_date
    );
$$;

revoke all on function public.order_reviewable_by(uuid, uuid) from public;
grant execute on function public.order_reviewable_by(uuid, uuid) to authenticated, service_role;

drop policy if exists "Guests can review after a completed experience" on public.reviews;
create policy "Guests can review after a completed experience"
    on public.reviews for insert to authenticated
    with check (
        review_type = 'guest_to_provider'
        and reviewer_id = auth.uid()
        and public.order_reviewable_by(order_id, auth.uid())
    );

-- The client names only these columns on insert. reviewee_id, provider_id,
-- is_published and published_at are set by the trigger (which runs as owner, so
-- it needs no grant), and must stay OUT of the browser's reach — the same care
-- 20260829012000 took with is_published. So the only new grant is order_id;
-- reviewer_id, review_type, rating and comment are already granted.
grant insert (order_id) on table public.reviews to authenticated;

-- ------------------------------------------------------------ the two triggers
--
-- Layer 2: triggers. The existing check_review_window is the cottage window; it
-- reads booking_id and would raise "That booking does not exist" on a provider
-- review whose booking_id is null. So it now steps aside for the new type, and a
-- sibling trigger enforces the experience window and fills the server-owned
-- fields from the order.

create or replace function public.check_review_window()
    returns trigger
    language plpgsql
    security definer
    set search_path to 'public'
    as $$
declare
  co date;
begin
  -- A guest-experience review is not about a booking; its own trigger handles it.
  if new.review_type = 'guest_to_provider' then
    return new;
  end if;

  select check_out into co from public.bookings where id = new.booking_id;

  if co is null then
    raise exception 'That booking does not exist.';
  end if;

  if current_date < co then
    raise exception 'You can leave a review once the stay has finished.';
  end if;

  if current_date > co + 14 then
    raise exception 'The 14 day window for reviewing this stay has closed.';
  end if;

  return new;
end;
$$;

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

grant all on function public.check_experience_review_window() to anon, authenticated, service_role;

drop trigger if exists reviews_check_experience_window on public.reviews;
create trigger reviews_check_experience_window
    before insert on public.reviews
    for each row execute function public.check_experience_review_window();

-- --------------------------------------------------------- the provider reply
--
-- Layer for display symmetry: the provider gets one public reply, reusing the
-- host_reply / host_reply_at columns (already the only UPDATE-granted columns).
-- reviewee_id was set to the provider's owner by the trigger, so this matches
-- the same shape as the host reply policy.

drop policy if exists "Providers can reply to reviews about them" on public.reviews;
create policy "Providers can reply to reviews about them"
    on public.reviews for update to authenticated
    using (review_type = 'guest_to_provider' and reviewee_id = auth.uid())
    with check (review_type = 'guest_to_provider' and reviewee_id = auth.uid());

-- ---------------------------------------------------------- read + the takedown
--
-- A published provider review is public — the standalone experience page is
-- browsable signed-out, so anon reads it too.
drop policy if exists "Anyone can view published provider reviews" on public.reviews;
create policy "Anyone can view published provider reviews"
    on public.reviews for select to authenticated, anon
    using (
        review_type = 'guest_to_provider'
        and is_published = true
        and hidden_at is null
    );

-- The takedown has to be real for BOTH kinds of review, and the cottage read
-- policy ignores is_published — so the single lever every public read must
-- respect is hidden_at. Re-create the two existing public SELECT policies with
-- "and hidden_at is null" added; nothing else about them changes. A hidden
-- review is then gone for everyone but the service role (the admin route),
-- which bypasses RLS.

drop policy if exists "Anyone can view guest reviews of hosts" on public.reviews;
create policy "Anyone can view guest reviews of hosts"
    on public.reviews for select to authenticated, anon
    using (review_type = 'guest_to_host' and hidden_at is null);

drop policy if exists "reviews - read published" on public.reviews;
create policy "reviews - read published"
    on public.reviews for select to public
    using ((is_published = true or auth.uid() = reviewer_id) and hidden_at is null);

commit;
