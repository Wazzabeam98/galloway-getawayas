-- experience review reminders and review push link
--
-- WHAT THIS IS FOR, AND WHAT GOES WRONG WITHOUT IT.
--
-- 1. sent_experience_review_reminders. A guest who has been on an experience is
--    now asked to review it by email (app/api/cron/experience-review-reminders),
--    the way a guest is asked after a stay. The stay's reminder remembers who it
--    asked in sent_review_reminders — keyed on booking_id, with a foreign key to
--    bookings, so it cannot hold an experience order. Without a record of its
--    own the daily job would ask the same guest every day for ten days. One row
--    per order, written when the email goes. Service-role only: only the cron
--    reads or writes it, with the admin client.
--
-- 2. queue_review_push sent a provider's "You have a new review" push to
--    /services/dashboard (their bookings), because providers had no Reviews page.
--    They do now (/services/dashboard/reviews, #469), so the push opens it — the
--    way a host's opens /dashboard/reviews. The function is otherwise exactly as
--    20261019170805 left it: security definer, errors swallowed so a push can
--    never stop a review being saved.
--
-- PRE-FLIGHT: not destructive. A new empty table, and a function replaced with
-- one whose only change is the else-branch URL. Safe to run twice.

create table if not exists public.sent_experience_review_reminders (
    order_id uuid primary key references public.service_orders(id) on delete cascade,
    sent_at  timestamptz not null default now()
);

alter table public.sent_experience_review_reminders enable row level security;
revoke all on table public.sent_experience_review_reminders from anon;
revoke all on table public.sent_experience_review_reminders from authenticated;
grant all on table public.sent_experience_review_reminders to service_role;

create or replace function public.queue_review_push()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  target uuid;
  where_url text;
  is_new boolean := (tg_op = 'INSERT');
begin
  begin
    target := new.reviewee_id;
    if target is null and new.provider_id is not null then
      select owner_id into target from public.service_providers where id = new.provider_id;
    end if;
    where_url := case new.review_type
      when 'guest_to_host' then '/dashboard/reviews'
      when 'host_to_guest' then '/review/' || new.booking_id
      else '/services/dashboard/reviews' end;

    if target is not null and is_new and not coalesce(new.is_published, false) then
      insert into public.push_outbox (dedupe_key, source, kind, user_id, category, title, body, url, context)
      values ('review.left:' || new.id, 'event', 'review.left', target, 'reviews',
              case new.review_type when 'host_to_guest' then 'Your host reviewed you' else 'You have a new review' end,
              'Write your review to read theirs.', where_url,
              jsonb_build_object('booking_id', new.booking_id))
      on conflict (dedupe_key) do nothing;
    end if;

    if target is not null and coalesce(new.is_published, false)
       and (is_new or not coalesce(old.is_published, false)) then
      insert into public.push_outbox (dedupe_key, source, kind, user_id, category, title, body, url, context)
      values ('review.published:' || new.id, 'event', 'review.published', target, 'reviews',
              'You have a new review',
              case new.review_type when 'host_to_guest' then 'Your host''s review of you is up.' else 'Tap to read it.' end,
              case new.review_type when 'host_to_guest' then '/trips' else where_url end,
              jsonb_build_object('booking_id', new.booking_id))
      on conflict (dedupe_key) do nothing;
    end if;

    if not is_new and new.host_reply is not null and old.host_reply is null and new.reviewer_id is not null then
      insert into public.push_outbox (dedupe_key, source, kind, user_id, category, title, body, url)
      values ('review.reply:' || new.id, 'event', 'review.reply', new.reviewer_id, 'reviews',
              'Your review got a reply', 'Tap to read it.', '/trips')
      on conflict (dedupe_key) do nothing;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$function$;

revoke all on function public.queue_review_push() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- Read back:
--   select relrowsecurity from pg_class where oid = 'public.sent_experience_review_reminders'::regclass;   -- true
--   select has_table_privilege('authenticated', 'public.sent_experience_review_reminders', 'select');        -- false
--   select position('/services/dashboard/reviews' in pg_get_functiondef('public.queue_review_push()'::regprocedure)) > 0;  -- true
