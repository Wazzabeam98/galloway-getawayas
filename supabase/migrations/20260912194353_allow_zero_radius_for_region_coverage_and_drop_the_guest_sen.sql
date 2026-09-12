-- allow zero radius for region coverage and drop the guest sentinel
--
-- WHAT THIS IS FOR, AND WHAT GOES WRONG WITHOUT IT.
--
-- A guest experience covers whole REGIONS ("Kirkcudbright and the Stewartry"),
-- not a circle round a point, so its coverage genuinely has no radius. The
-- guest wizard has always carried that honestly as radius 0. But the check on
-- this table demanded radius > 0, so a new guest's coverage insert (at
-- /api/services/finish) was rejected outright and their coverage never saved —
-- silently, because that insert threw its error away. Nothing on the guest path
-- reads the radius (the directory offers every experience to every cottage; the
-- coversPoint filter is the trade side's alone), so 0 is a value no reader ever
-- consults, not a distance.
--
-- Without this migration a region-based provider cannot store coverage at all
-- unless a magic sentinel is written in the number's place — which is what the
-- code did as a stopgap, and which puts a 1 in the database that means "no
-- radius" and that some future reader will mistake for one mile. This relaxes
-- the lower bound to allow the honest 0, keeps the 200-mile ceiling that stops
-- a fat-fingered host promising the whole country, and still refuses negatives.
--
-- PRE-FLIGHT: read-only, non-destructive. Dropping and re-adding a check
-- constraint loses no rows; the backfill below only ever touches guest rows
-- that hold the sentinel 1 (there is one such row on test), setting them to the
-- 0 they always meant. No production apply — test only, by decision.

alter table "public"."service_areas"
    drop constraint if exists "service_areas_radius_check";

alter table "public"."service_areas"
    add constraint "service_areas_radius_check"
        check ("radius_miles" >= 0 and "radius_miles" <= 200);

-- Normalise the one guest row that holds the old sentinel radius (1 = "no
-- radius") to the honest 0 the relaxed check now permits. Scoped to guest
-- providers, which only ever received a 1 from the sentinel; a host's radius is
-- a real distance and is left untouched. Runs after the new check is in place,
-- because 0 would fail the old one.
update "public"."service_areas" a
    set "radius_miles" = 0
    from "public"."service_providers" p
    where a."provider_id" = p."id"
      and p."audience" = 'guest'
      and a."radius_miles" = 1;
