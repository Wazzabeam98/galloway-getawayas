-- Move a slot booking (and its whole family) to another session — atomically.
--
-- WHAT A MOVE IS. A guest changes the date/time of a confirmed slot booking. The
-- booking's seats leave the old session and land on a new one; the order rows are
-- repointed to the new session and re-dated. A per-person booking can carry TOP-UP
-- children (added places on the same session, linked by parent_order_id — see
-- 20260920123742): those seats were bought on the SAME session and must ride along.
-- So a move is a FAMILY operation, and it is ALL-OR-NOTHING: either the whole
-- family lands on the new session, or nobody moves and the old session is left
-- exactly as it was. A half-moved family would split one party across two times and
-- corrupt both sessions' seat counts.
--
-- WHY AN RPC. The move touches four things that must agree — the target's seats,
-- the source's seats, and every family row's session/date — and it re-verifies the
-- target's capacity UNDER LOCK, so two guests racing for the last places on the
-- same target cannot both win. Doing that across four HTTP round-trips has a race
-- in every gap; doing it in one SECURITY DEFINER function makes it one transaction.
-- If anything raises (including the no-overlap exclusion firing as the target's
-- seats go 0 -> N), the whole function rolls back and the source is untouched. This
-- is the same compare-and-swap discipline the booking claim uses
-- (20260903174512), lifted to a two-session swap.
--
-- MONEY. A same-price move is a pure seat/session repoint — no charge, no refund —
-- so no money moves here. A price delta on a dearer/cheaper session, and the
-- guest-facing date picker, are a later layer on top of this engine; this migration
-- is the atomic swap and its audit trail only.
--
-- TEST ONLY, like the slot migrations it builds on. It must not merge to master
-- until it has reached production (the deploy-time gate enforces that on production
-- builds; preview builds fail open). Additive and idempotent.

-- --------------------------------------------------------------------------
-- 1. Audit trail. Every row that moves records where it came from, when, and how
--    many times it has moved — per ORDER row (parent and each child), so a moved
--    family is auditable charge by charge, the same reason a top-up is its own row
--    and not a mutated total. NULL / 0 on every existing row: nothing has moved.
--    on delete set null mirrors slot_session_id: a session is never hard-deleted
--    in normal operation, but if one ever were, the audit pointer nulls rather
--    than blocking the delete.
-- --------------------------------------------------------------------------
alter table public.service_orders
    add column if not exists moved_from_session_id uuid
        references public.slot_sessions(id) on delete set null;
alter table public.service_orders
    add column if not exists moved_at timestamptz;
alter table public.service_orders
    add column if not exists move_count integer not null default 0;

comment on column public.service_orders.moved_from_session_id is
    'Set when a slot order is MOVED to another session: the slot_sessions.id it '
    'was on immediately before this move. NULL on an order that has never moved.';
comment on column public.service_orders.moved_at is
    'When this order was last moved to another session. NULL if never moved.';
comment on column public.service_orders.move_count is
    'How many times this order has been moved between sessions. 0 = never moved. '
    'Stamped on the parent AND every confirmed top-up child, since a family moves '
    'together.';

