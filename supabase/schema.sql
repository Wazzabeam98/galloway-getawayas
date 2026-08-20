-- Galloway Getaways — the database structure.
--
-- Taken from the live project with `supabase db dump --linked`. Until this
-- file existed the structure of the database had no backup and no history:
-- the only copy was the running project itself.
--
-- Regenerate after any schema change, so this file stays the truth:
--
--   supabase link --project-ref <ref>
--   supabase db dump --linked -f supabase/schema.sql
--   -- then re-append the auth.users triggers at the foot of this file,
--   -- which a public-schema dump does not include.
--
-- To build a project from it:
--
--   psql "$DATABASE_URL" -f supabase/schema.sql
--
-- Structure only — no rows, no auth users, no secrets.




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."add_notification_preferences"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;


ALTER FUNCTION "public"."add_notification_preferences"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_profile_for_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.profiles (id, email, full_name, is_host)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;


ALTER FUNCTION "public"."add_profile_for_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_review_window"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  co date;
begin
  select check_out into co from public.bookings where id = new.booking_id;

  if co is null then
    raise exception 'That booking does not exist.';
  end if;

  if current_date < co then
    raise exception 'You can leave a review once the stay has finished.';
  end if;

  if current_date > co + 14 then
    raise exception 'The 14 day window for reviewing this stay has closed.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."check_review_window"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_own_account"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  uid uuid := auth.uid();
  blocking int;
  removed int;
begin
  if uid is null then
    raise exception 'You must be signed in to delete your account.';
  end if;

  -- The account must actually still exist.
  if not exists (select 1 from auth.users where id = uid) then
    raise exception 'This account no longer exists. Please sign out and sign in again.';
  end if;

  -- Refuse while there are still bookings in play, as guest or as host.
  select count(*) into blocking
  from public.bookings
  where (guest_id = uid or host_id = uid)
    and status in ('pending', 'confirmed')
    and check_out >= current_date;

  if blocking > 0 then
    raise exception
      'You still have % upcoming or pending booking(s). Please cancel them before deleting your account.',
      blocking;
  end if;

  delete from auth.users where id = uid;

  get diagnostics removed = row_count;
  if removed = 0 then
    raise exception 'Account could not be deleted. Please contact support.';
  end if;
end;
$$;


ALTER FUNCTION "public"."delete_own_account"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_unpaid_bookings"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.bookings
  set status = 'cancelled',
      cancelled_at = now()
  where status = 'pending_payment'
    and payment_status = 'unpaid'
    and created_at < now() - interval '1 hour';
end;
$$;


ALTER FUNCTION "public"."expire_unpaid_bookings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalise_staff_permissions"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
    if new.role = 'staff' then
        new.can_calendar := true;
        new.can_messages := false;
        new.can_bookings := false;
        new.can_listing := false;
        new.can_earnings := false;
    end if;
    return new;
end;
$$;


ALTER FUNCTION "public"."normalise_staff_permissions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."on_review_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if (tg_op = 'DELETE') then
    perform public.refresh_listing_ratings(old.listing_id);
    return old;
  end if;

  perform public.refresh_listing_ratings(new.listing_id);

  -- An update that moves a review between listings has to fix both.
  if (tg_op = 'UPDATE' and old.listing_id is distinct from new.listing_id) then
    perform public.refresh_listing_ratings(old.listing_id);
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."on_review_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."publish_expired_reviews"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.reviews r
  set is_published = true,
      published_at = coalesce(r.published_at, now())
  from public.bookings b
  where r.booking_id = b.id
    and r.is_published = false
    and current_date > b.check_out + 14;
end;
$$;


ALTER FUNCTION "public"."publish_expired_reviews"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."publish_paired_reviews"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  other_count integer;
begin
  select count(*) into other_count
  from public.reviews
  where booking_id = new.booking_id
    and review_type <> new.review_type;

  if other_count > 0 then
    update public.reviews
    set is_published = true,
        published_at = coalesce(published_at, now())
    where booking_id = new.booking_id
      and is_published = false;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."publish_paired_reviews"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_listing_ratings"("target_listing" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.listings l
  set
    rating_avg           = agg.avg_overall,
    rating_count         = agg.n,
    rating_cleanliness   = agg.avg_cleanliness,
    rating_accuracy      = agg.avg_accuracy,
    rating_checkin       = agg.avg_checkin,
    rating_communication = agg.avg_communication,
    rating_location      = agg.avg_location,
    rating_value         = agg.avg_value
  from (
    select
      count(*)                          as n,
      round(avg(rating), 2)             as avg_overall,
      round(avg(cleanliness_rating), 2) as avg_cleanliness,
      round(avg(accuracy_rating), 2)    as avg_accuracy,
      round(avg(checkin_rating), 2)     as avg_checkin,
      round(avg(communication_rating), 2) as avg_communication,
      round(avg(location_rating), 2)    as avg_location,
      round(avg(value_rating), 2)       as avg_value
    from public.reviews
    where listing_id = target_listing
      and review_type = 'guest_to_host'
      and is_published = true
  ) agg
  where l.id = target_listing;
end;
$$;


