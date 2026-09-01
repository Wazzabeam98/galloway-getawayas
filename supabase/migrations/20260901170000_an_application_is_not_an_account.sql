-- An application is not an account.
--
-- ALREADY APPLIED TO PRODUCTION, on 1 September 2026, under the filename
-- 20260901120000_an_application_is_not_an_account.sql. It was renamed because
-- the guest-experiences session merged 20260901120000_one_experience_per_chef_
-- per_date.sql onto master while this was in flight, and two migrations may not
-- share a timestamp — tests/migrations.test.ts says so, and it is the only
-- thing that noticed.
--
-- The database does not record filenames, so the rename changes nothing that
-- has run. Re-running it is harmless anyway: every statement is `if not
-- exists` or a repeat of a revoke. This note is here because there is no
-- schema_migrations table, so a filename is the only record we keep of what
-- has been applied — which is the gap that made this collision possible.
--
-- WHAT THIS IS FOR
--
-- /api/services/apply creates a real Supabase auth user on the first press,
-- from a public form, with no proof that the person filling it in owns the
-- address they typed. So a stranger can put your email into it and you now
-- have an account you did not make: you cannot sign up later — the address is
-- taken — and you get a confirmation email you never asked for. The rate limit
-- bounds the volume. It does nothing about one deliberate squat.
--
-- The fix is to hold the application somewhere that is not the auth system
-- until the address has been proved, and only then make the account. This is
-- that somewhere.
--
-- WHY EMAIL IS NOT UNIQUE HERE
--
-- Deliberately. Two people may hold a pending application on one address at
-- once, and only whoever opens the link owns the outcome. A unique constraint
-- would move the squat rather than remove it — a stranger could still bag your
-- address, just in this table instead of auth.users.
--
-- WHY THE TOKEN IS STORED AS A HASH
--
-- It is a bearer credential: whoever holds it can create an account on this
-- address. Storing what we email would mean a read of this table is a set of
-- working links. The row holds sha256 of it and nothing that can be replayed.
--
-- TWO CLOCKS, AND THEY ARE NOT THE SAME
--
--   token_sent_at + 14 days   the LINK stops working
--   created_at    + 90 days   the APPLICATION is deleted
--
-- A tradesman opening a dead link three weeks later has lost nothing: the row
-- is still there, and pressing once mints him a new token against it. The
-- second clock exists because this holds a real person's name, phone and
-- business details, and keeping that indefinitely because somebody never
-- finished a form is not a position worth defending.
--
-- NOTHING IN THE BROWSER MAY READ THIS
--
-- RLS on with no policies at all, and the grants revoked. Every row belongs to
-- somebody who has no account yet, so there is no `owner_id = auth.uid()` to
-- write and nobody who should be reading it but the service role.

create table if not exists public.service_applications (
    id uuid primary key default gen_random_uuid(),

    -- Lowercased by the route before it gets here.
    email text not null,
    name text,

    -- Denormalised out of the payload so the chase list and the alert can be
    -- built without parsing json, and so a phone number is one column away
    -- when somebody is trying to ring them.
    trade text not null,
    business_name text not null,
    contact_phone text,

    -- The whole application as the wizard sent it: provider, areas, extras,
    -- prices, registrations, skills. Promoted into the real tables on the day
    -- it is claimed, through the same whitelists the route already applies.
    payload jsonb not null,

    -- sha256 of the token that was emailed. Never the token.
    token_hash text not null,
    token_sent_at timestamptz not null default now(),
    resend_count integer not null default 0,
    last_resend_at timestamptz,

    created_at timestamptz not null default now(),

    -- Set when the link is opened and the account is made. A claimed row is
    -- kept, not deleted: it is the evidence of what was submitted and when.
    claimed_at timestamptz,
    provider_id uuid references public.service_providers(id) on delete set null
);

-- One row per live token. Not unique on email — see the note above.
create unique index if not exists service_applications_token
    on public.service_applications (token_hash);

-- The chase list: everything still waiting on its applicant, oldest first.
create index if not exists service_applications_unclaimed
    on public.service_applications (created_at)
    where claimed_at is null;

alter table public.service_applications enable row level security;

-- No policies. With RLS on and none defined, anon and authenticated can read
-- and write nothing, whatever the grants say. The grants go too, so the
-- intent is stated twice rather than resting on the absence of a policy.
revoke all on public.service_applications from anon, authenticated;

comment on table public.service_applications is
    'A services application held before the address has been proved. No auth '
    'user exists for these rows. Promoted into service_providers when the '
    'emailed link is opened; swept 90 days after created_at if it never is.';

comment on column public.service_applications.token_hash is
    'sha256 of the emailed token. The token itself is never stored — a read of '
    'this table must not be a set of working links.';
