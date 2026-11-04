-- AI-suggested replies for hosts (behind a flag): what each draft cost, and the
-- monthly spend alerts. Both service-role only — written and read by
-- app/api/messages/threads/[bookingId]/suggest-reply and /admin/ai-usage.
--
-- Additive only: two new tables.

-- One row per draft asked for: who, on which booking, which model, the tokens
-- the API reported and what that cost. `fake` marks a preview with no API key
-- (the stand-in answer), which costs nothing.
create table if not exists public.ai_usage_log (
    id uuid primary key default gen_random_uuid(),
    feature text not null default 'reply_suggestion',
    user_id uuid references public.profiles(id) on delete set null,
    booking_id uuid references public.bookings(id) on delete set null,
    model text not null,
    input_tokens integer not null default 0,
    output_tokens integer not null default 0,
    cost_usd numeric(12, 6) not null default 0,
    outcome text not null default 'ok',
    fake boolean not null default false,
    created_at timestamptz not null default now()
);
create index if not exists ai_usage_log_created_idx on public.ai_usage_log (created_at desc);
create index if not exists ai_usage_log_user_created_idx on public.ai_usage_log (user_id, created_at desc);

alter table public.ai_usage_log enable row level security;
revoke all on table public.ai_usage_log from anon;
revoke all on table public.ai_usage_log from authenticated;

-- One row per alert sent: a calendar month (Europe/London, 'YYYY-MM') and the
-- level reached ('80' or '100'). The primary key is what stops a second email
-- for the same level in the same month.
create table if not exists public.ai_spend_alerts (
    month text not null,
    level text not null,
    spent_usd numeric(12, 6) not null,
    cap_usd numeric(12, 2) not null,
    created_at timestamptz not null default now(),
    primary key (month, level)
);

alter table public.ai_spend_alerts enable row level security;
revoke all on table public.ai_spend_alerts from anon;
revoke all on table public.ai_spend_alerts from authenticated;

-- Read back:
--   select relrowsecurity from pg_class where relname in ('ai_usage_log','ai_spend_alerts');  -- true, true
--   select has_table_privilege('authenticated','public.ai_usage_log','select');               -- false