ALTER FUNCTION "public"."refresh_listing_ratings"("target_listing" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."render_template"("tpl" "text", "guest_name" "text", "listing_title" "text", "check_in" "date", "check_out" "date") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select replace(replace(replace(replace(
           coalesce(tpl, ''),
           '{guest_name}',    coalesce(nullif(split_part(trim(guest_name), ' ', 1), ''), 'there')),
           '{listing}',       coalesce(listing_title, 'your stay')),
           '{check_in}',      to_char(check_in,  'FMDay FMDD FMMonth')),
           '{check_out}',     to_char(check_out, 'FMDay FMDD FMMonth'));
$$;


ALTER FUNCTION "public"."render_template"("tpl" "text", "guest_name" "text", "listing_title" "text", "check_in" "date", "check_out" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_due_scheduled_messages"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  rec         record;
  local_now   timestamp;
  local_hour  int;
  today       date;
  sent_count  int := 0;
begin
  local_now  := now() at time zone 'Europe/London';
  local_hour := extract(hour from local_now);
  today      := local_now::date;

  for rec in
    select
      b.id            as booking_id,
      b.guest_id,
      b.host_id,
      b.check_in,
      b.check_out,
      t.template_type,
      t.body,
      l.title         as listing_title,
      coalesce(
        nullif(p.preferred_name, ''),
        case when coalesce(p.show_full_name, true) then nullif(p.full_name, '') end,
        'there'
      )               as guest_name
    from public.message_templates t
    join public.bookings b
      on b.host_id = t.user_id
     and b.status  = 'confirmed'
    left join public.listings l on l.id = b.listing_id
    left join public.profiles p on p.id = b.guest_id
    where t.enabled
      and t.body <> ''
      and t.anchor <> 'none'
      and (
            array_length(t.listing_ids, 1) is null
         or b.listing_id = any (t.listing_ids)
      )
      and (
            (   t.anchor = 'booking'
            and b.confirmed_at is not null
            and now() >= b.confirmed_at + (t.minutes_after || ' minutes')::interval )

         or (   t.anchor = 'check_in'
            and b.check_in - t.days_offset = today
            and t.send_hour = local_hour )

         or (   t.anchor = 'after_check_in'
            and b.check_in = today
            and local_hour = least(
                  extract(hour from coalesce(l.check_in_time, '15:00'::time))::int + t.hours_after,
                  23) )

            -- Counted back from the moment they actually have to leave.
            -- 11am check-out with "12 hours before" sends at 11pm the
            -- night before.
         or (   t.anchor = 'before_check_out'
            and date_trunc('hour',
                  (b.check_out::timestamp + coalesce(l.check_out_time, '11:00'::time))
                  - (t.hours_before || ' hours')::interval
                ) = date_trunc('hour', local_now) )

         or (   t.anchor = 'check_out'
            and b.check_out - t.days_offset = today
            and t.send_hour = local_hour )
      )
      and not exists (
            select 1 from public.sent_scheduled_messages s
            where s.booking_id = b.id
              and s.template_type = t.template_type
      )
  loop
    begin
      insert into public.sent_scheduled_messages (booking_id, template_type)
      values (rec.booking_id, rec.template_type);
    exception when unique_violation then
      continue;
    end;

    insert into public.messages (booking_id, sender_id, recipient_id, body)
    values (
      rec.booking_id,
      rec.host_id,
      rec.guest_id,
      public.render_template(rec.body, rec.guest_name, rec.listing_title, rec.check_in, rec.check_out)
    );

    sent_count := sent_count + 1;
  end loop;

  return sent_count;
end;
$$;


ALTER FUNCTION "public"."send_due_scheduled_messages"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."booking_guests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "email" "text" NOT NULL,
    "name" "text",
    "status" "text" DEFAULT 'invited'::"text" NOT NULL,
    "invite_token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invited_by" "uuid",
    "invited_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "accepted_at" timestamp with time zone,
    CONSTRAINT "booking_guests_status_check" CHECK (("status" = ANY (ARRAY['invited'::"text", 'active'::"text", 'removed'::"text"])))
);


ALTER TABLE "public"."booking_guests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bookings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "listing_id" "uuid" NOT NULL,
    "guest_id" "uuid" NOT NULL,
    "host_id" "uuid" NOT NULL,
    "check_in" "date" NOT NULL,
    "check_out" "date" NOT NULL,
    "guests" integer DEFAULT 1 NOT NULL,
    "total_price" numeric NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "adults" integer DEFAULT 1 NOT NULL,
    "children" integer DEFAULT 0 NOT NULL,
    "pets" integer DEFAULT 0 NOT NULL,
    "confirmed_at" timestamp with time zone,
    "payment_status" "text" DEFAULT 'unpaid'::"text" NOT NULL,
    "payment_plan" "text",
    "deposit_amount" numeric(10,2),
    "balance_amount" numeric(10,2),
    "balance_due_date" "date",
    "amount_paid" numeric(10,2) DEFAULT 0 NOT NULL,
    "amount_refunded" numeric(10,2) DEFAULT 0 NOT NULL,
    "stripe_customer_id" "text",
    "stripe_payment_method_id" "text",
    "stripe_payment_intent_id" "text",
    "balance_payment_intent_id" "text",
    "balance_attempts" integer DEFAULT 0 NOT NULL,
    "balance_last_attempt_at" timestamp with time zone,
    "free_cancel_until" "date",
    "paid_at" timestamp with time zone,
    "commission_rate" numeric,
    "payout_transfer_id" "text",
    "paid_out_at" timestamp with time zone,
    "payout_amount" numeric,
    CONSTRAINT "bookings_status_check" CHECK (("status" = ANY (ARRAY['pending_payment'::"text", 'pending'::"text", 'confirmed'::"text", 'declined'::"text", 'cancelled'::"text", 'expired'::"text", 'completed'::"text"]))),
    CONSTRAINT "valid_dates" CHECK (("check_out" > "check_in"))
);


