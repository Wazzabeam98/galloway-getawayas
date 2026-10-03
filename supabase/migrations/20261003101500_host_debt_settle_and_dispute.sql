-- A host's debt can be settled, and argued with.
--
-- A clawback shortfall or a cancellation fee is a `payouts` row with status
-- 'owed', summed into profiles.payout_balance_owed, and the payout run takes it
-- off the host's next payouts. That is all a debt could do: a host who stops
-- taking bookings carried it for ever, with no way to pay it and no way to say
-- it was wrong. Airbnb's shape, which this follows: recover from coming payouts
-- first; when none are coming, ask the host for it as an amount they can pay;
-- and let them dispute it, which puts it in front of a person.
--
-- The debt stays where it lives — the `payouts` row is still the debt, and the
-- running total is still the sum of what the 'owed' rows have outstanding.
-- Nothing here gives a debt a second home.
--
--   owed ──pay──────────────▶ settled          (apply_host_debt_payment)
--   owed ──payout run───────▶ settled          (unchanged)
--   owed ──dispute──────────▶ disputed         (dispute_host_debt)
--   disputed ──upheld/reduced▶ owed            (decide_host_debt_dispute)
--   disputed ──waived───────▶ waived
--
-- A disputed debt comes OFF the running total while it is argued, so the payout
-- run does not take money a person has not yet decided is owed; upholding it
-- puts back what is still owed. Every one of those moves happens inside one
-- function with the row locked, so the row and the total cannot disagree.

-- ---------------------------------------------------------------------------
-- The record on the debt itself
-- ---------------------------------------------------------------------------

alter table public.payouts
    add column if not exists waived_amount       numeric(10,2) not null default 0,
    add column if not exists disputed_at         timestamptz,
    add column if not exists dispute_reason      text,
    add column if not exists dispute_outcome     text,
    add column if not exists dispute_note        text,
    add column if not exists dispute_resolved_at timestamptz,
    add column if not exists dispute_resolved_by uuid references public.profiles(id) on delete set null,
    add column if not exists due_notice_sent_at  timestamptz;

alter table public.payouts
    drop constraint if exists payouts_dispute_outcome_check;
alter table public.payouts
    add constraint payouts_dispute_outcome_check
    check (dispute_outcome is null or dispute_outcome in ('upheld', 'reduced', 'waived'));

alter table public.payouts
    drop constraint if exists payouts_waived_amount_check;
alter table public.payouts
    add constraint payouts_waived_amount_check check (waived_amount >= 0);

comment on column public.payouts.waived_amount is
    'Part of a debt the platform wrote off on review of a dispute. Outstanding = |amount| - settled_amount - waived_amount. The original amount is never rewritten.';
comment on column public.payouts.due_notice_sent_at is
    'When the host was last told this debt is due because no payout is coming to take it from (cron/host-debts).';

create index if not exists payouts_disputed_idx
    on public.payouts (disputed_at)
    where status = 'disputed';

-- ---------------------------------------------------------------------------
-- A host paying a debt directly
-- ---------------------------------------------------------------------------

create table if not exists public.host_debt_payments (
    id                          uuid primary key default gen_random_uuid(),
    payout_id                   uuid not null references public.payouts(id) on delete restrict,
    host_id                     uuid not null references public.profiles(id) on delete restrict,
    amount                      numeric(10,2) not null check (amount > 0),
    -- How much of it went against the debt, and how much arrived after the debt
    -- had already been recovered another way (and is refunded to the host).
    applied_amount              numeric(10,2) not null default 0,
    excess_amount               numeric(10,2) not null default 0,
    excess_refunded_at          timestamptz,
    stripe_checkout_session_id  text not null unique,
    stripe_payment_intent_id    text,
    created_at                  timestamptz not null default now()
);

create index if not exists host_debt_payments_payout_idx on public.host_debt_payments (payout_id);

alter table public.host_debt_payments enable row level security;
revoke all on table public.host_debt_payments from anon, authenticated;

-- ---------------------------------------------------------------------------
-- dispute_host_debt — the host says it is wrong
-- ---------------------------------------------------------------------------
-- Returns the amount taken off the running total while it is argued, or null
-- when there is nothing to dispute (not theirs, not owed, already recovered).

create or replace function public.dispute_host_debt(
    p_payout uuid,
    p_host   uuid,
    p_reason text
)
returns numeric
language plpgsql
security definer
set search_path = public
as $fn$
declare
    r   public.payouts%rowtype;
    v_out numeric;
