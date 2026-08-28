-- Whether the call-out fee is waived when the job goes ahead.
--
-- Common practice in the trades, and it is the tradesman's own offer rather
-- than anything we impose — so it is a thing they say about their own pricing,
-- not a platform rule with a column to enforce it.
--
-- It matters to a host at exactly the moment they are choosing who to ring:
-- "£40 call-out, waived if you go ahead" is a different proposition from "£40
-- call-out", and it is a real advantage to whoever offers it. Which is why the
-- fee and the waiver are read together — see calloutLine() in
-- lib/serviceProviders.ts, which is the only place either is worded.
--
-- Nothing is prefilled and no amount is suggested anywhere in the sign-up. If
-- every roofer showed the same figure it would read as a platform charge
-- rather than as their own price.
--
-- Pre-flight:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'service_providers'
--      and column_name = 'callout_waived';
--
-- Safe to run twice. Run on test first, then production.

alter table "public"."service_providers"
    add column if not exists "callout_waived" boolean not null default false;