ALTER TABLE "public"."bookings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."calendar_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "listing_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "is_blocked" boolean DEFAULT false NOT NULL,
    "price_override" numeric,
    "min_nights_override" integer,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."calendar_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."error_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source" "text" DEFAULT 'client'::"text" NOT NULL,
    "message" "text" NOT NULL,
    "detail" "text",
    "path" "text",
    "digest" "text",
    "user_id" "uuid",
    "user_agent" "text",
    "resolved" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."error_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."listing_access" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "listing_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "email" "text" NOT NULL,
    "role" "text" DEFAULT 'co_host'::"text" NOT NULL,
    "can_calendar" boolean DEFAULT false NOT NULL,
    "can_messages" boolean DEFAULT false NOT NULL,
    "can_bookings" boolean DEFAULT false NOT NULL,
    "can_listing" boolean DEFAULT false NOT NULL,
    "can_earnings" boolean DEFAULT false NOT NULL,
    "status" "text" DEFAULT 'invited'::"text" NOT NULL,
    "invite_token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invited_by" "uuid",
    "invited_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "accepted_at" timestamp with time zone,
    CONSTRAINT "listing_access_role_check" CHECK (("role" = ANY (ARRAY['co_host'::"text", 'staff'::"text"]))),
    CONSTRAINT "listing_access_status_check" CHECK (("status" = ANY (ARRAY['invited'::"text", 'active'::"text", 'revoked'::"text"])))
);


ALTER TABLE "public"."listing_access" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."listing_ical_feeds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "listing_id" "uuid" NOT NULL,
    "url" "text" NOT NULL,
    "label" "text",
    "last_synced_at" timestamp with time zone,
    "last_status" "text",
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "events" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "failure_count" integer DEFAULT 0 NOT NULL,
    "alerted_at" timestamp with time zone
);


ALTER TABLE "public"."listing_ical_feeds" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."listings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "host_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "location" "text" NOT NULL,
    "price_per_night" numeric NOT NULL,
    "max_guests" integer DEFAULT 2,
    "images" "text"[] DEFAULT '{}'::"text"[],
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "property_type" "text",
    "privacy_type" "text" DEFAULT 'Entire place'::"text",
    "bedrooms" integer DEFAULT 1,
    "beds" integer DEFAULT 1,
    "bathrooms" integer DEFAULT 1,
    "amenities" "text"[] DEFAULT '{}'::"text"[],
    "new_listing_promo" boolean DEFAULT true,
    "last_minute_discount" boolean DEFAULT false,
    "weekly_discount" boolean DEFAULT false,
    "monthly_discount" boolean DEFAULT false,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "ical_import_url" "text",
    "min_nights" integer DEFAULT 1 NOT NULL,
    "max_nights" integer,
    "events_allowed" boolean DEFAULT false NOT NULL,
    "smoking_allowed" boolean DEFAULT false NOT NULL,
    "quiet_hours_enabled" boolean DEFAULT false NOT NULL,
    "quiet_hours_start" "text" DEFAULT '22:00'::"text",
    "quiet_hours_end" "text" DEFAULT '07:00'::"text",
    "commercial_photography_allowed" boolean DEFAULT false NOT NULL,
    "checkin_start" "text" DEFAULT '15:00'::"text",
    "checkin_end" "text" DEFAULT ''::"text",
    "checkout_time" "text" DEFAULT '11:00'::"text",
    "additional_rules" "text",
    "cancellation_policy" "text" DEFAULT 'Moderate'::"text" NOT NULL,
    "non_refundable_option" boolean DEFAULT false NOT NULL,
    "weekend_price" numeric,
    "cleaning_fee" numeric DEFAULT 0 NOT NULL,
    "pet_fee" numeric DEFAULT 0 NOT NULL,
    "extra_guest_fee" numeric DEFAULT 0 NOT NULL,
    "advance_notice" "text" DEFAULT 'Same day'::"text" NOT NULL,
    "preparation_time" "text" DEFAULT 'None'::"text" NOT NULL,
    "availability_window" "text" DEFAULT '9 months'::"text" NOT NULL,
    "instant_book" boolean DEFAULT false NOT NULL,
    "instant_book_requires_phone" boolean DEFAULT false NOT NULL,
    "instant_book_requires_verified_id" boolean DEFAULT false NOT NULL,
    "check_in_time" time without time zone DEFAULT '15:00:00'::time without time zone NOT NULL,
    "check_out_time" time without time zone DEFAULT '11:00:00'::time without time zone NOT NULL,
    "stl_licence_number" "text",
    "stl_licence_expiry" "date",
    "stl_licence_status" "text" DEFAULT 'none'::"text" NOT NULL,
    "check_in_method" "text",
    "latitude" double precision,
    "longitude" double precision,
    "nearby" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "rating_avg" numeric(3,2),
    "rating_count" integer DEFAULT 0 NOT NULL,
    "rating_cleanliness" numeric(3,2),
    "rating_accuracy" numeric(3,2),
    "rating_checkin" numeric(3,2),
    "rating_communication" numeric(3,2),
    "rating_location" numeric(3,2),
    "rating_value" numeric(3,2),
    "commission_rate" numeric,
    "damage_deposit" numeric DEFAULT 0 NOT NULL,
    "ical_token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "extra_guest_after" integer DEFAULT 1 NOT NULL,
    "extra_guest_period" "text" DEFAULT 'night'::"text" NOT NULL,
    CONSTRAINT "listings_cancellation_policy_check" CHECK (("cancellation_policy" = ANY (ARRAY['Flexible'::"text", 'Moderate'::"text", 'Limited'::"text", 'Firm'::"text"]))),
    CONSTRAINT "listings_extra_guest_period_check" CHECK (("extra_guest_period" = ANY (ARRAY['night'::"text", 'stay'::"text"]))),
    CONSTRAINT "listings_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text", 'hidden'::"text"])))
);


