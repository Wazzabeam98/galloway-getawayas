-- Owner tools: Remove on /admin/listings deletes a never-booked listing for
-- good (app/api/admin/listings/remove). The trail records it as
-- 'listing_deleted', with listing_id null (the row is gone — the foreign key
-- is ON DELETE SET NULL anyway) and the id and title in detail.
--
-- Widens the check by one value; every existing row still satisfies it.

alter table "public"."admin_actions"
    drop constraint if exists "admin_actions_action_check";

alter table "public"."admin_actions"
    add constraint "admin_actions_action_check" check ("action" = any (array[
        'listing_hidden'::text,
        'listing_relisted'::text,
        'listing_edited'::text,
        'listing_photo_removed'::text,
        'listing_deleted'::text,
        'provider_hidden'::text,
        'provider_relisted'::text,
        'account_reactivated'::text
    ]));

-- Read back:
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'admin_actions_action_check';     -- eight actions, incl. listing_deleted
