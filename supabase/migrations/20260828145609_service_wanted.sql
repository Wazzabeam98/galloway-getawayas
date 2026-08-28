-- What a host looked for and we could not offer.
--
-- WHY A TABLE RATHER THAN AN EMAIL
--
-- The shop goes live with an empty directory: tradesmen are being signed up by
-- hand, so on day one a host searching for a roofer in Wigtown finds nobody.
-- The old empty state said "Nobody covers Wigtown yet", which reads like a
-- broken site rather than a young one, and gave them nothing to do.
--
-- What they can do instead is tell us, and that answer is the single most
-- useful thing this feature produces: "three hosts wanted a roofer in Wigtown"
-- is a recruiting list. An email alone would make that a counting exercise in
-- an inbox, so it is a row, and the admins are emailed as well because
-- somebody has to act on it.
--
-- NOTHING HERE PROMISES ANYBODY ANYTHING. It is not a queue, it is not matched
-- to an enquiry, and no tradesman ever sees it. If it starts being answered
-- automatically it needs a different shape and its own thinking.
--
-- WHY host_id IS NULLABLE
--
-- A signed-out visitor looking round the shop is exactly the person whose
-- interest is worth knowing about, and making them sign in first to say "I
-- need a roofer" loses the signal to collect the identity. The trade and the
-- area are the parts that matter.
--
-- Pre-flight:
--   select table_name from information_schema.tables
--    where table_schema = 'public' and table_name = 'service_wanted';
--
-- Safe to run twice. Run on test first, then production.

create table if not exists "public"."service_wanted" (
    "id"         uuid primary key default gen_random_uuid(),

    -- Null for somebody who is not signed in. See above.
    "host_id"    uuid references "auth"."users"("id") on delete set null,
    "listing_id" uuid references "public"."listings"("id") on delete set null,

    "trade"      text not null,
    "area_key"   text not null default '',
    "note"       text not null default '',

    -- So a reply is possible when they left one and were not signed in.
    "contact"    text not null default '',

    "created_at" timestamptz not null default now(),

    constraint "service_wanted_trade_check" check (btrim("trade") <> '')
);

create index if not exists "service_wanted_trade_area_idx"
    on "public"."service_wanted" ("trade", "area_key");

alter table "public"."service_wanted" enable row level security;

-- WRITE-ONLY FROM THE BROWSER, DELIBERATELY.
--
-- Anyone may add one, including anon: that is the whole point of collecting it
-- from a signed-out visitor. Nobody may read the table back, not even the host
-- who wrote a row — there is nothing in it for them, and a readable table of
-- "who wants what where" is a list of every gap in our coverage handed to
-- anyone with the public key.
--
-- The admin screens read it with the service role, which is not subject to any
-- of this.
revoke all on table "public"."service_wanted" from "anon", "authenticated";

grant insert ("host_id", "listing_id", "trade", "area_key", "note", "contact")
    on table "public"."service_wanted" to "anon", "authenticated";

grant all on table "public"."service_wanted" to "service_role";

drop policy if exists "anyone may say what they wanted" on "public"."service_wanted";
create policy "anyone may say what they wanted"
    on "public"."service_wanted"
    for insert
    with check (
        -- Signed in: it has to be you. Signed out: no claim to make.
        "host_id" is null or "host_id" = auth.uid()
    );

-- Read back:
--   select trade, area_key, count(*) from public.service_wanted
--    group by trade, area_key order by count(*) desc;
--
-- That query is the recruiting list.
