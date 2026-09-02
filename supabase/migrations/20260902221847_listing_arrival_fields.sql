-- Arrival & access details for the "Getting there" screen — OFF-ROW, on purpose.
--
-- These are arrival SECRETS: the private approach a sat-nav can't see, the
-- what3words pin, the wifi. `listings` is read with select('*') in several
-- places including the PUBLIC listing page, so a column there would show the way
-- into an empty cottage to anyone browsing. So they live in their own table with
-- no browser grants — read by the arrival page and written by the host editor,
-- both through the service role after checking who's asking, exactly like
-- listing_access_codes (which already holds the door code as `code`, and stays
-- the door code's home; this table does not duplicate it).
--
-- An earlier version of this migration added these as columns on `listings`;
-- the drops below undo that where it already ran (test), and are a harmless
-- no-op on production, which never saw it.
--
-- Safe to run twice. Run on test first, then production.

alter table "public"."listings"
    drop column if exists "arrival_directions",
    drop column if exists "door_code",
    drop column if exists "parking_info",
    drop column if exists "wifi_name",
    drop column if exists "wifi_password",
    drop column if exists "what3words";

create table if not exists "public"."listing_arrival" (
    "listing_id" uuid primary key references "public"."listings"("id") on delete cascade,
    "arrival_directions" text,
    "parking_info" text,
    "wifi_name" text,
    "wifi_password" text,
    "what3words" text,
    "updated_at" timestamptz not null default now()
);

-- No browser access at all. RLS on with zero policies is deny-all; the grants are
-- revoked too, so neither anon nor a signed-in stranger can read a cottage's way
-- in. The service role bypasses both, and the app checks the guest is on the
-- booking before it reads.
alter table "public"."listing_arrival" enable row level security;
revoke all on table "public"."listing_arrival" from "anon", "authenticated";

comment on table "public"."listing_arrival" is
    'Arrival secrets (approach directions, parking, wifi, what3words) for a '
    'listing. Off-row and grant-less so select(*) on the public page can''t leak '
    'them; served only to a confirmed guest. The door code stays in '
    'listing_access_codes.';
