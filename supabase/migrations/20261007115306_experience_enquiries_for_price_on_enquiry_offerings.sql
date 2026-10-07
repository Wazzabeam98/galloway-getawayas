-- A guest's enquiry to an experience provider, for the offerings that have no
-- fixed price (a range, or price on enquiry).
--
-- WHY A NEW TABLE, NOT THE MESSAGES INBOX. Guest↔provider messaging today is
-- keyed to an existing booking/order, and a range/price-on-enquiry offering has
-- neither yet — the guest is asking BEFORE there is anything to book. The shared
-- messages RLS is intricate and has been a source of real bugs, so this stays a
-- small, self-contained thing it can't destabilise: one row per enquiry, with
-- the guest's message, emailed to the provider straight away and visible to the
-- provider and to admin. (A full two-way inbox thread can come later; this is the
-- "not a dead end" path, kept minimal and safe.)
--
-- service_enquiries is TRADE-only (the host↔tradesman introduction, with its own
-- subscription/commission model), so it is the wrong home for this.
--
-- There is NO money in this file: an enquiry is a question, not an order. The
-- order path (service_orders) is untouched, and a range/enquiry offering is
-- refused server-side before it could ever price.

create table if not exists public.experience_enquiries (
    id uuid primary key default gen_random_uuid(),
    provider_id uuid not null references public.service_providers(id) on delete cascade,
    -- The guest who asked. CASCADE so deleting a profile erases their enquiries,
    -- matching messages.sender_id.
    guest_id uuid not null references auth.users(id) on delete cascade,
    -- The offering they asked about. Soft link + a name snapshot, so an enquiry
    -- still reads right if the item is later edited or removed (the same pattern
    -- service_orders uses for item_id/item_name).
    item_id uuid references public.service_provider_items(id) on delete set null,
    item_name text,
    message text not null check (char_length(message) between 1 and 2000),
    -- open → the provider still owes a reply; answered/closed are for later.
    status text not null default 'open' check (status in ('open', 'answered', 'closed')),
    created_at timestamptz not null default now()
);

create index if not exists experience_enquiries_provider_idx
    on public.experience_enquiries(provider_id, created_at desc);
create index if not exists experience_enquiries_guest_idx
    on public.experience_enquiries(guest_id, created_at desc);

alter table public.experience_enquiries enable row level security;
grant select, insert on table public.experience_enquiries to authenticated;
grant all on table public.experience_enquiries to service_role;

-- A signed-in guest lodges their own enquiry (guest_id must be them) — no other
-- insert is allowed, so nobody can write one as someone else.
drop policy if exists "guests lodge their own enquiry" on public.experience_enquiries;
create policy "guests lodge their own enquiry"
    on public.experience_enquiries
    for insert to authenticated
    with check (guest_id = auth.uid());

-- The guest reads their own; the provider's owner reads enquiries for their own
-- business. No update/delete from the browser (status moves via the service role
-- only), so an enquiry can't be quietly erased or marked answered by a stranger.
drop policy if exists "guest and provider read the enquiry" on public.experience_enquiries;
create policy "guest and provider read the enquiry"
    on public.experience_enquiries
    for select to authenticated
    using (
        guest_id = auth.uid()
        or exists (
            select 1 from public.service_providers p
             where p.id = experience_enquiries.provider_id and p.owner_id = auth.uid()
        )
    );

comment on table public.experience_enquiries is
    'A guest''s pre-booking question to an experience provider about a range or '
    'price-on-enquiry offering. Emailed to the provider; seen by provider and '
    'admin. No money — the order path is untouched.';

notify pgrst, 'reload schema';

-- Read back:
--   select count(*) from public.experience_enquiries;  -- 0 on a fresh table
--   select polname from pg_policies where tablename = 'experience_enquiries';
