-- Phone and email as two ways into ONE account (Airbnb's model).
--
-- The bug: login uses Supabase's native phone OTP, keyed on auth.users.phone.
-- The number a guest saves in Account details is profiles.phone — a separate,
-- unconfirmed contact field. So logging in with that number found no matching
-- auth.users.phone and created a new, empty account instead of opening theirs.
--
-- The fix links a confirmed number to the account by setting auth.users.phone
-- (via Supabase's phone-change OTP, in Account settings). This migration adds
-- the server-side lookup the LOGIN step needs to tell three cases apart, so it
-- can block the one that must not create a second account:
--
--   'login'       — the number is a CONFIRMED login phone (auth.users.phone):
--                   sign in opens that account, as Supabase already does.
--   'unconfirmed' — the number is NOT a login phone anywhere, but it is sitting
--                   on some account's profiles.phone unconfirmed: logging in
--                   would wrongly make a new account, so the app blocks it and
--                   tells them to log in with email and confirm the number in
--                   settings.
--   'new'         — the number is on no account at all: carry on and create one,
--                   exactly as now.
--
-- phone_norm() reduces any UK-typed form to the digits Supabase stores
-- (+44 7700 900123 / 07700 900123 / 447700900123 → "447700900123"), so both
-- sides compare the same whatever was typed or stored.

create or replace function public.phone_norm(raw text)
returns text
language sql
immutable
as $$
    with d as (select regexp_replace(coalesce(raw, ''), '\D', '', 'g') as x)
    select case
        when x = '' then null
        when x like '0044%' then substr(x, 3)          -- 0044 7700 900123
        when x like '44%' and length(x) = 12 then x    -- 447700900123
        when x like '0%' and length(x) = 11 then '44' || substr(x, 2)  -- 07700900123
        when length(x) = 10 and x like '7%' then '44' || x             -- 7700900123
        else x
    end
    from d
$$;

-- SECURITY DEFINER so it can read auth.users; service_role-only so it is never a
-- browser-reachable "does this number have an account?" oracle. The one API
-- route that calls it (app/api/auth/phone-login-check) runs with the service
-- role and returns only block-or-proceed to the client.
create or replace function public.phone_login_state(p_phone text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
    n text := public.phone_norm(p_phone);
begin
    if n is null or n = '' then
        return 'new';
    end if;
    if exists (
        select 1 from auth.users
         where public.phone_norm(phone) = n
           and phone_confirmed_at is not null
    ) then
        return 'login';
    end if;
    if exists (
        select 1 from public.profiles
         where public.phone_norm(phone) = n
    ) then
        return 'unconfirmed';
    end if;
    return 'new';
end;
$$;

revoke all on function public.phone_norm(text) from public, anon, authenticated;
revoke all on function public.phone_login_state(text) from public, anon, authenticated;
grant execute on function public.phone_norm(text) to service_role;
grant execute on function public.phone_login_state(text) to service_role;

notify pgrst, 'reload schema';

-- Read back:
--   select public.phone_norm('07700 900123'), public.phone_norm('+44 7700 900123'),
--          public.phone_norm('447700900123');
--   -- expected: all three = '447700900123'
--   select public.phone_login_state('07700 900000');
--   -- expected on a clean project: 'new'
--   select count(*) from information_schema.role_routine_grants
--    where routine_name = 'phone_login_state' and grantee in ('anon','authenticated');
--   -- expected: 0
