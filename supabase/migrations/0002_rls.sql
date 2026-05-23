-- 0002_rls.sql — Row-level security.
--
-- The principles, in plain English:
--   * Hosts can only see + edit their own hosts/nights/games/etc rows.
--   * Players in a night can see public game state for that night.
--   * Players can only insert/update their own player + answer rows.
--   * Answers are write-only-by-self until the question resolves; once
--     resolved, anyone in the night can see them (for the reveal screens).
--   * Topic suggestions are write-by-any-player, read-by-host only.
--
-- The player identity comes from a request header `x-tr1via-device`
-- carrying the device UUID. The server-side Supabase client (lib/supabase/
-- server.ts) sets this header on every player-facing request based on the
-- cookie; the helper function current_device_id() reads it via the
-- `request.headers` JSON setting.

set search_path = public, extensions;

-- ─── helpers ────────────────────────────────────────────────────────────

-- Returns the device_id from the x-tr1via-device request header, or NULL.
create or replace function current_device_id()
returns uuid
language sql
stable
as $$
  select nullif(
    current_setting('request.headers', true)::jsonb->>'x-tr1via-device',
    ''
  )::uuid;
$$;

-- Returns the current player_id in a given night for the calling device.
create or replace function current_player_id(p_night_id uuid)
returns uuid
language sql
stable
security definer
as $$
  select id from players
   where night_id = p_night_id
     and device_id = current_device_id()
   limit 1;
$$;

-- Returns true if the current auth.uid() owns the host of this night.
create or replace function is_night_host(p_night_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1 from nights n
    join hosts h on h.id = n.host_id
    where n.id = p_night_id and h.user_id = auth.uid()
  );
$$;

-- ─── enable RLS ─────────────────────────────────────────────────────────

alter table hosts                 enable row level security;
alter table venues                enable row level security;
alter table nights                enable row level security;
alter table games                 enable row level security;
alter table categories            enable row level security;
alter table questions             enable row level security;
alter table players               enable row level security;
alter table game_participations   enable row level security;
alter table answers               enable row level security;
alter table reveals               enable row level security;
alter table adjustments           enable row level security;
alter table topic_suggestions     enable row level security;
alter table audience_topic_votes  enable row level security;

-- ─── policies ───────────────────────────────────────────────────────────

-- hosts: only the owning auth user.
create policy hosts_self_read   on hosts for select using (user_id = auth.uid());
create policy hosts_self_insert on hosts for insert with check (user_id = auth.uid());
create policy hosts_self_update on hosts for update using (user_id = auth.uid());

-- venues: only the owning host.
create policy venues_owner on venues for all
  using (exists (select 1 from hosts h where h.id = venues.host_id and h.user_id = auth.uid()))
  with check (exists (select 1 from hosts h where h.id = venues.host_id and h.user_id = auth.uid()));

-- nights: host writes; player in that night can read.
create policy nights_host_all on nights for all
  using (exists (select 1 from hosts h where h.id = nights.host_id and h.user_id = auth.uid()))
  with check (exists (select 1 from hosts h where h.id = nights.host_id and h.user_id = auth.uid()));
create policy nights_player_read on nights for select
  using (current_player_id(id) is not null);
-- Anyone with the room code can read the public projection (just to look up
-- night_id by code). We expose a narrow view for join — see app code.

-- games: host writes; participants read.
create policy games_host_all on games for all
  using (is_night_host(games.night_id))
  with check (is_night_host(games.night_id));
create policy games_participant_read on games for select
  using (current_player_id(games.night_id) is not null);

-- categories: host writes; participants of the parent night read.
create policy categories_host_all on categories for all
  using (exists (select 1 from games g where g.id = categories.game_id and is_night_host(g.night_id)))
  with check (exists (select 1 from games g where g.id = categories.game_id and is_night_host(g.night_id)));
