-- 0005_host_roles.sql — founder role + paywall comp flag.
--
-- Adds the platform-owner concept ('founder') and the ability for the
-- founder to comp a host past any future paywall. Audit fields capture
-- when the bypass was granted and by whom.
--
-- RLS is intentionally NOT updated here — the founder-only API routes
-- (/api/admin/*) use the service-role client and gate access in app
-- code via requireFounder(). Keeps the RLS file simple and ensures the
-- audit trail is written by a single, reviewed code path.
--
-- The partial unique index makes 'founder' a singleton: only one host
-- can hold that role at a time. Belt-and-braces against accidental
-- promotion via raw SQL.
--
-- Plan ref: docs/superpowers/plans/2026-05-23-tr1via.md (extended by
-- Brandon's 2026-05-23 founder/comp request).

set search_path = public, extensions;

alter table hosts
  add column role text not null default 'host'
    check (role in ('host', 'founder')),
  add column is_paywall_bypassed boolean not null default false,
  add column comped_at timestamptz,
  add column comped_by uuid references hosts(id) on delete set null;

create unique index hosts_single_founder_idx
  on hosts (role)
  where role = 'founder';

comment on column hosts.role is 'host (default) or founder (platform owner). Singleton enforced by hosts_single_founder_idx.';
comment on column hosts.is_paywall_bypassed is 'When true, this host is comped past any future paywall checks.';
comment on column hosts.comped_at is 'When is_paywall_bypassed was first flipped true.';
comment on column hosts.comped_by is 'The hosts.id of the founder who granted the bypass.';
