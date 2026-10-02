-- The admin side of the stay Resolution Centre (PR 3 of the payments trilogy:
-- #182 send/request money, #183 change reservation, this one).
--
-- A money REQUEST the guest declines, or lets run past the 72h deadline, is
-- moved to status 'escalated' by lib/resolutions + the cron and the host-decide
-- route. Until now nothing consumed that state: the escalation alert emails
-- already link to /admin/resolutions, a page that did not exist. This adds the
-- columns that page writes when an admin adjudicates the escalation.
--
-- NO MONEY MOVES HERE, and that is deliberate. An escalated row is a request the
-- guest never paid — the platform holds no authority to charge their card, so
-- the admin's job is to record the decision and close it, not to move money. Any
-- actual refund of something already paid goes through the existing send/refund
-- path, not this one. So this migration adds four record-keeping columns and one
-- partial index; it grants nothing (the table stays service-role only, RLS on,
-- reached only through the admin-gated route), and it loses no data.

alter table public.booking_resolutions
    -- Which way the admin decided. 'for_host'/'for_guest' record who the platform
    -- sided with; 'split' is a partial finding; 'dismissed' closes a request that
    -- should never have been raised. It is a note about a decision, not a money
    -- instruction — nothing keys off it to charge or refund.
    add column if not exists admin_outcome text
        check (admin_outcome in ('for_host', 'for_guest', 'split', 'dismissed')),
    -- The admin's written reason. Required by the route, so a closed escalation
    -- always says why — the same rule the migration ledger's --note follows.
    add column if not exists admin_note text,
    -- Who closed it, and when. resolved_at is the close marker the queue reads:
    -- an escalation is OPEN while it is null and CLOSED once it is set, exactly
    -- like the chargebacks page uses closed_at. on delete set null so removing an
    -- admin profile never deletes the audit of what they decided.
    add column if not exists resolved_by uuid references public.profiles(id) on delete set null,
    add column if not exists resolved_at timestamptz;

-- The admin queue: escalated requests still waiting on a decision, oldest first.
create index if not exists booking_resolutions_admin_open_idx
    on public.booking_resolutions (escalated_at)
    where status = 'escalated' and resolved_at is null;