begin
    select * into r from public.payouts where id = p_payout for update;
    if not found or r.host_id is distinct from p_host or r.status <> 'owed' then
        return null;
    end if;

    v_out := round(abs(r.amount) - coalesce(r.settled_amount, 0) - coalesce(r.waived_amount, 0), 2);
    if v_out <= 0 then
        return null;
    end if;

    update public.payouts
       set status = 'disputed',
           disputed_at = now(),
           dispute_reason = p_reason,
           dispute_outcome = null,
           dispute_note = null,
           dispute_resolved_at = null,
           dispute_resolved_by = null
     where id = p_payout;

    perform public.adjust_payout_balance(p_host, -v_out);
    return v_out;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- decide_host_debt_dispute — a person decides
-- ---------------------------------------------------------------------------
-- p_keep is what the host still owes after the decision: the whole outstanding
-- for 'upheld', something in between for 'reduced', nothing for 'waived'.
-- Returns what is owed again (0 for a waiver), or null if the debt is not an
-- open dispute or the amount does not fit the outcome.

create or replace function public.decide_host_debt_dispute(
    p_payout  uuid,
    p_admin   uuid,
    p_outcome text,
    p_keep    numeric,
    p_note    text
)
returns numeric
language plpgsql
security definer
set search_path = public
as $fn$
declare
    r      public.payouts%rowtype;
    v_out  numeric;
    v_keep numeric;
begin
    select * into r from public.payouts where id = p_payout for update;
    if not found or r.status <> 'disputed' or r.dispute_resolved_at is not null then
        return null;
    end if;

    v_out := round(abs(r.amount) - coalesce(r.settled_amount, 0) - coalesce(r.waived_amount, 0), 2);

    if p_outcome = 'upheld' then
        v_keep := v_out;
    elsif p_outcome = 'waived' then
        v_keep := 0;
    elsif p_outcome = 'reduced' then
        v_keep := round(coalesce(p_keep, -1), 2);
        if v_keep <= 0 or v_keep >= v_out then
            return null;
        end if;
    else
        return null;
    end if;

    update public.payouts
       set waived_amount = round(coalesce(waived_amount, 0) + (v_out - v_keep), 2),
           status = case when v_keep > 0 then 'owed' else 'waived' end,
           settled_at = case when v_keep > 0 then settled_at else now() end,
           dispute_outcome = p_outcome,
           dispute_note = p_note,
           dispute_resolved_at = now(),
           dispute_resolved_by = p_admin,
           -- A debt that is owed again is told afresh if nothing is coming.
           due_notice_sent_at = null
     where id = p_payout;

    if v_keep > 0 then
        perform public.adjust_payout_balance(r.host_id, v_keep);
    end if;

    return v_keep;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- apply_host_debt_payment — the host paid at Stripe
-- ---------------------------------------------------------------------------
-- Called by the webhook once the Checkout session has completed. Idempotent on
-- the session id: a redelivery records nothing a second time. Applies no more
-- than is still outstanding — the payout run may have recovered some of it
-- while the host was on the payment page — and reports the rest as excess for
-- the caller to refund.

create or replace function public.apply_host_debt_payment(
    p_payout  uuid,
    p_host    uuid,
    p_amount  numeric,
    p_session text,
    p_intent  text
)
returns table (applied numeric, excess numeric, duplicate boolean)
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_id    uuid;
    r       public.payouts%rowtype;
    v_out   numeric;
    v_apply numeric := 0;
begin
    insert into public.host_debt_payments (payout_id, host_id, amount, stripe_checkout_session_id, stripe_payment_intent_id)
    values (p_payout, p_host, round(p_amount, 2), p_session, p_intent)
    on conflict (stripe_checkout_session_id) do nothing
    returning id into v_id;

    if v_id is null then
        return query select 0::numeric, 0::numeric, true;
        return;
    end if;

    select * into r from public.payouts where id = p_payout for update;

    if found and r.host_id = p_host and r.status = 'owed' then
        v_out := round(abs(r.amount) - coalesce(r.settled_amount, 0) - coalesce(r.waived_amount, 0), 2);
        v_apply := greatest(0, least(round(p_amount, 2), v_out));

        if v_apply > 0 then
            update public.payouts
               set settled_amount = round(coalesce(settled_amount, 0) + v_apply, 2),
                   status = case when v_apply >= v_out then 'settled' else 'owed' end,
                   settled_at = case when v_apply >= v_out then now() else settled_at end
             where id = p_payout;

            perform public.adjust_payout_balance(p_host, -v_apply);
        end if;
    end if;

    update public.host_debt_payments
       set applied_amount = v_apply,
           excess_amount = round(p_amount, 2) - v_apply
     where id = v_id;

    return query select v_apply, round(p_amount, 2) - v_apply, false;
end;
$fn$;

-- Money functions, so never within reach of the browser roles (SECURITY DEFINER
-- functions are granted to PUBLIC by default).
revoke all on function public.dispute_host_debt(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.decide_host_debt_dispute(uuid, uuid, text, numeric, text) from public, anon, authenticated;
revoke all on function public.apply_host_debt_payment(uuid, uuid, numeric, text, text) from public, anon, authenticated;
