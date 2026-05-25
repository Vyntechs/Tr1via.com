# TR1VIA — Handoff (session 7, mid-investigation, written to ~ because /Volumes/Creativity unmounted)

**When you can: copy this file into the repo as `HANDOFF.md`, commit, push to the `p0-32-33-tv-fullscreen-end-game` branch. Then next session reads it from the canonical location.**

**Read order in the next session:** this → `MEMORY.md` (auto-memory) → `tr1via-plan.md` (rules) → `docs/superpowers/plans/2026-05-23-tr1via.md` (build plan) → `supabase/README.md` (DB) → `README.md` (run). Prior handoff is preserved in git history at `1f05685` (end of session 6).

---

## Critical context

**Wednesday 2026-05-27 is the real go-live.** the first host (`host@example.com`) opens it that night to host actual trivia at her venue. NOT a demo — paying patrons. ~3 days from this handoff (Sun 2026-05-24 evening).

**Session 7 hit a stop-hook + a filesystem unmount mid-investigation of a NEW P0 bug. Session must restart cold.** Two threads are in flight:

1. **PR #3 (TV-fullscreen layout + End Game CTA) is shipped + awaiting Brandon's eyeball check.** Code is good — pre-validated via 206 unit tests, all 4 e2e specs, full-flow driver against prod. Vercel preview deploy URL is on the PR.

2. **A new bug surfaced when Brandon tried to generate questions as a host:** the pick page hangs on the "pulling questions" spinner indefinitely. He walked away from the tab for a moment; refresh did not fix it. Investigation was systematic (via the `superpowers:systematic-debugging` skill) and reached the end of Phase 1.B before the stop-hook hit. The evidence already collected (below) **changes the initial hypothesis** — don't redo it from scratch.

---

## Thread 1: PR #3 — TV-fullscreen + End Game

**URL:** https://github.com/Vyntechs/Tr1via.com/pull/3
**Branch:** `p0-32-33-tv-fullscreen-end-game`
**Status:** Mergeable. Vercel preview deploying. Awaiting Brandon's eyeball check.

**What it changes:**
- TV state machine fills the host laptop viewport (no more 30% black bars / clipping — P0.32).
- Host taps cells directly on the same TVGrid the audience watches.
- "End Game →" button surfaces when the board is exhausted (P0.33).
- Bottom control strip changes per state. Players list + QR moved behind a "Players" button.

**What Brandon needs to do:** pull up the preview deploy, play one game with one phone, confirm:
1. TV fills the screen.
2. Cell taps work on the TV grid (no separate board).
3. "End Game →" appears when the board's empty.
4. "Players (N)" button opens the sheet.
5. "Pick next →" appears during reveal.

**Pre-validated:**
- 206/206 unit + component tests pass (added 14 for `deriveHostMode`).
- TypeScript clean.
- All 4 Playwright e2e specs green (including the rewritten `auto-start-on-reveal.spec.ts` for the new lobby → Start → cell flow).
- `scripts/full-flow-prod.mjs` against prod: green at 81s.

---

## Thread 2: Gen-stuck bug — Phase 1 evidence (do NOT redo)

### What Brandon hit

He tried to generate questions on the host setup pick page. The page sat on the "Pulling questions · TOPIC" spinner indefinitely. He walked away briefly. Returned: still spinning. Refreshed: still spinning. His exact words: *"It's still sitting there thinking it's loading, generating questions."*

### The investigation flow used (next session continues from here)

Use the `superpowers:systematic-debugging` skill. Iron Law: **NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.** Symptom patches are failure. Brandon was explicit: *"I don't want an immediate unlock. I want the root cause. Explored, researched, planned, corrected, validated. I want it ran through the toolkit."*

**Phase 1 (evidence gathering) — partial, finished below:**

- ✅ **1.A — query Supabase for Brandon's stuck categories.** Done via Supabase MCP. **Surprise finding:** they're all in state `'draft'`, NOT `'generating'`. Three rows, all `q_count = 0`. See "Evidence" below.
- ✅ **1.B — inspect questions tables for those categories.** All zero. Generation never inserted any rows for these categories.
- ❌ **1.C — pull Vercel function logs for `/api/categories/[id]/generate` around the time each stuck category was created.** Not done yet. This is the next concrete action.
- ❌ **1.D — pinpoint failing component boundary** (Anthropic? Insert? after() crash? Vercel function timeout? Bad topic?). Depends on 1.C.

