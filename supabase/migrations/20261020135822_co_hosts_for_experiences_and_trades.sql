-- Co-hosts for guest experiences and trades.
--
-- WHAT. The holiday-let co-host system (listing_access + has_listing_permission,
-- #440) copied onto service providers. The grant hangs on the provider, not on
-- one offering — a provider's diary, inbox, bookings, listing and earnings are
-- one business — so it is provider_access, and the question every row policy
-- asks is has_provider_permission(provider, permission). It answers exactly as
-- lib/providerAccess checkProvider does: the provider's owner, or an ACTIVE
-- provider_access row holding that permission. The same five permissions:
--
--   can_calendar   sessions, blocks, weekly hours, imported calendars
--   can_messages   order and enquiry threads; replying to reviews
--   can_bookings   bookings, enquiries and requests
--   can_listing    the listing editor and its child tables
--   can_earnings   what the business earns (read on the server only)
--
-- provider_access is written only by the server routes (service role) — the
-- invite, accept, decline, update, revoke and leave actions, which check the
-- shared helper — so the browser gets no write on it at all, and may read only
-- its own rows. The subscription, Stripe payouts and trade billing stay
-- owner-only: none of those are browser writes, and their routes keep checking
-- owner_id.
--
-- Every policy below widens an owner-only policy to "owner, or a co-host with
-- the permission the action needs". What the browser may change is still
-- limited by the column grants already in place, so a co-host gains exactly the
-- owner's reach and no more.
--
-- PRE-FLIGHT. Not destructive: one new table, two functions, owner-only policies
-- replaced by policies that include the owner on the same terms.

create table if not exists public.provider_access (
    id uuid primary key default gen_random_uuid(),
    provider_id uuid not null references public.service_providers(id) on delete cascade,
    user_id uuid references public.profiles(id) on delete cascade,
    email text not null,
    role text not null default 'co_host',
    can_calendar boolean not null default false,
    can_messages boolean not null default false,
    can_bookings boolean not null default false,
    can_listing boolean not null default false,
    can_earnings boolean not null default false,
    status text not null default 'invited',
    invite_token uuid not null default gen_random_uuid(),
    invited_by uuid references public.profiles(id) on delete set null,
    invited_at timestamptz not null default now(),
    accepted_at timestamptz,
    constraint provider_access_role_check check (role = 'co_host'),
    constraint provider_access_status_check check (status in ('invited', 'active', 'revoked'))
);

create index if not exists provider_access_provider_idx on public.provider_access (provider_id);
create index if not exists provider_access_user_idx on public.provider_access (user_id);
create unique index if not exists provider_access_unique_person
    on public.provider_access (provider_id, lower(email)) where status <> 'revoked';
create unique index if not exists provider_access_invite_token_key on public.provider_access (invite_token);

alter table public.provider_access enable row level security;
revoke all on table public.provider_access from anon, authenticated;
grant select on table public.provider_access to authenticated;
grant all on table public.provider_access to service_role;

drop policy if exists "people see their own provider access" on public.provider_access;
create policy "people see their own provider access" on public.provider_access
    for select to authenticated
    using (user_id = auth.uid());

create or replace function public.has_provider_permission(provider uuid, perm text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select auth.uid() is not null and (
    exists (select 1 from public.service_providers p where p.id = provider and p.owner_id = auth.uid())
    or exists (
      select 1 from public.provider_access pa
       where pa.provider_id = provider
         and pa.user_id = auth.uid()
         and pa.status = 'active'
         and case perm
               when 'can_calendar' then pa.can_calendar
               when 'can_messages' then pa.can_messages
               when 'can_bookings' then pa.can_bookings
               when 'can_listing'  then pa.can_listing
               when 'can_earnings' then pa.can_earnings
               when 'any'          then true
               else false
             end
    )
  )
$function$;

revoke all on function public.has_provider_permission(uuid, text) from public, anon;
grant execute on function public.has_provider_permission(uuid, text) to authenticated, service_role;

-- the provider row itself: a co-host reads it, and one with the listing edits it
-- (the trades editor saves from the browser; column grants limit what it may set)
drop policy if exists "co-hosts read the provider they help with" on public.service_providers;
create policy "co-hosts read the provider they help with" on public.service_providers
    for select to authenticated
    using (public.has_provider_permission(id, 'any'));
drop policy if exists "listing co-hosts edit the provider" on public.service_providers;
create policy "listing co-hosts edit the provider" on public.service_providers
    for update to authenticated
    using (public.has_provider_permission(id, 'can_listing'))
    with check (public.has_provider_permission(id, 'can_listing'));

-- the listing's child tables
drop policy if exists "owners manage their own areas" on public.service_areas;
drop policy if exists "owner and listing co-hosts manage areas" on public.service_areas;
create policy "owner and listing co-hosts manage areas" on public.service_areas
    for all to authenticated
    using (public.has_provider_permission(provider_id, 'can_listing'))
    with check (public.has_provider_permission(provider_id, 'can_listing'));

drop policy if exists "owners manage their own extras" on public.service_provider_extras;
drop policy if exists "owner and listing co-hosts manage extras" on public.service_provider_extras;
create policy "owner and listing co-hosts manage extras" on public.service_provider_extras
    for all to authenticated
    using (public.has_provider_permission(provider_id, 'can_listing'))
    with check (public.has_provider_permission(provider_id, 'can_listing'));

drop policy if exists "owners manage their own items" on public.service_provider_items;
drop policy if exists "owner and listing co-hosts manage items" on public.service_provider_items;
create policy "owner and listing co-hosts manage items" on public.service_provider_items
    for all to authenticated
    using (public.has_provider_permission(provider_id, 'can_listing'))
    with check (public.has_provider_permission(provider_id, 'can_listing'));

drop policy if exists "owners manage their own prices" on public.service_provider_prices;
drop policy if exists "owner and listing co-hosts manage prices" on public.service_provider_prices;
create policy "owner and listing co-hosts manage prices" on public.service_provider_prices
    for all to authenticated
    using (public.has_provider_permission(provider_id, 'can_listing'))
    with check (public.has_provider_permission(provider_id, 'can_listing'));

drop policy if exists "owners manage their own registrations" on public.service_provider_registrations;
drop policy if exists "owner and listing co-hosts manage registrations" on public.service_provider_registrations;
create policy "owner and listing co-hosts manage registrations" on public.service_provider_registrations
    for all to authenticated
    using (public.has_provider_permission(provider_id, 'can_listing'))
    with check (public.has_provider_permission(provider_id, 'can_listing'));

-- skills: the public policy is left exactly as it is (anon reads it, and anon
-- may not call has_provider_permission); co-hosts get their own, signed-in only.
drop policy if exists "skills of approved providers are public" on public.service_provider_skills;
create policy "skills of approved providers are public" on public.service_provider_skills
    for select
    using (exists (select 1 from public.service_providers p
                    where p.id = service_provider_skills.provider_id
                      and (p.status = 'approved' or p.owner_id = auth.uid())));
drop policy if exists "listing co-hosts read skills" on public.service_provider_skills;
create policy "listing co-hosts read skills" on public.service_provider_skills
    for select to authenticated
    using (public.has_provider_permission(provider_id, 'can_listing'));

-- the diary
drop policy if exists "owners manage their own availability" on public.slot_availability;
drop policy if exists "owner and calendar co-hosts manage availability" on public.slot_availability;
create policy "owner and calendar co-hosts manage availability" on public.slot_availability
    for all to authenticated
    using (public.has_provider_permission(provider_id, 'can_calendar'))
    with check (public.has_provider_permission(provider_id, 'can_calendar'));

drop policy if exists "owners manage their own blocks" on public.slot_blocks;
drop policy if exists "owner and calendar co-hosts manage blocks" on public.slot_blocks;
create policy "owner and calendar co-hosts manage blocks" on public.slot_blocks
    for all to authenticated
    using (public.has_provider_permission(provider_id, 'can_calendar'))
    with check (public.has_provider_permission(provider_id, 'can_calendar'));

drop policy if exists "owners read their own sessions" on public.slot_sessions;
drop policy if exists "owner and calendar co-hosts read sessions" on public.slot_sessions;
create policy "owner and calendar co-hosts read sessions" on public.slot_sessions
    for select to authenticated
    using (public.has_provider_permission(provider_id, 'can_calendar')
           or public.has_provider_permission(provider_id, 'can_bookings'));

drop policy if exists "providers manage their own calendar feeds" on public.provider_ical_feeds;
drop policy if exists "owner and calendar co-hosts manage imported calendars" on public.provider_ical_feeds;
create policy "owner and calendar co-hosts manage imported calendars" on public.provider_ical_feeds
    for all to authenticated
    using (public.has_provider_permission(provider_id, 'can_calendar'))
    with check (public.has_provider_permission(provider_id, 'can_calendar'));

-- enquiries (a trade's requests from hosts; an experience's questions from guests)
drop policy if exists "providers read enquiries sent to them" on public.service_enquiries;
create policy "providers read enquiries sent to them" on public.service_enquiries
    for select to authenticated
    using (public.has_provider_permission(provider_id, 'can_bookings')
           or public.has_provider_permission(provider_id, 'can_messages'));

drop policy if exists "either side records an outcome" on public.service_enquiries;
create policy "either side records an outcome" on public.service_enquiries
    for update to authenticated
    using (host_id = auth.uid() or public.has_provider_permission(provider_id, 'can_bookings'))
    with check (host_id = auth.uid() or public.has_provider_permission(provider_id, 'can_bookings'));

drop policy if exists "guest and provider read the enquiry" on public.experience_enquiries;
create policy "guest and provider read the enquiry" on public.experience_enquiries
    for select to authenticated
    using (guest_id = auth.uid()
           or public.has_provider_permission(provider_id, 'can_bookings')
           or public.has_provider_permission(provider_id, 'can_messages'));

-- message threads: an enquiry's, and an order's
drop policy if exists "enquiry participants send messages" on public.messages;
create policy "enquiry participants send messages" on public.messages
    for insert to authenticated
    with check (
        sender_id = auth.uid()
        and enquiry_id in (
            select e.id from public.service_enquiries e
             where e.host_id = auth.uid() or public.has_provider_permission(e.provider_id, 'can_messages')
        )
    );
drop policy if exists "enquiry participants view messages" on public.messages;
create policy "enquiry participants view messages" on public.messages
    for select to authenticated
    using (
        enquiry_id in (
            select e.id from public.service_enquiries e
             where e.host_id = auth.uid() or public.has_provider_permission(e.provider_id, 'can_messages')
        )
    );

create or replace function public.is_order_message_participant(p_order uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
    select exists (
        select 1
        from service_orders o
        where o.id = p_order
          and (
              o.guest_id = auth.uid()
              or public.has_provider_permission(o.provider_id, 'can_messages')
          )
    );
$function$;

-- replying to a guest's review of the business
drop policy if exists "Co-hosts with messages can reply to provider reviews" on public.reviews;
create policy "Co-hosts with messages can reply to provider reviews" on public.reviews
    for update to authenticated
    using (review_type = 'guest_to_provider' and public.has_provider_permission(provider_id, 'can_messages'))
    with check (review_type = 'guest_to_provider' and public.has_provider_permission(provider_id, 'can_messages'));

notify pgrst, 'reload schema';

-- Read back:
--   select to_regclass('public.provider_access') is not null
--      and has_function_privilege('anon', 'public.has_provider_permission(uuid,text)', 'execute') = false
--      and (select count(*) from pg_policies where qual like '%has_provider_permission%' or with_check like '%has_provider_permission%') >= 18;
