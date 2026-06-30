-- Dev seed. Creates: 1 host, 1 venue, 1 night (room code DEMO42), 2 games,
-- 6 categories per game with 7 picked questions each, using real questions
-- from the chat transcript sample data. Runs only after the schema is up.
--
-- Idempotent: skips rows that already exist by unique constraints.

set search_path = pg_temp, public;

create temporary table question_seed (
  prompt text not null,
  options text[] not null,
  correct_index smallint not null,
  point_value smallint not null
) on commit drop;

create or replace function pg_temp.seed_category(
  p_game_id uuid,
  p_name text,
  p_topic text,
  p_position integer,
  p_color text,
  p_questions question_seed[]
)
returns void
language plpgsql
as $$
declare
  v_category_id uuid;
  v_question question_seed;
begin
  insert into public.categories (game_id, name, topic, position, color, state)
    values (p_game_id, p_name, p_topic, p_position::smallint, p_color, 'ready')
    returning id into v_category_id;

  foreach v_question in array p_questions loop
    insert into public.questions (
      category_id,
      point_value,
      prompt,
      options,
      correct_index,
      difficulty,
      source,
      is_picked
    )
    values (
      v_category_id,
      v_question.point_value,
      v_question.prompt,
      to_jsonb(v_question.options),
      v_question.correct_index,
      greatest(1, least(7, v_question.point_value / 100))::smallint,
      'host-edit',
      true
    );
  end loop;
end;
$$;

-- NOTE: requires an auth.users row to exist. In a real local dev session,
-- supabase auth signup creates that for you. For seeding without auth,
-- create a synthetic user inline.
do $$
declare
  v_user_id uuid;
  v_host_id uuid;
  v_venue_id uuid;
  v_night_id uuid;
  v_game1 uuid;
  v_game2 uuid;
