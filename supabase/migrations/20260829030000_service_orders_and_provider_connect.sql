-- Guest experiences, v1: the schema. A provider gets their own Stripe account,
-- and a guest order is a booking-shaped thing for a service on a date.
--
-- NOT LIVE UNTIL THE CODE IS. This lands on test first. It adds columns and a
-- table; it changes no existing row and no existing behaviour.
--
-- WHY THE PROVIDER'S STRIPE ACCOUNT IS HERE, NOT ON profiles
--
-- A host's connected account lives on profiles.stripe_account_id, created with
-- MCC 7011 (lodging). A guest-trade provider is not lodging — a chef is
-- catering, a baker is a bakery — and Stripe holds ONE business category per
-- Express account. If a person is both a host and a provider, one shared
-- account would have to lie to Stripe about one of the two, and a wrong MCC is
-- the kind of thing that turns into a payout hold months later that nobody
-- traces back. So a provider's payout account is its own account, scoped to the
-- business, created with the trade's own category. See lib/serviceOrders.ts
-- for the MCC table.
--
-- These mirror the six profile columns the connect route already reads and
-- writes, so the same status-read logic serves both.

alter table public.service_providers
    add column if not exists stripe_account_id text,
    add column if not exists stripe_charges_enabled boolean not null default false,
    add column if not exists stripe_payouts_enabled boolean not null default false,
    add column if not exists stripe_details_submitted boolean not null default false,
    add column if not exists stripe_requirements_due text,
    add column if not exists stripe_updated_at timestamptz;

comment on column public.service_providers.stripe_payouts_enabled is
    'Set from Stripe by the provider connect route. Live-to-guests needs this '
    'AND status = approved. See lib/serviceOrders.ts isLiveToGuests.';

-- ---------------------------------------------------------------------------
-- The order.
--
-- Booking-shaped, because the design said so: a commission trade wants a
-- booking, not an enquiry. Money moves, so it carries the same care a booking
-- does — a price snapshotted at request, a commission snapshotted at request,
-- and the payment intent it authorised against.
--
-- STATES (auth on request, capture on confirm — the guest's card is held, not
-- charged, until the provider says yes):
--
--   authorised  card held (PaymentIntent requires_capture). Awaiting provider.
--   confirmed   provider said yes; the hold was captured; money taken.
--   declined    provider said no; the hold released. No money moved.
--   expired     provider did not answer in the window; the hold released.
--   cancelled   guest pulled it before the provider answered; hold released.
--   refunded    confirmed, then money returned under the provider's policy.
--
-- The provider is the merchant of record: the charge is made on_behalf_of the
-- provider's connected account, so the guest is paying the provider, and the
-- platform's 10% is an application fee. The guest is told this before they pay.
create table if not exists public.service_orders (
    id uuid primary key default gen_random_uuid(),

    provider_id uuid not null references public.service_providers(id),
    guest_id uuid not null references public.profiles(id),
    -- The cottage the guest is staying in — how "near me" and "during my stay"
    -- are known. Nullable so an order can outlive a listing being removed.
    listing_id uuid references public.listings(id),
    booking_id uuid references public.bookings(id),

    trade text not null,
    -- When the experience happens. Constrained to the guest's stay window by
    -- the application, not here — the DB does not know the stay.
    service_date date not null,

    -- Snapshotted at request, never read live off the provider again, exactly
    -- as bookings.total_price and bookings.commission_rate are. What the guest
    -- agreed to is what the guest agreed to.
    price numeric not null check (price >= 0),
    commission_rate numeric not null default 0.10,

    status text not null default 'authorised'
        check (status in ('authorised','confirmed','declined','expired','cancelled','refunded')),

    -- The guest's own details, released to the provider on confirm — the same
    -- way an accepted enquiry releases the host's. Snapshotted so a later
    -- profile edit cannot rewrite what the provider was told.
    guest_name text,
    guest_phone text,
    guest_email text,
    note text,

    -- What the provider is contracting as, snapshotted for the receipt and the
    -- "who you are buying from" line. The provider's identity is the thing the
    -- guest is told about, so it cannot be allowed to drift after the fact.
    provider_business_name text,

    stripe_payment_intent_id text,
    amount_refunded numeric not null default 0,

    -- The window closes and the hold is released if the provider never answers.
    expires_at timestamptz,
    confirmed_at timestamptz,
    cancelled_at timestamptz,

    created_at timestamptz not null default now()
);

create index if not exists service_orders_provider_idx on public.service_orders(provider_id);
create index if not exists service_orders_guest_idx on public.service_orders(guest_id);

-- RLS on, and no browser grants at all. Every read and write goes through a
-- route under the service role: the guest order route authorises the card, the
-- provider confirm route captures it, and both check identity with getUser().
-- A booking taught us that a blanket write grant plus a friendly policy is how
-- a stranger inserts a paid row, so there is no policy and no grant here — the
-- table is reachable only by the service role until a specific, column-scoped
-- grant is written for a specific screen.
alter table public.service_orders enable row level security;

revoke all on table public.service_orders from anon, authenticated;

comment on table public.service_orders is
    'A guest paying a provider for an experience during their stay. Service '
    'role only; no browser grants. auth on request, capture on confirm.';
