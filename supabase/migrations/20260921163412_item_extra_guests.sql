-- Extra-guests pricing for a group-priced (flat) experience item.
--
-- A flat item has one base price that includes a set number of guests. With
-- these set, a larger party pays a per-head fee on top — a per-extra-adult fee
-- and, where the provider's minimum age admits children, a per-extra-child fee —
-- up to a maximum party size. The price never drops below the base (fewer than
-- the included number still pays the base).
--
-- All nullable. An item with `included_guests` NULL has no extra-guests pricing
-- and behaves exactly as before: one flat price, party size is metadata only.
alter table public.service_provider_items
    add column if not exists included_guests integer,
    add column if not exists extra_adult_fee numeric,
    add column if not exists extra_child_fee numeric,
    add column if not exists max_party integer;

-- Guard rails: fees are non-negative money, and the party bounds are sane.
alter table public.service_provider_items
    add constraint service_provider_items_extra_adult_fee_nonneg
        check (extra_adult_fee is null or extra_adult_fee >= 0) not valid,
    add constraint service_provider_items_extra_child_fee_nonneg
        check (extra_child_fee is null or extra_child_fee >= 0) not valid,
    add constraint service_provider_items_included_guests_pos
        check (included_guests is null or included_guests >= 1) not valid,
    add constraint service_provider_items_max_party_ok
        check (max_party is null or included_guests is null or max_party >= included_guests) not valid;
