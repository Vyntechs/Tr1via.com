-- 0024_game_scores_answer_engine.sql
--
-- Keep the existing game_scores contract while selecting exactly one answer
-- source per night's immutable engine. Adjustments are aggregated separately
-- so they are applied once regardless of answer count, and participations stay
-- the driving rows so players with no answers remain visible at zero.

set search_path = public, extensions;

create or replace view public.game_scores as
with answer_facts as (
  select
    c.game_id,
    a.player_id,
    a.awarded_points,
    a.is_correct,
    a.ms_to_lock
  from public.answers a
  join public.questions q on q.id = a.question_id
  join public.categories c on c.id = q.category_id
  join public.games g on g.id = c.game_id
  join public.nights n on n.id = g.night_id
  where n.answer_engine = 'legacy'

  union all

  select
    qp.game_id,
    qpa.player_id,
    qpa.awarded_points,
    qpa.is_correct,
    qpa.ms_to_lock
  from public.question_play_answers qpa
  join public.question_plays qp on qp.id = qpa.play_id
  join public.nights n
    on n.id = qp.night_id
   and n.current_run_id = qp.run_id
  where n.answer_engine = 'resilient_v1'
    and qp.status = 'resolved'
),
answer_totals as (
  select
    game_id,
    player_id,
    coalesce(sum(awarded_points), 0) as awarded_points,
    count(*) filter (where is_correct) as correct_count,
    count(*) as answered_count,
    min(ms_to_lock) filter (where is_correct) as fastest_correct_ms
  from answer_facts
  group by game_id, player_id
),
adjustment_totals as (
  select game_id, player_id, sum(delta) as delta
  from public.adjustments
  group by game_id, player_id
)
select
  gp.game_id,
  p.id as player_id,
  p.display_name,
  coalesce(at.awarded_points, 0) + coalesce(ad.delta, 0) as score,
  coalesce(at.correct_count, 0) as correct_count,
  coalesce(at.answered_count, 0) as answered_count,
  at.fastest_correct_ms
from public.game_participations gp
join public.players p on p.id = gp.player_id
left join answer_totals at
  on at.game_id = gp.game_id
 and at.player_id = p.id
left join adjustment_totals ad
  on ad.game_id = gp.game_id
 and ad.player_id = p.id;