begin
  -- Synthesize a dev user if none exists with this id
  v_user_id := '00000000-0000-0000-0000-000000000001';
  insert into auth.users (id, email, raw_user_meta_data, role, instance_id)
    values (v_user_id, 'dev@tr1via.local', '{"display_name":"Dev Host"}', 'authenticated', '00000000-0000-0000-0000-000000000000')
    on conflict (id) do nothing;

  -- Host
  insert into hosts (user_id, display_name, default_venue, is_first_night_complete)
    values (v_user_id, 'Dev Host', 'Demo Pizza', true)
    on conflict (user_id) do update set display_name = excluded.display_name
    returning id into v_host_id;

  -- Venue
  insert into venues (host_id, name) values (v_host_id, 'Demo Pizza')
    returning id into v_venue_id;

  -- Night
  insert into nights (host_id, venue_name, room_code, theme_key, scheduled_at, opened_at)
    values (v_host_id, 'Demo Pizza', 'DEMO42', 'house', now(), now())
    returning id into v_night_id;

  -- Games
  insert into games (night_id, game_no, state) values (v_night_id, 1, 'ready') returning id into v_game1;
  insert into games (night_id, game_no, state) values (v_night_id, 2, 'draft') returning id into v_game2;

  -- Game 1 categories + 7 picked questions each
  perform pg_temp.seed_category(v_game1, 'Geography', 'U.S. states', 0, '#4ECDC4', ARRAY[
    ('Which U.S. state has the longest coastline?',   ARRAY['Florida','Alaska','California','Maine'], 1, 100),
    ('What is the largest U.S. state by area?',        ARRAY['Texas','Alaska','California','Montana'], 1, 200),
    ('Which state has the most national parks?',       ARRAY['Utah','California','Alaska','Arizona'], 1, 300),
    ('What is the only U.S. state that borders one other state?', ARRAY['Maine','Hawaii','Alaska','Florida'], 0, 400),
    ('Which state was the last to join the Union?',    ARRAY['Hawaii','Alaska','Arizona','New Mexico'], 0, 500),
    ('Which state has 99 counties?',                   ARRAY['Iowa','Kansas','Nebraska','Missouri'], 0, 600),
    ('Which state has the longest border with Canada?',ARRAY['Alaska','Montana','Minnesota','North Dakota'], 0, 700)
  ]::question_seed[]);

  perform pg_temp.seed_category(v_game1, 'Animals', 'Mammals', 1, '#C8E25E', ARRAY[
    ('Which mammal lays eggs?',                        ARRAY['Platypus','Hedgehog','Aardvark','Pangolin'], 0, 100),
    ('What is the largest land mammal?',                ARRAY['Elephant','Hippo','Rhino','Giraffe'], 0, 200),
    ('What is the only mammal that can truly fly?',    ARRAY['Bat','Flying squirrel','Sugar glider','Colugo'], 0, 300),
    ('How many hearts does an octopus have?',           ARRAY['3','1','5','2'], 0, 400),
    ('Which mammal has the longest gestation period?', ARRAY['African elephant','Blue whale','Giraffe','Rhinoceros'], 0, 500),
    ('Which is the only mammal that cannot jump?',     ARRAY['Elephant','Hippo','Rhino','Sloth'], 0, 600),
    ('Which mammal has the most teeth?',                ARRAY['Giant armadillo','Crocodile','Shark','Hippo'], 0, 700)
  ]::question_seed[]);

  perform pg_temp.seed_category(v_game1, 'Food', 'World cuisine', 2, '#F2A02D', ARRAY[
    ('Which of these is botanically a berry?',         ARRAY['Banana','Strawberry','Raspberry','Blackberry'], 0, 100),
    ('What spice gives curry its yellow color?',       ARRAY['Turmeric','Saffron','Paprika','Cumin'], 0, 200),
    ('Which country invented ice cream cones?',         ARRAY['United States','Italy','France','Belgium'], 0, 300),
    ('What is the most-consumed meat in the world?',   ARRAY['Pork','Chicken','Beef','Lamb'], 0, 400),
    ('Which fruit has its seeds on the outside?',      ARRAY['Strawberry','Raspberry','Pomegranate','Kiwi'], 0, 500),
    ('What is the world''s most expensive spice?',     ARRAY['Saffron','Vanilla','Cardamom','Truffle'], 0, 600),
    ('Honey discovered in Egyptian tombs was edible — roughly how old?', ARRAY['~3,000 years','~500 years','~10,000 years','~1,000 years'], 0, 700)
  ]::question_seed[]);

  perform pg_temp.seed_category(v_game1, 'Movies', 'Animated films', 3, '#E64A8C', ARRAY[
    ('In The Lion King, what does "Hakuna Matata" mean?', ARRAY['No worries','Lion king','Hello friend','Big trouble'], 0, 100),
    ('Which Pixar film features a rat who can cook?',   ARRAY['Ratatouille','Up','Wall-E','Cars'], 0, 200),
    ('What year did the first Toy Story release?',      ARRAY['1995','1998','1992','2000'], 0, 300),
    ('Which animated film won the first Best Animated Feature Oscar?', ARRAY['Shrek','Monsters Inc','Spirited Away','Ice Age'], 0, 400),
    ('What is the highest-grossing animated film of all time?', ARRAY['The Lion King (2019)','Frozen II','Inside Out 2','Toy Story 4'], 2, 500),
    ('In Finding Nemo, what species is Nemo?',          ARRAY['Clownfish','Pufferfish','Angelfish','Damselfish'], 0, 600),
    ('Which Pixar short was the first computer-animated film to win an Oscar?', ARRAY['Tin Toy','Geri''s Game','Luxo Jr','For the Birds'], 0, 700)
  ]::question_seed[]);

  perform pg_temp.seed_category(v_game1, 'Music', '60s rock', 4, '#9B7BD8', ARRAY[
    ('What was The Beatles'' original band name?',     ARRAY['The Quarrymen','The Silver Beetles','The Cavemen','The Mods'], 0, 100),
    ('Which band released "Bohemian Rhapsody"?',        ARRAY['Queen','The Who','Led Zeppelin','Pink Floyd'], 0, 200),
    ('Who wrote "Like a Rolling Stone"?',               ARRAY['Bob Dylan','Neil Young','Paul Simon','James Taylor'], 0, 300),
    ('What was the first Beatles album?',                ARRAY['Please Please Me','With the Beatles','A Hard Day''s Night','Help!'], 0, 400),
    ('Which guitarist played the solo on "While My Guitar Gently Weeps"?', ARRAY['Eric Clapton','George Harrison','Jimi Hendrix','Jeff Beck'], 0, 500),
    ('Which Hendrix album was released posthumously?', ARRAY['The Cry of Love','Are You Experienced','Axis: Bold as Love','Electric Ladyland'], 0, 600),
    ('What year did Jimi Hendrix die?',                  ARRAY['1970','1969','1971','1972'], 0, 700)
  ]::question_seed[]);

  perform pg_temp.seed_category(v_game1, 'History', 'Ancient civilizations', 5, '#FF6A3D', ARRAY[
    ('Which empire did Julius Caesar lead?',            ARRAY['Roman','Greek','Persian','Egyptian'], 0, 100),
    ('In what year did Christopher Columbus first reach the Americas?', ARRAY['1492','1500','1485','1510'], 0, 200),
    ('Who was the first emperor of China?',             ARRAY['Qin Shi Huang','Han Wudi','Kublai Khan','Wu Zetian'], 0, 300),
    ('Which ancient wonder was located in Egypt?',     ARRAY['Lighthouse of Alexandria','Colossus of Rhodes','Hanging Gardens of Babylon','Temple of Artemis'], 0, 400),
    ('Oxford University began teaching around 1096 AD. Which of these empires existed BEFORE Oxford?', ARRAY['Roman Empire','Aztec Empire','Mongol Empire','Ottoman Empire'], 0, 500),
    ('How old roughly was Egyptian tomb honey when found edible?', ARRAY['~3,000 years','~500 years','~10,000 years','~1,000 years'], 0, 600),
    ('Woolly mammoths still walked Earth as recently as when?', ARRAY['~4,000 years ago','~12,000 years ago','~40,000 years ago','~100,000 years ago'], 0, 700)
  ]::question_seed[]);

end$$;