**Phase 2 (pattern analysis), 3 (hypothesis), 4 (TDD fix) — not started.**

### Evidence collected (Supabase, project `citweuctcnuxmqjxcbiz` = "Trivia")

Query used:
```sql
SELECT c.id, c.name, c.topic, c.state, c.position, c.flavor::text, c.created_at,
       EXTRACT(EPOCH FROM (now() - c.created_at))::int AS age_sec,
       (SELECT count(*) FROM questions q WHERE q.category_id = c.id) AS q_count,
       (SELECT count(*) FROM questions q WHERE q.category_id = c.id AND q.image_url IS NOT NULL) AS q_with_photo,
       (SELECT count(*) FROM questions q WHERE q.category_id = c.id AND q.is_picked) AS q_picked,
       n.venue_name, n.room_code, u.email, g.game_no
FROM categories c
JOIN games g ON g.id = c.game_id
JOIN nights n ON n.id = g.night_id
JOIN hosts h ON h.id = n.host_id
JOIN auth.users u ON u.id = h.user_id
WHERE c.state IN ('generating','draft','review')
ORDER BY c.created_at DESC
LIMIT 30;
```

Result (all 3 rows belong to `brandon@vyntechs.com`):

| id | topic | state | created_at (UTC) | age_sec | q_count | flavor | night |
|---|---|---|---|---|---|---|---|
| `8e0fbffd-8bf6-4545-91fc-95b3da339581` | Beatles | **draft** | 2026-05-24 23:30:38 | 674 (~11min) | **0** | `{"difficulty":"normal"}` | Soul Fire Pizza · V79NYP · g1 |
| `ba3d2500-e244-4a14-865f-ec226fcec127` | Space | **draft** | 2026-05-24 22:13:03 | 5328 (~89min) | **0** | `{"difficulty":"normal"}` | Soul Fire Pizza · ZYS7WT · g1 |
| `7103dbe2-6914-4058-a0de-ddb05970dbbe` | Greek Mythology | **draft** | 2026-05-24 18:51:49 | 17403 (~4.8h) | **0** | `{"difficulty":"normal"}` | Soul Fire Pizza · 7QAZC6 · g1 |

The most recent one (Beatles, ~11 min old at the time of query) is almost certainly what Brandon was sitting on. Note: the table schema for `categories` has NO `updated_at` column, only `created_at` — so there's no DB-level record of when state was changed.

### What this evidence rules out + rules in

**Ruled out:**
- ❌ "Generation job died mid-flight after inserting some questions" — would leave `q_count > 0`. All three have zero.
- ❌ "Category state stuck in `'generating'`" — DB says `'draft'`.
- ❌ "Browser tab throttling caused missed broadcasts" — wouldn't explain the DB state.

**Ruled in (hypotheses to test in Phase 1.C):**

1. **`generateQuestions` (Claude call) returned zero valid questions or threw.** The route's catch block at `app/api/categories/[id]/generate/route.ts:94` rolls state back to `'draft'` and broadcasts `error`. If this is what happened, the host's open tab should have received the `error` broadcast → `setGenerationFailureMessage` → show the failure UI with retry / manual entry buttons. But the host sees the loading screen, not the failure UI. So either:
   - the `error` broadcast didn't land at the client (Realtime hiccup, channel not subscribed in time), AND
   - the polling fallback in `useGenerationStatus` didn't catch it.
   - The polling fallback DOES detect `dbState === 'draft'` → returns `{ kind: 'rolled-back' }`. The parent's useEffect at `HostSetupPickClient.tsx:188` reacts to `rolled-back` by setting `generationFailureMessage` and `state='draft'`. So if polling ran, the failure UI WOULD appear. So either polling didn't run yet, or there's a state-update bug.

