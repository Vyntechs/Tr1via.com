-- 0014_questions_withhold_correct_index_from_players.sql
--
-- Close the anti-cheat leak: a joined player must never be able to read the
-- answer (questions.correct_index) for a LIVE question.
--
-- The bug: questions_player_read (0002_rls.sql) lets a player SELECT the
-- questions row as soon as `played_at` is set (the question goes live). RLS is
-- ROW-level / column-blind, so that row carries correct_index — readable the
-- instant the host hits Reveal, for the whole answer window, via a hand-written
-- anon query or the realtime feed. The app's PLAYER_QUESTION_COLUMNS allowlist
-- (lib/hooks/useRoom.ts) only hides it in the UI; the database handed it over.
--
-- The fix is column-level: the player role (`anon`) loses SELECT on the
-- correct_index column specifically, while keeping every other column. Postgres
-- can't subtract one column from a relation-wide grant, so we drop the
-- table-level SELECT and re-grant SELECT on the safe columns only. The host
-- (`authenticated`, via questions_host_all) and the server (`service_role`,
-- which bypasses RLS) are untouched, so the first host's console and all server routes
-- still read the answer. Players receive the answer ONLY after resolve, through
-- server-side paths (the resolve broadcast hint + the admin /room snapshot,
-- which already withholds correct_index until finished_at).
--
-- Row-level visibility is deliberately left as-is (gated on played_at): players
-- still read the live question's PROMPT/OPTIONS to answer — that path is
-- unchanged. Only the answer column moves out of their reach.
--
-- NOTE (maintenance): this is an explicit column allowlist. A future column
-- added to `questions` will NOT be readable by players until it is added here.
-- That fail-closed default is intended for a table that holds the answer.
--
-- Instant, no table rewrite, no backfill, no lock beyond the brief catalog
-- update, and reversible (re-grant table-level SELECT to restore old behavior).

revoke select on questions from anon;

grant select (
  id,
  category_id,
  point_value,
  prompt,
  options,
  image_url,
  image_attribution,
  image_source,
  difficulty,
  source,
  is_picked,
  fact_blurb,
  played_at,
  finished_at
) on questions to anon;
