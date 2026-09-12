-- A slot session's MODE: is this time being sold as a PRIVATE HIRE (one booking
-- takes the whole session) or a SHARED TABLE (several bookings fill seats)?
--
-- WHY A COLUMN, AND NOT JUST capacity. capacity = 1 means "one booking fills
-- it" — true of a private hire, but ALSO of a shared table whose provider set
-- slot_capacity = 1. Capacity alone cannot tell the two apart. The mode has to
-- be recorded so the booking route can REFUSE a booking of the wrong kind for a
-- time already claimed: a private hire on a table people have joined, or a seat
-- on a room booked privately. Without it, a flat (private) booking on a shared
-- session silently takes a single seat — the guest pays a private-hire price for
-- one chair. That is a live latent bug today (reachable when a host switches a
-- time between shared and private after it has been booked once), and it becomes
-- an everyday path once a provider can offer both products. See
-- app/api/services/slots/book/route.ts and lib/serviceSlots.ts (slotClaimKind).
--
-- WHEN IT IS SET. On the claim that fills an EMPTY session (seats_taken 0 -> >0),
-- never on insert. That same claim establishes a fresh time AND re-establishes
-- one reopened by a cancellation, so a session sitting at 0 seats has NO
-- effective mode and the next booking decides it. The value on a 0-seat row is
-- stale by design; a reader must treat 0 seats as "either mode is still open".
-- This is why the cancel/refund path needs no change: it only decrements seats,
-- and the next booking re-establishes the mode.
--
-- Backward compatible: one column with a default. Old code (and the other
-- previews still on master) ignore it.
alter table public.slot_sessions
    add column if not exists private boolean not null default false;

comment on column public.slot_sessions.private is
    'Mode of a materialised slot time: true = private hire (one booking takes the '
    'whole session), false = shared table (bookings fill seats). Meaningful only '
    'while seats_taken > 0; a 0-seat session has no mode and the next booking '
    'establishes it. Set by the booking route on the 0 -> >0 claim, not on insert.';
