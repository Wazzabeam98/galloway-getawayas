-- What a food provider can cater for, in their own words.
--
-- A slot books instantly with no provider gate, so a guest with a dietary need
-- has no "can you do gluten-free?" before they pay — the note+confirm loop that
-- answers it for the request shapes doesn't exist for a slot. The answer belongs
-- on the listing, up front. This is the column that holds it.
--
-- Deliberately free text, not a checklist: a checklist reads as a guarantee, and
-- "gluten-free" as a tick box is a promise a kitchen can't always keep. A
-- sentence in the provider's own words ("can do gluten-free and dairy-free with
-- a day's notice; not a nut-free kitchen") is honest where a tick is not.
--
-- When it is EMPTY, the listing says so plainly rather than staying silent — a
-- guest reading nothing assumes it's fine, which is the failure this is here to
-- stop. Same principle as "no note" never meaning "no allergy".
--
-- Safe to run twice. Run on test first, then production.

alter table "public"."service_providers"
    add column if not exists "dietary_note" text;

comment on column "public"."service_providers"."dietary_note" is
    'A food provider''s own words on what they can cater for. Free text, not a '
    'checklist. Shown on the listing; when empty the listing says "hasn''t said" '
    'rather than staying silent.';
