-- The two checks that are missing from the admin_actions table as it was
-- actually created.
--
-- The table was built from a description of the plan rather than from
-- 20260821_admin_actions.sql, and came out right in every respect except
-- these: columns, types, nullability, both foreign keys, the ON DELETE SET
-- NULL on listing_id and the revoked grants all match. Only the two CHECK
-- constraints did not make it.
--
-- Confirmed by probing the live table: an action of 'not_a_real_action' and a
-- reason of '   ' were both accepted.
--
-- Nothing has gone wrong because of it — every write goes through
-- recordAdminAction(), which sets the action itself and rejects a reason
-- shorter than three characters. This is the belt to that pair of braces, and
-- it matters most for whatever writes to this table next, which may not be
-- that function.
--
-- Safe to run on a table that already has rows: both conditions hold for
-- everything the application writes.

alter table "public"."admin_actions"
    drop constraint if exists "admin_actions_action_check";

alter table "public"."admin_actions"
    add constraint "admin_actions_action_check" check ("action" = any (array[
        'listing_hidden'::text,
        'listing_relisted'::text,
        'listing_edited'::text,
        'listing_photo_removed'::text
    ]));

alter table "public"."admin_actions"
    drop constraint if exists "admin_actions_reason_not_blank";

alter table "public"."admin_actions"
    add constraint "admin_actions_reason_not_blank" check (btrim("reason") <> '');
