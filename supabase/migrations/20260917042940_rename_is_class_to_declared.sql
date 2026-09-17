-- Rename slot_sessions.is_class -> declared.
--
-- WHY. The previous migration (…_dated_class_as_a_slot_session) called the flag
-- `is_class`, but the capability is general: most declared dated sessions won't be
-- "classes" — a whisky tasting, a photographer's clear morning, a masseuse fitting
-- one in, a personal-training slot. The flag means "a provider-declared dated
-- session that reserves its interval and is offered", so `declared` reads true to
-- whoever meets it next; `is_class` would mislead.
--
-- Done as a forward-only rename (not by editing the original) because that one was
-- already applied to test. Postgres rewrites every dependent object on a column
-- rename, so the no-overlap exclusion predicate and the two checks follow the new
-- name automatically; only the constraint NAMES are renamed here, for the reader.
--
-- TEST ONLY, like the migration it renames. Neither has reached production, so no
-- production rename is in play. Additive/idempotent-ish: guarded so a re-run after
-- the rename is a no-op.

do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'slot_sessions' and column_name = 'is_class'
    ) then
        alter table public.slot_sessions rename column is_class to declared;
    end if;
end $$;

alter table public.slot_sessions rename constraint slot_sessions_class_has_duration to slot_sessions_declared_has_duration;
alter table public.slot_sessions rename constraint slot_sessions_class_not_block to slot_sessions_declared_not_block;

comment on column public.slot_sessions.declared is
    'True for a provider-DECLARED dated session: a capacity-bearing session created '
    'up front (before any booking), with an optional title. Most are not classes — '
    'a tasting, a one-off, a session fitted round another job. Unlike a block it is '
    'offered to guests and carries real seats; unlike an open hour it exists at zero '
    'seats and reserves its interval. Counted by slot_sessions_no_overlap so an '
    'open-hours booking cannot land on top of a declared session.';
comment on constraint slot_sessions_no_overlap on public.slot_sessions is
    'Authoritative non-overlap guard: for one provider on one date, no two rows '
    'that are BOOKED (seats_taken > 0), a BLOCK (blocked), or a DECLARED session '
    '(declared) may hold overlapping block_minutes. No-op for a fixed-grid provider '
    'with none of these; bites per-treatment overlaps, partial blocks, and any '
    'booking overlapping a declared session.';

notify pgrst, 'reload schema';

-- Read back (after --apply --read, or by hand on test):
--   select column_name from information_schema.columns
--    where table_name='slot_sessions' and column_name in ('declared','is_class') order by 1;  -- expect only 'declared'
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid='public.slot_sessions'::regclass and conname like 'slot_sessions_%' order by conname;
