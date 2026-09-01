-- What has actually been applied, on the database that would know.
--
-- APPLIED TO BOTH DATABASES on 1 September 2026, originally as
-- 20260901180000_a_record_of_what_has_run.sql. Renamed when the other session
-- merged 20260901180000_provider_item_menu.sql — the second timestamp
-- collision between two sessions in one day, and the reason the second half of
-- this comment used to have to exist. The ledger row was carried across with
-- it, so the observation and its checksum still stand.
--
-- WHY THIS EXISTS
--
-- Migrations here are applied by hand and nothing recorded that they ran. The
-- only evidence was a filename in a folder, and a folder is a list of what
-- SOMEBODY MEANT to run, not a record of what did.
--
-- Two things went wrong on 1 September 2026 because of that gap, on the same
-- day. Two sessions each wrote a migration numbered 20260901120000, which only
-- a test noticed; and renaming one of them to break the tie needed a paragraph
-- of comment explaining that it had already been applied under its old name,
-- because nothing else could say so.
--
-- WHAT THE CHECKSUM IS FOR, WHICH IS THE BETTER HALF
--
-- A filename tells you a migration ran. It cannot tell you the file still says
-- what it said when it ran. A migration edited afterwards — a widened check, a
-- forgotten column added to a create table — leaves the name claiming applied
-- and the database not matching it, and nobody finds that by looking: the file
-- reads correctly and the schema is simply not what it describes.
--
-- That is the same shape as every stale note that has cost time on this
-- project. The difference is that this one can be checked, by storing what the
-- file said at the moment it ran.
--
-- BACKFILLED IS NOT THE SAME AS OBSERVED
--
-- Every migration written before this one has to be marked applied on
-- assumption — nobody watched them run, and there is no record to import. The
-- assumption is well founded: on 1 September 2026 all 4,334 schema facts in
-- public, and every storage bucket and policy, were compared between the two
-- projects and found identical, and both matched the folder.
--
-- It is still an assumption, so the column says so and `migrate.mjs --status`
-- prints it as one. A ledger that quietly presents inference as observation is
-- worse than no ledger, because it is believed.

create table if not exists public.schema_migrations (
    -- The file name, which is the only durable identity a migration has here.
    filename text primary key,

    applied_at timestamptz not null default now(),

    -- sha256 of the file's bytes at the moment it was applied. Null for rows
    -- that were backfilled: we do not know what the file said when it ran, and
    -- guessing would be the exact dishonesty this column exists to prevent.
    checksum text,

    -- false: this row was written by the runner as the migration committed.
    -- true:  we are asserting it ran, from the state of the schema.
    backfilled boolean not null default false,

    -- Free text, for the assertions. "compared against test, 1 Sept 2026".
    note text
);

comment on table public.schema_migrations is
    'What has been applied to THIS database. Written by scripts/migrate.mjs as '
    'each migration commits. Rows with backfilled = true are assertions from '
    'the schema, not observations of a run.';

comment on column public.schema_migrations.checksum is
    'sha256 of the migration file when it was applied. A mismatch against the '
    'file today means the file was edited after it ran, which no amount of '
    'reading the folder would reveal.';

-- Nothing in a browser has any business reading this, and RLS with no policies
-- is what actually stops it — the grants are revoked as well so the intent is
-- stated twice rather than resting on the absence of a policy.
alter table public.schema_migrations enable row level security;
revoke all on public.schema_migrations from anon, authenticated;
