-- Who may read a listing row.
--
-- PRE-FLIGHT: none. This replaces one policy with another; no data changes.
-- Safe to run twice. Run it on TEST first and load the site — this is the one
-- migration in this repo that can EMPTY a page rather than break it, which is
-- the harder failure to notice.
--
-- WHAT WAS WRONG
--
-- The SELECT policy was `USING (true)`. Every listing row was readable by
-- anybody holding the anon key, which ships in every page of the site — so a
-- draft somebody was half way through writing, and a listing its host had
-- deliberately taken down, were both readable over the REST API by anyone who
-- asked. Measured on 28 August 2026: test handed an anonymous caller 2 drafts,
-- production handed over both hidden listings.
--
-- The application queries filtered on status. The database never did. That is
-- the wrong way round, and it is a prerequisite for holding listings for
-- approval at all: a listing waiting to be approved would otherwise be public
-- from the moment the status existed.
--
-- WHY A FUNCTION AND NOT A POLICY THAT SAYS IT ALL INLINE
--
-- The first attempt put the EXISTS clauses straight in the policy and Postgres
-- refused every read with:
--
--     42P17  infinite recursion detected in policy for relation "listings"
--
-- `listing_access` has its own policy — "owner manages access" — which selects
-- from `listings` to decide who owns the access row. So listings asked
-- listing_access, which asked listings, and round it went. An anonymous caller
-- got NOTHING, including the published rows the public site is built from: the
-- home page would have been empty.
--
-- A SECURITY DEFINER function runs as its owner, so the tables it reads are not
-- re-checked against the caller's policies and the cycle cannot form. It is
-- marked STABLE so it is evaluated once per row rather than repeatedly, and
-- pinned to `search_path = public` so nothing can be shadowed by a schema
-- earlier on someone else's path.
--
-- WHY IT IS LONGER THAN "status = 'published'"
--
-- Four kinds of person legitimately read a row that is not published, and each
-- one is a page that silently EMPTIES if the policy forgets them:
--
--   the host          drafts in the wizard, their dashboard, the editor
--   a co-host         the calendar and edit screen they were trusted with
--   a guest           Your trips, Passport, the review form — which must keep
--                     working after the host takes the listing down
--   a companion       booking_guests lets somebody else on the booking see it
--
-- The co-host case is one this project has been bitten by before: row-level
-- security returning nothing looks exactly like having no listings.
--
-- WHAT CHANGES FOR A SIGNED-OUT VISITOR
--
-- A hidden listing no longer opens at its own URL for a stranger. It still
-- opens for the host, a co-host, and anybody who booked it — which is who that
-- behaviour existed for.

create index if not exists listing_access_user_listing_idx
    on public.listing_access (user_id, listing_id);

create index if not exists bookings_guest_listing_idx
    on public.bookings (guest_id, listing_id);

create index if not exists booking_guests_user_booking_idx
    on public.booking_guests (user_id, booking_id);

create or replace function public.may_read_listing(listing uuid, host uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select
        -- Yours, whatever state it is in.
        host = auth.uid()

        -- Somebody you trusted with it. Any role: being able to READ the
        -- listing is the floor under every co-host permission, and the finer
        -- grain is decided in lib/access.ts, not here.
        or exists (
            select 1 from listing_access la
            where la.listing_id = listing
              and la.user_id = auth.uid()
        )

        -- Somebody who booked it. Still true after the host takes it down,
        -- or Your trips and Passport quietly lose the stay and the guest is
        -- left holding a booking they cannot look at.
        or exists (
            select 1 from bookings b
            where b.listing_id = listing
              and b.guest_id = auth.uid()
        )

        -- Somebody else on that booking.
        or exists (
            select 1 from bookings b
            join booking_guests bg on bg.booking_id = b.id
            where b.listing_id = listing
              and bg.user_id = auth.uid()
        );
$$;

comment on function public.may_read_listing(uuid, uuid) is
    'Whether the current user may read a listing that is not published. '
    'SECURITY DEFINER on purpose: listing_access has a policy that selects '
    'from listings, so doing this inline recursed and refused every read.';

revoke all on function public.may_read_listing(uuid, uuid) from public;
grant execute on function public.may_read_listing(uuid, uuid) to anon, authenticated;

drop policy if exists "Listings are viewable by everyone." on public.listings;
drop policy if exists listings_readable on public.listings;

create policy listings_readable
    on public.listings
    for select
    using (
        -- Checked first and on its own, so the public site never pays for the
        -- function call and an anonymous reader never touches the other tables.
        status = 'published'
        or public.may_read_listing(id, host_id)
    );

comment on policy listings_readable on public.listings is
    'Published listings are public. Everything else is readable only by the '
    'host, a co-host, a guest who booked it, or a companion on that booking. '
    'Replaced USING (true) on 28 August 2026, which let anyone holding the '
    'anon key read drafts and hidden listings.';
