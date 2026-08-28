-- A logo, for the trades where a photo of the work says nothing.
--
-- Cleaning, waste, gardening and maintenance are hired by an owner choosing a
-- contractor, and a photograph of a clean kitchen tells them nothing. A logo
-- makes a small firm look like a business. The guest-facing trades keep work
-- photos, because a cake and a boat trip are bought on what they look like —
-- which is why this is a separate column rather than a reinterpretation of
-- `photos`. A trade can want one, the other, or eventually both, and
-- overloading one column would make "both" impossible.
--
-- Optional. Plenty of small cleaning firms have no logo, and the sign-up falls
-- back to initials in a circle, the same stand-in the account avatars use.
--
-- It is a storage path, not a URL, like every other image on the site — see
-- lib/utils.ts getImageUrl.
--
-- Pre-flight:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'service_providers'
--      and column_name = 'logo';
--
-- Safe to run twice. Run on test first, then production.

alter table "public"."service_providers"
    add column if not exists "logo" text;
