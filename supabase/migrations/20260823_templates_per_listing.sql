-- More than one template of a type, each scoped to listings.
--
-- Until now `message_templates` was unique on (user_id, template_type): one
-- check-in message per host, for every property they own. That is fine with
-- one cottage and wrong with three — where the lockbox is, which door, the
-- parking, the directions are all different, and a single message cannot say
-- them. The {lockbox_code} placeholder solved the one-token case and no more.
--
-- Scope moves out of the `listing_ids` array and into a join table, because
-- the array cannot be constrained. Postgres has no built-in way to say "no two
-- templates of this type may name the same listing", and that rule is the only
-- thing standing between a misconfiguration and a guest being sent another
-- property's door code. As rows, it is a unique index and the database
-- refuses it.
--
-- `user_id` and `template_type` are carried on the join rows so that index can
-- exist at all — they are filled by a trigger from the parent template, never
-- by the caller, so they cannot drift.
--
-- `message_templates.listing_ids` is deliberately LEFT IN PLACE. The old code
-- is still deployed while this runs, and it reads that column; it is backfilled
-- from here and dropped in a later migration once the new code is live.
--
-- Safe to run twice.
--
-- PRE-FLIGHT — expect 0 rows:
--
--   select table_name from information_schema.tables
--   where table_schema = 'public' and table_name = 'message_template_listings';
--
-- And, to see what is about to be relaxed:
--
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.message_templates'::regclass and contype = 'u';

create table if not exists public.message_template_listings (
    template_id   uuid not null references public.message_templates (id) on delete cascade,
    listing_id    uuid not null references public.listings (id) on delete cascade,
    -- Copied from the parent by the trigger below, so the unique index can
    -- span what it needs to. Never set by a caller.
    user_id       uuid not null,
    template_type text not null,
    primary key (template_id, listing_id)
);

comment on table public.message_template_listings is
    'Which listings a message template applies to. No rows for a template means it is the catch-all for every listing the host has.';

-- The rule the whole change exists for: one host cannot have two templates of
-- the same type both naming the same property. A template with no rows here is
-- the catch-all and is not covered by this — a specific template beating a
-- default is the intended arrangement, not a clash.
create unique index if not exists message_template_listings_one_per_type_idx
    on public.message_template_listings (user_id, template_type, listing_id);

-- Fills user_id and template_type from the parent template.
--
-- They exist only so the index above can be written, so letting a caller
-- supply them would be letting a caller defeat the constraint. Same reasoning
-- as the conversation_prefs stamp trigger: a value that is compared against
-- another table's data is set by the database, not by whoever is calling.
create or replace function public.message_template_listings_fill()
returns trigger
language plpgsql
as $$
begin
    select t.user_id, t.template_type
      into new.user_id, new.template_type
      from public.message_templates t
     where t.id = new.template_id;

    if new.user_id is null then
        raise exception 'no such template: %', new.template_id;
    end if;

    return new;
end $$;

drop trigger if exists message_template_listings_fill_trigger on public.message_template_listings;
create trigger message_template_listings_fill_trigger
    before insert or update on public.message_template_listings
    for each row execute function public.message_template_listings_fill();

-- If a template ever changes hands or type, the copies follow it. Nothing in
-- the UI does that today, but a stale copy here would silently disable the
-- constraint for that row, which is the sort of thing that is discovered by a
-- guest getting the wrong door code.
create or replace function public.message_template_listings_resync()
returns trigger
language plpgsql
as $$
begin
    if new.user_id is distinct from old.user_id
       or new.template_type is distinct from old.template_type then
        update public.message_template_listings
           set user_id = new.user_id, template_type = new.template_type
         where template_id = new.id;
    end if;
    return new;
end $$;

drop trigger if exists message_templates_resync_scope_trigger on public.message_templates;
create trigger message_templates_resync_scope_trigger
    after update on public.message_templates
    for each row execute function public.message_template_listings_resync();

-- Backfill from the array. Idempotent: on conflict do nothing.
insert into public.message_template_listings (template_id, listing_id, user_id, template_type)
select t.id, l.listing_id, t.user_id, t.template_type
  from public.message_templates t
 cross join lateral unnest(coalesce(t.listing_ids, '{}'::uuid[])) as l(listing_id)
 where exists (select 1 from public.listings x where x.id = l.listing_id)
on conflict do nothing;

-- Now the old rule can go. Found by definition rather than by name, because it
-- was created by hand and the name is not recorded anywhere in this repo.
do $$
declare
    c record;
begin
    for c in
        select conname
          from pg_constraint
         where conrelid = 'public.message_templates'::regclass
           and contype = 'u'
           and pg_get_constraintdef(oid) ilike '%(user_id, template_type)%'
    loop
        execute format('alter table public.message_templates drop constraint %I', c.conname);
    end loop;

    -- Some of these are plain unique indexes rather than constraints.
    for c in
        select indexrelid::regclass::text as name
          from pg_index
         where indrelid = 'public.message_templates'::regclass
           and indisunique
           and not indisprimary
           and pg_get_indexdef(indexrelid) ilike '%(user_id, template_type)%'
    loop
        execute format('drop index if exists %s', c.name);
    end loop;
end $$;

-- Row-level security, matching how message_templates itself is reached: a host
-- may see and change the scope of their own templates and nobody else's. The
-- sender reads it with the service role, which bypasses this.
alter table public.message_template_listings enable row level security;

drop policy if exists message_template_listings_own on public.message_template_listings;
create policy message_template_listings_own
    on public.message_template_listings
    for all
    using (
        exists (
            select 1 from public.message_templates t
             where t.id = message_template_listings.template_id
               and t.user_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1 from public.message_templates t
             where t.id = message_template_listings.template_id
               and t.user_id = auth.uid()
        )
    );

grant select, insert, update, delete on public.message_template_listings to authenticated;
revoke all on public.message_template_listings from anon;

-- The sender asks one question of this table: which listings does this
-- template cover.
create index if not exists message_template_listings_template_idx
    on public.message_template_listings (template_id);
