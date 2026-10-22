-- wishlists (Save, Airbnb's shape)
--
-- WHAT THIS IS FOR. A guest can Save a holiday let or an experience to a
-- wishlist — the heart on every card and the Save button on every listing. A
-- wishlist is a named list of saved stays and experiences, private to the
-- person who made it. These two tables hold them.
--
-- WHO MAY READ-WRITE THEM. The OWNER, and only the owner, straight from the
-- browser under row-level security — the same design as guest_delivery_addresses
-- (20260925150018): guest_id defaults to auth.uid() and a single policy pins
-- every read and write to guest_id = auth.uid(). So a guest reads and writes
-- their own wishlists with the ordinary browser client (lib/supabase), no
-- service-role route, and no one can see anyone else's. anon gets nothing.
--
-- WHY RLS AND NOT A CACHED PAGE. The listing and experience pages are cached and
-- shared across every visitor, so a person's hearts and wishlists must never be
-- baked into them — they are loaded on the client after the page renders, which
-- only works because these tables are the caller's own RLS-gated rows.
--
-- PERSONAL DATA. A wishlist carries a name the person chose ("Mum's visit"), so
-- a closed account's wishlists are deleted in admin_anonymise_account (patched
-- in place below); the items cascade with them.
--
-- PRE-FLIGHT. Not destructive: two new tables, their indexes, RLS, grants, and
-- the account-erasure function patched to clear a closed account's wishlists.
-- Nothing is dropped or rewritten.

create table if not exists public.wishlists (
    id uuid primary key default gen_random_uuid(),
    -- The owner. Defaults to auth.uid() so the browser can insert without naming
    -- itself; the policy's with-check pins it regardless.
    guest_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    name text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists wishlists_guest_idx
    on public.wishlists (guest_id, created_at desc);

create table if not exists public.wishlist_items (
    id uuid primary key default gen_random_uuid(),
    -- The owner, carried on the item too so RLS gates it directly (and so a grid
    -- of hearts can read every saved id in one query). Defaults to auth.uid().
    guest_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    wishlist_id uuid not null references public.wishlists (id) on delete cascade,
    -- Exactly one of these is set: a saved holiday let, or a saved experience
    -- (a guest-facing service_providers row). The CHECK enforces the xor.
    listing_id uuid references public.listings (id) on delete cascade,
    provider_id uuid references public.service_providers (id) on delete cascade,
    created_at timestamptz not null default now(),
    constraint wishlist_items_one_target check ((listing_id is not null) <> (provider_id is not null))
);

-- A stay or an experience sits in a given wishlist at most once.
create unique index if not exists wishlist_items_listing_uidx
    on public.wishlist_items (wishlist_id, listing_id) where listing_id is not null;
create unique index if not exists wishlist_items_provider_uidx
    on public.wishlist_items (wishlist_id, provider_id) where provider_id is not null;
-- The hearts on a page read "what has this guest saved" by owner.
create index if not exists wishlist_items_guest_idx
    on public.wishlist_items (guest_id);

alter table public.wishlists enable row level security;
drop policy if exists "guests manage their own wishlists" on public.wishlists;
create policy "guests manage their own wishlists"
    on public.wishlists
    using (guest_id = auth.uid())
    with check (guest_id = auth.uid());

revoke all on public.wishlists from anon, authenticated;
grant select, insert, update, delete on public.wishlists to authenticated;

alter table public.wishlist_items enable row level security;
drop policy if exists "guests manage their own wishlist items" on public.wishlist_items;
-- Own items, and an item may only be added to a wishlist the person owns (the
-- subquery stops a crafted insert attaching an item to someone else's list).
create policy "guests manage their own wishlist items"
    on public.wishlist_items
    using (guest_id = auth.uid())
    with check (
        guest_id = auth.uid()
        and wishlist_id in (select id from public.wishlists where guest_id = auth.uid())
    );

revoke all on public.wishlist_items from anon, authenticated;
grant select, insert, update, delete on public.wishlist_items to authenticated;

comment on table public.wishlists is
    'A guest''s named wishlist of saved stays and experiences. Owner-only RLS (guest_id = auth.uid()); read/written from the browser, never service-role. Private to the owner.';
comment on table public.wishlist_items is
    'A saved holiday let (listing_id) or experience (provider_id) in a wishlist, exactly one of the two. Owner-only RLS.';

-- ---------------------------------------------------------------- erasure

-- A closed account's wishlists carry a name the person chose, so they are
-- cleared with the rest of their personal data. Patched in place after the
-- listing_notification_subscribers delete line (a single-line delete in the
-- saved-snippets block; wishlist_items cascade with the wishlists), the same way
-- listing_notification_subscribers itself patched in after email_outbox.
do $patch$
declare
  def text;
  anchor text := 'begin delete from public.listing_notification_subscribers where old_email is not null and lower(email) = lower(old_email); exception when undefined_table then null; end;';
  added text := E'\n  begin delete from public.wishlists where guest_id = uid; exception when undefined_table then null; end;';
begin
  select pg_get_functiondef('public.admin_anonymise_account(uuid)'::regprocedure) into def;
  if position('public.wishlists where guest_id' in def) > 0 then
    return;  -- already patched
  end if;
  if position(anchor in def) = 0 then
    raise exception 'admin_anonymise_account no longer has the guest_delivery_addresses delete line to patch after — add the wishlists delete by hand';
  end if;
  execute replace(def, anchor, anchor || added);
end
$patch$;

notify pgrst, 'reload schema';

-- Read back:
--   select relname, relrowsecurity from pg_class where relname in ('wishlists','wishlist_items') order by relname;  -- both true
--   select count(*) from information_schema.role_table_grants where table_name in ('wishlists','wishlist_items') and grantee='anon';  -- 0
--   select count(*) from information_schema.role_table_grants where table_name in ('wishlists','wishlist_items') and grantee='authenticated' and privilege_type in ('SELECT','INSERT','UPDATE','DELETE');  -- 8
--   select position('public.wishlists where guest_id' in pg_get_functiondef('public.admin_anonymise_account(uuid)'::regprocedure)) > 0;  -- true
