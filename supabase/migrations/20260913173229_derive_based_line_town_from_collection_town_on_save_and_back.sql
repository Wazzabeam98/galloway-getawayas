-- derive based_line town from collection_town on save, and backfill
--
-- WHAT THIS IS FOR, AND WHAT GOES WRONG WITHOUT IT.
--
-- `based_line` is the one public "where they are" line on a guest experience —
-- shown on the experiences card and provider page (app/experiences/*), never on
-- the trades directory. It is meant to be a TOWN and nothing else: everything is
-- in Dumfries & Galloway so the region adds nothing, and a provider's street is
-- PRIVATE until an order is confirmed.
--
-- On master it has never actually been derived. The wizard writes it from the
-- collection town for a collecting provider (lib/serviceProviders.ts,
-- collectionFieldsForWrite), but nothing derives it in general: for a provider
-- who signed up any other way it is whatever prose was typed, or null. The
-- come-to-me slot work fixed only the slot-on-premises path, going forward, and
-- never for existing rows. The result is a column that is null for real
-- providers and, on test, holds hand-typed seed prose — some of it a street
-- ("Harbourside, Kirkcudbright") or a region ("across the Stewartry"), exactly
-- the two things it must never be.
--
-- WHERE A TOWN CAN HONESTLY COME FROM, PER SHAPE. Only the "guest comes to you"
-- shapes have a town: made-to-order collection, a slot on the provider's
-- premises, and a slot at a meeting point all carry a collection address whose
-- TOWN is public (`collection_town`) and whose street/postcode stay private. The
-- "provider travels to the guest" shapes — comes_to_you, made-to-order delivery,
-- and a travelling slot — have only coverage regions, no single town, and must
-- NOT invent one: their location is the separate "Covers …" line built from
-- service_areas. So `collection_town` is the only honest source, and it is
-- correct for it to be null (and based_line with it) for a travelling provider.
--
-- THE FIX. Make the derivation authoritative at the database, so no future code
-- path has to remember it. A BEFORE INSERT OR UPDATE trigger sets based_line
-- from collection_town on every write:
--   - collecting (a town present)        -> based_line = that town
--   - delivering (fulfilment='delivery')  -> based_line = null, even if a stale
--                                            collection_town lingers (they travel)
--   - anything else (no town)             -> based_line = null
-- The wizard's own based_line write stays and now agrees with the trigger; the
-- trigger is the backstop that catches every other path (admin, seed, a future
-- feature) rather than being a rule a person must re-apply each time.
--
-- PRE-FLIGHT — DESTRUCTIVE (the backfill overwrites data), run with --apply
-- --destructive. What it overwrites, checked on test before running:
--   select based_line, count(*) from public.service_providers
--    where based_line is not null group by based_line;
-- Every non-null value on test is seed prose owned by a *.test account (8 from
-- seed-marketplace, plus seed-chef / seed-other-applicant / seed-review-row);
-- there are no real providers, and none on production (the guest side has never
-- had an approved real provider). So the backfill loses nothing real. It nulls
-- the prose because collection_town is empty everywhere today: the honest
-- derived value IS null until a real collection address is entered, at which
-- point the trigger fills the town. Travelling providers keep their location via
-- the "Covers …" line regardless.

-- The derivation, in one place. Pure: it only reads and rewrites NEW, touches no
-- table, so SECURITY INVOKER (the default) is right and it is cheap on every row.
create or replace function public.derive_based_line()
returns trigger
language plpgsql
as $$
begin
    new.based_line := case
        when new.fulfilment = 'delivery' then null
        else nullif(btrim(new.collection_town), '')
    end;
    return new;
end;
$$;

drop trigger if exists "derive_based_line" on "public"."service_providers";
create trigger "derive_based_line"
    before insert or update on "public"."service_providers"
    for each row execute function public.derive_based_line();

-- Backfill: bring every existing row into line with the rule above. On today's
-- data this nulls the seed prose (collection_town is empty everywhere); once a
-- collection address exists it will read back as the town. `is distinct from`
-- so a row already correct is not rewritten.
update public.service_providers
   set based_line = case
           when fulfilment = 'delivery' then null
           else nullif(btrim(collection_town), '')
       end
 where based_line is distinct from (case
           when fulfilment = 'delivery' then null
           else nullif(btrim(collection_town), '')
       end);

-- Read back:
--   -- the trigger is installed:
--   select tgname from pg_trigger where tgname = 'derive_based_line';
--   -- no based_line holds a street or a region any more (expect zero rows):
--   select id, based_line from public.service_providers
--    where based_line ~ '[0-9]' or based_line ilike '%across%' or based_line ilike '%,%';
--   -- a collecting provider derives its town (set an address, read it back):
--   -- update service_providers set fulfilment='collection', collection_town='Wigtown' where id=...;
--   -- select based_line from service_providers where id=...;  -> 'Wigtown'
