-- Co-hosts can do in the browser what their permissions say they can.
--
-- WHAT WENT WRONG. #435 and #439 let co-hosts into the host pages, and the
-- server routes behind them check the shared helper (lib/access checkListing).
-- But several screens still write straight from the browser, and the row
-- policies on those tables were written when only the owner could be there:
-- `listing.host_id = auth.uid()`. A co-host — Jamie, full access on the
-- 4 bedroom Townhouse — saving a price got "new row violates row-level security
-- policy for table calendar_overrides" (19/10/2026). The same owner-only check
-- sat on listing extras, iCal feeds, booking messages, accepting a booking
-- request (which silently changed nothing) and replying to a review.
--
-- THE FIX. One function, has_listing_permission(listing, permission), that
-- answers exactly as lib/access checkListing does: the listing's owner, or an
-- ACTIVE listing_access row (co-host or staff) holding that permission. Every
-- policy below asks it, with the permission the action needs:
--
--   calendar_overrides   prices, minimum stays, blocks      can_calendar
--   listing_ical_feeds   add / remove an imported calendar  can_calendar
--   listing_extras       the extras a listing sells          can_listing
--   messages (booking)   send and read the guest thread      can_messages
--   bookings             accept a request (status only)      can_bookings
--   reviews              reply to a guest's review           can_messages
--
-- It is SECURITY DEFINER so the answer doesn't depend on whether the caller can
-- read the listing row (a hidden listing, a co-host); it only ever answers about
-- auth.uid(). The listing's status plays no part: an owner or permitted co-host
-- manages a hidden, paused or pending listing exactly like a live one.
--
-- What the browser may change is still limited by the column grants already in
-- place (bookings: status and confirmed_at; reviews: host_reply and
-- host_reply_at), so a co-host gains exactly the owner's reach and no more.
--
-- PRE-FLIGHT. Not destructive: two functions; six owner-only policies replaced
-- by policies that include the owner on the same terms.

create or replace function public.has_listing_permission(listing uuid, perm text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select auth.uid() is not null and (
    exists (select 1 from public.listings l where l.id = listing and l.host_id = auth.uid())
    or exists (
      select 1 from public.listing_access la
       where la.listing_id = listing
         and la.user_id = auth.uid()
         and la.status = 'active'
         and case perm
               when 'can_calendar' then la.can_calendar
               when 'can_messages' then la.can_messages
               when 'can_bookings' then la.can_bookings
               when 'can_listing'  then la.can_listing
               when 'can_earnings' then la.can_earnings
               else false
             end
    )
  )
$function$;

create or replace function public.has_booking_permission(booking uuid, perm text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.bookings b
     where b.id = booking and public.has_listing_permission(b.listing_id, perm)
  )
$function$;

revoke all on function public.has_listing_permission(uuid, text) from public, anon;
revoke all on function public.has_booking_permission(uuid, text) from public, anon;
grant execute on function public.has_listing_permission(uuid, text) to authenticated, service_role;
grant execute on function public.has_booking_permission(uuid, text) to authenticated, service_role;

-- calendar: prices, minimum stays, blocks
drop policy if exists "Hosts can manage their own calendar overrides" on public.calendar_overrides;
drop policy if exists "Owner and calendar co-hosts manage calendar overrides" on public.calendar_overrides;
create policy "Owner and calendar co-hosts manage calendar overrides" on public.calendar_overrides
  for all to authenticated
  using (public.has_listing_permission(listing_id, 'can_calendar'))
  with check (public.has_listing_permission(listing_id, 'can_calendar'));

-- imported calendars (iCal)
drop policy if exists "hosts manage their own feeds" on public.listing_ical_feeds;
drop policy if exists "Owner and calendar co-hosts manage imported calendars" on public.listing_ical_feeds;
create policy "Owner and calendar co-hosts manage imported calendars" on public.listing_ical_feeds
  for all to authenticated
  using (public.has_listing_permission(listing_id, 'can_calendar'))
  with check (public.has_listing_permission(listing_id, 'can_calendar'));

-- extras the listing sells
drop policy if exists "Hosts manage their own listing extras" on public.listing_extras;
drop policy if exists "Owner and listing co-hosts manage listing extras" on public.listing_extras;
create policy "Owner and listing co-hosts manage listing extras" on public.listing_extras
  for all to authenticated
  using (public.has_listing_permission(listing_id, 'can_listing'))
  with check (public.has_listing_permission(listing_id, 'can_listing'));

-- the booking's message thread: the guest, or the host side with messages
drop policy if exists "Participants can send messages on their booking" on public.messages;
create policy "Participants can send messages on their booking" on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and booking_id is not null
    and (
      booking_id in (select b.id from public.bookings b where b.guest_id = auth.uid() or b.host_id = auth.uid())
      or public.has_booking_permission(booking_id, 'can_messages')
    )
  );
drop policy if exists "Participants can view their booking's messages" on public.messages;
create policy "Participants can view their booking's messages" on public.messages
  for select to authenticated
  using (
    booking_id is not null
    and (
      booking_id in (select b.id from public.bookings b where b.guest_id = auth.uid() or b.host_id = auth.uid())
      or public.has_booking_permission(booking_id, 'can_messages')
    )
  );

-- accepting a booking request (the browser may set status and confirmed_at only)
drop policy if exists "Co-hosts with bookings can view and update bookings" on public.bookings;
drop policy if exists "Co-hosts with bookings can view bookings" on public.bookings;
create policy "Co-hosts with bookings can view bookings" on public.bookings
  for select to authenticated
  using (public.has_listing_permission(listing_id, 'can_bookings'));
drop policy if exists "Co-hosts with bookings can update booking status" on public.bookings;
create policy "Co-hosts with bookings can update booking status" on public.bookings
  for update to authenticated
  using (public.has_listing_permission(listing_id, 'can_bookings'))
  with check (public.has_listing_permission(listing_id, 'can_bookings'));

-- replying to a guest's review of the listing (host_reply / host_reply_at only)
drop policy if exists "Co-hosts with messages can reply to reviews" on public.reviews;
create policy "Co-hosts with messages can reply to reviews" on public.reviews
  for update to authenticated
  using (review_type = 'guest_to_host' and public.has_listing_permission(listing_id, 'can_messages'))
  with check (review_type = 'guest_to_host' and public.has_listing_permission(listing_id, 'can_messages'));

notify pgrst, 'reload schema';

-- Read back:
--   select tablename, policyname from pg_policies where qual like '%has_listing_permission%' or with_check like '%has_listing_permission%' or qual like '%has_booking_permission%' or with_check like '%has_booking_permission%';
--   select has_function_privilege('anon', 'public.has_listing_permission(uuid,text)', 'execute');   -- false
