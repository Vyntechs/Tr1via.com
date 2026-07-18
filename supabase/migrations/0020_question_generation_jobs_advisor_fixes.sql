-- 0020_question_generation_jobs_advisor_fixes.sql
--
-- Resolve the post-migration Supabase advisor findings for generation jobs.
-- This is additive except for replacing the equivalent host-read policy with
-- the recommended one-evaluation auth.uid() form.

set search_path = public, extensions;

create index question_generation_jobs_game_id_idx
  on question_generation_jobs (game_id);

create index question_generation_jobs_night_id_idx
  on question_generation_jobs (night_id);

drop policy question_generation_jobs_host_read
  on question_generation_jobs;

create policy question_generation_jobs_host_read
  on question_generation_jobs
  for select
  to authenticated
  using (
    exists (
      select 1
      from hosts h
      where h.id = question_generation_jobs.host_id
        and h.user_id = (select auth.uid())
    )
  );
