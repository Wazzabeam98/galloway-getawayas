-- Somewhere to count what strangers have just done.
--
-- WHAT THIS IS FOR. POST /api/services/apply runs as the service role with no
-- auth gate of any kind — by design, because a tradesman has no account until
-- this route makes them one. So a stranger can call it in a loop and, for each
-- call, get Supabase to send a "confirm your signup" email. The project's
-- outbound mail is one shared allowance: exhaust it and real password resets
-- and confirmations stop working site-wide. That is the failure worth
-- preventing — not the junk rows, the outage.
--
-- WHY A TABLE AND NOT AN IN-MEMORY COUNTER. Vercel runs this on however many
-- lambda instances it feels like, each with its own memory, so an in-process
-- counter limits nothing in particular. The count has to live where every
-- instance can see it.
--
-- SERVICE ROLE ONLY. Nothing in a browser has any business reading or writing
-- this: it is a log of when unauthenticated people hit a public route, and the
-- keys in it are IP addresses and email addresses.
create table if not exists public.rate_limit_hits (
    id          bigserial primary key,
    bucket      text        not null,
    key         text        not null,
    created_at  timestamptz not null default now()
);

-- The only query that runs against this: count the hits in one bucket, for one
-- key, since a moment. created_at descending so the recent end is the cheap end.
create index if not exists rate_limit_hits_lookup
    on public.rate_limit_hits (bucket, key, created_at desc);

alter table public.rate_limit_hits enable row level security;

-- No policies, deliberately. RLS with no policy denies everything to anon and
-- authenticated; the service role bypasses RLS, which is the only caller.
-- Revoked as well, so a policy added later cannot quietly open it.
revoke all on table public.rate_limit_hits from anon;
revoke all on table public.rate_limit_hits from authenticated;
revoke all on sequence public.rate_limit_hits_id_seq from anon;
revoke all on sequence public.rate_limit_hits_id_seq from authenticated;

-- Read back:
--   select relrowsecurity from pg_class where relname = 'rate_limit_hits';   -- expect true
--   select count(*) from pg_policies where tablename = 'rate_limit_hits';    -- expect 0
--   select count(*) from information_schema.table_privileges
--    where table_name = 'rate_limit_hits' and grantee in ('anon','authenticated');  -- expect 0
