-- A published listing must have a name and a price somebody could pay.
--
-- The add-a-property wizard and the edit-listing screen both refuse to publish
-- without them, but both of those run in the browser, and the browser writes
-- straight to this table. A form can only refuse politely. This is the thing
-- that makes it impossible.
--
-- 'published' only. A draft is deliberately allowed to be half-finished — that
-- is the whole point of Save & finish later — and 'hidden' rows were published
-- before they were taken down, so they already satisfy this.
--
-- Photos are NOT part of this, though the wizard requires one. Every seed
-- listing in the test project is created without images, so including them
-- would refuse to apply on test and would break the payment suite's reseed.
-- Photos stay a rule the forms enforce.
--
-- title is already NOT NULL and price_per_night is already NOT NULL, so the
-- gaps this closes are a blank-after-trimming title and a price of zero or
-- less. Both were reachable: the wizard stored `title || 'Untitled listing'`
-- for drafts, and the edit screen tested `!price`, which "0" passes.

-- BEFORE RUNNING THIS, check nothing already breaks it. A check constraint
-- refuses to be created if any existing row violates it. This must return no
-- rows on the project you are about to run it against.
--
--   select id, title, price_per_night, status
--   from public.listings
--   where status = 'published'
--     and (btrim(title) = '' or price_per_night <= 0);
--
-- Run against production and test on 22 August 2026: no rows on either.
-- Production had 4 published listings, test had 10.
--
-- APPLIED TO TEST on 22 August 2026, and checked: an update setting a
-- published listing to price 0, and one setting its title to spaces, were both
-- refused.
--
-- NOT YET APPLIED TO PRODUCTION. There is no production database password on
-- the MacBook — supabase/.temp/pooler-url carries the host and user but no
-- password, and the CLI has no stored access token — so it could not be run
-- from here. Run the alter and comment below in the Supabase SQL editor for
-- project hviwjxigqivjfhmhpjiy, then delete this paragraph.

alter table public.listings
    add constraint listings_published_are_complete
    check (
        status <> 'published'
        or (btrim(title) <> '' and price_per_night > 0)
    );

comment on constraint listings_published_are_complete on public.listings is
    'A published listing must have a non-blank title and a price above zero. '
    'Drafts are exempt on purpose. Photos are enforced by the forms, not here, '
    'because the test seed data has none.';
