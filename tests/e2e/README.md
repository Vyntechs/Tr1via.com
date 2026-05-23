# TR1VIA end-to-end tests

These specs verify the multi-surface contract of the live game — they need
a real Supabase project to talk to (Realtime broadcast channels can't be
faked in a unit test, and the whole point of these specs is to confirm
"one host press → TV + every phone update within 250ms").

## Running

By default, the specs `test.skip()` if `SUPABASE_LIVE` is not `1`:

```bash
SUPABASE_LIVE=1 npm run test:e2e
```

You'll also need the following env vars set (same as `.env.local`):

| Var | What it is |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser-facing URL of the Supabase project. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key (RLS-on) for the same project. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key — only used server-side. |
| `SESSION_SECRET` | HMAC secret for the player device cookie. |

The Playwright config (`playwright.config.ts`) already starts `npm run dev`
as the `webServer`. Use a Supabase project you don't mind seeding (the
specs create + drop a night per run; they don't reach into other rows).

## Local Supabase

The fastest path is `supabase start` (per Phase 3 of the plan), which boots
a complete local stack on port 54321. Copy the printed URL + anon + service
keys into `.env.local`, run `npm run typegen`, then export
`SUPABASE_LIVE=1` and run these specs.

## What the specs assert

- `reveal-sync.spec.ts` — host + TV + 3 phones in five separate browser
  contexts. Validates the "one press, three surfaces" hot path: reveal
  arrival latency, per-phone scrambled answer ordering, T+20 resolve
  arrival latency, and the awarded-points math for fast/slow/wrong taps.
