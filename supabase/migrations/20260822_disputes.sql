-- Chargebacks.
--
-- Nothing listened for `charge.dispute.created`, and the platform carries full
-- chargeback liability — so the first anyone would have known about a dispute
-- was money missing from the balance. Stripe gives a deadline, usually between
-- 7 and 21 days depending on the card network, and a dispute nobody noticed is
-- a dispute lost by default.
--
-- Its own table rather than columns on `bookings`, because one booking can be
-- disputed more than once — a partial chargeback, then another — and each
-- carries its own amount, reason and deadline.
--
-- Safe to run twice.
--
-- PRE-FLIGHT — expect 0 rows:
--
--   select table_name from information_schema.tables
--   where table_schema = 'public' and table_name = 'disputes';

create table if not exists public.disputes (
    id                  uuid primary key default gen_random_uuid(),
    booking_id          uuid references public.bookings (id),
    -- Stripe's id is the natural key: every event about a dispute carries it,
    -- and events arrive out of order and more than once.
    stripe_dispute_id   text not null unique,
    stripe_charge_id    text,
    stripe_payment_intent_id text,
    amount              numeric not null default 0,
    currency            text,
    -- Stripe's own vocabulary, stored raw. Deliberately not mapped to
    -- something of ours: what evidence to gather depends on the exact reason,
    -- and a lossy translation of it would cost a dispute one day.
    reason              text,
    status              text,
    -- The deadline. The single most important column here.
    evidence_due_by     timestamptz,
    opened_at           timestamptz,
    closed_at           timestamptz,
    -- Set when Stripe gives the money back, so a won dispute stops showing as
    -- money at risk.
    funds_reinstated_at timestamptz,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

-- The owner tools page asks one question: what is open, soonest deadline
-- first.
create index if not exists disputes_open_idx
    on public.disputes (evidence_due_by)
    where closed_at is null;

create index if not exists disputes_booking_idx
    on public.disputes (booking_id);

-- Row-level security on, with no policy for `authenticated`. Nothing outside a
-- service-role route may read this: a dispute names a guest who has accused
-- somebody of taking their money, and the host it concerns must not be able to
-- read it out of the browser.
alter table public.disputes enable row level security;

-- Money columns are revoked from `authenticated` everywhere else in this
-- schema; the whole table is here.
revoke all on public.disputes from authenticated;
revoke all on public.disputes from anon;
