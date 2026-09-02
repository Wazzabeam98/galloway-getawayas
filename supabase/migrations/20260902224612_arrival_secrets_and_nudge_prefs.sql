-- Arrival: wall the secret columns with a grant, and remember a dismissed nudge.
--
-- PART 1 — the wall is a grant, not a policy.
--
-- listing_arrival and listing_access_codes are already revoked from anon and
-- authenticated at the TABLE level (the money-table house rule), so a browser
-- has no access to them today. These COLUMN revokes are belt-and-braces on the
-- three secrets — the approach directions, the wifi password, the door code —
-- so that if anyone ever grants either table, the secrets stay walled by their
-- own revoke rather than by a policy that could be dropped. Revoking a column a
-- role was never granted is a no-op; it is here to state the intent and to hold
-- if the table grant ever changes.

revoke select, insert, update (arrival_directions, wifi_password)
    on table "public"."listing_arrival" from "anon", "authenticated";
revoke select, insert, update (code)
    on table "public"."listing_access_codes" from "anon", "authenticated";

-- PART 2 — a dismissed arrival nudge, per host and listing.
--
-- Shaped like conversation_prefs: a nullable timestamp the host owns, one row per
-- host + listing. "Dismissed" is DERIVED, never stored as a boolean — a dismissal
-- holds only until a newer booking arrives for that listing, exactly as an
-- archived conversation returns when a newer message lands. The app compares
-- dismissed_at against the booking; this just stores the stamp.

create table if not exists "public"."arrival_nudge_prefs" (
    "user_id" uuid not null references "public"."profiles"("id") on delete cascade,
    "listing_id" uuid not null references "public"."listings"("id") on delete cascade,
    "dismissed_at" timestamptz,
    primary key ("user_id", "listing_id")
);

alter table "public"."arrival_nudge_prefs" enable row level security;
grant select, insert, update on table "public"."arrival_nudge_prefs" to "authenticated";

drop policy if exists "own arrival nudge prefs" on "public"."arrival_nudge_prefs";
create policy "own arrival nudge prefs" on "public"."arrival_nudge_prefs"
    for all to "authenticated"
    using ("user_id" = "auth"."uid"())
    with check ("user_id" = "auth"."uid"());

comment on table "public"."arrival_nudge_prefs" is
    'Per host + listing dismissal of the "add your arrival details" nudge. '
    'dismissed_at is a stamp; "dismissed" is derived by comparing it to the '
    'listing''s soonest upcoming booking, so a new booking brings the nudge back.';
