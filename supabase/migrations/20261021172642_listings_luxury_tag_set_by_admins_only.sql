-- listings luxury tag set by admins only
--
-- WHAT THIS IS FOR, AND WHAT GOES WRONG WITHOUT IT.
--
-- A "Luxury" tag, Airbnb Luxe's shape: a mark of a place we have chosen, shown
-- as a badge on its card and page and as a search filter. Only an admin sets it
-- (/api/admin/listings/luxury, is_admin checked on the server, service-role
-- write) — a host must never be able to call their own place luxury.
--
-- THE WRITE SIDE. `authenticated` has no UPDATE on this column (UPDATE on
-- listings is a column allow-list, 20260903161233, and is_luxury is not added
-- to it). But it still holds a TABLE-level INSERT grant on listings, which
-- covers every column including new ones — so without more, a host's browser
-- could create a draft with is_luxury = true. The trigger below closes that
-- the way listings_status_authority closes status: a browser role may not set
-- it on insert, nor change it on update. The service role and the migration
-- user may.
--
-- THE READ SIDE. Public, like display_order: the anon home grid and area pages
-- read it for the badge and the filter. Nothing private about it.
--
-- PRE-FLIGHT: not destructive. A new column defaulting to false (every
-- existing listing untagged), one column SELECT grant, one new trigger. Safe
-- to run twice.

alter table public.listings add column if not exists is_luxury boolean not null default false;

comment on column public.listings.is_luxury is
    'Admin-only "Luxury" tag (Airbnb Luxe style): a badge on the card and page and a search filter. Set only by /api/admin/listings/luxury (is_admin + service role); browser roles cannot set it on insert or change it (listings_luxury_authority).';

grant select (is_luxury) on public.listings to anon, authenticated;

create or replace function public.enforce_listing_luxury_authority()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
    if current_user in ('anon', 'authenticated') then
        if tg_op = 'INSERT' and coalesce(new.is_luxury, false) then
            raise exception 'The Luxury tag is set by Galloway Getaways, not on the listing.'
                using errcode = '42501';
        elsif tg_op = 'UPDATE' and new.is_luxury is distinct from old.is_luxury then
            raise exception 'The Luxury tag is set by Galloway Getaways, not on the listing.'
                using errcode = '42501';
        end if;
    end if;
    return new;
end;
$$;

revoke all on function public.enforce_listing_luxury_authority() from public, anon, authenticated;

drop trigger if exists listings_luxury_authority on public.listings;
create trigger listings_luxury_authority
    before insert or update on public.listings
    for each row
    execute function public.enforce_listing_luxury_authority();

notify pgrst, 'reload schema';

-- Read back:
--   select data_type, is_nullable, column_default from information_schema.columns where table_name = 'listings' and column_name = 'is_luxury';   -- boolean | NO | false
--   select count(*) from public.listings where is_luxury;                                                                                    -- 0
--   select has_column_privilege('anon', 'public.listings', 'is_luxury', 'select');                                                          -- true
--   select has_column_privilege('authenticated', 'public.listings', 'is_luxury', 'update');                                                 -- false
--   select count(*) from pg_trigger where tgname = 'listings_luxury_authority';                                                             -- 1
