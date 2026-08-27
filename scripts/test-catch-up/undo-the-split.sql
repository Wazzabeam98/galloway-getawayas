-- TEST DATABASE ONLY. Undoes the business/listing split. Run this once.
--
-- WHAT HAPPENED
--
-- `service_providers` was briefly split into a business and its trade
-- listings, so that one person holding several trades would type their name
-- and phone number once. That was the wrong shape: a cleaning round and a
-- window round are two businesses and very often trade under two names, so
-- each trade is its own row with its own name again — which is what the
-- migrations did before the split and what they do again now.
--
-- Step one of the catch-up ran on test. Step two never did, which is the only
-- reason this is cheap: step two was the destructive half, and every column it
-- would have dropped is still here and still populated. Nothing has been lost.
--
-- THIS ALSO TAKES THE TRIAL OUT
--
-- There is no free trial. It is 10% per job from the first job, at the rate in
-- `commission_rate`. `trial_ends_at` goes, and 'trial' comes out of the plan
-- check, so the column cannot hold a value the code no longer knows about.
--
-- Safe to run twice.

begin;

-- 1. Anything edited through the split code lands back on the listing.
--
-- Between step one and now, a save from the new sign-up wrote the name, email,
-- phone and logo to `service_businesses` and nowhere else. Those edits would
-- otherwise go down with the table. Copied back only where they actually
-- differ, so an untouched row is left exactly as it is.
do $$
begin
    if exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'service_providers'
           and column_name = 'business_id'
    ) then
        update "public"."service_providers" p
           set business_name  = coalesce(nullif(btrim(b.business_name), ''), p.business_name),
               contact_email  = coalesce(b.contact_email, p.contact_email),
               contact_phone  = coalesce(b.contact_phone, p.contact_phone),
               logo           = coalesce(b.logo, p.logo),
               owner_id       = coalesce(p.owner_id, b.owner_id),
               updated_at     = now()
          from "public"."service_businesses" b
         where b.id = p.business_id
           and (
                coalesce(nullif(btrim(b.business_name), ''), '') is distinct from coalesce(p.business_name, '')
             or coalesce(b.contact_email, '') is distinct from coalesce(p.contact_email, '')
             or coalesce(b.contact_phone, '') is distinct from coalesce(p.contact_phone, '')
             or coalesce(b.logo, '') is distinct from coalesce(p.logo, '')
           );
    end if;
end $$;

-- Refuses to go on if a listing would be left without an owner. Without
-- owner_id nothing can see the row and it looks deleted.
do $$
declare
    ownerless integer;
begin
    select count(*) into ownerless from "public"."service_providers" where owner_id is null;
    if ownerless > 0 then
        raise exception 'STOP: % listing(s) have no owner_id. Nothing has been changed.', ownerless;
    end if;
end $$;

-- 2. The policies that read ownership through the business.
--
-- The originals were never dropped — step two would have done that — so they
-- are still in place and still correct. These are the ones that go.
drop policy if exists "owners manage their own provider via business" on "public"."service_providers";
drop policy if exists "owners manage their own areas via business" on "public"."service_areas";
drop policy if exists "owners manage their own prices via business" on "public"."service_provider_prices";
drop policy if exists "owners manage their own extras via business" on "public"."service_provider_extras";
drop policy if exists "owners manage their own business" on "public"."service_businesses";
drop policy if exists "businesses with an approved listing are public" on "public"."service_businesses";

-- 3. The registrations table was created with a policy that joins through the
-- business, so it is rewritten here rather than left pointing at a table that
-- is about to disappear. The table itself and its grants are untouched: it
-- hangs off the listing, which is not going anywhere.
drop policy if exists "owners manage their own registrations" on "public"."service_provider_registrations";
create policy "owners manage their own registrations"
    on "public"."service_provider_registrations"
    using (exists (
        select 1 from "public"."service_providers" p
         where p."id" = "service_provider_registrations"."provider_id"
           and p."owner_id" = auth.uid()
    ))
    with check (exists (
        select 1 from "public"."service_providers" p
         where p."id" = "service_provider_registrations"."provider_id"
           and p."owner_id" = auth.uid()
    ));

-- 4. The column and the table.
alter table "public"."service_providers"
    drop constraint if exists "service_providers_business_trade_key";

drop index if exists "public"."service_providers_business_idx";

alter table "public"."service_providers" drop column if exists "business_id";

drop table if exists "public"."service_businesses";

-- 5. The trial.
--
-- The value has to move before the check narrows, or the constraint is
-- rejected by the row it is being added for. Same shape as the house rule
-- about widening a check before adding a status value, running the other way.
update "public"."service_providers"
   set plan = 'commission', updated_at = now()
 where plan = 'trial';

alter table "public"."service_providers"
    drop constraint if exists "service_providers_plan_check";

alter table "public"."service_providers"
    add constraint "service_providers_plan_check"
    check ("plan" in ('commission', 'subscription'));

alter table "public"."service_providers"
    alter column "plan" set default 'commission';

-- SUPERSEDED, AND LEFT HERE LOUD RATHER THAN QUIET.
--
-- This line used to read:
--
--     alter table "public"."service_providers" drop column if exists "trial_ends_at";
--
-- The trial came back on 27 August 2026 — 90 free days from approval for the
-- maintenance trades, then £20 a month — and `trial_ends_at` is a real column
-- again, added by 20260827_provider_trial_and_plan.sql.
--
-- `drop column if exists` would have taken it off again without a word,
-- because "if exists" is precisely the phrase that turns undoing a live
-- migration into a silent no-op. Anybody re-running this script on test would
-- have got a database that no longer matched the code and no error to say so.
--
-- So it raises instead. If you are here because this script just failed, that
-- is it working: you are running an undo written for a schema that has since
-- moved on. Read 20260827_provider_trial_and_plan.sql, decide what you
-- actually want, and do that rather than editing this line out.
do $$
begin
    if exists (
        select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name = 'service_providers'
           and column_name = 'trial_ends_at'
    ) then
        raise exception
            'undo-the-split.sql would drop trial_ends_at, which is live again '
            'as of 20260827_provider_trial_and_plan.sql. Refusing. See the '
            'note above this block.';
    end if;
end $$;

commit;

-- Read back. This should be the original shape: owner_id and business_name on
-- the listing and no business_id. `trial_ends_at` IS expected now — see the
-- refusal above; it is no longer this script's business to remove it.
--
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'service_providers'
--    order by ordinal_position;
--
--   select business_name, trade, plan, owner_id is not null as has_owner
--     from public.service_providers;
