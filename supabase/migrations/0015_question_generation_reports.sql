-- 0015_question_generation_reports.sql
--
-- Append-only quality/cost ledger for AI category generation.
--
-- SAFE / ADDITIVE:
--   - One new table, no rewrite of existing tables.
--   - Nullable foreign keys with ON DELETE SET NULL keep historical report
--     summaries without preventing category/night cleanup.
--   - RLS enabled. Hosts can read their own reports; players/anon cannot.
--   - Writes are server-only through the service-role admin client.

set search_path = public, extensions;

create table question_generation_reports (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references categories on delete set null,
  game_id uuid references games on delete set null,
  night_id uuid references nights on delete set null,
  host_id uuid references hosts on delete set null,
  category_name text,
  topic text not null,
  mode text not null default 'unknown'
    check (mode in ('initial', 'reroll', 'auto_build', 'unknown')),
  status text not null
    check (status in ('completed', 'partial', 'failed')),
  requested_count smallint not null check (requested_count >= 0),
  accepted_count smallint not null check (accepted_count >= 0),
  generated_count smallint not null check (generated_count >= 0),
  rejected_count smallint not null check (rejected_count >= 0),
  rounds smallint not null check (rounds >= 0),
  verify_passes smallint not null check (verify_passes >= 0),
  llm_calls integer not null default 0 check (llm_calls >= 0),
  tokens_in integer not null default 0 check (tokens_in >= 0),
  tokens_out integer not null default 0 check (tokens_out >= 0),
  estimated_cost_usd numeric(10,4) not null default 0 check (estimated_cost_usd >= 0),
  image_target_count smallint not null default 0 check (image_target_count >= 0),
  image_attached_count smallint not null default 0 check (image_attached_count >= 0),
  image_skipped_count smallint not null default 0 check (image_skipped_count >= 0),
  risk_flag_count integer not null default 0 check (risk_flag_count >= 0),
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index question_generation_reports_category_created_idx
  on question_generation_reports (category_id, created_at desc);

create index question_generation_reports_host_created_idx
  on question_generation_reports (host_id, created_at desc);

alter table question_generation_reports enable row level security;

create policy question_generation_reports_host_read
  on question_generation_reports
  for select
  using (
    exists (
      select 1
      from hosts h
      where h.id = question_generation_reports.host_id
        and h.user_id = auth.uid()
    )
  );

revoke all on question_generation_reports from anon;
grant select on question_generation_reports to authenticated;
grant all on question_generation_reports to service_role;

comment on table question_generation_reports is
  'Append-only AI generation quality/cost report. Written server-side; read by the owning host only.';