-- --------------------------------------------------------------------------
-- 2. The atomic family move.
--
--    Returns jsonb. On success: {ok:true, seats, moved, from_session, to_session,
--    from_date, from_time, to_date, to_time} — the caller uses the two (date,time)
--    pairs to tell the provider what changed. On a handled refusal: {ok:false,
--    error:<code>} with the source untouched. An UNHANDLED raise (e.g. the
--    no-overlap exclusion, 23P01) also leaves the source untouched, because the
--    whole function is one transaction.
--
--    Error codes: no-order, not-parent (you move the original, not a top-up),
--    not-confirmed, not-a-slot, family-drift (a confirmed child sits on a
--    different session — the family is not really together, so refuse rather than
--    mis-count seats), no-seats, no-target, same-session, other-provider,
--    target-blocked, past-cutoff (target is inside its own free-cancel window),
--    target-not-ready (an empty open-hour row with no length to reserve),
--    mode-clash (private vs shared), no-room (target can't fit the whole family).
--
--    SECURITY DEFINER: the caller (the move route) has already checked the
--    signed-in user is the order's payer. The function only ever moves a family
--    the caller named, and only to a session of the SAME provider.
-- --------------------------------------------------------------------------
create or replace function public.move_order_family_to_session(
    p_order uuid,
    p_target_session uuid,
    p_window_hours integer default 48
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_parent          public.service_orders%rowtype;
    v_source          public.slot_sessions%rowtype;
    v_target          public.slot_sessions%rowtype;
    v_family_ids      uuid[];
    v_seats           integer;
    v_drift           integer;
    v_family_private  boolean;
    v_deadline        timestamptz;
    v_establish       boolean;
begin
    -- The parent — the row the guest acts on. A top-up child cannot be moved on
    -- its own; you move the whole family from the original order.
    select * into v_parent from public.service_orders where id = p_order for update;
    if not found then
        return jsonb_build_object('ok', false, 'error', 'no-order');
    end if;
    if v_parent.parent_order_id is not null then
        return jsonb_build_object('ok', false, 'error', 'not-parent');
    end if;
    if v_parent.status <> 'confirmed' then
        return jsonb_build_object('ok', false, 'error', 'not-confirmed');
    end if;
    if v_parent.slot_session_id is null then
        return jsonb_build_object('ok', false, 'error', 'not-a-slot');
    end if;

    -- Lock the whole family: the parent plus every CONFIRMED top-up child. (FOR
    -- UPDATE cannot ride an aggregate, so lock first, then read the locked rows.)
    perform 1
       from public.service_orders
      where (id = v_parent.id or parent_order_id = v_parent.id)
        and status = 'confirmed'
      for update;

    -- CAVEAT GUARD. The move assumes the whole family sits on ONE session. If a
    -- confirmed child has drifted off the parent's session, refuse — the seat
    -- arithmetic would be wrong. (Verified empty on test at build time; kept as a
    -- hard floor.)
    select count(*) into v_drift
      from public.service_orders
     where parent_order_id = v_parent.id
       and status = 'confirmed'
       and slot_session_id is distinct from v_parent.slot_session_id;
    if v_drift > 0 then
        return jsonb_build_object('ok', false, 'error', 'family-drift');
    end if;

    select array_agg(id), coalesce(sum(coalesce(quantity, 1)), 0)
      into v_family_ids, v_seats
      from public.service_orders
     where (id = v_parent.id or parent_order_id = v_parent.id)
       and status = 'confirmed';
    if v_seats <= 0 then
        return jsonb_build_object('ok', false, 'error', 'no-seats');
    end if;

    -- Lock source and target.
    select * into v_source from public.slot_sessions where id = v_parent.slot_session_id for update;
    select * into v_target from public.slot_sessions where id = p_target_session for update;
    if v_target.id is null then
        return jsonb_build_object('ok', false, 'error', 'no-target');
    end if;
    if v_target.id = v_source.id then
        return jsonb_build_object('ok', false, 'error', 'same-session');
    end if;
    if v_target.provider_id <> v_source.provider_id then
        return jsonb_build_object('ok', false, 'error', 'other-provider');
    end if;
    if v_target.blocked then
        return jsonb_build_object('ok', false, 'error', 'target-blocked');
    end if;

    -- CUTOFF. You cannot move INTO a session that is already inside its own
    -- free-cancellation window — that lands the family's money on a slot they can
    -- no longer freely leave. The deadline is the session start less the
    -- provider's window, reading the stored date/time as UTC to match
    -- lib/serviceSlots.freeCancelDeadline.
    v_deadline := ((v_target.session_date + v_target.session_time) at time zone 'UTC')
                  - make_interval(hours => greatest(0, coalesce(p_window_hours, 48)));
    if now() >= v_deadline then
        return jsonb_build_object('ok', false, 'error', 'past-cutoff');
    end if;

    -- Establishing an EMPTY, non-declared target needs a length, or its
    -- block_minutes reserves nothing. An open-hour row with no duration is not a
    -- valid move target for v1.
    v_establish := (v_target.seats_taken = 0 and not v_target.declared);
    if v_establish and v_target.duration_minutes is null then
        return jsonb_build_object('ok', false, 'error', 'target-not-ready');
    end if;

    -- MODE. A private family needs a private-safe target; a shared family a shared
    -- one. An empty non-declared target takes the family's mode; anything already
    -- seated (or declared) must already match it.
    v_family_private := coalesce(v_source.private, false);
    if not v_establish and coalesce(v_target.private, false) <> v_family_private then
        return jsonb_build_object('ok', false, 'error', 'mode-clash');
    end if;

    -- CAPACITY, all-or-nothing. The whole family must fit.
    if v_target.seats_taken + v_seats > v_target.capacity then
        return jsonb_build_object('ok', false, 'error', 'no-room');
    end if;

    -- APPLY. Claim on the target first — this is the write that can fail on the
    -- no-overlap exclusion as its seats go 0 -> N; if it raises, nothing else has
    -- happened. Then release the source, then repoint and stamp the family.
    update public.slot_sessions
       set seats_taken = seats_taken + v_seats,
           private      = case when v_establish then v_family_private else private end
     where id = v_target.id;

    update public.slot_sessions
       set seats_taken = greatest(0, seats_taken - v_seats)
     where id = v_source.id;

    update public.service_orders
       set slot_session_id       = v_target.id,
           service_date          = v_target.session_date,
           service_time          = v_target.session_time,
           moved_from_session_id = v_source.id,
           moved_at              = now(),
           move_count            = coalesce(move_count, 0) + 1
     where id = any(v_family_ids);

    return jsonb_build_object(
        'ok', true,
        'seats', v_seats,
        'moved', coalesce(array_length(v_family_ids, 1), 0),
        'from_session', v_source.id,
        'to_session', v_target.id,
        'from_date', to_char(v_source.session_date, 'YYYY-MM-DD'),
        'from_time', to_char(v_source.session_time, 'HH24:MI'),
        'to_date', to_char(v_target.session_date, 'YYYY-MM-DD'),
        'to_time', to_char(v_target.session_time, 'HH24:MI')
    );
end;
$fn$;

-- The browser never calls this — only the move route, as the service role, after
-- its own payer-only ownership check.
revoke all on function public.move_order_family_to_session(uuid, uuid, integer)
    from public, anon, authenticated;
grant execute on function public.move_order_family_to_session(uuid, uuid, integer)
    to service_role;

-- PostgREST caches the schema; the new columns and function are written and read
-- under the service role and are invisible over the API until it reloads.
notify pgrst, 'reload schema';

-- Read back (after --apply, or by hand on test):
--   -- the three audit columns exist:
--   select column_name, data_type, column_default from information_schema.columns
--    where table_name='service_orders'
--      and column_name in ('moved_from_session_id','moved_at','move_count') order by 1;
--   -- the function exists and is service-role-only:
--   select proname, pg_get_function_arguments(oid) from pg_proc
--    where proname = 'move_order_family_to_session';
