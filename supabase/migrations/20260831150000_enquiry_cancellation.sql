-- Calling off an accepted job — by the tradesman, or by the host.
--
-- 'accepted' was as far as the status machine went in the friendly direction,
-- and that was a gap: an accepted job is a promise a person can still break. A
-- tradesman goes off sick two days before a changeover; a host's guests cancel
-- and the work is no longer needed. So there is now 'cancelled'.
--
-- IT IS TERMINAL. A cancelled enquiry is finished. Re-asking the same tradesman
-- is a fresh row with its own token, never a revival of this one — the accept
-- that would have released a phone number has to happen again, on the new ask.
-- Because 'cancelled' is not one of the open statuses, it drops out of the
-- one-open-enquiry index, the expiry sweep, and — the point of the whole thing
-- — the calendar's clash markers and the booking-overlap email, both of which
-- already read only 'accepted'. A withdrawn promise stops warning about a
-- conflict that no longer exists, with no change to either of those readers.
--
-- WHY A REASON, AND WHO
--
-- "Can't make it" and "I'm off sick" are different, and the host decides
-- differently between them — chase, or write it off and find someone else. So
-- a cancel carries a reason, and it travels: into the email and onto every
-- screen the cancelled enquiry appears on. `cancelled_by` records which side
-- called it off, so the alert can be worded from the right end — a tradesman
-- cancelling leaves the host uncovered and is urgent; a host cancelling only
-- frees the tradesman's day.
--
-- Written under the service role, like every other status move: `status` is
-- not grantable to a browser (a host who could set 'accepted' would hand
-- themselves a phone number), so these columns need no new grant.
--
-- Safe to run twice. Run on test first, then production.

alter table "public"."service_enquiries"
    drop constraint if exists "service_enquiries_status_check";
alter table "public"."service_enquiries"
    add constraint "service_enquiries_status_check"
    check ("status" in (
        'sent', 'viewed', 'accepted', 'declined', 'expired', 'withdrawn', 'direct', 'cancelled'
    ));

alter table "public"."service_enquiries"
    add column if not exists "cancelled_by"  text;
alter table "public"."service_enquiries"
    add column if not exists "cancel_reason" text;
alter table "public"."service_enquiries"
    add column if not exists "cancelled_at"  timestamptz;

alter table "public"."service_enquiries"
    drop constraint if exists "service_enquiries_cancelled_by_check";
alter table "public"."service_enquiries"
    add constraint "service_enquiries_cancelled_by_check"
    check ("cancelled_by" is null or "cancelled_by" in ('host', 'provider'));
