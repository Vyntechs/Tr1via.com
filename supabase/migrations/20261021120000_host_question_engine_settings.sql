-- 20261021120000_host_question_engine_settings.sql
--
-- Per-host switch for the question builder: "classic" (today's builder) or
-- "new" (the next builder, still identical to classic until step 4 lands).
-- Copies the shape of host_answer_engine_settings (0022).
--
--   - No row means classic. The app also treats any read error, a missing
--     table, or an unknown value as classic, so this file can be applied
--     after the code ships (previews run against the live database, where
--     this table will not exist until it is applied by hand).
--   - Additive only: one new table, nothing existing is changed.
--   - Safe to run more than once.
--   - RLS on with NO policies; only service_role (the server) can read or
--     write it. Hosts never see or change it; the founder flips it from
--     /host/admin through PATCH /api/admin/hosts/[id].

create table if not exists public.host_question_engine_settings (
  host_id uuid primary key references public.hosts(id) on delete cascade,
  engine text not null default 'classic'
    check (engine in ('classic', 'new')),
  updated_at timestamptz not null default now()
);

alter table public.host_question_engine_settings enable row level security;

revoke all privileges on table public.host_question_engine_settings
from public, anon, authenticated;

grant all privileges on table public.host_question_engine_settings
to service_role;
