-- A host asks ONE tradesman to look at something.
--
-- Phase two. There is no money in this file and there is no money in the flow
-- it describes: every trade that reaches it is on the subscription, the
-- platform takes nothing per job, and the work is paid off-platform. No
-- commission is snapshotted, no total is computed, and nothing here is ever
-- read by the payout engine. If that stops being true, this table is the wrong
-- table — see "why there is no completed status" below.
--
-- WHY NOT service_requests
--
-- `service_requests` is the old manual flow, three rows of it on production,
-- pointing at the old flat `services` catalogue rather than at a provider.
-- Nothing here reuses it. The page it drove is being retired and its URL taken;
-- the table and its rows are left exactly where they are, untouched, because
-- deleting somebody's live data to free up a name is not a migration.
--
-- ONE TRADESMAN, ON PURPOSE
--
-- This is a directory and an introduction, not a dispatcher. A host browses
-- profiles, reads the prices where a provider has published them, and asks one
-- person. Nothing fans out to three and nothing scores anybody, so the failure
-- mode is silence rather than a bidding war — which is why `expires_at` and
-- the `viewed` status both exist. See the status list.
--
-- WHICH TRADES REACH IT
--
-- Seven, at the time of writing: the six maintenance trades plus window
-- cleaning. Not gardening — its prices are banded on `listings.plot_band` and
-- nothing writes that column yet, so a gardener would show a host no price at
-- all. It joins the day the listing form asks. Not cleaning and not waste:
-- they take 10% at acceptance, which needs a total, which needs a completion
-- step. That is a booking and it is a different table.
--
-- The rule itself lives in lib/serviceProviders.ts SHOP_TRADES, beside the
-- trade vocabulary and the plan rules it depends on, and is read through
-- canBeEnquiredAbout. It is deliberately NOT a check constraint here: the day
-- gardening joins should be a line in a list, not a migration on a table with
-- live rows in it.
--
-- Pre-flight:
--   select table_name from information_schema.tables
--    where table_schema = 'public' and table_name like 'service_enquir%';
--
-- Safe to run twice. Run on test first, then production.

