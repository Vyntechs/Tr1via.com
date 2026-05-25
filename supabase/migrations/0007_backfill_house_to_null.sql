-- 0007_backfill_house_to_null.sql — clean up historical "house" defaults.
--
-- Every night created before migration 0006 was stamped with the DB column
-- default theme_key='house'. That default was set when the layout default
-- was also 'house', but PR #13 swapped the layout to 'daylight' and now
-- the per-night override conflicts with the host's preference.
--
-- This backfill treats the historical 'house' default as "no explicit
-- override" — sets theme_key to NULL for every existing 'house' row so
-- those nights now inherit the host's default_theme_key (which defaults
-- to 'daylight' per migration 0006).
--
-- SAFE / REVERSIBLE: if this turns out wrong (e.g. a host genuinely wanted
-- house for their existing nights), the reverse is:
--   UPDATE nights SET theme_key = 'house' WHERE theme_key IS NULL;
--
-- Brandon should apply this AFTER migration 0006 has been validated. Can
-- be deferred indefinitely — the new code (resolveTheme) handles both
-- pre-backfill (theme_key='house' wins, renders house) and post-backfill
-- (theme_key=null, falls through to host preference) gracefully.

set search_path = public, extensions;

update nights
  set theme_key = null
  where theme_key = 'house';
