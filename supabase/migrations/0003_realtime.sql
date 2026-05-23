-- 0003_realtime.sql — enable Postgres Changes broadcasts.
--
-- Tables that should fire INSERT/UPDATE/DELETE events into the
-- supabase_realtime publication, which the browser/phone clients
-- subscribe to.

alter publication supabase_realtime add table players;
alter publication supabase_realtime add table game_participations;
alter publication supabase_realtime add table answers;
alter publication supabase_realtime add table reveals;
alter publication supabase_realtime add table questions;
alter publication supabase_realtime add table categories;
alter publication supabase_realtime add table games;
alter publication supabase_realtime add table nights;
alter publication supabase_realtime add table adjustments;
