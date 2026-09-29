-- The subscription "shop window" as a DATABASE rule, not a client-side filter.
--
-- WHY (from B's audit, finding 1)
--
-- The only row-level gate on public provider visibility was status = 'approved'.
-- Whether a trade's subscription is unpaid (or their trial expired and the cron
-- delisted them) was enforced only by app query code adding
-- `.neq('subscription_status','unpaid')` — a filter the anon client CHOOSES to
-- send, not a rule the database keeps. A raw anon call that omits the filter got
-- back unpaid, delisted trades' public listing columns. Contact details were
-- always safe (revoked from anon/authenticated) and new enquiries were already
-- blocked server-side, so the exposure was bounded — but the whole subscription
-- model rests on delisting working, and any new public read that forgot the
-- filter would silently re-list non-payers.
--
-- THE FIX
--
-- Fold the rule into the public SELECT policy so it can't be forgotten. Approval
-- stays a SEPARATE gate (a pre-approval trade is still private); this ADDS the
-- subscription condition. It mirrors lib/serviceSubscription.ts visibleInDirectory
-- exactly: visible when approved AND subscription_status is not 'unpaid'
-- (null/'none'/'trialing'/'active' all remain visible; a guest experience, which
-- never carries a subscription, has null here and is unaffected — its own money
-- gate lives in the loader). The owner still reads their own row through the
-- separate owner policy, and admin/service-role reads bypass RLS.
--
-- Safe to run twice.

drop policy if exists "approved providers are public" on "public"."service_providers";
create policy "approved providers are public"
    on "public"."service_providers"
    for select
    using (
        "status" = 'approved'
        and coalesce("subscription_status", 'none') <> 'unpaid'
    );
