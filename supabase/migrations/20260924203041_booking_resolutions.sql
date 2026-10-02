-- "Send or request money" for a stay — the Resolution Centre, host↔guest.
--
-- A host can REQUEST money from a guest (extra services, or damage after
-- checkout) or SEND money to a guest (a refund). A request goes to the guest,
-- who accepts and pays, declines, or suggests a different amount; no response in
-- 72 hours, or a decline, escalates it to an admin. A send is funded by the host
-- paying a one-off Stripe page, and only then is the guest refunded to their
-- original card.
--
-- Everything here is SERVICE-ROLE ONLY (RLS on, no anon/authenticated grants),
-- like booking_host_notes: the two parties and admins reach it exclusively
-- through the gated routes, so a guest can never read another booking's request,
-- amount or private attachments over the REST API. Financial rows are
-- RESTRICT-linked to bookings/profiles so a resolution can never orphan or be
-- orphaned.

create table if not exists public.booking_resolutions (
    id uuid primary key default gen_random_uuid(),
    booking_id uuid not null references public.bookings(id) on delete restrict,
    host_id uuid not null references public.profiles(id) on delete restrict,
    guest_id uuid not null references public.profiles(id) on delete restrict,

    -- 'request' = guest → host (host asks the guest for money);
    -- 'send'    = host → guest (a refund the host funds up front).
    direction text not null check (direction in ('request', 'send')),
    -- 'extra_services' carries commission; 'damage' does not, and is only
    -- offered after checkout. A send has no reason of its own; it stores the
    -- reason it answers, or 'extra_services' as a neutral default.
    reason text not null check (reason in ('extra_services', 'damage')),

    amount numeric(10,2) not null check (amount > 0),
    note text,
    -- Frozen at creation: 0.10 for an extra-services request, 0 for damage and
    -- for every send (a refund takes no cut).
    commission_rate numeric not null default 0 check (commission_rate >= 0 and commission_rate < 1),

    -- request:  pending → countered → pending → paid | declined | escalated | cancelled | expired
    -- send:     awaiting_host_payment → completed | cancelled
    status text not null check (status in (
        'pending', 'countered', 'paid', 'declined', 'escalated',
        'cancelled', 'expired', 'awaiting_host_payment', 'completed'
    )),
    -- The guest's suggested figure while status = 'countered'.
    counter_amount numeric(10,2) check (counter_amount is null or counter_amount > 0),

    stripe_payment_intent_id text,  -- the guest's payment (request) or the host's one-off (send)

    created_by uuid not null references public.profiles(id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    responded_at timestamptz,   -- when the guest last accepted/declined/countered
    paid_at timestamptz,        -- request paid, or send refund issued
    escalated_at timestamptz,   -- handed to an admin (72h no-response, or declined)
    expires_at timestamptz      -- a pending request's 72h escalation deadline
);

create index if not exists booking_resolutions_booking_idx on public.booking_resolutions (booking_id);
-- The escalation sweep's working set: still-open requests past their deadline.
create index if not exists booking_resolutions_due_idx
    on public.booking_resolutions (expires_at)
    where status in ('pending', 'countered');
-- The admin resolution queue (built in a later PR) reads escalated rows.
create index if not exists booking_resolutions_escalated_idx
    on public.booking_resolutions (escalated_at)
    where status = 'escalated';

alter table public.booking_resolutions enable row level security;
-- No policies and no grants: authenticated/anon get nothing. Every read and
-- write is through the service role in the gated routes.
revoke all on public.booking_resolutions from anon, authenticated;

-- Private attachments for a request (receipts, damage photos): PNG/JPG/PDF, in a
-- private storage bucket, reachable only through a gated signed-URL route.
create table if not exists public.booking_resolution_attachments (
    id uuid primary key default gen_random_uuid(),
    resolution_id uuid not null references public.booking_resolutions(id) on delete cascade,
    path text not null,
    content_type text,
    uploaded_by uuid not null references public.profiles(id) on delete restrict,
    created_at timestamptz not null default now()
);
create index if not exists booking_resolution_attachments_res_idx
    on public.booking_resolution_attachments (resolution_id);

alter table public.booking_resolution_attachments enable row level security;
revoke all on public.booking_resolution_attachments from anon, authenticated;

-- A PRIVATE bucket for those attachments. public=false → no object is reachable
-- by URL; the app serves them via short-lived signed URLs from the service role,
-- only to the two parties and admins.
insert into storage.buckets (id, name, public)
    values ('resolution-attachments', 'resolution-attachments', false)
    on conflict (id) do nothing;
