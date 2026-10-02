-- The "order guests readable" policy must not throw for an authenticated reader.
--
-- The policy (20260920013334_experience_invite_list) checked order ownership with
-- an inline subquery over service_orders:
--
--     order_id is not null and (
--         exists (select 1 from service_orders o
--                  where o.id = booking_guests.order_id and o.guest_id = auth.uid())
--         or user_id = auth.uid())
--
-- service_orders is REVOKED from the browser (authenticated has no SELECT on it),
-- and a policy expression is planned with the reader's own privileges. So the mere
-- REFERENCE to service_orders made every authenticated SELECT on booking_guests
-- fail with "permission denied for table service_orders" — not row-by-row, but the
-- whole read, because the privilege is checked when the table is referenced at all.
-- (Row short-circuiting on `order_id is not null` does not help: the reference is
-- still in the plan.) That broke the one browser reader of booking_guests, the
-- stay invite sheet, which now reads server-side instead; every other reader
-- already used the service role. This makes the POLICY itself safe so no future
-- authenticated reader can trip over it.
--
-- The fix moves the service_orders lookup behind a SECURITY DEFINER function, so
-- the policy expression no longer names service_orders and the reader needs no
-- grant on it. Visibility is IDENTICAL: the function answers only "does the caller
-- own this one order?" (o.guest_id = auth.uid()), the same test the inline subquery
-- ran — nothing is widened. For anon (auth.uid() is null) it returns false.

create or replace function public.owns_order(p_order uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $fn$
    select exists (
        select 1 from public.service_orders o
         where o.id = p_order and o.guest_id = auth.uid()
    );
$fn$;

-- Callable by the roles that evaluate the policy; it reveals only a boolean about
-- the caller's OWN order, so this grants no new visibility.
revoke all on function public.owns_order(uuid) from public;
grant execute on function public.owns_order(uuid) to anon, authenticated;

drop policy if exists "order guests readable" on public.booking_guests;
create policy "order guests readable" on public.booking_guests
    for select using (
        order_id is not null and (
            public.owns_order(order_id)
            or booking_guests.user_id = auth.uid()
        )
    );
