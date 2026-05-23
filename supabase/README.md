# Supabase setup (TR1VIA)

This directory holds the database schema (`migrations/`) and dev seed
data (`seed.sql`). The app talks to Supabase via the typed client in
`lib/supabase/{client,server,admin}.ts`.

## What Brandon needs to do (one time)

1. **Create a Supabase project** at [supabase.com](https://supabase.com/dashboard) (free tier is fine).
   - Project name: `tr1via` (or whatever)
   - Region: pick the one closest to your venues
   - Choose a strong database password and save it
2. **Get the keys.** In the project dashboard:
   - Settings → API → copy the `Project URL` and the `anon public` key
   - Settings → API → reveal + copy the `service_role` key (keep this secret — server-only)
3. **Put them in `.env.local`** (copy `.env.example` first):
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-REF.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi…
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi…
   ```
4. **Apply the schema.** Two options:
   - **Option A — Supabase CLI (recommended for ongoing dev):**
     ```bash
     brew install supabase/tap/supabase
     supabase link --project-ref YOUR-REF
     supabase db push   # applies migrations/*.sql in order
     npm run typegen    # regenerates lib/supabase/types.ts from the live schema
     ```
   - **Option B — SQL editor (one-shot):** open the dashboard SQL editor, paste each migration file in order (0001 → 0004), run each.
5. **Done.** The app should boot with `npm run dev`. Visit `http://localhost:3000`.

## What's in here

| File | What it does |
|---|---|
| `migrations/0001_init.sql` | Creates every table (hosts, nights, games, categories, questions, players, answers, reveals, adjustments, topic_suggestions, audience_topic_votes) + `game_scores` view + the `resolve_question(uuid)` stored procedure. |
| `migrations/0002_rls.sql` | Row-level security: hosts see their own data; players in a night see public game state; answers are write-only-by-self until question resolves. Uses an `x-tr1via-device` header for player identity. |
| `migrations/0003_realtime.sql` | Enables Postgres Changes broadcasts on the tables the app subscribes to. |
| `migrations/0004_storage.sql` | Creates the `question-images` public bucket for host-uploaded photos. |
| `seed.sql` | Optional dev seed: one host, one venue, one night with room code `DEMO42`, two games, six categories with seven real sample questions. Run after migrations. |

## Real-time channels the app uses

- **`room:{roomCode}`** (Broadcast channel) — host → all phones + TV for: `reveal`, `undo`, `end-early`, `resolve`. Carries the server timestamp so every device computes the same timer.
- **Postgres Changes on `players`** — TV roster + host live player list update as people join/leave.
- **Postgres Changes on `answers`** — TV lock-in pile fills as players submit.
- **Postgres Changes on `reveals`** — fallback consumer that survives a missed broadcast (Realtime can drop messages under load).

## When to NOT use the service-role client

The service-role client bypasses RLS. Only use it for:
- Resolving a question at T+20 (server-side, in a Server Action triggered by the first phone's timer-end or by host end-early)
- Background generation jobs writing 20 questions for a category
- Housekeeping cron (closing nights past their scheduled_at + 6 hours)

Player and host requests must use the cookie-bound `getSupabaseServer()` so RLS protects them.
