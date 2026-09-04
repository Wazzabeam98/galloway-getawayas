-- Companion invites become single-use share links.
--
-- The link, not the email address, now carries the invite. So the email
-- becomes optional: a booker can add a nameless "+1" and share the link on any
-- channel, and whoever opens an unclaimed link claims that one seat. When an
-- email IS given the accept route still binds the link to it (belt and braces),
-- but the column no longer has to be filled.
ALTER TABLE "public"."booking_guests" ALTER COLUMN "email" DROP NOT NULL;

-- "Waiting to send" vs "Invited" — we stamp when the booker actually shares a
-- link (copy / email / Messages / WhatsApp / Messenger), so the group sheet can
-- tell a seat whose link has gone out from one that's still sitting unsent.
-- Nothing reads a secret from this; it is a UI state only.
ALTER TABLE "public"."booking_guests" ADD COLUMN IF NOT EXISTS "link_sent_at" timestamp with time zone;

-- Single use, expiry (at check-out) and revoke/regenerate are all enforced in
-- the accept + booking-guests routes against existing columns (status,
-- invite_token, user_id, accepted_at) and the booking's check_out date, so no
-- further schema is needed. The unique-person index already excludes NULL
-- emails, so multiple emailless seats on one booking are allowed.
--
-- No view and no column-level revoke here, so the two grant/PostgREST gotchas
-- (a column revoke is a no-op under a table grant; a new view 404s until a
-- reload) don't apply. The reload below is belt-and-braces so the nullable
-- change and the new column show on the REST surface the moment this lands on
-- production, rather than waiting on the DDL watcher.
notify pgrst, 'reload schema';