2. **The after() job crashed before the synchronous portion finished setting `state='generating'`.** In that case state would never leave its initial value (which is whatever it was — likely `'draft'` post-creation). ⚠️ The route sets `state='generating'` synchronously BEFORE returning the 202, so if this were the cause, the category would still be in `'draft'` from creation, but the host's pick page wouldn't have routed there at all (the topic-page POST wouldn't have completed). Doesn't fully fit. Worth verifying by checking whether the synchronous update actually committed.

3. **Some other path resets state to `'draft'`.** Worth grepping the codebase for every place that writes `state: 'draft'` to the categories table. Currently 2 known places: the catch block and inside `runGenerationJob`'s helper. Could be a third somewhere.

4. **The Anthropic call OR Pexels call hung past the function's `maxDuration: 120s`.** Vercel would kill the function. If the kill happened AFTER the catch block had already set state='draft' but BEFORE the broadcast landed, you'd see exactly this state (draft in DB, no client broadcast). The catch is `await runGenerationJob(...).catch(async (err) => { ... await admin.update({state:'draft'}); await broadcastToCategory(..., 'error', ...); })` — those two awaits are sequential. The update could finish, then the broadcast call gets killed mid-flight when the function is shut down. ⚠️ **This is the most plausible hypothesis given the evidence.**

**The next concrete action (Phase 1.C):** Pull Vercel function logs filtered to the Beatles category's creation window (≈ `2026-05-24 23:30:38 UTC`) and look for the `[generate]` log lines. Use:

```
mcp__claude_ai_Vercel__get_runtime_logs   (project: tr1via)
   - filter by time window: 2026-05-24 23:30:00 to 23:33:00 UTC
   - look for: POST /api/categories/8e0fbffd-8bf6-4545-91fc-95b3da339581/generate
   - look for: "[generate] job failed:" log line from the route's catch
   - look for: function timeout / cold-stop messages
   - look for: any error from the generateQuestions or autoAttachPhoto modules
```

Then do the same for the Space and Greek Mythology categories. If all 3 share the same failure mode, that's the root cause. If they differ, it's environment-dependent.

### Tools available next session

- **Supabase MCP** (already loaded):
  - `mcp__plugin_supabase_supabase__execute_sql` — project id `citweuctcnuxmqjxcbiz`
  - `mcp__plugin_supabase_supabase__get_logs` — service options: api, postgres, edge-function, realtime, etc.
- **Vercel MCP** (already loaded):
  - `mcp__claude_ai_Vercel__get_runtime_logs`
  - `mcp__claude_ai_Vercel__list_deployments`
- **Code paths already mapped:**
  - `app/api/categories/[id]/generate/route.ts` (catch block at line ~94 rolls back to draft; `maxDuration: 120` at line 40).
  - `lib/ai/generate-questions.ts` (Claude wrapper).
  - `lib/ai/auto-attach-photo.ts` (Pexels wrapper).
  - `lib/hooks/useGenerationStatus.ts` (client-side polling fallback — only fires timeout if `loadedCount === 0`).
  - `app/host/setup/[nightId]/pick/[categoryId]/HostSetupPickClient.tsx` (renders loading vs error vs pick).

### What NOT to do next session

- ❌ Don't patch around the symptom. Brandon was explicit: he wants the bug investigated, not unblocked.
- ❌ Don't ship `useVisibilityResume` / "drop the `loadedCount === 0` guard" fixes until root cause is confirmed. Those WERE the fixes I was about to propose; Brandon redirected to "run it through the toolkit." Phase 1 isn't done yet.
- ❌ Don't recreate Phase 1.A or 1.B. The Supabase query above already gave the answer. Save tokens, build from it.
- ❌ Don't query for the user-specific stuck categories with `WHERE h.email='...'` directly on the `hosts` table — the email lives on `auth.users`, joined via `h.user_id`. The working query is above.

---

## Resilience audit Brandon asked for

Brandon's question: "What other cases can we just have issues?" The audit was started but is gated on completing the systematic-debugging investigation above. Surfacing the list so it's not lost; prioritization will firm up once root cause is named.

| # | Failure | Likelihood Wed | What happens today |
|---|---------|----|----|
| **A** | **Gen flow leaves category in unrecoverable state** | ⚠️ HIGH (Brandon hit it 3x today) | TBD — see investigation above. |
| **B** | **Host tab backgrounded during gen** | ⚠️ HIGH | Realtime broadcasts missed; client polling fallback only catches `loadedCount === 0` case. |
| **C** | **Live-game tab backgrounded** | ⚠️ HIGH | `useRoom` has no visibility-resume re-fetch; state can desync from prod. TV (`useTVRoom`) has 4s self-heal — laptop doesn't. |
| **D** | **Pexels rate-limited mid-batch** | MED | Handled (loop breaks, generation still completes); host sees some questions without images. Acceptable. |
| **E** | **Host network drops during /reveal or /end** | MED | Toast error. Idempotency check exists for /start; needs verification for /reveal. |
| **F** | **Realtime WebSocket dies + reconnects** | MED | Supabase SDK auto-reconnects, but broadcasts sent during the gap are lost. Self-heal exists for TV, not host. |
| **G** | **Laptop sleeps mid-game** | LOW | Like (C) but more severe. |
| **H** | **the first host opens two host tabs** | LOW | Both subscribe; actions from one don't refresh the other. |

---

## State of the working tree (before /Volumes/Creativity unmounted)

- Branch: `p0-32-33-tv-fullscreen-end-game` — clean, all commits pushed to PR #3 on GitHub.
- This handoff file is on Brandon's home directory only; he should commit + push it to the branch after re-mounting the drive or re-cloning the repo.
- Untracked files (session-6 leftovers, NOT for any PR): `.playwright-mcp/`, `.tmp-smoke-shots/`, `VERIFY-2026-05-24.md`, three `verify-*.png` files. Safe to delete.

---

## Anthropic stop-hook problem (Brandon's recurring infrastructure issue)

Brandon hits a "stop hook problem" every session, forcing restarts. Symptoms observed this session:
- Bash mid-command suddenly reports working directory deleted, cwd "recovered" to /Users/bnipps.
- Write tool returns `EACCES: permission denied, mkdir '/Volumes/Creativity'` — the path can't be created because it's a mount that disappeared.
- The TaskCreate/TaskUpdate tools start failing with `ENOENT: no such file or directory, lstat '/Users/bnipps/.claude/tasks/<uuid>/.lock'`.

This is consistent with a network or external volume `/Volumes/Creativity` losing its mount partway through a session. The most reliable workaround: **clone the repo to a local SSD path (e.g., `~/dev/tr1via`)** so it doesn't depend on `/Volumes/Creativity` staying mounted. The PR state lives on GitHub; re-clone loses nothing local except the untracked session-6 leftovers (already noted as safe to delete).

The real fix lives on Anthropic's side. If you want to report it: file with the specific error text + that it's recurring on a project that lives on an external/network mount.

---

## Resumption prompt to paste into the next session

```
Read HANDOFF.md and /Users/bnipps/.claude/projects/-Volumes-Creativity-dev-projects-tr1via/memory/MEMORY.md.

the first host (host@example.com) goes live on tr1via.com Wednesday 2026-05-27.

Two threads in flight:

1. PR #3 (TV-fullscreen layout + End Game CTA, P0.32 + P0.33) is shipped + awaiting Brandon's eyeball check. Don't touch unless he reports a problem on the preview deploy.

2. NEW gen-stuck bug: pick page hangs on "pulling questions" spinner. Brandon walked away briefly; refresh didn't fix it. Investigation was started under superpowers:systematic-debugging, reached the end of Phase 1.B with a SURPRISE finding (3 stuck categories in DB are in state 'draft' with q_count=0, NOT 'generating' as theorized). Resume at Phase 1.C: pull Vercel function logs for /api/categories/[id]/generate around 2026-05-24 23:30:38 UTC (the most-recent stuck category "Beatles", id 8e0fbffd-8bf6-4545-91fc-95b3da339581) and identify what wrote state='draft' on these rows after they presumably went through 'generating'.

Iron Law (don't violate): NO FIXES UNTIL ROOT CAUSE IS NAMED. Brandon was explicit — symptom patches are unacceptable. Run through superpowers:systematic-debugging phases 1 → 2 → 3 → 4 in order.

Workflow:
- PR-first; never push to main directly ([[feedback-pr-workflow]]).
- Plain-English PR descriptions for Brandon (non-technical).
- Use scripts/full-flow-prod.mjs ([[project-full-flow-driver]]) for repeat validation.
- Driver hits the SAME /api/categories/[id]/generate endpoint and completes in ~24s/category — so the endpoint isn't universally broken. Brandon's failure must be conditional on something specific (topic? difficulty? a race?).

Start by reading the HANDOFF "Thread 2" + "Evidence collected" sections in full, then continue at Phase 1.C using the Vercel MCP. Don't redo Phase 1.A or 1.B.
```
