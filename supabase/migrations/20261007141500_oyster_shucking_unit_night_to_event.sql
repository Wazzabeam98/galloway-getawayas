-- Move the two Oyster Shucking Experience offerings off the 'night' unit.
--
-- "Oyster Shucking Experience" (audience=guest, comes_to_you) is our first real
-- food provider. The pricing bases offered at the time came from the trades
-- directory and included "per night", so both offerings were priced
-- "£475 / night" — nonsense for an event a provider turns up to, and worse,
-- 'night' MULTIPLIES, so the booking flow would have asked "how many nights?".
--
-- The new offered set (OFFERED_UNITS in lib/serviceOrders.ts) is per person /
-- whole session / per event / per item. Both offerings are a single whole-event
-- price, so 'event' is the sensible unit: £475 charged once, read as
-- "£475 / event". 'event' is non-multiplying, like 'flat'.
--
-- Scoped to the two known rows by id and guarded on unit='night', so it is a
-- no-op anywhere those rows are already fixed or do not exist (e.g. TEST, a
-- fresh dev database). No schema change; data only.

update public.service_provider_items
   set unit = 'event'
 where id in (
         '26760dfb-655a-4823-9b00-b49f1c6638b1',  -- Walkaround shucking
         '817e08fc-5935-4ba3-870f-9a153b89f129'   -- Oyster Boat
       )
   and unit = 'night';