ALTER TABLE "public"."listings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."message_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "template_type" "text" NOT NULL,
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "days_offset" integer DEFAULT 0 NOT NULL,
    "send_hour" integer DEFAULT 9 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "anchor" "text" DEFAULT 'none'::"text" NOT NULL,
    "minutes_after" integer DEFAULT 0 NOT NULL,
    "hours_after" integer DEFAULT 0 NOT NULL,
    "listing_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "hours_before" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "message_templates_template_type_check" CHECK (("template_type" = ANY (ARRAY['booking_confirmation'::"text", 'checkin_details'::"text", 'checkin_day'::"text", 'checkout_details'::"text"])))
);


ALTER TABLE "public"."message_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "recipient_id" "uuid" NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "read_at" timestamp with time zone
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_preferences" (
    "user_id" "uuid" NOT NULL,
    "new_message" boolean DEFAULT true NOT NULL,
    "booking_reminders" boolean DEFAULT true NOT NULL,
    "review_prompts" boolean DEFAULT true NOT NULL,
    "marketing" boolean DEFAULT false NOT NULL,
    "unsubscribe_token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notification_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid",
    "kind" "text" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "currency" "text" DEFAULT 'gbp'::"text" NOT NULL,
    "status" "text" NOT NULL,
    "stripe_payment_intent_id" "text",
    "stripe_refund_id" "text",
    "failure_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payouts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid",
    "host_id" "uuid",
    "amount" numeric NOT NULL,
    "kind" "text" DEFAULT 'transfer'::"text" NOT NULL,
    "status" "text" DEFAULT 'succeeded'::"text" NOT NULL,
    "stripe_transfer_id" "text",
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."payouts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text",
    "is_host" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "phone" "text",
    "preferred_name" "text",
    "residential_address" "text",
    "show_full_name" boolean DEFAULT true NOT NULL,
    "welcome_message" "text",
    "welcome_message_enabled" boolean DEFAULT false NOT NULL,
    "identity_verified" boolean DEFAULT false NOT NULL,
    "identity_verified_at" timestamp with time zone,
    "avatar_url" "text",
    "stripe_account_id" "text",
    "stripe_charges_enabled" boolean DEFAULT false NOT NULL,
    "stripe_payouts_enabled" boolean DEFAULT false NOT NULL,
    "stripe_details_submitted" boolean DEFAULT false NOT NULL,
    "stripe_requirements_due" "text",
    "stripe_updated_at" timestamp with time zone,
    "is_admin" boolean DEFAULT false NOT NULL,
    "payout_balance_owed" numeric DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quick_replies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."quick_replies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "listing_id" "uuid",
    "reviewer_id" "uuid" NOT NULL,
    "reviewee_id" "uuid" NOT NULL,
    "review_type" "text" NOT NULL,
    "rating" numeric(3,2) NOT NULL,
    "comment" "text" NOT NULL,
    "host_reply" "text",
    "host_reply_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "cleanliness_rating" integer,
    "accuracy_rating" integer,
    "checkin_rating" integer,
    "communication_rating" integer,
    "location_rating" integer,
    "value_rating" integer,
    "is_published" boolean DEFAULT false NOT NULL,
    "published_at" timestamp with time zone,
    "edited_at" timestamp with time zone,
    CONSTRAINT "reviews_accuracy_rating_check" CHECK ((("accuracy_rating" >= 1) AND ("accuracy_rating" <= 5))),
    CONSTRAINT "reviews_checkin_rating_check" CHECK ((("checkin_rating" >= 1) AND ("checkin_rating" <= 5))),
    CONSTRAINT "reviews_cleanliness_rating_check" CHECK ((("cleanliness_rating" >= 1) AND ("cleanliness_rating" <= 5))),
    CONSTRAINT "reviews_communication_rating_check" CHECK ((("communication_rating" >= 1) AND ("communication_rating" <= 5))),
    CONSTRAINT "reviews_location_rating_check" CHECK ((("location_rating" >= 1) AND ("location_rating" <= 5))),
    CONSTRAINT "reviews_rating_check" CHECK ((("rating" >= (1)::numeric) AND ("rating" <= (5)::numeric))),
    CONSTRAINT "reviews_review_type_check" CHECK (("review_type" = ANY (ARRAY['guest_to_host'::"text", 'host_to_guest'::"text"]))),
    CONSTRAINT "reviews_value_rating_check" CHECK ((("value_rating" >= 1) AND ("value_rating" <= 5)))
);