create table if not exists "public"."service_enquiries" (
    "id"            uuid primary key default gen_random_uuid(),

    -- Quotable on the phone. A tradesman ringing about "GG-7K2M" is a
    -- conversation that can start; one ringing about a uuid is not.
    "reference"     text not null unique,

    "host_id"       uuid not null references "auth"."users"("id") on delete cascade,
    "listing_id"    uuid references "public"."listings"("id") on delete set null,

    -- RESTRICT, not cascade. A tradesman who deletes their listing must not
    -- silently erase the record of what the platform sent them — that record
    -- is the only evidence a subscription bought anything.
    "provider_id"   uuid not null references "public"."service_providers"("id") on delete restrict,

    -- SNAPSHOTS
    --
    -- A profile is editable and so is a price. What the host was looking at
    -- when they pressed the button is not, and a join would quietly rewrite it.
    -- Same reasoning as bookings.commission_rate, minus the commission.
    "trade"          text not null,
    "business_name"  text not null,
    "price_snapshot" jsonb not null default '{}',
    "area_key"       text not null default '',

    -- WHAT THE HOST SAID
    --
    -- fault_keys are extra_key values from the trade's `faults` group in
    -- lib/serviceProviders.ts SERVICE_EXTRAS — the same vocabulary the
    -- tradesman ticked when he signed up, so both ends mean the same thing by
    -- "something keeps tripping". Free text as well, never instead.
    "fault_keys"   text[] not null default '{}',
    "summary"      text not null,
    "urgency"      text not null default 'soon',
    "access_note"  text not null default '',
    "when_note"    text not null default '',

    -- HOW TO REACH THE HOST
    --
    -- Held here rather than joined out of auth.users because it is what the
    -- host chose to hand over for this job, which is not necessarily their
    -- account address, and must not change under them afterwards. Released to
    -- the provider on acceptance and not before — see the contact-details
    -- decision of 26 Aug 2026 in lib/contactDetails.ts.
    "host_name"    text not null default '',
    "host_phone"   text not null default '',
    "host_email"   text not null default '',

    "status"         text not null default 'sent',
    "provider_reply" text,
    "decline_reason" text,

    -- THE REPLY LINK
    --
    -- A tradesman on a roof does not sign in to answer an email, and there is
    -- no provider dashboard for him to sign in to. So the email carries a
    -- token. Only its sha256 is stored: a leaked database row must not be a
    -- working reply link, and nothing ever needs to read the token back.
    "reply_token_hash" text,
    "token_used_at"    timestamptz,

    "sent_at"      timestamptz not null default now(),
    "viewed_at"    timestamptz,
    "responded_at" timestamptz,
    "expires_at"   timestamptz,
    "withdrawn_at" timestamptz,

    -- WRITTEN LATER, GATING NOTHING
    --
    -- Nothing on the platform can observe a job being done: the introduction is
    -- the product, the work is paid off-platform, and nobody messages through
    -- the site afterwards. So this is self-reported by whoever answers the
    -- follow-up, and it is never presented as a fact the platform verified.
    -- It is honest as an attribution figure precisely because nothing is billed
    -- on it. The day something is, it stops being good enough.
    "outcome"      text,
    "outcome_at"   timestamptz,
    "outcome_by"   uuid references "auth"."users"("id"),

    "created_at"   timestamptz not null default now(),
    "updated_at"   timestamptz not null default now(),

    -- WHY THERE IS NO 'completed'
    --
    -- Because nothing could set it truthfully. A completed status would be one
    -- side's assertion wearing the platform's badge. `outcome` says the same
    -- thing without the badge.
    --
    -- 'direct' is the emergency route: the host was shown the number and rang
    -- it, so the introduction had already happened before the row existed.
    -- There was no answer to wait for, which is why it is a status of its own
    -- and not an 'accepted' nobody accepted.
    constraint "service_enquiries_status_check"
        check ("status" in (
            'sent', 'viewed', 'accepted', 'declined', 'expired', 'withdrawn', 'direct'
        )),

    constraint "service_enquiries_urgency_check"
        check ("urgency" in ('emergency', 'soon', 'planned')),

    constraint "service_enquiries_outcome_check"
        check ("outcome" is null or "outcome" in ('went_ahead', 'did_not', 'no_contact')),

    -- An enquiry with nothing in it is a wasted call-out for somebody.
    constraint "service_enquiries_summary_check"
        check (btrim("summary") <> ''),

    -- An emergency is released immediately and never expires; everything else
    -- has a deadline from the moment it is sent. Both halves stated, so a row
    -- cannot be written that waits for ever.
    constraint "service_enquiries_expiry_check"
        check (
            ("urgency" = 'emergency' and "expires_at" is null)
            or ("urgency" <> 'emergency' and "expires_at" is not null)
        )
);

-- ONE LIVE ENQUIRY PER HOST, PER PROVIDER, PER TRADE
--
-- Without this, a host who gets no answer sends the same thing four times and
-- the tradesman's opinion of the platform is formed by the duplicates. A
-- closed one — declined, expired, withdrawn — never blocks a new one, because
-- asking again next month is an ordinary thing to do.
create unique index if not exists "service_enquiries_one_open_idx"
    on "public"."service_enquiries" ("host_id", "provider_id", "trade")
    where "status" in ('sent', 'viewed');

create index if not exists "service_enquiries_host_idx"
    on "public"."service_enquiries" ("host_id", "sent_at" desc);

create index if not exists "service_enquiries_provider_idx"
    on "public"."service_enquiries" ("provider_id", "sent_at" desc);

-- What the expiry sweep reads, and nothing else.
create index if not exists "service_enquiries_waiting_idx"
    on "public"."service_enquiries" ("expires_at")
    where "status" in ('sent', 'viewed');

