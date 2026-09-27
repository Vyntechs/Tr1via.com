-- 20260927210000_auth_rate_events.sql
--
-- Abuse limits for the host sign-in doors (/api/auth/start, send-code,
-- verify-code, host-access, login). One row per counted event: a request
-- from an IP, or a wrong password for an email or from an IP. The server
-- counts recent rows per (bucket, key_hash) to decide "too many tries".
--
--   - key_hash is an HMAC-SHA256 of bucket + IP/email keyed by the server's
--     SESSION_SECRET, so the table never holds a plain IP or email.
--   - Rows older than a day are deleted by the server as it goes.
--   - If this table is missing (code deployed before this migration), the
--     server skips the limits rather than blocking sign-in.
--
-- Written and read ONLY by the server with the service-role key
-- (lib/auth/rate-limit-store.ts). RLS is on with NO policies, and
-- anon/authenticated have no grants, so the browser can never touch it.

set search_path = public, extensions;

create table if not exists public.auth_rate_events (
  id uuid primary key default gen_random_uuid(),
  bucket text not null check (length(bucket) between 1 and 64),
  key_hash text not null check (length(key_hash) between 1 and 128),
  created_at timestamptz not null default now()
);

comment on table public.auth_rate_events is
  'Hashed sign-in attempt counters for abuse limits. Service role only.';

create index if not exists auth_rate_events_bucket_key_created_idx
  on public.auth_rate_events (bucket, key_hash, created_at desc);

create index if not exists auth_rate_events_created_idx
  on public.auth_rate_events (created_at);

alter table public.auth_rate_events enable row level security;

revoke all on table public.auth_rate_events from public;
revoke all on table public.auth_rate_events from anon, authenticated;
grant select, insert, delete on table public.auth_rate_events to service_role;
