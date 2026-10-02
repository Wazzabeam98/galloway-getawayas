-- Nothing that holds money may be quietly cut loose.
--
-- Five foreign keys that point at (or from) a money row were ON DELETE SET NULL,
-- so deleting the parent severed the link and left an orphaned money record — a
-- payment or payout with no booking, a paid order with no session. That is how a
-- reseed twice orphaned paid rows (the slot_session_id case), and how a
-- self-serve account deletion could sever the payment/payout ledger. This flips
-- all five to ON DELETE RESTRICT: the delete now FAILS LOUDLY instead of silently
-- cutting money loose. A parent that still has money pointing at it cannot be
-- deleted until that money is dealt with first — which is the point.
--
-- Each is drop-then-add so re-applying is a no-op; the constraint keeps its
-- default (column) name. Additive-shaped (no data changes), but it CHANGES a
-- delete rule, so treat it as a real production change: applied to test here,
-- recorded and hand-applied to production.

-- A payment must not outlive knowing which booking it paid for.
alter table public.payments
    drop constraint if exists payments_booking_id_fkey;
alter table public.payments
    add constraint payments_booking_id_fkey
        foreign key (booking_id) references public.bookings(id) on delete restrict;

-- A payout must not outlive its booking or its host.
alter table public.payouts
    drop constraint if exists payouts_booking_id_fkey;
alter table public.payouts
    add constraint payouts_booking_id_fkey
        foreign key (booking_id) references public.bookings(id) on delete restrict;
alter table public.payouts
    drop constraint if exists payouts_host_id_fkey;
alter table public.payouts
    add constraint payouts_host_id_fkey
        foreign key (host_id) references public.profiles(id) on delete restrict;

-- A paid slot order must not be cut loose from the session it sits on: deleting a
-- booked session is now refused, not silently nulled. (The host diary/move picker
-- reconcile orphans defensively, but the real fix is to never make one.)
alter table public.service_orders
    drop constraint if exists service_orders_slot_session_id_fkey;
alter table public.service_orders
    add constraint service_orders_slot_session_id_fkey
        foreign key (slot_session_id) references public.slot_sessions(id) on delete restrict;

-- A paid order must not lose which item it bought: deleting an item that orders
-- reference is refused (the provider deactivates it instead).
alter table public.service_orders
    drop constraint if exists service_orders_item_id_fkey;
alter table public.service_orders
    add constraint service_orders_item_id_fkey
        foreign key (item_id) references public.service_provider_items(id) on delete restrict;

-- Read back (after --apply, or by hand): every one of these should now say RESTRICT.
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conname in ('payments_booking_id_fkey','payouts_booking_id_fkey',
--                      'payouts_host_id_fkey','service_orders_slot_session_id_fkey',
--                      'service_orders_item_id_fkey');
