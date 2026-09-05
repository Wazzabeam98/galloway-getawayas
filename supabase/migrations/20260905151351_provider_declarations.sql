-- The declarations a guest-experience provider confirms at sign-up.
--
-- The checks screen ("A few checks before we list you") asks a set chosen for
-- the category — a chef confirms food registration and allergens, a sauna owner
-- confirms their heat-and-cold setup is maintained, everyone confirms public
-- liability insurance and that their listing is accurate. This is the column
-- that records their answers.
--
-- Shape is an object keyed by check (lib/serviceProviders GUEST_CHECKS), each a
-- boolean: exactly the checks that category was asked, and whether each was
-- confirmed. So the owner reads a true picture at review — what we put to them,
-- and their answer — rather than inferring a missing tick from an absent key.
--
-- NON-BLOCKING BY DESIGN. Nothing enforces these at sign-up: a provider can
-- send their application with a box unticked, and the owner decides what that
-- means when they approve. So there is no NOT NULL and no CHECK — an empty
-- object ('{}') is the honest default for a row that predates the screen or a
-- host trade that never sees it.
--
-- Safe to run twice. Run on test first, then production.

alter table "public"."service_providers"
    add column if not exists "declarations" jsonb not null default '{}'::jsonb;

comment on column "public"."service_providers"."declarations" is
    'What a guest-experience provider confirmed on the checks screen: an object '
    'keyed by check (GUEST_CHECKS), each a boolean. Records the checks that '
    'category was asked and their answer. Non-blocking — weighed at review, not '
    'enforced at sign-up. Empty object for host trades and pre-existing rows.';
