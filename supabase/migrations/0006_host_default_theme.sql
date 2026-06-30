-- 0006_host_default_theme.sql — host-level theme preference.
--
-- Root cause of the "theme flips when I click Set up Wednesday" bug:
-- theme was stored only on the night row, with no concept of "what theme
-- does this host prefer." Non-night routes (dashboard, library, settings)
-- fall back to the layout default ('daylight' after PR #13). Per-night
-- routes use nights.theme_key — and EVERY existing night was created when
-- the default was 'house' (the prior layout default + DB column default),
-- so per-night routes still render in house. Inconsistency.
--
-- Fix: add the missing layer. `hosts.default_theme_key` is the host's
-- preferred theme — drives every non-overridden route. `nights.theme_key`
-- becomes an OPTIONAL override (Halloween night, season finale, etc.).
-- Resolution chain in code:
--   night.theme_key ?? host.default_theme_key ?? 'daylight'
--
-- This migration is SAFE / ADDITIVE:
--   - ADD COLUMN with default 'daylight' → every existing host row backfills
--     to 'daylight' automatically. No data loss.
--   - ALTER nights.theme_key DROP NOT NULL + DROP DEFAULT → existing rows
--     keep their value (still 'house' / whatever was set). New inserts can
--     omit it (will be null) and fall through to host preference.
--
-- The backfill that flips existing nights from 'house' → NULL (so they
-- inherit host preference) is a SEPARATE migration (0007). Brandon can
-- stage them: apply this one first, validate the preview, then optionally
-- run 0007 to clean up the first host's existing night.

set search_path = public, extensions;

-- Host's preferred theme. Drives the global default for every page the
-- host visits — dashboard, library, settings, AND per-night routes when
-- the night row leaves theme_key null.
alter table hosts
  add column default_theme_key text not null default 'daylight';

comment on column hosts.default_theme_key is
  'Host-level theme preference. Drives every host route by default; per-night `nights.theme_key` overrides this when set (special events).';

-- Per-night theme becomes OPTIONAL — null means "use host preference."
-- Existing rows are untouched; they keep whatever value was set at create
-- time. Migration 0007 backfills the historical 'house' default to null
-- so old nights also inherit host preference.
alter table nights
  alter column theme_key drop not null,
  alter column theme_key drop default;

comment on column nights.theme_key is
  'Optional per-night theme override. When null, the host''s default_theme_key is used. Set explicitly only for special-event themes (Halloween, season finale, etc).';
