-- Trades get the take-down experiences already have, and admins get a take-down
-- for both, built like the admin accommodation hide.
--
-- 1. service_providers.admin_hidden_at — an ADMIN's take-down of an experience
--    or a trade. Null = not taken down.
--
--    WHY NOT status = 'hidden'. The accommodation hide flips listings.status, but
--    a provider's status is read by their own dashboard, calendar, earnings and
--    Stripe-connect pages, which all redirect anything that is not 'approved'
--    back into the sign-up flow. Flipping it would lock a taken-down trade out of
--    the enquiries they already have, and an experience provider out of the
--    orders they already took — and existing work has to keep running. So, like
--    owner_paused, the take-down is its own column, orthogonal to status: the row
--    stays 'approved', the shop window closes, the back office stays open. Unlike
--    owner_paused, only an admin sets it and only an admin lifts it (Relist).
--
--    GRANTS. Not granted to anon/authenticated: read and written only through
--    the service role (the admin route, the marketplace loaders, the enquiry
--    route). Recorded as REVOKED in the select-grant-decision guard.
--
-- 2. The public SELECT policy gains both take-downs. The trade directory is read
--    straight from the browser under this policy, and owner_paused/admin_hidden_at
--    are revoked from the browser roles, so the policy is the only place the
--    directory can be made to respect them — and a rule the database keeps cannot
--    be forgotten by the next public read. It mirrors
--    lib/serviceSubscription.ts visibleInDirectory exactly. The owner still reads
--    their own row through the owner policy; admin/service-role reads bypass RLS.
--
-- 3. admin_actions learns about providers: a nullable provider_id (SET NULL, the
--    same call as listing_id — what was done has to outlive the row) and two new
--    actions, provider_hidden and provider_relisted. The check is WIDENED, never
--    narrowed: the four listing actions stay exactly as they are.
--
-- Additive and safe to run twice. Nothing existing changes visibility: every row
-- has admin_hidden_at null, and owner_paused rows were already off every guest
-- read (isLiveToGuests).

alter table "public"."service_providers"
    add column if not exists "admin_hidden_at" timestamptz;

drop policy if exists "approved providers are public" on "public"."service_providers";
create policy "approved providers are public"
    on "public"."service_providers"
    for select
    using (
        "status" = 'approved'
        and coalesce("subscription_status", 'none') <> 'unpaid'
        and "owner_paused" = false
        and "admin_hidden_at" is null
    );

alter table "public"."admin_actions"
    add column if not exists "provider_id" uuid
        references "public"."service_providers"("id") on delete set null;

create index if not exists "admin_actions_provider_idx"
    on "public"."admin_actions" ("provider_id", "created_at" desc);

alter table "public"."admin_actions"
    drop constraint if exists "admin_actions_action_check";

alter table "public"."admin_actions"
    add constraint "admin_actions_action_check" check ("action" = any (array[
        'listing_hidden'::text,
        'listing_relisted'::text,
        'listing_edited'::text,
        'listing_photo_removed'::text,
        'provider_hidden'::text,
        'provider_relisted'::text
    ]));

notify pgrst, 'reload schema';

-- Read back:
--   select count(*) filter (where admin_hidden_at is not null) from service_providers;   -- 0
--   select pg_get_expr(polqual, polrelid) from pg_policy
--    where polname = 'approved providers are public';                                  -- has both
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'admin_actions_action_check';                                      -- six actions
--   select column_name from information_schema.column_privileges
--    where table_name = 'service_providers' and grantee in ('anon','authenticated')
--      and column_name = 'admin_hidden_at';                                             -- no rows
