-- The restore drill's read-only role can read sequences, as it reads tables.
--
-- WHAT GOES WRONG WITHOUT IT. pg_dump reads every sequence's current value
-- (SELECT last_value, is_called) so a restore picks up numbering where
-- production left off. restore_drill_ro was granted SELECT on tables only, so
-- the first real drill run (19 Oct 2026) stopped at
--   permission denied for sequence agreement_acceptances_id_seq
-- and the drill could never pass. On production two sequences are affected:
-- agreement_acceptances_id_seq and rate_limit_hits_id_seq.
--
-- SELECT on a sequence reads its value only. It does NOT allow nextval or
-- setval (those need USAGE / UPDATE), so the role still cannot change anything.
-- The default privilege covers sequences created later, the same way the
-- runbook's setup covers tables (docs/BACKUP-AND-RESTORE.md).
--
-- Guarded on the role existing: it is created by hand on production only (the
-- runbook), and TEST has no drill.
--
-- PRE-FLIGHT. Not destructive: grants only, no rows, no columns.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'restore_drill_ro') then
    grant select on all sequences in schema public to restore_drill_ro;
    alter default privileges in schema public grant select on sequences to restore_drill_ro;
  end if;
end
$$;

-- Read back:
--   select c.relname, has_sequence_privilege('restore_drill_ro', c.oid, 'SELECT')
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where c.relkind = 'S' and n.nspname = 'public';
