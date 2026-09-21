-- restore drill runs log table
--
-- WHAT THIS IS FOR, AND WHAT GOES WRONG WITHOUT IT.
--
-- The quarterly restore drill (a GitHub Action — see docs/BACKUP-AND-RESTORE.md)
-- restores a full copy of the production application data into a throwaway
-- Postgres and checks every table restored intact. It needs somewhere durable to
-- record that it ran and how it went, for two readers:
--
--   1. the 8am error digest, which flags a drill that FAILED or one that has not
--      run when it was due — a silent backup that has quietly stopped being
--      tested is exactly the thing the insurer is asking us to prevent; and
--   2. the runbook's audit trail, so "recovery is tested quarterly" is a claim
--      with dated evidence behind it rather than an assertion.
--
-- Without this table the drill can still run and email its result, but a missed
-- run leaves no trace, and nothing notices that the last successful test was
-- three quarters ago. The table IS the watchdog's memory.
--
-- PRE-FLIGHT: not destructive; creates one new table and nothing else. The
-- read-only drill role (restore_drill_ro) is granted INSERT on it separately, in
-- the role SQL in the runbook — the role owns no application data and can write
-- nowhere else.

create table if not exists public.restore_drill_runs (
    id                   uuid primary key default gen_random_uuid(),
    -- when the drill finished (not when it started) — the moment the result
    -- below became true.
    run_at               timestamptz not null default now(),
    -- 'pass' or 'fail'. Text, not an enum, so a future third state (e.g.
    -- 'partial') does not need a migration to record.
    status               text not null check (status in ('pass', 'fail')),
    -- 'schedule' or 'manual' — a quarterly cron run vs a hand-triggered one, so
    -- the digest's "overdue?" clock counts only the runs that were meant to keep
    -- the schedule.
    trigger              text not null default 'schedule',
    -- how many tables the drill compared source-to-target.
    tables_checked       integer,
    -- the tables whose row counts did NOT match, as [{table, source, target}].
    -- Empty on a pass; the evidence of what was wrong on a fail.
    mismatches           jsonb not null default '[]'::jsonb,
    -- did the listings content hash match end to end.
    listings_hash_match  boolean,
    -- the Postgres version pair, e.g. "source 17.6 / target 17.11".
    pg_versions          text,
    -- a one-line human summary or, on a fail, the error.
    detail               text,
    created_at           timestamptz not null default now()
);

comment on table public.restore_drill_runs is
    'One row per quarterly database restore drill (see docs/BACKUP-AND-RESTORE.md). Written by the restore_drill_ro role from CI; read by the 8am digest to flag a failed or overdue drill.';

-- Read straight back by the digest, newest first.
create index if not exists restore_drill_runs_run_at_idx
    on public.restore_drill_runs (run_at desc);
