-- A delivery radius, in miles, for a provider that travels to the guest.
--
-- The regions a provider ticks are informational; this is the enforced one. A
-- delivery or travelling order is refused server-side when the address is further
-- than this from the provider's base (their collection postcode) — measured from
-- the cottage against a stay, or from the typed postcode standalone. 0 means no
-- radius set, in which case delivery falls back to the Dumfries & Galloway gate.
alter table public.service_providers
    add column if not exists delivery_radius_miles numeric(5,1) not null default 0;

notify pgrst, 'reload schema';
