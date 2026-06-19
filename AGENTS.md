# tr1via — Agent Guide

Live, Jeopardy-style multiplayer trivia run at small venues. One host on a laptop (mirrored to a venue TV) + a private host phone, and 20-40 players each on their own phone. The product promise is "one press, three surfaces" — when the host taps Reveal, every phone and the TV update within ~250ms.

## Stack
- **Next.js 16** (App Router, Turbopack dev) + React 19 + TypeScript (strict)
- **Tailwind CSS v4** (`@tailwindcss/postcss`) + CSS custom properties for theme tokens
- **Supabase** — Postgres + Realtime + Auth + Storage (`@supabase/ssr`, `@supabase/supabase-js`)
- **Anthropic Claude API** (`@anthropic-ai/sdk`) for question generation + answer verification
- **Pexels** for auto-attached question photos
- **Stripe** for the "Trivia Nerd" host subscription
- **Vitest** (unit/component/integration) + **Playwright** (E2E)
- Deploy: **Vercel** (preview per push; prod = tr1via.com)

## Commands
Package manager is **npm** (`package-lock.json`). All scripts from `package.json`:
```bash
npm run dev          # next dev --turbopack (predev rebuilds theme via tsx lib/theme/__build__.ts)
npm run build        # prebuild rebuilds theme, then next build
npm start            # next start (prod server)
npm run lint         # next lint
npm test             # vitest run (unit + component + integration)
npm run test:watch   # vitest (watch)
npm run test:e2e     # playwright test (spins up dev server with test env)
npm run typegen      # supabase gen types typescript --local --schema public > lib/supabase/types.ts
```
Type-check (not a script, used in CI/verification): `npx tsc --noEmit`.

