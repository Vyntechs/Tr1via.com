# TR1VIA

Live trivia, designed to make the room feel alive.

This is the web app for **tr1via.com** — a Jeopardy-style multiplayer trivia game run live at small venues. One host on a laptop (mirrored to a TV) plus a private host phone, and 20–40 players each on their own phone.

> **Single source of truth — the rules:** `tr1via-plan.md`
> **Design package:** `tr1via/` directory in the design handoff bundle (HTML/JSX prototypes from Claude Design)
> **Build plan:** `docs/superpowers/plans/2026-05-23-tr1via.md`

## Stack

- **Next.js 16** + React 19 + TypeScript (App Router)
- **Tailwind CSS v4** + CSS custom properties for theme tokens
- **Supabase** (Postgres + Realtime + Auth + Storage)
- **Claude API** for question generation
- **Pexels** for auto-attached question photos
- **Vercel** for deploy (preview per PR)

## Run locally

```bash
# 1. Install deps
npm install

# 2. Start local Supabase
brew install supabase/tap/supabase   # one-time
supabase start                       # boots local Postgres + Realtime + Studio

# 3. Copy env, fill in keys
cp .env.example .env.local
# Get NEXT_PUBLIC_SUPABASE_URL + keys from `supabase status`
# Get ANTHROPIC_API_KEY + PEXELS_API_KEY from each provider
# Generate SESSION_SECRET: openssl rand -base64 48

# 4. Apply migrations + generate types
supabase db reset
npm run typegen

# 5. Run
npm run dev    # http://localhost:3000
```

## Project structure

```
app/                  Next.js routes (player + host + tv surfaces)
components/system/    Design-system atoms (TR1VIA wordmark, PointTag, AnswerCard, …)
components/player/    Player phone screens
components/tv/        Venue TV screens
components/host/      Host phone + laptop screens
lib/theme/            14 themed palettes + per-month weather
lib/game/             Pure game logic (scramble, score, timer, …)
lib/supabase/         DB clients (browser / server / admin)
lib/ai/               Claude API integration
supabase/migrations/  SQL schema
tests/                Vitest unit + Playwright E2E
```

## Tests

```bash
npm test               # unit tests (Vitest)
npm run test:e2e       # E2E (Playwright, including multi-context sync tests)
```

## Deploy

Auto-deploys to Vercel preview on every push. Production is `tr1via.com`. See `docs/deploy.md` (forthcoming) for env vars + DNS.