ALTER TABLE "public"."reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sent_review_reminders" (
    "booking_id" "uuid" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sent_review_reminders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sent_scheduled_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "template_type" "text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sent_scheduled_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "host_id" "uuid" NOT NULL,
    "service_id" "uuid",
    "listing_id" "uuid",
    "preferred_date" "date",
    "notes" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "service_requests_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'scheduled'::"text", 'completed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."service_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."services" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "price_note" "text" DEFAULT ''::"text" NOT NULL,
    "icon" "text" DEFAULT 'wrench'::"text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."services" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stripe_events" (
    "event_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "payload" "jsonb"
);


ALTER TABLE "public"."stripe_events" OWNER TO "postgres";


ALTER TABLE ONLY "public"."booking_guests"
    ADD CONSTRAINT "booking_guests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calendar_overrides"
    ADD CONSTRAINT "calendar_overrides_listing_id_date_key" UNIQUE ("listing_id", "date");



ALTER TABLE ONLY "public"."calendar_overrides"
    ADD CONSTRAINT "calendar_overrides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."error_log"
    ADD CONSTRAINT "error_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."listing_access"
    ADD CONSTRAINT "listing_access_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."listing_ical_feeds"
    ADD CONSTRAINT "listing_ical_feeds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."listings"
    ADD CONSTRAINT "listings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."message_templates"
    ADD CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."message_templates"
    ADD CONSTRAINT "message_templates_user_id_template_type_key" UNIQUE ("user_id", "template_type");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payouts"
    ADD CONSTRAINT "payouts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quick_replies"
    ADD CONSTRAINT "quick_replies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_booking_id_review_type_key" UNIQUE ("booking_id", "review_type");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sent_review_reminders"
    ADD CONSTRAINT "sent_review_reminders_pkey" PRIMARY KEY ("booking_id");



ALTER TABLE ONLY "public"."sent_scheduled_messages"
    ADD CONSTRAINT "sent_scheduled_messages_booking_id_template_type_key" UNIQUE ("booking_id", "template_type");



ALTER TABLE ONLY "public"."sent_scheduled_messages"
    ADD CONSTRAINT "sent_scheduled_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_requests"
    ADD CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stripe_events"
    ADD CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("event_id");



CREATE INDEX "booking_guests_booking_idx" ON "public"."booking_guests" USING "btree" ("booking_id");



CREATE UNIQUE INDEX "booking_guests_unique_person" ON "public"."booking_guests" USING "btree" ("booking_id", "lower"("email")) WHERE ("status" <> 'removed'::"text");



CREATE INDEX "booking_guests_user_idx" ON "public"."booking_guests" USING "btree" ("user_id");



CREATE INDEX "bookings_balance_due_idx" ON "public"."bookings" USING "btree" ("balance_due_date") WHERE ("payment_status" = 'deposit_paid'::"text");



CREATE INDEX "bookings_payment_status_idx" ON "public"."bookings" USING "btree" ("payment_status");



CREATE INDEX "error_log_created_idx" ON "public"."error_log" USING "btree" ("created_at" DESC);



CREATE INDEX "error_log_resolved_idx" ON "public"."error_log" USING "btree" ("resolved");



CREATE INDEX "listing_access_listing_idx" ON "public"."listing_access" USING "btree" ("listing_id");



CREATE UNIQUE INDEX "listing_access_unique_person" ON "public"."listing_access" USING "btree" ("listing_id", "lower"("email")) WHERE ("status" <> 'revoked'::"text");



CREATE INDEX "listing_access_user_idx" ON "public"."listing_access" USING "btree" ("user_id");



CREATE INDEX "listing_ical_feeds_listing_idx" ON "public"."listing_ical_feeds" USING "btree" ("listing_id");



CREATE UNIQUE INDEX "listing_ical_feeds_unique_url" ON "public"."listing_ical_feeds" USING "btree" ("listing_id", "url");



CREATE INDEX "message_templates_user_idx" ON "public"."message_templates" USING "btree" ("user_id");



CREATE INDEX "messages_booking_created_idx" ON "public"."messages" USING "btree" ("booking_id", "created_at" DESC);



CREATE INDEX "messages_unread_idx" ON "public"."messages" USING "btree" ("recipient_id", "read_at") WHERE ("read_at" IS NULL);



CREATE UNIQUE INDEX "notification_preferences_token_idx" ON "public"."notification_preferences" USING "btree" ("unsubscribe_token");



CREATE INDEX "payments_booking_idx" ON "public"."payments" USING "btree" ("booking_id");



CREATE UNIQUE INDEX "profiles_stripe_account_idx" ON "public"."profiles" USING "btree" ("stripe_account_id") WHERE ("stripe_account_id" IS NOT NULL);



CREATE INDEX "quick_replies_user_id_idx" ON "public"."quick_replies" USING "btree" ("user_id");



CREATE INDEX "reviews_booking_idx" ON "public"."reviews" USING "btree" ("booking_id");



CREATE INDEX "reviews_listing_published_idx" ON "public"."reviews" USING "btree" ("listing_id", "is_published");



CREATE UNIQUE INDEX "reviews_one_per_reviewer_idx" ON "public"."reviews" USING "btree" ("booking_id", "reviewer_id", "review_type");



CREATE INDEX "service_requests_host_idx" ON "public"."service_requests" USING "btree" ("host_id");



CREATE OR REPLACE TRIGGER "listing_access_staff_permissions" BEFORE INSERT OR UPDATE ON "public"."listing_access" FOR EACH ROW EXECUTE FUNCTION "public"."normalise_staff_permissions"();



CREATE OR REPLACE TRIGGER "reviews_check_window" BEFORE INSERT ON "public"."reviews" FOR EACH ROW EXECUTE FUNCTION "public"."check_review_window"();



CREATE OR REPLACE TRIGGER "reviews_publish_pair" AFTER INSERT ON "public"."reviews" FOR EACH ROW EXECUTE FUNCTION "public"."publish_paired_reviews"();



CREATE OR REPLACE TRIGGER "reviews_refresh_listing_ratings" AFTER INSERT OR DELETE OR UPDATE ON "public"."reviews" FOR EACH ROW EXECUTE FUNCTION "public"."on_review_change"();



ALTER TABLE ONLY "public"."booking_guests"
    ADD CONSTRAINT "booking_guests_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."booking_guests"
    ADD CONSTRAINT "booking_guests_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."booking_guests"
    ADD CONSTRAINT "booking_guests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."calendar_overrides"
    ADD CONSTRAINT "calendar_overrides_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."error_log"
    ADD CONSTRAINT "error_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."listing_access"
    ADD CONSTRAINT "listing_access_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."listing_access"
    ADD CONSTRAINT "listing_access_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."listing_access"
    ADD CONSTRAINT "listing_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."listing_ical_feeds"
    ADD CONSTRAINT "listing_ical_feeds_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."listings"
    ADD CONSTRAINT "listings_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."message_templates"
    ADD CONSTRAINT "message_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payouts"
    ADD CONSTRAINT "payouts_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payouts"
    ADD CONSTRAINT "payouts_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quick_replies"
    ADD CONSTRAINT "quick_replies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_reviewee_id_fkey" FOREIGN KEY ("reviewee_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sent_review_reminders"
    ADD CONSTRAINT "sent_review_reminders_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_requests"
    ADD CONSTRAINT "service_requests_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_requests"
    ADD CONSTRAINT "service_requests_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."service_requests"
    ADD CONSTRAINT "service_requests_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE SET NULL;



CREATE POLICY "Anyone can view calendar overrides" ON "public"."calendar_overrides" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Anyone can view guest reviews of hosts" ON "public"."reviews" FOR SELECT TO "authenticated", "anon" USING (("review_type" = 'guest_to_host'::"text"));



CREATE POLICY "Guests can create their own bookings" ON "public"."bookings" FOR INSERT TO "authenticated" WITH CHECK (("guest_id" = "auth"."uid"()));



CREATE POLICY "Guests can review after their completed stay" ON "public"."reviews" FOR INSERT TO "authenticated" WITH CHECK ((("review_type" = 'guest_to_host'::"text") AND ("reviewer_id" = "auth"."uid"()) AND ("booking_id" IN ( SELECT "bookings"."id"
   FROM "public"."bookings"
  WHERE (("bookings"."guest_id" = "auth"."uid"()) AND ("bookings"."status" = 'confirmed'::"text") AND ("bookings"."check_out" < "now"()))))));



CREATE POLICY "Guests can view their own bookings" ON "public"."bookings" FOR SELECT TO "authenticated" USING (("guest_id" = "auth"."uid"()));



CREATE POLICY "Hosts and reviewed guests can view guest reviews" ON "public"."reviews" FOR SELECT TO "authenticated" USING ((("review_type" = 'host_to_guest'::"text") AND (("reviewer_id" = "auth"."uid"()) OR ("reviewee_id" = "auth"."uid"()))));



CREATE POLICY "Hosts can create listings." ON "public"."listings" FOR INSERT WITH CHECK (("auth"."uid"() = "host_id"));



CREATE POLICY "Hosts can manage their own calendar overrides" ON "public"."calendar_overrides" TO "authenticated" USING (("listing_id" IN ( SELECT "listings"."id"
   FROM "public"."listings"
  WHERE ("listings"."host_id" = "auth"."uid"())))) WITH CHECK (("listing_id" IN ( SELECT "listings"."id"
   FROM "public"."listings"
  WHERE ("listings"."host_id" = "auth"."uid"()))));



CREATE POLICY "Hosts can reply to reviews written about them" ON "public"."reviews" FOR UPDATE TO "authenticated" USING ((("review_type" = 'guest_to_host'::"text") AND ("reviewee_id" = "auth"."uid"()))) WITH CHECK ((("review_type" = 'guest_to_host'::"text") AND ("reviewee_id" = "auth"."uid"())));



CREATE POLICY "Hosts can review guests after a completed stay" ON "public"."reviews" FOR INSERT TO "authenticated" WITH CHECK ((("review_type" = 'host_to_guest'::"text") AND ("reviewer_id" = "auth"."uid"()) AND ("booking_id" IN ( SELECT "bookings"."id"
   FROM "public"."bookings"
  WHERE (("bookings"."host_id" = "auth"."uid"()) AND ("bookings"."status" = 'confirmed'::"text") AND ("bookings"."check_out" < "now"()))))));



CREATE POLICY "Hosts can update booking status on their listings" ON "public"."bookings" FOR UPDATE TO "authenticated" USING (("host_id" = "auth"."uid"())) WITH CHECK (("host_id" = "auth"."uid"()));



CREATE POLICY "Hosts can update their own listings." ON "public"."listings" FOR UPDATE USING (("auth"."uid"() = "host_id"));



CREATE POLICY "Hosts can view bookings on their listings" ON "public"."bookings" FOR SELECT TO "authenticated" USING (("host_id" = "auth"."uid"()));



CREATE POLICY "Listings are viewable by everyone." ON "public"."listings" FOR SELECT USING (true);



CREATE POLICY "Participants can send messages on their booking" ON "public"."messages" FOR INSERT TO "authenticated" WITH CHECK ((("sender_id" = "auth"."uid"()) AND ("booking_id" IN ( SELECT "bookings"."id"
   FROM "public"."bookings"
  WHERE (("bookings"."guest_id" = "auth"."uid"()) OR ("bookings"."host_id" = "auth"."uid"()))))));



CREATE POLICY "Participants can view their booking's messages" ON "public"."messages" FOR SELECT TO "authenticated" USING (("booking_id" IN ( SELECT "bookings"."id"
   FROM "public"."bookings"
  WHERE (("bookings"."guest_id" = "auth"."uid"()) OR ("bookings"."host_id" = "auth"."uid"())))));



CREATE POLICY "Public can view confirmed booking dates for calendar export" ON "public"."bookings" FOR SELECT TO "anon" USING (("status" = 'confirmed'::"text"));



CREATE POLICY "Public profiles are viewable by everyone." ON "public"."profiles" FOR SELECT USING (true);



CREATE POLICY "Users can insert their own profile." ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can update own profile." ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "booker manages their group" ON "public"."booking_guests" USING ((EXISTS ( SELECT 1
   FROM "public"."bookings" "b"
  WHERE (("b"."id" = "booking_guests"."booking_id") AND ("b"."guest_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."bookings" "b"
  WHERE (("b"."id" = "booking_guests"."booking_id") AND ("b"."guest_id" = "auth"."uid"())))));



ALTER TABLE "public"."booking_guests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."calendar_overrides" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."error_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "guests see their own place in a group" ON "public"."booking_guests" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "host reads own sent log" ON "public"."sent_scheduled_messages" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."bookings" "b"
  WHERE (("b"."id" = "sent_scheduled_messages"."booking_id") AND ("b"."host_id" = "auth"."uid"())))));



