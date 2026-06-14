-- 0013_game_scores_per_game_isolation.sql
--
-- Fix: game_scores double-counted answers across both games of a night.
--
-- The original view (0001_init.sql) joined answers only on player_id:
--
--     left join answers a    on a.player_id = p.id
--     left join questions q  on q.id = a.question_id
--     left join categories c on c.id = q.category_id and c.game_id = gp.game_id
--
-- The only game predicate (`c.game_id = gp.game_id`) lived in a LEFT JOIN's ON
-- clause, so an answer from the OTHER game merely NULLed the category columns —
-- it did NOT drop the answer row. Every answers aggregate (sum/count/min) reads
-- from `a`, so each per-game row summed BOTH games: a player in two games saw
-- their Game-1 points in their Game-2 leaderboard row and vice-versa. The
-- adjustments subquery was already correctly game-scoped — that asymmetry is
-- what made this a bug, not a design choice. (Lesson: view-leftjoin-filter-trap.)
--
-- Fix: scope every answers aggregate to the row's game with an aggregate FILTER.
-- We use FILTER, NOT a WHERE clause / inner join, on purpose: a WHERE would drop
-- players who joined a game but never answered, making them vanish from the
-- board instead of showing at 0. FILTER keeps every game_participations row and
-- only constrains which answers feed the totals. For an answer belonging to a
-- different game the categories LEFT JOIN leaves c.game_id NULL, so the predicate
-- `c.game_id = gp.game_id` is false and that answer is excluded.
--
-- `create or replace view` is instant — no lock, no backfill; reads recompute
-- correctly on next query. Scoring is independent per game (each game's board and
-- the finale use only that game's answers); there is no cumulative night total.

create or replace view game_scores as
  select
    gp.game_id,
    p.id as player_id,
    p.display_name,
    coalesce(sum(a.awarded_points) filter (where c.game_id = gp.game_id), 0)
      + coalesce(
          (select sum(adj.delta)
             from adjustments adj
            where adj.player_id = p.id
              and adj.game_id = gp.game_id), 0)
      as score,
    count(a.*) filter (where a.is_correct and c.game_id = gp.game_id) as correct_count,
    count(a.*) filter (where c.game_id = gp.game_id)                  as answered_count,
    min(a.ms_to_lock) filter (where a.is_correct and c.game_id = gp.game_id) as fastest_correct_ms
  from game_participations gp
  join players p on p.id = gp.player_id
  left join answers a on a.player_id = p.id
  left join questions q on q.id = a.question_id
  left join categories c on c.id = q.category_id and c.game_id = gp.game_id
  group by gp.game_id, p.id, p.display_name;
