-- TEST DATABASE ONLY. Step two of two. Run this AFTER the deploy is up.
--
-- Step one added the business table and left every old column in place, so the
-- site kept working while the deploy went out. This takes the old columns off.
--
-- DO NOT RUN THIS UNTIL THE DEPLOY IS LIVE AND YOU HAVE LOADED THE PAGES.
--
-- `business_name`, `owner_id` and `contact_email` are read by name in three
-- places — the sign-up at app/services/join/apply/page.tsx, the admin queue at
-- app/admin/providers/page.tsx, and app/api/services/submitted/route.ts.
-- Dropping them under running old code does not degrade those pages, it errors
-- them: a select naming a column that is gone fails outright.
--
-- The check at the top refuses to run if the backfill never happened.
--
-- Safe to run twice.

begin;

do $$
declare
    unlinked integer;
begin
    if not exists (
        select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'service_providers'
           and column_name = 'business_id'
    ) then
        raise exception 'STOP: business_id does not exist. Run 1-add-and-backfill.sql first.';
    end if;

    select count(*) into unlinked from "public"."service_providers" where business_id is null;
    if unlinked > 0 then
        raise exception 'STOP: % listing(s) still have no business.', unlinked;
    end if;
end $$;

-- The old policies go first. They read owner_id, so they would be dropped
-- along with the column anyway — naming them here means the tidy-up is
-- something this script did rather than something Postgres did quietly.
drop policy if exists "owners manage their own provider" on "public"."service_providers";
drop policy if exists "owners manage their own areas" on "public"."service_areas";
drop policy if exists "owners manage their own prices" on "public"."service_provider_prices";
drop policy if exists "owners manage their own extras" on "public"."service_provider_extras";

alter table "public"."service_providers"
    drop constraint if exists "service_providers_owner_trade_key";

drop index if exists "public"."service_providers_owner_idx";

-- Dropping a column takes its check constraints with it, so the kind, plan and
-- settlement checks go on their own. They live on service_businesses now.
alter table "public"."service_providers" drop column if exists "owner_id";
alter table "public"."service_providers" drop column if exists "business_name";
alter table "public"."service_providers" drop column if exists "logo";
alter table "public"."service_providers" drop column if exists "contact_email";
alter table "public"."service_providers" drop column if exists "contact_phone";
alter table "public"."service_providers" drop column if exists "kind";
alter table "public"."service_providers" drop column if exists "plan";
alter table "public"."service_providers" drop column if exists "trial_ends_at";
alter table "public"."service_providers" drop column if exists "settlement";
alter table "public"."service_providers" drop column if exists "commission_rate";
alter table "public"."service_providers" drop column if exists "notify_user_ids";

-- The policies added in step one carry "via business" in their names so the
-- two generations could sit side by side. Now that there is only one, they get
-- the names the migrations declare, so a fresh database and this one read the
-- same in the dashboard.
alter policy "owners manage their own provider via business"
    on "public"."service_providers" rename to "owners manage their own provider";
alter policy "owners manage their own areas via business"
    on "public"."service_areas" rename to "owners manage their own areas";
alter policy "owners manage their own prices via business"
    on "public"."service_provider_prices" rename to "owners manage their own prices";
alter policy "owners manage their own extras via business"
    on "public"."service_provider_extras" rename to "owners manage their own extras";

commit;

-- Read back: this should list only the per-trade columns.
--
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'service_providers'
--    order by ordinal_position;
