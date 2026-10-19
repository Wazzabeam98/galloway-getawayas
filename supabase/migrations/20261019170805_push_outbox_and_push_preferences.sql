-- Push notifications for every event: the outbox, the per-category switches,
-- and the security alerts.
--
-- WHAT THIS IS FOR. Until now only three events pushed, and the host's
-- new-booking push depended on the guest's browser coming back from Stripe.
-- From here every email the site sends records one row here (lib/email →
-- lib/pushOutbox), as do the events that have no email (security alerts,
-- day-of reminders). A separate job (/api/cron/push-outbox) picks each row up
-- and sends it exactly once — so nothing is ever pushed from payment, payout or
-- settlement code, and a push can never hold up an email or a booking.
--
-- WHAT GOES WRONG WITHOUT IT. Pushes are only sent for messages and host
-- confirmations; a host whose guest closes the tab after paying is never pushed.
--
-- push_outbox and payout_destinations_seen are SERVICE ROLE ONLY: RLS on, no
-- policies, every grant to anon and authenticated revoked
-- (tests/table-grants-guard.test.ts). A row holds a recipient, a short title
-- and body (never a door code, wifi, address, card or message text — built by
-- lib/pushRules) and a site path.
--
-- notification_preferences.push holds the person's push switches per category
-- ({"messages": false, ...}); a missing key means the default (on, except
-- marketing). Security alerts ignore it. Same row, same own-row policies as
-- the email switches beside it.
--
-- SECURITY ALERTS come from triggers, because sign-ins, password and email
-- changes happen in the browser against Supabase Auth with no route of ours in
-- between: a trigger on auth.users queues them. Every trigger body swallows its
-- own errors — a push must never be able to stop somebody signing in, or a
-- profile saving. An erased account (deleted+…@invalid.example, banned) queues
-- nothing. Payout bank details live at Stripe; the account.updated webhook
-- stamps profiles.stripe_updated_at, and a trigger on that queues a check that
-- the job makes against Stripe (read only).
--
-- PRE-FLIGHT. Not destructive: two new tables, one new column with a default,
-- six trigger functions and their triggers, and the erasure function patched
-- in place to delete the new rows.

