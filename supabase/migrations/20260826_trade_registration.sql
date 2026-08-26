-- Registration for the trades where the law says who may do the work.
--
-- Three of the maintenance trades are not a matter of being good at the job:
--
--   gas         Gas Safe. A real register, one number, and it lapses yearly.
--   oil         OFTEC. Same shape.
--   electrics   Part P is a section of the Building Regulations, NOT a
--               register — there is no such thing as a "Part P number". What
--               an electrician actually holds is membership of a competent
--               person scheme, so the scheme has to be captured alongside the
--               number or the number means nothing.
--
-- A TABLE, NOT A PAIR OF COLUMNS
--
-- This started as `registration_scheme` and `registration_number` on the
-- listing, which is wrong here in particular. Most of Dumfries & Galloway is
-- off the gas grid, so a rural plumber who does gas in the towns and oil
-- everywhere else is the ordinary case, not the awkward one — and that plumber
-- holds two numbers from two bodies at once. One column pair can only ever
-- hold one of them, so the second would go uncaptured and unchecked.
--
-- One row per registration, then. The primary key stops the same listing
-- claiming two Gas Safe numbers, and says nothing about holding a Gas Safe and
-- an OFTEC at the same time, which is what actually happens.
--
-- PER PROVIDER ROW, WHICH IS PER TRADE
--
-- The requirement attaches to the trade. Somebody who plumbs and joins is two
-- businesses here, one per trade, and only the plumbing one needs a Gas Safe
-- number — approving the joinery must not be blocked on it.
--
-- WHY IT IS PUBLIC
--
-- Readable by anyone once the listing is approved, the number included. That
-- is deliberate: the Gas Safe register is publicly searchable by design, so an
-- owner with a broken boiler can take the number off the listing and check it
-- themselves. A registration number is not a secret; it is a claim that can be
-- verified, and one nobody can check is worth very little.
--
-- WHY THE VERIFICATION CANNOT BE FAKED
--
-- Providers write their own rows from the browser, so anything the browser can
-- set is something a provider could set for themselves. A `verified_at` they
-- could write would be a tick box saying "I am registered", which is worthless.
--
-- So `verified_number` holds the number exactly as it stood when a human
-- looked at it. Verified means verified_number equals number. Change the
-- number and it stops matching, in the same statement, whether or not the
-- provider wanted it to — there is no moment where an unchecked number is
-- wearing an old tick. Both verified columns are written ONLY by the admin
-- decision route under the service role, the same trick and for the same
-- reason as `approved_digest`.
--
-- THE TOGGLES
--
-- `does_gas` and `does_oil` sit on the plumber's listing rather than being
-- trades of their own, because most plumbers do one or both and splitting the
-- trade would put the same firm in two places. They are columns rather than
-- entries in service_provider_extras because an extra is a thing you sell, and
-- these gate whether the listing may be approved at all — the queue has to see
-- them on the row it is deciding about, and so does an owner with a dead
-- boiler deciding who to ring.
--
-- Pre-flight:
--   select table_name from information_schema.tables
--    where table_schema = 'public' and table_name = 'service_provider_registrations';
--
-- Safe to run twice. Run on test first, then production.

alter table "public"."service_providers"
    add column if not exists "does_gas" boolean not null default false;

alter table "public"."service_providers"
    add column if not exists "does_oil" boolean not null default false;

create table if not exists "public"."service_provider_registrations" (
    "provider_id"     uuid not null references "public"."service_providers"("id") on delete cascade,
    "scheme"          text not null,
    "number"          text not null,

    -- Service role only.
    "verified_at"     timestamptz,
    "verified_by"     uuid references "auth"."users"("id"),
    "verified_number" text,

    -- Gas Safe registration runs a year at a time. A number checked in 2026
    -- says nothing in 2028, and knowing when to look again is most of the
    -- value of having checked at all.
    "expires_at"      date,

    "created_at"      timestamptz not null default now(),
    "updated_at"      timestamptz not null default now(),

    primary key ("provider_id", "scheme"),

    constraint "service_provider_registrations_scheme_check"
        check ("scheme" in (
            'gas_safe',
            'oftec',
            'part_p_niceic',
            'part_p_napit',
            'part_p_elecsa',
            'part_p_stroma'
        )),

    -- A blank number is not a registration. Without this, an empty string
    -- would sit in the queue for ever as something to check.
    constraint "service_provider_registrations_number_check"
        check (btrim("number") <> '')
);

create index if not exists "service_provider_registrations_unverified_idx"
    on "public"."service_provider_registrations" ("provider_id")
    where "verified_at" is null;

alter table "public"."service_provider_registrations" enable row level security;

-- COLUMN-LEVEL GRANTS, THE SAME WAY THE MONEY COLUMNS ARE DONE
--
-- Row-level security is per row, not per column: the owner policy below lets a
-- provider write their own registration rows, and without this that would
-- include `verified_at` and `verified_number`. They could tick themselves off
-- as checked, which is the one thing this table exists to prevent.
--
-- So the verified columns and `expires_at` are simply not grantable to a
-- signed-in user. Nothing in the browser may write them at all; only the admin
-- decision route, running under the service role, can. The sign-up sends only
-- the three columns it owns, so an ordinary upsert is unaffected — a payload
-- that never mentions a column needs no permission on it.
--
-- If a save ever fails with "permission denied for table
-- service_provider_registrations", something in the browser has started
-- sending a column it should not. That is the fault, not this grant.
revoke all on table "public"."service_provider_registrations" from "anon", "authenticated";

grant select on table "public"."service_provider_registrations" to "anon", "authenticated";
grant insert ("provider_id", "scheme", "number", "created_at", "updated_at")
    on table "public"."service_provider_registrations" to "authenticated";
grant update ("number", "updated_at")
    on table "public"."service_provider_registrations" to "authenticated";
-- Deleting is theirs: a plumber who gives up gas work takes the row off. RLS
-- still holds it to their own listings.
grant delete on table "public"."service_provider_registrations" to "authenticated";

grant all on table "public"."service_provider_registrations" to "service_role";

drop policy if exists "owners manage their own registrations" on "public"."service_provider_registrations";
create policy "owners manage their own registrations"
    on "public"."service_provider_registrations"
    using (exists (
        select 1 from "public"."service_providers" p
         where p."id" = "service_provider_registrations"."provider_id"
           and p."owner_id" = auth.uid()
    ))
    with check (exists (
        select 1 from "public"."service_providers" p
         where p."id" = "service_provider_registrations"."provider_id"
           and p."owner_id" = auth.uid()
    ));

drop policy if exists "registrations of approved providers are public" on "public"."service_provider_registrations";
create policy "registrations of approved providers are public"
    on "public"."service_provider_registrations"
    for select
    using (exists (
        select 1 from "public"."service_providers" p
         where p."id" = "service_provider_registrations"."provider_id"
           and p."status" = 'approved'
    ));

-- TWO LOCKS, NOT ONE
--
-- The grants above stop a provider writing `verified_at`. `verified_number` is
-- the second lock, and it is the one that survives a mistake in the first:
-- lib/serviceProviders.ts `registrationVerified` never reads `verified_at`
-- alone, it requires `verified_number` to still equal `number`. So a provider
-- who was checked in March and quietly edits their number in June is not
-- verified in June, and nobody has to remember to clear anything.
--
-- Belt and braces on purpose. This is the field where being wrong means
-- sending somebody unregistered to a guest's boiler.
