-- Letting a tradesman turn texts off without turning himself off.
--
-- WHY THIS COLUMN EXISTS AT ALL
--
-- Emergency enquiries are texted as well as emailed, because an emergency is
-- now a shorter clock and a louder email and nothing else — there is no
-- automatic release behind it, so how fast he SEES the enquiry is the whole
-- product. A roofer checks his phone, not his inbox.
--
-- The consent question is easy: the number was given for a business listing
-- and the text is about an enquiry for that business, which is a service
-- message rather than marketing. What is not automatic is giving him a way
-- out. Without one, a tradesman who does not want texts does the only thing
-- he can and REMOVES HIS NUMBER FROM HIS LISTING — and then the emergency
-- route cannot reach him at all, and an owner with a flood loses the one
-- person who turns out. An opt-out that keeps the email costs a column and
-- protects the channel.
--
-- It is opt-OUT rather than opt-in on purpose, and that is a decision rather
-- than a default: opting in would leave the fastest channel switched off for
-- everybody who never read that step, on the trades where minutes matter.
--
-- The sign-up says so beside the phone field. A text that arrives unannounced
-- is the thing this pair of changes exists to avoid.
--
-- Pre-flight:
--   select column_name from information_schema.columns
--    where table_name = 'service_providers' and column_name = 'sms_opt_out';
--
-- Safe to run twice. Run on test first, then production.

alter table "public"."service_providers"
    add column if not exists "sms_opt_out" boolean not null default false;

-- His own, like the rest of his listing. 20260827185827_provider_status_grants
-- revoked everything on this table and grants columns back one at a time, so a
-- column nobody grants is a column the sign-up cannot save.
grant insert ("sms_opt_out") on table "public"."service_providers" to "authenticated";
grant update ("sms_opt_out") on table "public"."service_providers" to "authenticated";

-- Read back:
--   select count(*) as providers, count(*) filter (where sms_opt_out) as opted_out
--     from public.service_providers;
