-- 20260927230000_find_auth_user_by_email.sql
--
-- One-row lookup of a sign-in account by email, for the host sign-in doors
-- (/api/auth/start, send-code, verify-code, login) and the founder's admin
-- tools (lib/auth/admin-users.ts). Replaces paging through every account
-- with the admin listUsers API on each unauthenticated request.
--
--   - Compares lower(email) on BOTH sides, so an address stored with any
--     capital letters still matches. That skips Supabase's own email index,
--     which is fine: TR1VIA has a few dozen accounts, and auth.users is
--     owned by Supabase, so we deliberately add no index there.
--     TR1VIA has no SSO accounts.
--   - Returns only id, email and app metadata (our password marker and the
--     founder's per-host switches). Never passwords or tokens.
--   - SECURITY DEFINER with an empty search_path (every name is qualified).
--   - Callable ONLY by the server's service-role key: execute is revoked
--     from public, anon and authenticated, so the browser can never use it
--     to check which emails have accounts.
--   - If the server code ships before this migration, lib/auth/admin-users.ts
--     falls back to the old paged listUsers walk, so sign-in keeps working.

create or replace function public.find_auth_user_by_email(p_email text)
returns table (id uuid, email text, raw_app_meta_data jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.email::text, u.raw_app_meta_data
  from auth.users as u
  where lower(u.email) = lower(btrim(p_email))
    and u.is_sso_user = false
  limit 1;
$$;

comment on function public.find_auth_user_by_email(text) is
  'Server-only (service_role) account lookup by email for host sign-in.';

revoke all on function public.find_auth_user_by_email(text) from public;
revoke all on function public.find_auth_user_by_email(text) from anon, authenticated;
grant execute on function public.find_auth_user_by_email(text) to service_role;
