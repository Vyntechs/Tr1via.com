-- 0016_question_generation_reports_privileges.sql
--
-- Tighten table-level privileges for the AI generation report ledger.
-- RLS already blocks non-policy writes, but this keeps grants aligned with
-- the intended model: host clients can read through RLS; service-role writes.

set search_path = public, extensions;

revoke all on question_generation_reports from anon, authenticated;
grant select on question_generation_reports to authenticated;
grant all on question_generation_reports to service_role;
