-- Let the needs-reply nudge remember it has chased a NON-booking thread.
--
-- sent_reply_nudges dedupes on (user_id, booking_id) so a person is chased about
-- a waiting thread at most once every quiet window. With the unified inbox the
-- nudge now also chases job (enquiry) and order threads — which have no
-- booking_id — and a null booking_id makes the (user_id, booking_id) unique
-- treat every chase as new, so nothing dedupes and it would nudge every run.
--
-- thread_key is the generic identity ("enquiry:<id>" / "order:<id>") for those,
-- with its own unique so the same per-user-per-thread dedupe holds. Booking
-- nudges are unchanged — they keep using booking_id.
--
-- Safe to run twice. Run on test first, then production.

alter table "public"."sent_reply_nudges"
    add column if not exists "thread_key" text;

create unique index if not exists "sent_reply_nudges_user_thread_key"
    on "public"."sent_reply_nudges" ("user_id", "thread_key")
    where "thread_key" is not null;

comment on column "public"."sent_reply_nudges"."thread_key" is
    'Generic thread identity for non-booking nudges ("enquiry:<id>" / "order:<id>"). '
    'Booking nudges keep using booking_id; this dedupes the other two kinds.';
