-- When the last confirmation email was sent to a listing-notification
-- subscriber, so the route can refuse a resend that comes too soon.
--
-- WHY. #475's notification-emails route re-sent a fresh confirmation email on
-- every POST for an unconfirmed address, with nothing to stop it, so an
-- authenticated owner or full-access co-host could have the platform email a
-- third party without limit, from our sending reputation (audit 21 Oct,
-- finding 2). The route now throttles resends (lib/notificationEmails
-- confirmResendBlocked / CONFIRM_RESEND_THROTTLE_MS) and needs a per-row
-- timestamp to measure against — this column.
--
-- Nullable, no default: a null means "never sent", which the throttle treats as
-- "the first send is always allowed". The table is service-role only, so no
-- grant changes. Additive, loses nothing, safe to run twice. Production first,
-- then test.

alter table "public"."listing_notification_subscribers"
    add column if not exists "confirm_sent_at" timestamptz;

-- Read back:
--   select count(*) from information_schema.columns
--    where table_name = 'listing_notification_subscribers' and column_name = 'confirm_sent_at';
--   -- expect 1.
