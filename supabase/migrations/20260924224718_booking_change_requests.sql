-- "Change reservation" for a stay — the host proposes new dates / guest count /
-- price, and the guest must accept before anything moves. Mirrors Airbnb's
-- Flow 1 (AIRBNB-HOST-FLOWS/REPORT.md) and PR #182's Resolution Centre: money
-- moves only on acceptance, and the house rule (money before booking state) is
-- kept — a price increase is charged, or a decrease refunded, and only then are
-- the booking's dates/guests/total rewritten.
--
-- Service-role only, RLS on, no browser grants — exactly like booking_resolutions
-- (20260924203041): the two parties and admins reach it through the gated routes,
-- so a guest can never read another booking's proposed change over the REST API.
-- RESTRICT-linked to bookings/profiles so a change can never orphan or be
-- orphaned.

create table if not exists public.booking_change_requests (
    id uuid primary key default gen_random_uuid(),
    booking_id uuid not null references public.bookings(id) on delete restrict,
    host_id uuid not null references public.profiles(id) on delete restrict,
    guest_id uuid not null references public.profiles(id) on delete restrict,

    -- Who proposed the change. A host proposal is accepted by the guest; a guest
    -- proposal is approved by the host. Either way the money is the guest's (they
    -- pay an increase, they are refunded a decrease) and it only moves once both
    -- sides have agreed.
    initiated_by text not null default 'host' check (initiated_by in ('host', 'guest')),

    -- The proposed new stay. Dates are the booking's own [check_in, check_out)
    -- half-open shape; guests/children/pets mirror the booking's columns.
    new_check_in date not null,
    new_check_out date not null check (new_check_out > new_check_in),
    new_guests integer not null check (new_guests >= 1),
    new_children integer not null default 0 check (new_children >= 0),
    new_pets integer not null default 0 check (new_pets >= 0),
    -- The host re-priced total (accommodation cost) for the changed stay.
    new_total numeric(10,2) not null check (new_total >= 0),

    -- A snapshot of what the booking was when the request was made, so the guest
    -- sees a true before/after diff even if the booking moves underneath, and the
    -- delta is fixed at request time.
    old_check_in date not null,
    old_check_out date not null,
    old_guests integer not null,
    old_children integer not null default 0,
    old_pets integer not null default 0,
    old_total numeric(10,2) not null,

    -- new_total - old_total: > 0 charges the guest the difference on accept,
    -- < 0 refunds it (capped at net paid), 0 is a dates/guests-only change.
    price_delta numeric(10,2) not null,

    -- pending → (both agreed) → awaiting_guest_payment → accepted, or straight to
    -- accepted for a refund/zero change; also declined | cancelled | expired.
    -- 'awaiting_guest_payment' is the guest-pays step: for a host proposal the
    -- guest accepts and pays in one move, so it can go pending → accepted via the
    -- webhook; for a GUEST proposal the host approves first (both agreed) and the
    -- guest then pays, which is what this interim state holds. A charge is only
    -- 'accepted' once the payment clears in the webhook, where the booking is
    -- rewritten; a refund/zero change is applied by the respond route itself.
    status text not null default 'pending' check (status in (
        'pending', 'awaiting_guest_payment', 'accepted', 'declined', 'cancelled', 'expired'
    )),

    -- The Checkout session opened for a positive delta; reused on a repeat accept
    -- so a double-click can only ever produce one payment (same as resolutions).
    stripe_checkout_session_id text,
    stripe_payment_intent_id text,

    created_by uuid not null references public.profiles(id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    responded_at timestamptz,   -- when the guest accepted/declined
    applied_at timestamptz,     -- when the booking was actually rewritten
    expires_at timestamptz      -- optional deadline (unused in v1)
);

create index if not exists booking_change_requests_booking_idx
    on public.booking_change_requests (booking_id);
-- At most one change request can be open on a booking at a time: a second
-- proposal while one is still in play (waiting on the other side, or on the
-- guest's payment) would race to rewrite the same stay.
create unique index if not exists booking_change_requests_one_open
    on public.booking_change_requests (booking_id)
    where status in ('pending', 'awaiting_guest_payment');

alter table public.booking_change_requests enable row level security;
revoke all on public.booking_change_requests from anon, authenticated;
