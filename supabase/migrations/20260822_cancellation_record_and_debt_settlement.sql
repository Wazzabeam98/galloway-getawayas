-- Record who cancelled a booking, in the database.
--
-- Until now the only trace was `initiated_by` in the metadata on the Stripe
-- refund. The booking row itself could not tell a host cancellation from a
-- guest one, which matters the first time somebody disputes the 5% host
-- cancellation fee: the fee is charged on `isHost && reason === 'cancelled'`,
-- and nothing in our own records said whether that was true.
--
-- Three columns, because they answer different questions:
--   cancelled_by_user  the account that did it — the record that settles a
--                      dispute. Null for anything the system did on its own.
--   cancelled_by_role  'host' | 'guest' | 'system' — what to show on a screen
--                      without another lookup.
--   cancelled_at       when.
--
-- Existing cancelled bookings keep all three null, meaning "not recorded",
-- which is honest. They are not backfilled: a `payouts` row of kind 'penalty'
-- is good evidence a given cancellation was the host's, but it is evidence,
-- not a record, and this column is going to be quoted at somebody one day.
--
-- Safe to run twice. Adds nothing that constrains existing rows.
--
-- PRE-FLIGHT — expect 0 rows. Asks information_schema rather than the table
-- itself, because a query naming a column that does not exist yet errors
-- instead of answering, and "does it exist yet" is the whole question:
--
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'bookings'
--     and column_name in ('cancelled_at', 'cancelled_by_user', 'cancelled_by_role');

alter table public.bookings
    add column if not exists cancelled_at      timestamptz,
    add column if not exists cancelled_by_user uuid,
    add column if not exists cancelled_by_role text;

-- The role vocabulary. Added separately and guarded, because `add column if
-- not exists` will not add a constraint to a column that is already there.
-- Null passes: an old cancellation nobody recorded is not a rule violation.
do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.bookings'::regclass
          and conname = 'bookings_cancelled_by_role_check'
    ) then
        alter table public.bookings
            add constraint bookings_cancelled_by_role_check
            check (cancelled_by_role is null
                   or cancelled_by_role in ('host', 'guest', 'system'));
    end if;
end $$;

-- Points at the account, not at a profile row, so the record survives a
-- profile being tidied up. Not enforced as a foreign key for the same reason:
-- the value has to outlive whatever it refers to.
comment on column public.bookings.cancelled_by_user is
    'auth.users id of whoever cancelled. Null when the system did it, or when it predates this column.';
comment on column public.bookings.cancelled_by_role is
    'host | guest | system. Display only — cancelled_by_user is the record.';

-- Reading the owed panel in owner tools means finding every cancellation for
-- a host quickly.
create index if not exists bookings_cancelled_by_user_idx
    on public.bookings (cancelled_by_user)
    where cancelled_by_user is not null;

-- ---------------------------------------------------------------------------
-- Close off a debt once it has actually been recovered.
--
-- A `payouts` row with status 'owed' — a cancellation penalty, or a clawback
-- that could not be taken from the host's Stripe balance — was never touched
-- again. The payout run decremented `profiles.payout_balance_owed` and left
-- the row saying 'owed' for ever, so anything itemising what a host still owes
-- would keep listing debts that had already been settled.
--
-- Recovery is not all-or-nothing: a £45 debt against a £30 payout takes £30
-- now and £15 off the next stay. So how much has come back is recorded rather
-- than a bare flag, and the original `amount` is never rewritten — that row is
-- the evidence of what was charged and why.
--
-- status becomes 'settled' only once settled_amount covers the whole thing.
-- There is no check constraint on payouts.status (verified against the test
-- project on 22 August 2026), so no widening is needed first.
--
-- Safe to run twice.
--
-- PRE-FLIGHT — expect 0 rows:
--
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'payouts'
--     and column_name in ('settled_amount', 'settled_at');

alter table public.payouts
    add column if not exists settled_amount numeric not null default 0,
    add column if not exists settled_at     timestamptz;

comment on column public.payouts.settled_amount is
    'How much of this debt has been recovered so far, as a positive number. Compare against abs(amount).';

-- The payout run asks one question of this table: what does this host still
-- owe, oldest first.
create index if not exists payouts_owed_by_host_idx
    on public.payouts (host_id, created_at)
    where status = 'owed';
