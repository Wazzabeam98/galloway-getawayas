-- A provider must not be able to approve themselves.
--
-- THE HOLE. `owners manage their own provider` is a row policy:
--
--     using ("owner_id" = auth.uid()) with check ("owner_id" = auth.uid())
--
-- Row-level security is per ROW, not per COLUMN. It says which rows are yours;
-- it says nothing about which columns of them you may write. So an owner could
-- PATCH their own row's `status` straight to 'approved' and appear in the
-- public directory without anyone looking at them. Observed, not theorised:
-- scripts/journeys.mjs does exactly that with a real user's access token and it
-- succeeds today.
--
-- THE FIX, the same way the money columns and the registration columns are
-- done: the columns a provider must never write are simply not grantable to
-- `authenticated`. A payload that never mentions a column needs no permission
-- on it, so ordinary saves are unaffected; a payload that does mention one is
-- refused by the database rather than by a policy that has to be got right.
--
-- WHY A GRANT IS NOT ENOUGH ON ITS OWN, and what to do about it.
--
-- The registration table could revoke its verified columns outright because
-- the browser never writes them. `status` is different: the browser legitimately
-- sets it to 'pending_review' when somebody submits. Grants are value-blind —
-- they cannot say "this column, but only to that value" — so revoking `status`
-- alone would close the hole by breaking submission.
--
-- So the single write that is legitimate moves behind a function narrow enough
-- to be read in one sitting: `submit_service_provider` below. That is one field
-- moved, not the save moved server-side; the rest of the form still writes its
-- own columns straight from the browser exactly as before.
--
-- ORDER. This must run AFTER 20260827171104_cleaning_hourly_option.sql and
-- 20260827154137_gardening_and_windows_subscription.sql, because it grants the
-- columns those add. Run on test first, then production.
--
-- Safe to run twice.

-- ---------------------------------------------------------------- grants

revoke all on table "public"."service_providers" from "anon", "authenticated";

-- Reading is unchanged. The public directory and the sign-up form both need it,
-- and which rows are visible is still the row policy's business.
grant select on table "public"."service_providers" to "anon", "authenticated";

-- What the sign-up form owns. `owner_id` is grantable because the row policy
-- pins it to auth.uid() on both sides, so it cannot be used to hand a listing
-- to somebody else.
grant insert (
    "owner_id", "business_name", "trade", "description",
    "contact_email", "contact_phone", "audience",
    "photos", "logo", "does_gas", "does_oil",
    "callout_fee", "hourly_rate", "callout_waived",
    "pricing_choice", "billable_hourly_rate", "covered_bands",
    "updated_at"
) on table "public"."service_providers" to "authenticated";

grant update (
    "owner_id", "business_name", "trade", "description",
    "contact_email", "contact_phone", "audience",
    "photos", "logo", "does_gas", "does_oil",
    "callout_fee", "hourly_rate", "callout_waived",
    "pricing_choice", "billable_hourly_rate", "covered_bands",
    "updated_at"
) on table "public"."service_providers" to "authenticated";

-- Deleting stays theirs. The row policy holds it to their own listings and the
-- form only offers it on a draft.
grant delete on table "public"."service_providers" to "authenticated";

grant all on table "public"."service_providers" to "service_role";

-- Deliberately NOT granted to `authenticated`, and why:
--
--   status              the whole point. Only via submit_service_provider
--                       below, or the admin decision route.
--   submitted_at        when the queue received it. Theirs to trigger, not to
--                       write, or a stale row could jump the queue.
--   review_note         the admin's note back to them.
--   approved_at,        the decision itself.
--   declined_at
--   approved_digest,    the changes gate. The whole reason the digest is
--   changes_pending_at  trustworthy is that a provider cannot touch it.
--   commission_rate,    money and plan.
--   plan, settlement,
--   trial_ends_at
--   kind                set by trade, not by the applicant.
--   notify_user_ids     who gets told about this listing.
--   id, created_at      defaults.

-- ------------------------------------------------------------- submitting

-- The one legitimate status write, and nothing else.
--
-- security definer so it can write a column the caller cannot, and it earns
-- that by checking two things the caller cannot lie about: auth.uid() owns the
-- row, and the row is not already approved.
--
-- The approved case returns quietly rather than raising, and that mirrors
-- submitStatusPatch() in lib/serviceProviders.ts: an approved provider editing
-- their listing stays live, and the queue works out from the digest whether the
-- edit wants looking at. Raising here would turn an ordinary edit into an error.
create or replace function "public"."submit_service_provider"("p_id" uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_owner  uuid;
    v_status text;
begin
    select "owner_id", "status" into v_owner, v_status
      from "public"."service_providers"
     where "id" = p_id;

    if v_owner is null then
        raise exception 'no such listing';
    end if;

    if v_owner is distinct from auth.uid() then
        raise exception 'that listing is not yours';
    end if;

    if v_status = 'approved' then
        return;
    end if;

    update "public"."service_providers"
       set "status"      = 'pending_review',
           "submitted_at" = now(),
           "review_note"  = null
     where "id" = p_id;
end;
$$;

-- security definer functions are executable by everyone unless said otherwise,
-- and this one must never run unauthenticated: auth.uid() is null then, and the
-- ownership check would be comparing null to null.
revoke all on function "public"."submit_service_provider"(uuid) from "public", "anon";
grant execute on function "public"."submit_service_provider"(uuid) to "authenticated";