CREATE POLICY "host writes own sent log" ON "public"."sent_scheduled_messages" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."bookings" "b"
  WHERE (("b"."id" = "sent_scheduled_messages"."booking_id") AND ("b"."host_id" = "auth"."uid"())))));



CREATE POLICY "hosts manage their own feeds" ON "public"."listing_ical_feeds" USING ((EXISTS ( SELECT 1
   FROM "public"."listings" "l"
  WHERE (("l"."id" = "listing_ical_feeds"."listing_id") AND ("l"."host_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."listings" "l"
  WHERE (("l"."id" = "listing_ical_feeds"."listing_id") AND ("l"."host_id" = "auth"."uid"())))));



ALTER TABLE "public"."listing_access" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."listing_ical_feeds" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."listings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."message_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_preferences" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "own notification prefs - insert" ON "public"."notification_preferences" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own notification prefs - select" ON "public"."notification_preferences" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "own notification prefs - update" ON "public"."notification_preferences" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own quick replies delete" ON "public"."quick_replies" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "own quick replies insert" ON "public"."quick_replies" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "own quick replies select" ON "public"."quick_replies" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "own quick replies update" ON "public"."quick_replies" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "own requests cancel" ON "public"."service_requests" FOR UPDATE USING ((("auth"."uid"() = "host_id") AND ("status" = 'new'::"text"))) WITH CHECK (("auth"."uid"() = "host_id"));



CREATE POLICY "own requests insert" ON "public"."service_requests" FOR INSERT WITH CHECK (("auth"."uid"() = "host_id"));



CREATE POLICY "own requests select" ON "public"."service_requests" FOR SELECT USING (("auth"."uid"() = "host_id"));



CREATE POLICY "own templates all" ON "public"."message_templates" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner manages access" ON "public"."listing_access" USING ((EXISTS ( SELECT 1
   FROM "public"."listings" "l"
  WHERE (("l"."id" = "listing_access"."listing_id") AND ("l"."host_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."listings" "l"
  WHERE (("l"."id" = "listing_access"."listing_id") AND ("l"."host_id" = "auth"."uid"())))));



CREATE POLICY "owners read errors" ON "public"."error_log" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."is_admin" = true)))));



ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payments - read own" ON "public"."payments" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."bookings" "b"
  WHERE (("b"."id" = "payments"."booking_id") AND (("b"."guest_id" = "auth"."uid"()) OR ("b"."host_id" = "auth"."uid"()))))));



