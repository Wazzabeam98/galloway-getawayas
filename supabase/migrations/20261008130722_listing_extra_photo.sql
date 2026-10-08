-- One optional photo per host extra.
--
-- A sauna pack or a hamper looks bare as a line of text; a photo sells it. This
-- adds a single nullable column holding the storage PATH of the photo (the same
-- shape a listing photo is stored as — the public URL is derived from the path
-- by getImageUrl, nothing stores a full URL). Uploaded, shrunk and size-checked
-- in the browser exactly as listing photos are (lib/compressImage, lib/photoRules).
--
-- One photo, optional: an extra with no photo still reads right. Nothing in the
-- money path reads this column — it is display only — so no grant or guard here
-- changes; the existing host-manages-their-own RLS policy covers writing it.
--
-- Additive, loses nothing, safe to run twice. Run on test first, then production.

alter table "public"."listing_extras"
    add column if not exists "photo" text;

-- Read back:
--   select column_name from information_schema.columns
--    where table_name = 'listing_extras' and column_name = 'photo';
--   -- expect one row.
