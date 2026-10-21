-- coastal retreat shows gatehouse of fleet
--
-- WHAT THIS IS FOR, AND WHAT GOES WRONG WITHOUT IT.
--
-- "Coastal Retreat with Private Sauna and Spectacular Seaviews"
-- (0dd104bf-5de0-4a0c-aa52-34c5b2993fab) showed guests "Castle Douglas,
-- Dumfries and Galloway". The host typed Castle Douglas — it is the Royal Mail
-- post town for every DG7 postcode — but the cottage (DG7 2HB, coordinates
-- 54.851, -4.280) is about 4 miles from Gatehouse of Fleet and 15 from Castle
-- Douglas; its own street line names Gatehouse. Nothing on our side derived the
-- wrong town. A guest choosing Castle Douglas was shown a cottage on the Fleet.
--
-- Only what guests see changes (Liam, 21 Oct 2026): the public `location`.
-- street_address and postcode are left exactly as the host wrote them, and the
-- host is not notified (no trigger fires on location — the only listings push
-- is on status). The listing now joins the Gatehouse of Fleet area, and the
-- "4.3 miles from Gatehouse of Fleet" line (lib/nearestTown) tells guests it is
-- outside the town. The Location editor's town nudge stops the next one.
--
-- PRE-FLIGHT: one row, one column, guarded on its current value so it is a
-- no-op anywhere else (TEST has no such row) and safe to run twice.

update public.listings
   set location = 'Gatehouse of Fleet, Dumfries and Galloway'
 where id = '0dd104bf-5de0-4a0c-aa52-34c5b2993fab'
   and location = 'Castle Douglas, Dumfries and Galloway';

-- Read back:
--   select location, street_address, postcode from public.listings where id = '0dd104bf-5de0-4a0c-aa52-34c5b2993fab';
--   -- Gatehouse of Fleet, Dumfries and Galloway | Ardwall at Isles of Fleet Retreat, Court Knowe, Gatehouse of Fleet | DG7 2HB
