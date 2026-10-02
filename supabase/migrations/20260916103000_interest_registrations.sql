-- Register your interest — a waiting list kept while sign-up sits behind the
-- coming-soon tiles.
--
-- WHY A TABLE, NOT JUST EMAILS. Real interest is arriving from holiday-let
-- hosts, guest-experience hosts and tradesmen, and an inbox is not a list you
-- can sort, count by area, or mark people off as you open. So each registration
-- is a row.
--
-- WHO CAN READ IT. Nobody but the service role. These are members of the public
-- with no account — name, email, phone and their rough area — so there is no
-- `owner_id = auth.uid()` to gate a read on, and nobody signed in who should see
-- the list but the owner, via the admin page (adminClient, service role). RLS is
-- on with NO policies, which denies anon and authenticated everything, and the
-- grants are revoked too so the intent is stated twice rather than resting on
-- the absence of a policy. The public submit route uses the service role; the
-- browser's anon key never touches this table, so the list cannot be enumerated.

create table if not exists public.interest_registrations (
    id uuid primary key default gen_random_uuid(),

    created_at timestamptz not null default now(),
    -- Bumped when a repeat submission updates an existing row (see the unique
    -- index below); lets the admin list show when someone last got in touch.
    updated_at timestamptz not null default now(),

    -- The tile they chose. Three stable values, so a check constraint is honest
    -- here (unlike region, which follows GUEST_REGIONS in the app and is
    -- validated there).
    category text not null check (category in ('holiday_let', 'guest_experience', 'tradesman')),

    -- Lowercased by the route before it gets here.
    email text not null,
    name text not null,
    phone text,

    -- A GUEST_REGIONS key (rhins/machars/stewartry/nithsdale/annandale/all) —
    -- the same picker the sign-up wizard uses, so the list sorts by area and
    -- reads the same as what they will see if they go on to sign up. Validated
    -- against the canonical list in the route.
    region text,

    -- The "anything else" line — two cottages, an unusual experience — the
    -- sentence that decides who gets rung first.
    notes text,

    -- The owner works the list: 'new' until seen, then contacted / opened /
    -- dismissed. Marking people off is the whole point of keeping it.
    status text not null default 'new' check (status in ('new', 'contacted', 'opened', 'dismissed')),

    -- Kept for spam auditing only, never shown as contact detail.
    ip text,
    user_agent text
);

-- Dedupe: one row per person per category. A repeat submission updates that row
-- rather than piling up duplicates and re-emailing the owner. Someone genuinely
-- interested in two things (a let AND a service) still gets a row for each.
create unique index if not exists interest_registrations_email_category
    on public.interest_registrations (lower(email), category);

-- The admin list: newest first, and by status when working through it.
create index if not exists interest_registrations_created
    on public.interest_registrations (created_at desc);
create index if not exists interest_registrations_status
    on public.interest_registrations (status);

alter table public.interest_registrations enable row level security;

-- No policies. With RLS on and none defined, anon and authenticated can read and
-- write nothing whatever the grants say. The grants go too, so the intent is
-- stated twice. The service role bypasses both.
revoke all on public.interest_registrations from anon, authenticated;

-- PostgREST caches the schema; the table is invisible over the API until it
-- reloads (harmless here — nothing but the service role may touch it).
notify pgrst, 'reload schema';

comment on table public.interest_registrations is
    'Register-your-interest waiting list, captured while sign-up is behind the '
    'coming-soon tiles. Public PII with no auth user; readable only by the '
    'service role (public submit route + admin page). One row per (email, '
    'category); a repeat updates the row.';

-- Read back:
--   select column_name, is_nullable from information_schema.columns
--    where table_name='interest_registrations';
--   -- the table exists; authenticated has no grant on it:
--   select count(*) from information_schema.role_table_grants
--    where table_name='interest_registrations' and grantee in ('anon','authenticated');  -- 0
