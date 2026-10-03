-- phone sign-up profiles
--
-- WHAT THIS IS FOR, AND WHAT GOES WRONG WITHOUT IT.
--
-- The Log in or sign up panel (components/auth/AuthPanel) takes a phone number
-- or an email. A NEW account made with a phone number has no email on its auth
-- user — and add_profile_for_new_user copied new.email straight into
-- profiles.email, which is NOT NULL. So the profile insert failed, the trigger
-- raised, and Supabase refused to create the user at all: "Database error
-- saving new user" on the very first text. Phone sign-up could not make an
-- account.
--
-- Two changes:
--
--  1. add_profile_for_new_user writes '' when the auth user has no email yet,
--     exactly as it already writes '' for a missing name. Every email-made
--     account behaves exactly as before.
--
--  2. When an auth user's email is set or changed (a phone sign-up gives one on
--     its "Finish signing up" screen; it lands once they confirm it), the
--     profile's copy follows. Nothing kept profiles.email in step with
--     auth.users before; for phone accounts it is the only way the address
--     reaches the booking and receipt emails that read it.
--
-- PRE-FLIGHT. Not destructive: one function replaced (same signature, same
-- trigger), one new trigger function and one new trigger. No columns, no
-- grants, no rows touched.

create or replace function public.add_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, email, full_name, is_host)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.email is not null and new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$function$;

revoke all on function public.sync_profile_email() from public, anon, authenticated;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.sync_profile_email();
