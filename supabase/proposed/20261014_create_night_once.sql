-- PROPOSED, NOT APPLIED. Do not move into supabase/migrations/ without
-- Brandon's OK, and never on a show day.
--
-- One night per tap: a per-host lock plus get-or-create for POST /api/nights.
--
-- Why: on Oct 8 2026 Heather got two nights 1.07 seconds apart (14a0091e,
-- empty; 0993af1d, the one she built). The create route always inserted a
-- new night, and nothing in the database stopped a second one.
--
-- What this does: create_night_once(...) takes a transaction lock keyed on
-- the host, so two calls for the same host run one after the other. The
-- second call then finds the fresh empty night the first one made and
-- returns it (reused = true) instead of inserting a twin. A new night and
-- its two game shells are inserted in the same transaction, so a failure
-- can't leave a night with no games.
--
-- "Fresh empty night" = same host, created within p_reuse_window_seconds,
-- never opened/closed/run, same venue/theme/date as asked, both games still
-- draft and never started, no categories, no players. A night with anything
-- in it is never reused.
--
-- The app works with or without this function: until it exists the route
-- falls back to the same check in app code (lib/host/createNightOnce.ts).
-- The live show paths do not call it.

create or replace function public.create_night_once(
  p_host_id uuid,
  p_venue_name text,
  p_theme_key text,
  p_scheduled_at timestamptz,
  p_room_codes text[],
  p_reuse_window_seconds integer default 600
)
returns table (night_id uuid, room_code text, reused boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_night_id uuid;
  v_room_code text;
  v_code text;
  v_constraint text;
begin
  if p_host_id is null then
    raise exception 'create_night_once: host id is required';
  end if;
  if coalesce(array_length(p_room_codes, 1), 0) = 0 then
    raise exception 'create_night_once: at least one room code is required';
  end if;

  -- Serialize creates for this host only. Released at commit/rollback.
  perform pg_advisory_xact_lock(
    hashtextextended('tr1via:create_night:' || p_host_id::text, 0)
  );

  select n.id, n.room_code
    into v_night_id, v_room_code
    from nights n
   where n.host_id = p_host_id
     and n.opened_at is null
     and n.closed_at is null
     and n.current_run_id is null
     and n.created_at >= now() - make_interval(secs => greatest(p_reuse_window_seconds, 0))
     and n.venue_name = p_venue_name
     and n.theme_key is not distinct from p_theme_key
     and n.scheduled_at is not distinct from p_scheduled_at
     and (select count(*) from games g
           where g.night_id = n.id
             and g.state = 'draft'
             and g.started_at is null) = 2
     and not exists (select 1 from games g join categories c on c.game_id = g.id
                      where g.night_id = n.id)
     and not exists (select 1 from players p where p.night_id = n.id)
   order by n.created_at desc
   limit 1;

  if v_night_id is not null then
    return query select v_night_id, v_room_code, true;
    return;
  end if;

  foreach v_code in array p_room_codes loop
    begin
      insert into nights (host_id, venue_name, room_code, theme_key, scheduled_at)
      values (p_host_id, p_venue_name, v_code, p_theme_key, p_scheduled_at)
      returning id into v_night_id;

      insert into games (night_id, game_no) values (v_night_id, 1), (v_night_id, 2);

      return query select v_night_id, v_code, false;
      return;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      -- Only a room-code collision is retried with the next code.
      if v_constraint not in ('nights_room_code_key', 'nights_room_code_active_idx') then
        raise;
      end if;
    end;
  end loop;

  raise exception 'create_night_once: could not mint a unique room code';
end;
$$;

revoke all on function public.create_night_once(uuid, text, text, timestamptz, text[], integer)
  from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.create_night_once(uuid, text, text, timestamptz, text[], integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.create_night_once(uuid, text, text, timestamptz, text[], integer) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.create_night_once(uuid, text, text, timestamptz, text[], integer) to service_role;
  end if;
end;
$$;
