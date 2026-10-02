-- ratings exclude hidden reviews
--
-- WHAT THIS IS FOR, AND WHAT GOES WRONG WITHOUT IT.
--
-- refresh_listing_ratings() is the function the reviews trigger
-- (reviews_refresh_listing_ratings, AFTER INSERT OR DELETE OR UPDATE) runs to
-- rebuild a listing's stored rating_avg and rating_count. It averaged and
-- counted every review with is_published = true and said nothing about
-- hidden_at.
--
-- An admin takedown (app/api/admin/reviews/hide) sets hidden_at and leaves
-- is_published alone. hidden_at is the single lever every public read policy
-- respects, so guests and the host stop seeing the review — but the stored
-- aggregate kept counting it. So a listing could show "4.6 · 12 reviews" on its
-- card while the page below listed 11, because reviews.length is read under RLS
-- (which excludes hidden) and the stored count was not. Three numbers for one
-- rating, disagreeing, with no way to tell which was right.
--
-- Adding `and hidden_at is null` to the aggregate is the whole fix. No route
-- change is needed: setting or clearing hidden_at is an UPDATE on reviews, and
-- the AFTER-UPDATE trigger above already re-runs this function on both — so a
-- hide drops the number immediately and an un-hide restores it. The backfill at
-- the end recomputes every listing once, so any review hidden before this
-- migration stops counting the moment it is applied.
--
-- Proven by scripts/prove-hidden-reviews-excluded.mjs, which fails on the hide
-- step before this migration and passes after it.

create or replace function public.refresh_listing_ratings(target_listing uuid)
    returns void
    language plpgsql
    security definer
    set search_path to 'public'
    as $$
begin
  update public.listings l
  set
    rating_avg           = agg.avg_overall,
    rating_count         = agg.n,
    rating_cleanliness   = agg.avg_cleanliness,
    rating_accuracy      = agg.avg_accuracy,
    rating_checkin       = agg.avg_checkin,
    rating_communication = agg.avg_communication,
    rating_location      = agg.avg_location,
    rating_value         = agg.avg_value
  from (
    select
      count(*)                          as n,
      round(avg(rating), 2)             as avg_overall,
      round(avg(cleanliness_rating), 2) as avg_cleanliness,
      round(avg(accuracy_rating), 2)    as avg_accuracy,
      round(avg(checkin_rating), 2)     as avg_checkin,
      round(avg(communication_rating), 2) as avg_communication,
      round(avg(location_rating), 2)    as avg_location,
      round(avg(value_rating), 2)       as avg_value
    from public.reviews
    where listing_id = target_listing
      and review_type = 'guest_to_host'
      and is_published = true
      -- The one line this migration adds: a hidden review is not a public
      -- rating, so it must not sit in the stored average or count.
      and hidden_at is null
  ) agg
  where l.id = target_listing;
end;
$$;

-- Backfill: recompute every listing so any review hidden before today stops
-- counting straight away, rather than only when its listing next sees a review
-- change. Reuses the function above, one listing at a time.
do $$
declare
  r record;
begin
  for r in select id from public.listings loop
    perform public.refresh_listing_ratings(r.id);
  end loop;
end $$;
