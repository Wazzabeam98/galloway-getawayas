-- Editing a live listing must not take it down.
--
-- Until now `status` did two jobs at once: "have I approved this" and "is this
-- visible". So the only way to say "I need to look at this again" was to say
-- "take them down" — and an approved provider fixing a typo in their
-- description knocked themselves back to pending_review and vanished, with no
-- idea why.
--
-- Two columns separate the jobs:
--
--   `changes_pending_at`  when an approved provider last changed something
--                         that wants re-checking. They stay `approved` and
--                         stay live; this only decides whether they appear in
--                         the admin queue.
--   `approved_digest`     a fingerprint of the reviewable fields as they stood
--                         when they were last approved.
--
-- The digest is what makes the gate trustworthy. Providers write their own row
-- from the browser under `owners manage their own provider`, so anything the
-- browser sets is something the provider could decline to set. The digest is
-- written ONLY by the admin decision route under the service role, so
-- "reviewable fields differ from the digest" is a fact the provider cannot
-- suppress — the queue can work it out at read time whether or not the save
-- route ever ran.
--
-- Note what is deliberately NOT reviewable: contact details and coverage.
-- Contact details getting stale costs the provider work and there is nothing
-- to judge. Coverage is their own knowledge, changes legitimately and often,
-- and making it slow means people under-declare it and matching gets worse.
-- Blanket coverage, if it ever becomes a problem, is a rule at approval time,
-- not a queue.
--
-- Pre-flight, to see whether this has already been run:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'service_providers'
--      and column_name in ('changes_pending_at', 'approved_digest');
--
-- Safe to run twice. Run on test first, then production.

alter table "public"."service_providers"
    add column if not exists "changes_pending_at" timestamptz;

alter table "public"."service_providers"
    add column if not exists "approved_digest" text;

-- Only rows that are live and have diverged since approval, which is a small
-- slice of a small table — but it is the query the admin queue runs on every
-- load, so it is worth having.
create index if not exists "service_providers_changes_pending_idx"
    on "public"."service_providers" ("changes_pending_at")
    where "changes_pending_at" is not null;

-- No backfill. A null digest means "nothing outstanding" — anything approved
-- before this shipped is trusted until its next approval fills the digest in.
--
-- The alternative was to compute a digest for existing rows here, which would
-- mean writing the same fingerprint twice, once in SQL and once in TypeScript,
-- and they would drift. The cost of trusting instead is that a provider
-- approved before today gets one unreviewed edit. There is one such row on
-- test and none on production, because this table has never been created
-- there.
