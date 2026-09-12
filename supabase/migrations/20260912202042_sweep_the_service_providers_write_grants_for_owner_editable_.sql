-- Sweep the WRITE grants on service_providers for the columns an owner edits.
--
-- WHAT WAS WRONG
--
-- 20260828202340_contact_details_are_not_public switched service_providers from
-- a table grant to a column allow-list (revoke the table, grant named columns).
-- That was right for privacy, but it means a column added later is writable by
-- nobody-with-the-site-key until it is named — and, as with SELECT, nothing made
-- adding a column force a WRITE decision. The SELECT gap was swept on 9 September
-- (20260909121121). The WRITE gap was never swept.
--
-- So a signed-in guest provider editing their own listing sent an UPDATE that
-- touched columns the `authenticated` role has no INSERT/UPDATE on — shape, the
-- slot fields, the lead time, the dietary note, the terms-acceptance jsonb — and
-- Postgres refused the whole statement with "permission denied for table
-- service_providers". The edit saved nothing: the provider write runs first, so
-- the failure aborted the save before any child row (areas, prices, items). Every
-- guest self-service edit was dead, not just coverage.
--
-- THE DECISION, PER COLUMN
--
-- These nine are what the sign-up/edit wizard writes to its own row and are the
-- owner's to set (RLS still limits WHICH row — owner_id = auth.uid()). None is
-- money, status, Stripe, or an audit field:
--
--   shape                the booking shape the owner picks
--   slot_length_minutes  }
--   slot_capacity        }  the slot's own configuration
--   slot_min_people      }
--   lead_time_days       made-to-order notice the owner sets
--   dietary_note         the free-text dietary caveats
--   declarations         the owner's own terms-acceptance stamp (jsonb)
--   custom_label         the category label the owner chooses at sign-up
--   exclusive_per_date   derived by the wizard from `shape` (comes-to-you books
--                        the whole day). Owner-controlled in practice; granted so
--                        the write the wizard already makes succeeds. It is the
--                        one borderline column — a later change could derive it in
--                        a trigger and revoke this, but nothing about it is
--                        sensitive: it only ever affects the owner's own listing.
--
-- Everything NOT listed stays revoked, on purpose: status/review lifecycle
-- (status, review_note, submitted_at, approved_at/digest, declined_at,
-- changes_pending_at — a provider who could write status could approve
-- themselves; the one legit status write goes through submit_service_provider),
-- money/subscription (commission_rate, settlement, plan, trial_ends_at,
-- subscription_status, billing_token_hash), every stripe_* column, the admin
-- audit fields (category_assigned_at/by), the service-role booking rule
-- (cancellation_window_hours), server bookkeeping (reminders_sent,
-- notify_user_ids), and id/created_at.
--
-- The companion guard tests/provider-writable-columns-guard.test.ts is the same
-- decision in writing, checked against the live grant, so the next column added
-- lands in neither list and fails by name rather than silently.
--
-- Pre-flight (privileges before): read-only, non-destructive; grants only.
--   select privilege_type, column_name from information_schema.column_privileges
--    where table_name='service_providers' and grantee='authenticated'
--      and privilege_type in ('INSERT','UPDATE') order by 1,2;
--
-- Safe to run twice. Test only for now.

grant insert, update (
    "shape",
    "slot_length_minutes",
    "slot_capacity",
    "slot_min_people",
    "lead_time_days",
    "dietary_note",
    "declarations",
    "custom_label",
    "exclusive_per_date"
) on table "public"."service_providers" to "authenticated";

-- PostgREST caches the schema/grants; without this the change 403s until reload.
notify pgrst, 'reload schema';

-- Read back (each of the nine now writable by authenticated):
--   select column_name from information_schema.column_privileges
--    where table_name='service_providers' and grantee='authenticated'
--      and privilege_type='UPDATE'
--      and column_name in ('shape','slot_length_minutes','slot_capacity',
--        'slot_min_people','lead_time_days','dietary_note','declarations',
--        'custom_label','exclusive_per_date');
--   Expected: all nine.