ALTER TABLE "public"."payouts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payouts owner read" ON "public"."payouts" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."is_admin" = true)))));



CREATE POLICY "people see their own access" ON "public"."listing_access" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."quick_replies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reviews - delete own while hidden" ON "public"."reviews" FOR DELETE USING ((("auth"."uid"() = "reviewer_id") AND ("is_published" = false)));



CREATE POLICY "reviews - edit own while hidden" ON "public"."reviews" FOR UPDATE USING ((("auth"."uid"() = "reviewer_id") AND ("is_published" = false))) WITH CHECK (("auth"."uid"() = "reviewer_id"));



CREATE POLICY "reviews - read published" ON "public"."reviews" FOR SELECT USING ((("is_published" = true) OR ("auth"."uid"() = "reviewer_id")));



CREATE POLICY "reviews - write own" ON "public"."reviews" FOR INSERT WITH CHECK (("auth"."uid"() = "reviewer_id"));



ALTER TABLE "public"."sent_review_reminders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sent_scheduled_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."service_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."services" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "services readable" ON "public"."services" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



ALTER TABLE "public"."stripe_events" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."messages";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";











































































































































































GRANT ALL ON FUNCTION "public"."add_notification_preferences"() TO "anon";
GRANT ALL ON FUNCTION "public"."add_notification_preferences"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_notification_preferences"() TO "service_role";



GRANT ALL ON FUNCTION "public"."add_profile_for_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."add_profile_for_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_profile_for_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_review_window"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_review_window"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_review_window"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_own_account"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_own_account"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_own_account"() TO "service_role";



