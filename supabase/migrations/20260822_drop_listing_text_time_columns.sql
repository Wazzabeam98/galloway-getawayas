-- STEP 2 OF 2. DO NOT RUN THIS YET.
--
-- Run it only once the step 1 migration and the code that goes with it have
-- been live for a day or two, and a host has actually saved times from the
-- listing editor without anything going wrong.
--
-- Why the gap: while the old code is still deployed anywhere, a request in
-- flight can write to these columns. Dropping them underneath it turns a
-- harmless write into a 500. Nothing here needs preserving — every value in
-- both projects was the column default when this was written, and checkin_end
-- was '' on all fourteen rows — so the only reason to wait is the deploy
-- window.
--
-- Before running, confirm nothing writes them any more:
--
--   grep -rn "checkin_start\|checkin_end\|checkout_time" app components lib
--
-- That must come back empty.

alter table public.listings
    drop column if exists "checkin_start",
    drop column if exists "checkin_end",
    drop column if exists "checkout_time";
