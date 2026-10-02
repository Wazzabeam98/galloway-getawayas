-- Trade pricing, simplified to one shape for every trade; a free-text
-- registration number for gas and electrical trades; a per-extra quote option.
--
-- WHY
--
-- The old trade pricing branched per trade — bedroom or plot-size bands for
-- cleaning, gardening and window cleaning; a call-out plus hourly for the
-- maintenance trades; "quoted" for roofers/joiners/painters. Every trade now
-- shares ONE model: an "I provide a quote" tick, plus an optional hourly rate, a
-- flat fee and a call-out fee. A row is valid when the applicant ticks quote, or
-- gives an hourly rate, or gives a flat fee.
--
-- THE COLUMNS
--
--   provides_quote  the quote tick — priced after a look, no number up front.
--   flat_fee        one fixed price for the job. Optional. (> 0 when set.)
--
-- callout_fee, callout_waived and hourly_rate already exist and are reused as
-- they are. The bands columns (pricing_choice, billable_hourly_rate,
-- covered_bands) and the service_provider_prices table are left in place but no
-- longer written — the sign-up stops setting them, so old rows are untouched and
-- the constraints they carry are never hit by a new one.
--
-- registration_number replaces the pre-filled competency-scheme checklist for
-- gas and electrical trades with a single free-text number the applicant types.
-- The per-scheme service_provider_registrations table stays for any existing
-- rows; the sign-up simply writes the plain number here now.
--
-- service_provider_extras.quote is the per-extra twin of provides_quote — a
-- window-cleaning add-on the trade prices by quote rather than a fixed figure.
-- (service_provider_extras carries a table grant, so the column needs no grant.)
--
-- Safe to run twice.

alter table "public"."service_providers"
    add column if not exists "provides_quote" boolean not null default false,
    add column if not exists "flat_fee" numeric,
    add column if not exists "registration_number" text;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'service_providers_flat_fee_check'
    ) then
        alter table "public"."service_providers"
            add constraint "service_providers_flat_fee_check"
            check ("flat_fee" is null or "flat_fee" > 0);
    end if;
end $$;

alter table "public"."service_provider_extras"
    add column if not exists "quote" boolean not null default false;

-- service_providers is a column-grant table (the table SELECT/INSERT/UPDATE were
-- revoked in 20260828202340), so each new column needs its own grant or the
-- browser 403s. A signed-in provider writes all three to their own row (RLS
-- limits which row); they read them back on reopen, and quote/flat/registration
-- feed the host-facing price and the go-live check.
grant insert ("provides_quote", "flat_fee", "registration_number")
    on table "public"."service_providers" to "authenticated";
grant update ("provides_quote", "flat_fee", "registration_number")
    on table "public"."service_providers" to "authenticated";
grant select ("provides_quote", "flat_fee", "registration_number")
    on table "public"."service_providers" to "authenticated";

-- PostgREST caches the schema/grants; without this the change 403s until reload.
notify pgrst, 'reload schema';
