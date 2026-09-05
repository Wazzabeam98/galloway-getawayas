-- The ledger gets a column, explicitly, so that running a --check never changes
-- the ledger as a side effect.
--
-- schema_migrations is what tells you whether a migration ran. --record can now
-- store the read-only --check that proved a row, so --status can re-run it and
-- catch the day the schema drifts away from what was recorded. That check needs
-- somewhere to live. It USED to be added by --record itself, with an implicit
-- `add column if not exists` — but a table you consult to know what has run
-- should not quietly grow a column the first time somebody verifies something.
-- So it is a migration like any other: dry run, apply, read back, before any
-- check is attached.
--
-- Nullable on purpose: every existing row is a check-less assumption or an
-- observation until a --check is attached to it, and null is the honest value
-- for "no check recorded".

alter table public.schema_migrations
    add column if not exists verify_sql text;

comment on column public.schema_migrations.verify_sql is
    'Read-only SQL that --record ran to prove this row is applied; --status re-runs it. Null = no check recorded (a legacy assumption, or an observation carrying a checksum instead).';
