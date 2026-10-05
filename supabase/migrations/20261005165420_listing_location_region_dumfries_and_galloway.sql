-- Every listing's region is Dumfries and Galloway.
--
-- The Region box is gone from the become-a-host wizard and the listing editor:
-- every property is in Dumfries and Galloway. The region was never its own
-- column — it is the part of `listings.location` after the town ("Kirkcudbright,
-- Dumfries and Galloway") — and it is still read: the public listing's location
-- line, town search, admin and the trade enquiry emails all print it. So it is
-- not dropped; both forms and /api/listings/save now always write it as
-- "Town, Dumfries and Galloway" (lib/places.ts listingLocation).
--
-- This brings the EXISTING rows into line, conservatively:
--   * only rows whose region part is not already exactly "Dumfries and Galloway";
--   * only where that region part is recognisably a region — "Dumfries &
--     Galloway", a county ("…shire"), "Scotland", "United Kingdom" (the
--     malformed "Kirkcudbright, United Kingdom, DG6 4JS, United Kingdom") — or
--     missing altogether ("Kirkcudbright");
--   * never where the first part is itself the region (a town-less
--     "Dumfries & Galloway"), which has no town to keep.
-- A two-part value whose second part is a town ("Harbour Cottage, Kirkcudbright")
-- is left alone rather than guessed at.
--
-- No column, no grant, no row is removed. Rows already right are untouched.

with parts as (
    select id,
           btrim(split_part(location, ',', 1)) as town,
           nullif(btrim(substr(location, length(split_part(location, ',', 1)) + 2)), '') as rest
      from public.listings
     where location is not null
)
update public.listings l
   set location = p.town || ', Dumfries and Galloway'
  from parts p
 where l.id = p.id
   and p.town <> ''
   and lower(p.town) !~ 'galloway'
   and (
        p.rest is null
        or (p.rest <> 'Dumfries and Galloway'
            and lower(p.rest) ~ '(galloway|shire|scotland|united kingdom)')
   );

-- Read back:
--   select location, count(*) from public.listings group by 1 order by 2 desc;
--   -- expected on production: every row "<Town>, Dumfries and Galloway"
