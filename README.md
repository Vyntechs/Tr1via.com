# TR1VIA

Live trivia, designed to make the room feel alive.

This is the web app for **[tr1via.com](https://tr1via.com)** — a Jeopardy-style multiplayer trivia game run live at small venues. One host on a laptop (mirrored to a TV), a private host phone, and 20–40 players each on their own phone — one press, three synchronized surfaces, in realtime.

<p align="center">
  <img src="docs/screenshots/player-question/after-iphone-15-pro-max-image.png" alt="A live question on a player's phone" width="300">
</p>

**Live at [tr1via.com](https://tr1via.com).** My pride-and-joy project — real venues, real players, in production.

## How it's built

AI-directed, human-verified. I direct the agents; I own the judgment and the verification. The realtime sync model, the three-surface design (TV, host, player), and the call on what "done" means are mine — enforced in the code and the tests. The line-by-line authoring is paired with Claude, credited in the commit trailers. I don't claim I hand-wrote every line. I claim I know exactly why every line is there — and the multi-context Playwright tests that prove the TV, host, and player phones stay in sync are how I check it.

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

## What this is

The real production app behind tr1via.com, shared to show how I build — not a drop-in template. Still learning, still building; the deploy doc is a known gap, noted below. I'd rather show the limit than hide it.

## Deploy

Auto-deploys to Vercel preview on every push. Production is `tr1via.com`. See `docs/deploy.md` (forthcoming) for env vars + DNS.
