-- Let a listing wait for approval.
--
-- PRE-FLIGHT: none needed. This only widens what `status` may hold. No
-- existing row changes and no row can violate a widened check. Safe to run
-- twice; safe to run on both projects.
--
-- WHY, AND WHY IT IS ON ITS OWN
--
-- A host listing goes live the instant they finish the wizard: app/addhome
-- writes status = 'published' from the browser, straight to the table. The
-- plan is to make it wait, so that hosts can register in the weeks before soft
-- launch and everything goes live on the day — launch day being one click
-- rather than chasing ten people to finish their pricing.
--
-- The house rule is that a check constraint is widened BEFORE anything writes
-- the new value, because the alternative fails silently at the database: the
-- insert is refused, the browser reports success, and the listing simply is
-- not there. Adding 'hidden' to listings and 'pending_payment' to bookings
-- both hit this.
--
-- So this lands on its own, ahead of the code. Nothing writes 'pending_review'
-- yet. The screens are taught to display it in the same change as this, and
-- only later does publishing move to the server and start producing it.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--
-- It does not touch grants or policies. A probe on 28 August 2026 found that
-- `listings` has row-level security ON for writes — an anonymous insert is
-- refused 42501 on both projects — but its SELECT policy does not filter by
-- status at all: an anonymous caller can read every row over the REST API,
-- drafts included on test, and the two hidden rows on production. Status is
-- filtered only in application queries.
--
-- That has to be fixed before anything can be 'pending_review', or a listing
-- waiting for approval would be readable by anyone. It belongs with the change
-- that moves publishing to the server, alongside revoking `status` from
-- `authenticated`, because those three are one decision. See the plan.
--
-- The order of the values below is the order a listing moves through them,
-- which is worth keeping when the next one is added.

alter table public.listings
    drop constraint if exists listings_status_check;

alter table public.listings
    add constraint listings_status_check
    check (status in ('draft', 'pending_review', 'published', 'hidden'));

comment on constraint listings_status_check on public.listings is
    'draft: still being written, visible only to its host. pending_review: '
    'finished and waiting for an owner to approve it. published: live. '
    'hidden: was live and has been taken down. Widened on 28 August 2026 to '
    'add pending_review, ahead of the code that writes it.';
