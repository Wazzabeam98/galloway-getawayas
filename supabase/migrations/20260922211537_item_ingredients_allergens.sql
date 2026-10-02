-- Per-item ingredient and allergen details for a made-to-order menu.
--
-- A food-ordering menu shows each item with an info icon; tapping it opens what's
-- in it and what it may contain. The provider enters both per item in the listing
-- editor. Free text (not a fixed allergen list) so a home baker can write it the
-- way they would on a label — "Contains: wheat, egg, milk. Made in a kitchen that
-- handles nuts." Null on every item that has neither (the icon simply doesn't show).
alter table public.service_provider_items
    add column if not exists ingredients text,
    add column if not exists allergens text;

notify pgrst, 'reload schema';
