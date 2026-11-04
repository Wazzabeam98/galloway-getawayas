-- A dedicated preference for the "finish your listing" draft reminder, so it is
-- not folded in with marketing (which is opt-in and off by default, which would
-- have left the reminder reaching almost no one).
--
-- It behaves exactly like booking_reminders and review_prompts: a transactional
-- nudge that is ON by default, with a one-click unsubscribe in every email and a
-- toggle in notification settings. Existing rows get true from the default, so a
-- host who started a listing is reminded unless they turn it off.
--
-- No grants needed: notification_preferences is granted to anon/authenticated at
-- the table level, so this column is covered like the others. RLS still limits
-- each person to their own row.

alter table "public"."notification_preferences"
    add column if not exists "listing_reminders" boolean not null default true;

comment on column "public"."notification_preferences"."listing_reminders" is
    'Whether the host wants the "finish your listing" reminder for a draft they '
    'started and left. On by default; the draft-reminders cron skips a host who '
    'turns it off. Toggled in notification settings or by the email unsubscribe link.';
