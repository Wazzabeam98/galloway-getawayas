-- Push subscriptions: one row per phone or browser that has said yes to
-- notifications from Galloway Getaways.
--
-- WHAT THIS IS FOR. The site is now installable (a PWA) and can send push
-- notifications: a host's new booking, a new message, a guest's confirmed
-- booking. To push to somebody we need the address their browser's push
-- service gave us (the endpoint) and the two keys that encrypt the message for
-- that device. Without this table there is nowhere to keep them, and nothing
-- can be pushed.
--
-- WHO CAN READ IT. Nobody but the service role. An endpoint plus its keys is
-- enough to send a notification to that person's phone, so a browser that
-- could list this table could spam anyone's lock screen. RLS is on with NO
-- policies and every grant to anon and authenticated is revoked, so the intent
-- is stated twice rather than resting on the absence of a policy. The browser
-- only ever reaches it through /api/push/subscribe, which checks who is signed
-- in and writes with the service role. tests/table-grants-guard.test.ts holds
-- this classification.
--
-- ACCOUNT ERASURE. admin_anonymise_account is patched in place (below) to
-- delete the person's subscriptions alongside notification_preferences, so a
-- closed account stops receiving pushes and leaves no device behind. The
-- function is patched from its LIVE definition rather than retyped, so this
-- cannot quietly undo a change made to it since the last migration that
-- defined it; it refuses to apply if the anchor line it inserts after is gone.
--
-- PRE-FLIGHT. Not destructive: a new table, its index, revokes, and one line
-- added to an existing function. Nothing existing is dropped or rewritten.

create table if not exists public.push_subscriptions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    -- The push service's address for this device. Unique: one device belongs
    -- to whoever subscribed on it most recently (a shared iPad that changes
    -- hands moves to the new account rather than notifying both).
    endpoint text not null unique,
    p256dh text not null,
    auth text not null,
    user_agent text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx
    on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- No policies. Service role only.
revoke all on table public.push_subscriptions from anon;
revoke all on table public.push_subscriptions from authenticated;
grant select, insert, update, delete on table public.push_subscriptions to service_role;

comment on table public.push_subscriptions is
    'Web push subscriptions, one per device. Service role only (RLS on, no policies, anon/authenticated revoked) — written by /api/push/subscribe, read by lib/push.ts.';

-- Erasure: add the subscriptions to what admin_anonymise_account deletes.
do $patch$
declare
  def text;
  anchor text := 'begin delete from public.notification_preferences where user_id = uid; exception when undefined_table then null; end;';
  added text := E'\n  begin delete from public.push_subscriptions where user_id = uid; exception when undefined_table then null; end;';
begin
  select pg_get_functiondef('public.admin_anonymise_account(uuid)'::regprocedure) into def;
  if position('public.push_subscriptions' in def) > 0 then
    return;  -- already patched
  end if;
  if position(anchor in def) = 0 then
    raise exception 'admin_anonymise_account no longer has the notification_preferences line to patch after — add the push_subscriptions delete by hand';
  end if;
  execute replace(def, anchor, anchor || added);
end
$patch$;

notify pgrst, 'reload schema';

-- Read back:
--   select relrowsecurity from pg_class where relname = 'push_subscriptions';            -- true
--   select count(*) from pg_policies where tablename = 'push_subscriptions';             -- 0
--   select count(*) from information_schema.role_table_grants
--    where table_name = 'push_subscriptions' and grantee in ('anon','authenticated');    -- 0
--   select position('push_subscriptions' in pg_get_functiondef('public.admin_anonymise_account(uuid)'::regprocedure)) > 0;  -- true