GRANT ALL ON FUNCTION "public"."expire_unpaid_bookings"() TO "anon";
GRANT ALL ON FUNCTION "public"."expire_unpaid_bookings"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."expire_unpaid_bookings"() TO "service_role";



GRANT ALL ON FUNCTION "public"."normalise_staff_permissions"() TO "anon";
GRANT ALL ON FUNCTION "public"."normalise_staff_permissions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalise_staff_permissions"() TO "service_role";



GRANT ALL ON FUNCTION "public"."on_review_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."on_review_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."on_review_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."publish_expired_reviews"() TO "anon";
GRANT ALL ON FUNCTION "public"."publish_expired_reviews"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."publish_expired_reviews"() TO "service_role";



GRANT ALL ON FUNCTION "public"."publish_paired_reviews"() TO "anon";
GRANT ALL ON FUNCTION "public"."publish_paired_reviews"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."publish_paired_reviews"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_listing_ratings"("target_listing" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_listing_ratings"("target_listing" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_listing_ratings"("target_listing" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."render_template"("tpl" "text", "guest_name" "text", "listing_title" "text", "check_in" "date", "check_out" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."render_template"("tpl" "text", "guest_name" "text", "listing_title" "text", "check_in" "date", "check_out" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."render_template"("tpl" "text", "guest_name" "text", "listing_title" "text", "check_in" "date", "check_out" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."send_due_scheduled_messages"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."send_due_scheduled_messages"() TO "service_role";
























GRANT ALL ON TABLE "public"."booking_guests" TO "anon";
GRANT ALL ON TABLE "public"."booking_guests" TO "authenticated";
GRANT ALL ON TABLE "public"."booking_guests" TO "service_role";



GRANT ALL ON TABLE "public"."bookings" TO "anon";
GRANT ALL ON TABLE "public"."bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."bookings" TO "service_role";



GRANT ALL ON TABLE "public"."calendar_overrides" TO "anon";
GRANT ALL ON TABLE "public"."calendar_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."calendar_overrides" TO "service_role";



GRANT ALL ON TABLE "public"."error_log" TO "anon";
GRANT ALL ON TABLE "public"."error_log" TO "authenticated";
GRANT ALL ON TABLE "public"."error_log" TO "service_role";



GRANT ALL ON TABLE "public"."listing_access" TO "anon";
GRANT ALL ON TABLE "public"."listing_access" TO "authenticated";
GRANT ALL ON TABLE "public"."listing_access" TO "service_role";



GRANT ALL ON TABLE "public"."listing_ical_feeds" TO "anon";
GRANT ALL ON TABLE "public"."listing_ical_feeds" TO "authenticated";
GRANT ALL ON TABLE "public"."listing_ical_feeds" TO "service_role";



GRANT ALL ON TABLE "public"."listings" TO "anon";
GRANT ALL ON TABLE "public"."listings" TO "authenticated";
GRANT ALL ON TABLE "public"."listings" TO "service_role";



GRANT ALL ON TABLE "public"."message_templates" TO "anon";
GRANT ALL ON TABLE "public"."message_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."message_templates" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."notification_preferences" TO "anon";
GRANT ALL ON TABLE "public"."notification_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."payouts" TO "anon";
GRANT ALL ON TABLE "public"."payouts" TO "authenticated";
GRANT ALL ON TABLE "public"."payouts" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."quick_replies" TO "anon";
GRANT ALL ON TABLE "public"."quick_replies" TO "authenticated";
GRANT ALL ON TABLE "public"."quick_replies" TO "service_role";



GRANT ALL ON TABLE "public"."reviews" TO "anon";
GRANT ALL ON TABLE "public"."reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."reviews" TO "service_role";



GRANT ALL ON TABLE "public"."sent_review_reminders" TO "anon";
GRANT ALL ON TABLE "public"."sent_review_reminders" TO "authenticated";
GRANT ALL ON TABLE "public"."sent_review_reminders" TO "service_role";



GRANT ALL ON TABLE "public"."sent_scheduled_messages" TO "anon";
GRANT ALL ON TABLE "public"."sent_scheduled_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."sent_scheduled_messages" TO "service_role";



GRANT ALL ON TABLE "public"."service_requests" TO "anon";
GRANT ALL ON TABLE "public"."service_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."service_requests" TO "service_role";



GRANT ALL ON TABLE "public"."services" TO "anon";
GRANT ALL ON TABLE "public"."services" TO "authenticated";
GRANT ALL ON TABLE "public"."services" TO "service_role";



GRANT ALL ON TABLE "public"."stripe_events" TO "anon";
GRANT ALL ON TABLE "public"."stripe_events" TO "authenticated";
GRANT ALL ON TABLE "public"."stripe_events" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";

































--
-- Triggers on auth.users.
--
-- These live in the auth schema, so `supabase db dump` does not carry them.
-- They are what creates a profile row when somebody signs up. A database
-- restored without them accepts signups and silently never creates the
-- profile, which reads as an empty page rather than an error — so they are
-- kept here by hand. Supabase provisions the rest of the auth schema itself;
-- nothing else from it belongs in this file.
--
CREATE OR REPLACE TRIGGER "on_auth_user_created_notifications" AFTER INSERT ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "public"."add_notification_preferences"();
CREATE OR REPLACE TRIGGER "on_auth_user_created_profile" AFTER INSERT ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "public"."add_profile_for_new_user"();