create table if not exists public.push_outbox (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    -- One row per event, ever: a redelivered webhook or a re-run job that
    -- records the same event again is ignored here.
    dedupe_key text not null unique,
    source text not null check (source in ('email', 'event')),
    kind text not null,
    -- Who it is for: a user id, or the email address the email went to
    -- (resolved by the job, so payment code never waits on a lookup).
    user_id uuid references auth.users (id) on delete cascade,
    to_email text,
    category text not null,
    title text not null,
    body text not null,
    url text not null default '/',
    context jsonb not null default '{}'::jsonb,
    status text not null default 'pending'
        check (status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
    claimed_at timestamptz,
    done_at timestamptz,
    result jsonb
);

create index if not exists push_outbox_pending_idx
    on public.push_outbox (created_at) where status = 'pending';
create index if not exists push_outbox_user_idx on public.push_outbox (user_id);

alter table public.push_outbox enable row level security;
revoke all on table public.push_outbox from anon;
revoke all on table public.push_outbox from authenticated;
grant select, insert, update, delete on table public.push_outbox to service_role;

comment on table public.push_outbox is
    'One row per push to send, written by the email layer and by event triggers, sent exactly once by /api/cron/push-outbox. Service role only.';

-- The payout destination we last saw for each connected Stripe account, so a
-- change of bank details can be told apart from any other account update.
create table if not exists public.payout_destinations_seen (
    stripe_account_id text primary key,
    user_id uuid references auth.users (id) on delete cascade,
    fingerprint text not null,
    seen_at timestamptz not null default now()
);

alter table public.payout_destinations_seen enable row level security;
revoke all on table public.payout_destinations_seen from anon;
revoke all on table public.payout_destinations_seen from authenticated;
grant select, insert, update, delete on table public.payout_destinations_seen to service_role;

comment on table public.payout_destinations_seen is
    'Fingerprint of each Stripe account''s payout destination, for the "payout details changed" security alert. Service role only.';

alter table public.notification_preferences
    add column if not exists push jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------- security

create or replace function public.queue_auth_security_push()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  begin
    -- An erased account queues nothing.
    if new.email like 'deleted+%@invalid.example' or (new.banned_until is not null and new.banned_until > now()) then
      return new;
    end if;

    -- A sign-in. At most one alert a day, and none for the sign-in that
    -- created the account.
    if new.last_sign_in_at is distinct from old.last_sign_in_at
       and new.last_sign_in_at is not null
       and new.created_at < now() - interval '10 minutes' then
      insert into public.push_outbox (dedupe_key, source, kind, user_id, category, title, body, url)
      values ('security.sign_in:' || new.id || ':' || to_char(timezone('Europe/London', new.last_sign_in_at), 'YYYY-MM-DD'),
              'event', 'security.sign_in', new.id, 'account',
              'New sign-in to your account',
              'If this wasn''t you, change your password now.',
              '/account?section=security')
      on conflict (dedupe_key) do nothing;
    end if;

    if new.encrypted_password is distinct from old.encrypted_password
       and coalesce(new.encrypted_password, '') <> '' then
      insert into public.push_outbox (dedupe_key, source, kind, user_id, category, title, body, url)
      values ('security.password:' || new.id || ':' || extract(epoch from now())::bigint,
              'event', 'security.password', new.id, 'account',
              'Your password was changed',
              'If you didn''t do this, reset your password and contact us.',
              '/account?section=security')
      on conflict (dedupe_key) do nothing;
    end if;

    if new.email is distinct from old.email and coalesce(old.email, '') <> '' then
      insert into public.push_outbox (dedupe_key, source, kind, user_id, category, title, body, url)
      values ('security.email:' || new.id || ':' || extract(epoch from now())::bigint,
              'event', 'security.email', new.id, 'account',
              'Your email address was changed',
              'If you didn''t do this, contact us straight away.',
              '/account?section=security')
      on conflict (dedupe_key) do nothing;
    end if;
  exception when others then
    -- Never let a notification stop a sign-in.
    null;
  end;
  return new;
end;
$function$;

revoke all on function public.queue_auth_security_push() from public, anon, authenticated;

drop trigger if exists queue_auth_security_push on auth.users;
create trigger queue_auth_security_push
  after update of last_sign_in_at, encrypted_password, email on auth.users
  for each row execute function public.queue_auth_security_push();

create or replace function public.queue_payout_destination_check()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  begin
    if new.stripe_account_id is not null
       and new.stripe_updated_at is distinct from old.stripe_updated_at then
      insert into public.push_outbox (dedupe_key, source, kind, user_id, category, title, body, url, context)
      values ('payout.check:' || new.id || ':' || extract(epoch from coalesce(new.stripe_updated_at, now()))::bigint,
              'event', 'security.payout_check', new.id, 'account',
              'Payout details', 'Checking for a change', '/account?section=payments',
              jsonb_build_object('stripe_account_id', new.stripe_account_id))
      on conflict (dedupe_key) do nothing;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$function$;

revoke all on function public.queue_payout_destination_check() from public, anon, authenticated;

drop trigger if exists queue_payout_destination_check on public.profiles;
create trigger queue_payout_destination_check
  after update of stripe_updated_at on public.profiles
  for each row execute function public.queue_payout_destination_check();

-- Experience providers and trades are paid to their own connected account,
-- kept on service_providers; the same check, for the owner.
create or replace function public.queue_provider_payout_destination_check()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  begin
    if new.stripe_account_id is not null
       and new.stripe_updated_at is distinct from old.stripe_updated_at then
      insert into public.push_outbox (dedupe_key, source, kind, user_id, category, title, body, url, context)
      values ('payout.check.provider:' || new.id || ':' || extract(epoch from coalesce(new.stripe_updated_at, now()))::bigint,
              'event', 'security.payout_check', new.owner_id, 'account',
              'Payout details', 'Checking for a change', '/services/dashboard',
              jsonb_build_object('stripe_account_id', new.stripe_account_id))
      on conflict (dedupe_key) do nothing;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$function$;

revoke all on function public.queue_provider_payout_destination_check() from public, anon, authenticated;

drop trigger if exists queue_provider_payout_destination_check on public.service_providers;
create trigger queue_provider_payout_destination_check
  after update of stripe_updated_at on public.service_providers
  for each row execute function public.queue_provider_payout_destination_check();

-- ---------------------------------------------------------------- events with no email

-- Reviews: the person reviewed hears when a review is left (write yours to see
-- it, while it's still hidden), when it's published, and a guest hears when
-- the host replies. Text never included.
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
      else '/services/dashboard' end;

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

drop trigger if exists queue_review_push on public.reviews;
create trigger queue_review_push
  after insert or update of is_published, host_reply on public.reviews
  for each row execute function public.queue_review_push();

-- Admin decisions with no email: a listing, experience or trade taken down,
-- put back, or removed. admin_actions is where every one is written.
create or replace function public.queue_admin_action_push()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  begin
    if new.host_id is not null and new.action in ('listing_hidden','listing_relisted','listing_deleted','provider_hidden','provider_relisted') then
      insert into public.push_outbox (dedupe_key, source, kind, user_id, category, title, body, url)
      values ('admin_action:' || new.id, 'event', 'moderation.' || new.action, new.host_id, 'listings',
              case
                when new.action in ('listing_hidden','provider_hidden') then 'Your listing has been taken down'
                when new.action = 'listing_deleted' then 'Your listing has been removed'
                else 'Your listing is back up' end,
              case
                when new.action in ('listing_hidden','provider_hidden') then 'Guests can''t see it for now. Contact us if you have questions.'
                when new.action = 'listing_deleted' then 'Contact us if you have questions.'
                else 'Guests can find and book it again.' end,
              case when new.provider_id is not null then '/services/dashboard' else '/dashboard' end)
      on conflict (dedupe_key) do nothing;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$function$;

revoke all on function public.queue_admin_action_push() from public, anon, authenticated;

drop trigger if exists queue_admin_action_push on public.admin_actions;
create trigger queue_admin_action_push
  after insert on public.admin_actions
  for each row execute function public.queue_admin_action_push();

-- Owner alert: a holiday-let listing sent for approval (a new host's first
-- listing, or one sent back and resubmitted). Goes to every admin
-- (context.admins). Experiences and trades already email the owners, so their
-- push comes with that email.
create or replace function public.queue_listing_review_push()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  begin
    if new.status = 'pending_review' and (tg_op = 'INSERT' or old.status is distinct from 'pending_review') then
      insert into public.push_outbox (dedupe_key, source, kind, category, title, body, url, context)
      values ('admin.listing_review:' || new.id || ':' || extract(epoch from now())::bigint, 'event', 'admin.listing_review', 'admin',
              'Listing waiting for approval', coalesce(nullif(left(new.title, 80), ''), 'A new listing') || ' is ready to review.',
              '/admin/listings', jsonb_build_object('admins', true))
      on conflict (dedupe_key) do nothing;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$function$;

revoke all on function public.queue_listing_review_push() from public, anon, authenticated;

drop trigger if exists queue_listing_review_push on public.listings;
create trigger queue_listing_review_push
  after insert or update of status on public.listings
  for each row execute function public.queue_listing_review_push();

-- ---------------------------------------------------------------- erasure

do $patch$
declare
  def text;
  anchor text := 'begin delete from public.push_subscriptions where user_id = uid; exception when undefined_table then null; end;';
  added text := E'\n  begin delete from public.push_outbox where user_id = uid or (old_email is not null and lower(to_email) = lower(old_email)); exception when undefined_table then null; end;'
             || E'\n  begin delete from public.payout_destinations_seen where user_id = uid; exception when undefined_table then null; end;';
begin
  select pg_get_functiondef('public.admin_anonymise_account(uuid)'::regprocedure) into def;
  if position('public.push_outbox' in def) > 0 then
    return;  -- already patched
  end if;
  if position(anchor in def) = 0 then
    raise exception 'admin_anonymise_account no longer has the push_subscriptions line to patch after — add the push_outbox delete by hand';
  end if;
  execute replace(def, anchor, anchor || added);
end
$patch$;

notify pgrst, 'reload schema';

-- Read back:
--   select relname, relrowsecurity from pg_class where relname in ('push_outbox','payout_destinations_seen');      -- true, true
--   select count(*) from information_schema.role_table_grants
--    where table_name in ('push_outbox','payout_destinations_seen') and grantee in ('anon','authenticated');      -- 0
--   select column_default from information_schema.columns where table_name='notification_preferences' and column_name='push';
--   select count(*) from pg_trigger where tgname like 'queue\_%push%' or tgname like 'queue\_%payout%';   -- 6
--   select position('push_outbox' in pg_get_functiondef('public.admin_anonymise_account(uuid)'::regprocedure)) > 0;
