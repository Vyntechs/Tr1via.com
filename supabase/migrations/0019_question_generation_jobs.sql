-- 0019_question_generation_jobs.sql
--
-- Persist the host-visible state of an AI category build so navigation,
-- reconnects, and recoverable failures never erase the real progress.
--
-- SAFE / ADDITIVE:
--   - One new table; no existing rows are rewritten.
--   - Category deletion cascades to its transient job row.
--   - Owning hosts can read progress; only service-role server code writes.

set search_path = public, extensions;

create table question_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories on delete cascade,
  game_id uuid not null references games on delete cascade,
  night_id uuid not null references nights on delete cascade,
  host_id uuid not null references hosts on delete cascade,
  phase text not null default 'queued'
    check (phase in (
      'queued',
      'writing',
      'checking',
      'repairing',
      'images',
      'ready',
      'needs_attention'
    )),
  target_count smallint not null default 20
    check (target_count > 0),
  written_count smallint not null default 0
    check (written_count >= 0),
  certified_count smallint not null default 0
    check (certified_count >= 0 and certified_count <= target_count),
  image_count smallint not null default 0
    check (image_count >= 0 and image_count <= certified_count),
  attempt smallint not null default 1
    check (attempt > 0),
  last_error text,
  heartbeat_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id)
);

create index question_generation_jobs_host_updated_idx
  on question_generation_jobs (host_id, updated_at desc);

alter table question_generation_jobs enable row level security;

create policy question_generation_jobs_host_read
  on question_generation_jobs
  for select
  using (
    exists (
      select 1
      from hosts h
      where h.id = question_generation_jobs.host_id
        and h.user_id = auth.uid()
    )
  );

revoke all on question_generation_jobs from anon, authenticated;
grant select on question_generation_jobs to authenticated;
grant all on question_generation_jobs to service_role;

comment on table question_generation_jobs is
  'Current persisted progress for an AI category build. Server-written; owning host-readable.';
