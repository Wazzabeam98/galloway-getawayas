-- Restore the full INSERT allow-list on service_providers after the table revoke.
--
-- WHY THIS EXISTS. 20260912203252 revoked the stray TABLE-LEVEL insert grant that
-- had drifted onto the test database. In Postgres, revoking a privilege at the
-- table level also clears the same privilege where it was held at column level —
-- so that revoke did not just close the sensitive columns (intended), it dropped
-- INSERT from EVERY owner column too, leaving authenticated able to insert only
-- the nine columns re-granted in that same migration. A new provider row written
-- from the browser (business_name, owner_id, description…) would then be refused.
--
-- This grants INSERT back on the full write allow-list — the 37 columns an owner
-- legitimately writes, and no sensitive one. It is the authoritative statement of
-- the INSERT allow-list: it does not matter which columns a prior migration or a
-- drifted database happened to hold, after this the set is exactly these. That is
-- also what makes the three-migration sequence safe on production, where the
-- table revoke will clear production's own column grants the same way: this
-- restores them.
--
-- UPDATE is untouched — it was never a table-level grant, so 20260912203252 did
-- not disturb it; it already stands at these same 37 columns (28 from earlier
-- migrations plus the nine in 20260912202042).
--
-- Read back:
--   select privilege_type, count(*) from information_schema.column_privileges
--    where table_name='service_providers' and grantee='authenticated'
--      and privilege_type in ('INSERT','UPDATE') group by 1;   -- expect 37 and 37
--
-- Safe to run twice.

grant insert (
    "audience", "based_line", "billable_hourly_rate", "business_name", "callout_fee",
    "callout_waived", "collection_postcode", "collection_street", "collection_town",
    "contact_email", "contact_phone", "covered_bands", "custom_label", "declarations",
    "description", "dietary_note", "does_gas", "does_oil", "exclusive_per_date",
    "experience_price", "fulfilment", "guest_details", "headshot", "hourly_rate",
    "lead_time_days", "logo", "owner_id", "photos", "pricing_choice", "provider_name",
    "shape", "slot_capacity", "slot_length_minutes", "slot_min_people", "sms_opt_out",
    "trade", "updated_at"
) on table "public"."service_providers" to "authenticated";

-- PostgREST caches the schema/grants; without this the change 403s until reload.
notify pgrst, 'reload schema';