create policy categories_player_read on categories for select
  using (exists (select 1 from games g where g.id = categories.game_id
                   and current_player_id(g.night_id) is not null));

-- questions: host writes. Players can read only AFTER played_at — i.e.
-- the question is live or resolved. (We never want the prompt leaking
-- to players' phones, but the *existence* + correct_index + image_url
-- become readable once played. The phone JS only displays the options.)
create policy questions_host_all on questions for all
  using (exists (select 1 from categories c join games g on g.id = c.game_id
                  where c.id = questions.category_id and is_night_host(g.night_id)))
  with check (exists (select 1 from categories c join games g on g.id = c.game_id
                       where c.id = questions.category_id and is_night_host(g.night_id)));
create policy questions_player_read on questions for select
  using (
    played_at is not null
    and exists (select 1 from categories c join games g on g.id = c.game_id
                 where c.id = questions.category_id
                   and current_player_id(g.night_id) is not null)
  );

-- players: a row is readable by self or the host; writable by self on
-- insert/update of own row only; host can soft-remove via removed_at.
create policy players_self_select on players for select
  using (device_id = current_device_id() or is_night_host(night_id));
create policy players_self_insert on players for insert
  with check (device_id = current_device_id());
create policy players_self_update on players for update
  using (device_id = current_device_id());
create policy players_host_update on players for update
  using (is_night_host(night_id));

-- game_participations: self-insert; participants of the night read all.
create policy participations_self_insert on game_participations for insert
  with check (player_id = current_player_id(
    (select night_id from games where id = game_participations.game_id)
  ));
create policy participations_read on game_participations for select
  using (
    is_night_host((select night_id from games where id = game_participations.game_id))
    or current_player_id((select night_id from games where id = game_participations.game_id)) is not null
  );

-- answers: self-insert while question is live. Read self always; read
-- others only after question is resolved.
create policy answers_self_insert on answers for insert
  with check (
    player_id = current_player_id(
      (select g.night_id from games g
        join categories c on c.game_id = g.id
        join questions q on q.category_id = c.id
       where q.id = answers.question_id)
    )
    and exists (select 1 from questions q where q.id = answers.question_id
                  and q.played_at is not null and q.finished_at is null)
  );
create policy answers_self_select on answers for select
  using (player_id = current_player_id(
    (select g.night_id from games g
      join categories c on c.game_id = g.id
      join questions q on q.category_id = c.id
     where q.id = answers.question_id)
  ));
create policy answers_post_resolve_read on answers for select
  using (exists (select 1 from questions q where q.id = answers.question_id and q.finished_at is not null));
create policy answers_host_all on answers for all
  using (exists (select 1 from questions q
                  join categories c on c.id = q.category_id
                  join games g on g.id = c.game_id
                 where q.id = answers.question_id and is_night_host(g.night_id)));

-- reveals: host writes; participants + host read.
create policy reveals_host_insert on reveals for insert
  with check (is_night_host((select night_id from games where id = reveals.game_id)));
create policy reveals_read on reveals for select
  using (
    is_night_host((select night_id from games where id = reveals.game_id))
    or current_player_id((select night_id from games where id = reveals.game_id)) is not null
  );

-- adjustments: host only.
create policy adjustments_host_all on adjustments for all
  using (is_night_host((select night_id from games where id = adjustments.game_id)))
  with check (is_night_host((select night_id from games where id = adjustments.game_id)));

-- topic_suggestions: any player inserts; host reads aggregated.
create policy suggestions_player_insert on topic_suggestions for insert
  with check (player_id is not null);
create policy suggestions_host_read on topic_suggestions for select
  using (exists (
    select 1 from players p join nights n on n.id = p.night_id
    where p.id = topic_suggestions.player_id and is_night_host(n.id)
  ));

-- audience_topic_votes: night participants insert + read.
create policy votes_player_all on audience_topic_votes for all
  using (current_player_id(night_id) is not null)
  with check (current_player_id(night_id) is not null);
