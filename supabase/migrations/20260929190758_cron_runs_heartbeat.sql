-- A heartbeat for scheduled jobs, so a cron that stops running is NOTICED.
--
-- WHY (B's audit, must-fix #2)
--
-- The subscription/trial billing cron has no charge-retry to make a stalled run
-- obvious: if it stops firing (a rotated CRON_SECRET, a scheduler misconfig),
-- nobody is ever set 'unpaid', everyone keeps a free listing, and — as the code's
-- own comment warns — the failure is completely silent. This table records the
-- last time each job finished, so a separate daily check (the error-digest cron)
-- can spot a job that hasn't run when it should have and alert the directors the
-- way a money failure does.
--
-- One row per job, upserted on each successful run. Service-role only: the crons
-- write it under the admin client, nothing in a browser reads or writes it.
--
-- Safe to run twice.

create table if not exists "public"."cron_runs" (
    "job"      text primary key,
    "ran_at"   timestamptz not null default now(),
    "ok"       boolean not null default true,
    "detail"   text
);

alter table "public"."cron_runs" enable row level security;

revoke all on table "public"."cron_runs" from "anon", "authenticated";
grant all on table "public"."cron_runs" to "service_role";
