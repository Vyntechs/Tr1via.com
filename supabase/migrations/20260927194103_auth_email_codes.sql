-- 20260927194103_auth_email_codes.sql
--
-- One-time 6-digit sign-in codes that TR1VIA emails to hosts (sign in to an
-- account with no password yet, reset a forgotten password, confirm a new
-- account's email). Written and read ONLY by the server with the
-- service-role key (lib/auth/email-code-store.ts).
--
--   - code_hash is an HMAC-SHA256 of purpose + email + code keyed by the
--     server's SESSION_SECRET. The plain code is never stored.
--   - A code works for 10 minutes, allows 5 tries, and is single use
--     (consumed_at). Sending a new code retires the older ones.
--   - Sends are rate-limited per email (and overall) by counting recent rows.
--
-- RLS is on with NO policies, and anon/authenticated have no grants, so the
-- browser can never read or write this table. The service role bypasses RLS.

set search_path = public, extensions;

create table if not exists public.auth_email_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and length(email) between 3 and 254),
  code_hash text not null,
  purpose text not null check (purpose in ('login', 'reset', 'signup')),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.auth_email_codes is
  'Hashed one-time sign-in codes emailed to hosts. Service role only.';

create index if not exists auth_email_codes_email_purpose_created_idx
  on public.auth_email_codes (email, purpose, created_at desc);

create index if not exists auth_email_codes_created_idx
  on public.auth_email_codes (created_at);

alter table public.auth_email_codes enable row level security;

revoke all on table public.auth_email_codes from public;
revoke all on table public.auth_email_codes from anon, authenticated;
grant select, insert, update, delete on table public.auth_email_codes to service_role;
