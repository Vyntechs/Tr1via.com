# Venue pressure-test kit — how to fake a full room

Three tools. Run them **together against one room**, with a real host driving, and you have a
venue-sized night on a laptop. Built 2026-07-28.

| tool | what it is | cost per player | use it for |
|---|---|---|---|
| `scripts/venue-load.mjs` | transport only — polls + heartbeats, never answers | ~0 | "does idle chatter collapse the server" |
| `scripts/venue-players.mjs` | **real participants** — join, opt in, real websocket, lock in, get scored | ~0 | volume, the lock-in burst, the promise metric |
| `scripts/venue-browsers.mjs` | **real Chromium** running the actual app | ~1 CPU core | rendering truth, paint latency, split-brain |

Every tool has a `--self-test` / `--self-check` that proves the tool itself before you trust a run.

---

## The recipe

```bash
# 0) local stack up, dev server up
open -a Docker && npx supabase start
TEST_AUTH_ENABLED=1 TEST_SECRET=local-test-secret MOCK_EXTERNAL=1 npm run dev

# 1) seed + open a night (or just use the room code from a real night you built)
#    → gives you NIGHT_ID and ROOM_CODE

# 2) fill the room — both at once, same room code
node scripts/venue-players.mjs  --base-url http://localhost:3000 \
     --night-id <NIGHT_ID> --code <ROOM> --players 24 --seconds 300
node scripts/venue-browsers.mjs --base-url http://localhost:3000 \
     --code <ROOM> --browsers 6 --seconds 300

# 3) host the night for real (browser, or drive the API). Reveal. Resolve.
# 4) read both reports
```

Point `--base-url` at a **Vercel preview** to test the real serverless runtime instead of localhost.
`venue-players` finds Supabase keys from args, env, or `.env.local`; `--no-realtime` drops to
poll-only.

⚠️ **`venue-players` writes real player rows and real answers.** Against production that means junk
players in a real night. Use your own test night, never a host's live show.

---

## What the reports tell you

**`ONE PRESS → EVERY PHONE`** — the product promise, measured. For each revealed question: how many
phones the realtime push actually reached, the latency to the first and last one, the spread between
them, and how many were **missed** entirely (fell back to polling). Missed > 0 fails the run.

**`EVERY PLAYER SAW THEIR RESULT`** — after resolve, did every player who answered actually receive a
verdict. This is the Game-2-blind class of bug, and it is invisible when you only watch one phone.
Any blind player fails the run.

**`QUESTION PAINTED ON SCREEN`** (browsers) — host press → *visible to a human*, including React
render and paint. Also asserts every browser painted the **same** question text (no split brain).

---

## Proven results (2026-07-28, local, 30 in one room)

- 24 lightweight + 6 real browsers, one room, one host.
- Lightweight: 24/24 joined, 24/24 realtime subscribed, 24/24 pushed the reveal, **3ms spread, 0
  missed**, 20 answered → 20 saw their verdict, **none blind**. 2364 requests, p95 53ms, 0 errors,
  0 frozen requests.
- Browsers: 6/6 joined, 6/6 painted the same question with a **265ms spread**, 6/6 rendered a verdict.
- Earlier 30-player lightweight run scored cleanly: all 30 ranked in `game_scores`, speed bonus
  correctly awarded to the 3.3s lock-in.

Caveat on that run: snapshot poll max hit 1323ms, up from 198ms without browsers — that is six
Chromiums competing for this laptop's CPU, not a server problem. Real phones have their own CPUs.
When mixing, read the *lightweight* latency numbers from a browser-free run.

---

## Gap status

**Closed**
- ✅ Answers — players lock in through the real answer contract (legacy *and* resilient engines).
- ✅ Scoring & standings — real `game_scores` rows, real speed bonus.
- ✅ Per-game opt-in — they follow the host through the intermission into Game 2.
- ✅ Realtime websockets — one real subscription per player, headless, no browser needed.
- ✅ Fan-out latency — the "one press, three surfaces" promise is now a number.
- ✅ Correctness at scale — every player verifies it got its own verdict.
- ✅ Browser rendering & paint latency — via `venue-browsers`.

**Still open**
- ❌ **Per-device networks.** All players share one machine and one connection. No venue WiFi
  congestion, no packet loss, no phones sleeping in a pocket, and **no reconnect stampede** — which
  matters, because we have a known unfixed bug there (first fetch has no jitter).
- ❌ **Host and TV surfaces under load.** Only players are simulated. The host does all the writes
  and the TV polls and subscribes too; neither carries simulated load.
- ❌ **Real hosted serverless at scale.** Everything above is localhost. Pointing at a Vercel preview
  is one flag away and is the obvious next step.
- ❌ **Accuracy realism.** Simulated players **guess** (~25% vs a real room's ~50%). This is
  deliberate: `correct_index` is withheld from phones until resolve and the harness refuses to go
  around it via the database. If it could answer correctly, that would be a security bug.
- ❌ **Mobile device characteristics** — CPU throttling, backgrounding, app-switch tracking.

---

## If we outgrow this

Nothing off the shelf plays TR1VIA — the game brain (device cookie → join → per-player scramble →
lock in) is ours no matter what tool runs it. But the *engine* is a solved problem:

- **[Artillery](https://www.artillery.io/docs/playwright)** has a Playwright engine and can run real
  browsers at scale across AWS ECS/Fargate — the way to get past ~10 browsers. Budget roughly one
  vCPU per browser.
- **[k6](https://grafana.com/oss/k6/)** is what Supabase themselves use for their
  [Realtime benchmarks](https://supabase.com/docs/guides/realtime/benchmarks), with published
  scripts — reach for it when the question is specifically "does the push layer hold."

Neither is needed at 30 players on one laptop, which is why this kit exists.