Local setup (from README): `supabase start` → `cp .env.example .env.local` (fill keys) → `supabase db reset` → `npm run typegen` → `npm run dev` (http://localhost:3000).

## Architecture

Three surfaces, one game. State lives in Postgres; live updates fan out two ways: **Realtime broadcast** (instant, fire-and-forget) for snappy UI, and **Postgres Changes** (durable) so a device that missed a broadcast recovers from the table.

### Route groups (`app/`)
- `(player)/` — anonymous player phone: `/join`, `/room/[code]` (+ `/recap`, `/won`). No Supabase Auth; identity = signed `tr1via_device` cookie.
- `(host)/` — host auth: `/login`, `/auth/onboarding-complete`.
- `(marketing)/` — public: `/trivia-night`, `/pricing`, `/themes`.
- `host/` — authed host surfaces: `setup/[nightId]` (topic → pick → manual), `live/[nightId]` (live console), `phone/[nightId]`, `onboarding`, `admin`. Gated by `middleware.ts`.
- `tv/[code]` — the venue TV display.
- `dev/` — internal preview harnesses (`/dev/tv`, `/dev/host`, `/dev/player`, `/dev/system`, layout-repro pages). Used to eyeball themes/weather without a live night.
- `api/` — Route Handlers (see below).

### API surface (`app/api/`)
- Game lifecycle: `games/[id]/{start,reveal,resolve(via questions),end,end-early,undo,locks}`, `questions/[id]/{resolve,photo,photos,route}`, `answers`, `adjustments`.
- Setup/content: `categories` (+ `[id]/{generate,manual,pick,reorder}`), `topic-suggestions`, `founder/build-game`, `images/upload`.
- Nights/room: `nights` (+ `[id]/{open,close,theme,reset-to-setup,players}`, `by-code/[code]`), `room/[code]/snapshot`, `tv/[code]/snapshot`, `players` (+ `[id]/{heartbeat,join-game}`).
- Auth/session: `session/init` (mints device cookie), `auth/{founder-login,host-access,logout}`, `admin/{hosts,grant-magic-link}`.
- Billing: `stripe/{checkout,portal,webhook}`.
- Test-only: `api/_test/{login,reset,seed-night,fast-forward}` — gated, see Gotchas.

### lib subsystems (`lib/`)
- `lib/supabase/` — `client.ts` (browser, RLS-on, sends `x-tr1via-device`), `server.ts` (SSR/Route Handler, RLS-on, forwards device cookie → header), `admin.ts` (service-role, **RLS bypassed, server-only**), `types.ts` (generated, do not hand-edit — run `npm run typegen`).
- `lib/ai/` — `generate-questions.ts`, `verify-answers.ts`, `collect-verified-questions.ts` (generate→verify→regenerate loop requiring agreement across passes), `auto-attach-photo.ts`, `prompts.ts`.
- `lib/api/` — `broadcast.ts` (Realtime REST broadcast), `auth.ts`, `entitlements.ts`, `internalFetch.ts`, `require-test-mode.ts`, `schemas.ts` (zod), `responses.ts`.
- `lib/hooks/` — client live-state: `useRoom.ts`, `useTVRoom.ts`, `useRoster.ts`, `useTimer.ts`, `useLockInSync.ts`, `useDeviceSession.ts`, connection/resilience hooks.
- `lib/realtime/` — venue-WiFi resilience: `channelHealth.ts`, `fetchWithRetry.ts`, `freshnessWatchdog.ts`, `reachability.ts`, `recoveryBackoff.ts`.
- `lib/game/` — pure logic: `score.ts`, `scramble.ts`, `timer.ts`, `difficulty.ts`, `room-code.ts`.
- `lib/host/` — board/pick/reroll orchestration + `roomToTVSnapshot.ts`.
- `lib/theme/` — 14 themed palettes + per-month weather; `__build__.ts` is the predev/prebuild theme codegen step. `lib/audio/`, `lib/player/`, `lib/tv/`, `lib/room/`, `lib/pexels/`, `lib/billing/stripe.ts`.

### Data flow (live game)
Host taps an action → Route Handler writes to Postgres (service-role `admin` client for trusted ops like resolve) → `lib/api/broadcast.ts` POSTs to Supabase Realtime REST `/realtime/v1/api/broadcast` (fire-and-forget, no channel round-trip) → player/TV clients subscribed via `supabase.channel("room:CODE")` update instantly. Durable fallback: row inserts (publication in `0003_realtime.sql`) let a late/disconnected device rebuild state from the `reveals`/snapshot tables.

## Key files
- `middleware.ts` — refreshes Supabase auth cookies on every request AND gates `/host` + the `(host)` group behind a signed-in user (anon → `/login?next=...`). Player routes deliberately untouched. `/login` renders even when authed (account-switch escape hatch).
- `instrumentation.ts` — boots MSW (Anthropic + Pexels mocks) inside the Next server **only when `MOCK_EXTERNAL=1`** (Node runtime only). No-op in prod.
- `lib/api/broadcast.ts` — the "one press, three surfaces" publisher.
- `lib/supabase/{server,client,admin}.ts` — three clients with different trust levels; pick deliberately.
- `playwright.config.ts` vs `playwright-prod.config.ts` — local E2E vs prod smoke.
- `supabase/migrations/` — 14 SQL migrations; schema source of truth.

## Environment
Copy `.env.example` → `.env.local`. Keys: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `PEXELS_API_KEY`, `SESSION_SECRET` (`openssl rand -base64 48`), `NEXT_PUBLIC_SITE_URL`, Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`). Test/mocks: `TEST_AUTH_ENABLED`, `TEST_SECRET`, `MOCK_EXTERNAL`, `ANTHROPIC_BASE_URL`, `PEXELS_BASE_URL` (orchestration-only — never set in prod).

LLM models (from `lib/ai/`): generation `DEFAULT_MODEL = "claude-sonnet-4-6"`; verification `VERIFIER_MODEL = "claude-opus-4-8"`.

## Testing
- **Unit/component/integration**: `npm test` (Vitest). Includes `tests/integration/**` real-Postgres tests via **pglite** (in-process WASM — no Docker/CLI). `@` aliases the repo root; `server-only` is stubbed under Vitest.
- **E2E (local)**: `npm run test:e2e` — `playwright.config.ts` runs `tests/e2e/`, `fullyParallel: false` (multi-context sync tests share one dev server), auto-starts `npm run dev` with `TEST_AUTH_ENABLED=1 TEST_SECRET=local-test-secret MOCK_EXTERNAL=1`.
- **E2E (prod smoke)**: `npx playwright test -c playwright-prod.config.ts` — hits `https://tr1via.com` (override `SMOKE_BASE_URL`), only `prod-ui-smoke.spec.ts`, no local server.
- `scripts/` holds prod validation + model-benchmark utilities (`.mjs`).

## Gotchas
- **Deploy/merge/migration/push-to-main are the founder's call only — PR-first, real users. Never deploy during a live Wednesday show** (per HANDOFF.md).
- `lib/supabase/admin.ts` bypasses RLS — **server-only, never import into a Client Component**. Use `server.ts`/`client.ts` (RLS-on) for anything client-facing.
- `lib/supabase/types.ts` is generated — change schema via a migration in `supabase/migrations/`, then `npm run typegen`. Do not hand-edit.
- Browser env vars must be referenced as literal `process.env.NEXT_PUBLIC_X` — dynamic `process.env[name]` lookups are NOT inlined by the bundler and come back `undefined` in the browser (see `lib/supabase/client.ts`).
- `api/_test/*` routes require BOTH `TEST_AUTH_ENABLED=1` and a matching `x-test-secret` header (== `TEST_SECRET`); missing either → 404 (deny existence). Never enabled in prod.
- `MOCK_EXTERNAL=1` is set only by the test orchestration — never set it locally or in CI by hand; it reroutes Anthropic/Pexels to MSW.
- Realtime uses the REST broadcast endpoint (not WebSocket `channel.send()`) because the subscribe round-trip costs ~1-1.5s from a serverless function — don't "simplify" it back.
- Current branch at handoff: `fix/rls-correct-index-leak` (commit-only, not pushed/merged). In-flight effort: "July pyrotechnics" 4-phase plan in `tasks/july-pyrotechnics-plan.md` — hard-gated, one phase per session; do not auto-advance phases.
- `npx tsc --noEmit` has 2 known pre-existing errors in `HostHomeClient-founder-build.test.tsx` (unrelated baseline noise per HANDOFF.md).