-- The reply route looks a token up by its hash. Unique so a collision is a
-- write that fails rather than a link that answers somebody else's enquiry.
create unique index if not exists "service_enquiries_token_idx"
    on "public"."service_enquiries" ("reply_token_hash")
    where "reply_token_hash" is not null;

alter table "public"."service_enquiries" enable row level security;

-- COLUMN GRANTS, THE SAME TRICK AS service_provider_registrations
--
-- Row-level security is per row, not per column. The policies below give a
-- host access to their own enquiries and a provider access to the ones
-- addressed to them — and without these grants that would include `status`,
-- `reply_token_hash` and `outcome` for both of them. A host could mark their
-- own enquiry accepted; a provider could rewrite the summary he was sent.
--
-- So the browser may INSERT only the fields that describe the job, and may
-- UPDATE almost nothing. Every state change goes through a route under the
-- service role, which is not subject to any of this.
revoke all on table "public"."service_enquiries" from "anon", "authenticated";

grant select on table "public"."service_enquiries" to "authenticated";

-- A host writes the enquiry itself. Note what is absent: status, expires_at,
-- reference, both token columns, everything with a timestamp. The route sets
-- those, because a host who could set their own `expires_at` could set it to
-- next year.
grant insert (
    "host_id", "listing_id", "provider_id",
    "trade", "business_name", "price_snapshot", "area_key",
    "fault_keys", "summary", "urgency", "access_note", "when_note",
    "host_name", "host_phone", "host_email"
) on table "public"."service_enquiries" to "authenticated";

-- The only thing either side may write directly. `outcome` is self-reported by
-- design and gates nothing, so it is safe in the browser; withdrawing and
-- replying are not, and go through routes.
grant update ("outcome", "outcome_at", "outcome_by", "updated_at")
    on table "public"."service_enquiries" to "authenticated";

grant all on table "public"."service_enquiries" to "service_role";

-- A host sees their own, whatever state it is in.
drop policy if exists "hosts read their own enquiries" on "public"."service_enquiries";
create policy "hosts read their own enquiries"
    on "public"."service_enquiries"
    for select
    using ("host_id" = auth.uid());

-- And writes their own, to a provider that is actually live. The status check
-- is here as well as in the route on purpose: the route is the place this is
-- meant to be caught, and this is the place it cannot be got round.
drop policy if exists "hosts write their own enquiries" on "public"."service_enquiries";
create policy "hosts write their own enquiries"
    on "public"."service_enquiries"
    for insert
    with check (
        "host_id" = auth.uid()
        and exists (
            select 1 from "public"."service_providers" p
             where p."id" = "service_enquiries"."provider_id"
               and p."status" = 'approved'
        )
    );

-- A provider sees what was sent to him. There is no provider-facing page yet —
-- the email and its token are the whole mechanism today — but the policy is
-- written now so the page, when it exists, needs no migration of its own.
drop policy if exists "providers read enquiries sent to them" on "public"."service_enquiries";
create policy "providers read enquiries sent to them"
    on "public"."service_enquiries"
    for select
    using (exists (
        select 1 from "public"."service_providers" p
         where p."id" = "service_enquiries"."provider_id"
           and p."owner_id" = auth.uid()
    ));

-- Either side may record how it went, on a row they can already see. Which
-- side said so is `outcome_by`, and it is not to be believed about the other.
drop policy if exists "either side records an outcome" on "public"."service_enquiries";
create policy "either side records an outcome"
    on "public"."service_enquiries"
    for update
    using (
        "host_id" = auth.uid()
        or exists (
            select 1 from "public"."service_providers" p
             where p."id" = "service_enquiries"."provider_id"
               and p."owner_id" = auth.uid()
        )
    )
    with check (
        "host_id" = auth.uid()
        or exists (
            select 1 from "public"."service_providers" p
             where p."id" = "service_enquiries"."provider_id"
               and p."owner_id" = auth.uid()
        )
    );

-- Read back:
--   select status, urgency, count(*) from public.service_enquiries
--    group by status, urgency order by status;
--
-- Expected on a fresh database: no rows.
