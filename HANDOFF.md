# TR1VIA — Handoff (end of session 22, 2026-05-27 late afternoon, Heather-tonight fixes shipped)

**Next session: read this → `MEMORY.md` (auto-loaded) → `CLAUDE.md` → `tasks/lessons.md` (grep keywords).**

Prior handoffs in git history (session 21 at `030ff5b`, session 20 design at `11977c8`, session 19 at `6179b0b`).

---

## Critical context

- **Heather goes live tonight (2026-05-27).** She runs on whatever's currently on `main`. All today's fixes ARE on main — both PR #52 (May/Storm) and PR #53 (chrome + best category) merged.
- **No open PRs.** Clean working slate for next session's bug reports.
- **Latest main:** `953650a` — fix(host): ditch fake Mac chrome + compute real best category (#53).

---

## What landed this session (session 22 — Brandon-validates-the-preview)

Brandon validated PR #52's Vercel preview as a single player on his iPhone and reported bugs as he found them. Each was root-caused, fixed, and shipped through PR #52 (until it merged) and then PR #53.

### Bugs hit and fixed

1. **Ghost Game 2** (PR #52 — `c5b432c` + `560adbe` + `3798563`)
   - **Symptom:** clicking "Join Game 2" on a night where game 2 had no questions opened an empty TV view ("0 of 0 ANSWERED · WAITING ON HOST"), unrecoverable.
   - **Root cause:** `POST /api/games/:id/start` had no precondition — flipped any game to `live` regardless of whether questions existed. Host's "Start Game 2" button always enabled. TV snapshot rendered empty board with 200.
   - **Fix:** server-side precondition refuses to start a game with zero ready categories; host button greys out with tooltip when game 2 isn't ready; full-flow-prod step 3b now asserts the refusal.

2. **Long question covers players list** (PR #52 — `c5b432c`)
   - **Symptom:** on the TV during a long question prompt, the answer cards and player marquee got pushed off-screen.
   - **Root cause:** auto-fit fix existed on `main` as PR #51 (`01f4b56`) but the May/Storm branch was cut from one commit before it landed and never picked it up. Parallel branches both touched `TVQuestion.tsx`, both shipped, only one fix.
   - **Fix:** cherry-picked `01f4b56` onto the feat branch, resolved conflict with the marquee additions, added `flexShrink: 0` to the May marquee container so it stays visible too.

3. **AI generating wrong-answer questions** (PR #52 — `1b7ec24` + `7483fa4`)
   - **Symptom:** Heather texted Brandon: AI question said "most commonly harvested tree" with Eucalyptus marked correct; Pine is at least as defensible.
   - **Root cause #1 (upstream):** `lib/ai/prompts.ts` SYSTEM_PROMPT had detailed rules on STYLE and OPTION SHAPE but zero rule on factual accuracy or unambiguity. Model was allowed to produce metric-ambiguous questions and pick any defensible answer.
   - **Root cause #2 (downstream affordance):** the host's "mark correct" button in `HostGenEdit` was 9px monospace muted — Heather couldn't find it. She knew the answer was wrong but didn't know how to fix it.
   - **Fixes:** added "Accuracy and unambiguity" section to the system prompt with Pine/Eucalyptus baked in as a "do not repeat" failure case (same shape as the existing Patronus failure case); rewrote the mark affordance to a 12px green-outlined "Make correct" button with the whole row clickable.

4. **All sound effects disabled** (PR #52 — `0ebc2a4`)
   - **Symptom:** Brandon doesn't want any audio playing from any surface.
   - **Fix:** module-level `SOUNDS_DISABLED: boolean = true` kill switches in `lib/audio/welcomeChime.ts` and `lib/audio/thunder.ts`. All 4 call sites unchanged; both play functions return early. Test files `.skip`'d with revert instructions in comments. To bring sound back: flip both booleans + unskip describe blocks.

5. **Question hangs forever when player disconnects** (PR #52 — `44f7b09`)
   - **Symptom:** Brandon force-closed Safari with a question live. Timer hit 0. Nothing resolved. Dead end.
   - **Root cause:** question resolution was phone-only — the player's local timer fired `/api/questions/:id/resolve` at T+0. When the phone died, the trigger died. The resolve route's own header comment said *"It's also the fallback if the TV's useTimer reaches 0 first"* — but the TV's useTimer had no `onZero` callback wired. Documented design, missing implementation.
   - **Fix:** wired `onZero` on the TV's useTimer to POST the same resolve endpoint. The RPC does `select … for update` so phone + TV racing is safe. Also auto-recovers stuck questions on host page refresh (TV mounts with expired `revealedAt`, onZero fires immediately).
   - **Known limit:** if BOTH the player phone AND the host laptop die, the question still hangs. Truly bulletproof solution = server-driven scheduled resolve (Vercel Workflow or pg_cron). Not done — worth a follow-up PR.

6. **Fake Mac window chrome on every host view** (PR #53 — `dc28c08`)
   - **Symptom:** Brandon's screenshot: red/yellow/green Mac traffic-light bar above every host screen. Tacky, redundant (host app already runs inside a real browser window), wasted ~38px vertical.
   - **Root cause:** `LaptopShell` had `chrome = true` as the default with a comment saying "Default true (for gallery). The live app overrides to false." The override was never wired — all 26 production call sites got the fake chrome.
   - **Fix:** removed the chrome rendering block, dropped the `chrome` and `title` props, sed-stripped `title=` from all 26 call sites. LaptopShell is now just a theme-aware paper-background flex column.

7. **Wrap screen's "best category" was literally hardcoded to "Music"** (PR #53 — `d718b1f`)
   - **Symptom:** After game 1 ended, the player wrap screen showed `BEST CATEGORY: Music · 3/7` — but the game wasn't a music game. Same for every player, every night, every game.
   - **Root cause:** `summarizeGame()` in `app/(player)/room/[code]/page.tsx:1499` returned `bestCategory: "Music"` unconditionally. A comment in that function admitted it was a designer placeholder: *"the designer's defaults are reasonable for the brief Wrapped panel."* The TODO never landed.
   - **Fix:** `PlayerJoinGame2Wired` one-shot-fetches `(id, category_id)` for every question in game 1's categories. `summarizeGame` groups answers by category via that map; picks the bucket with most correct (tiebreakers: points → attempts → alphabetical name). Returns `"—"` / `"0/0"` while pending or with no answers.

---

## Lessons captured this session

Two memories added to `/Users/bnipps/.claude/projects/-Volumes-Creativity-dev-projects-tr1via/memory/`:

- **[Root cause → one answer, not a menu](feedback_root_cause_no_menu.md)** — once root cause is found, the fix is determined; don't present "how strict?" multi-option menus for engineering tactics.

(Also worth promoting to `tasks/lessons.md` for the next session: **"Designer defaults" leaking to production is a recurring bug class in this codebase** — same pattern hit twice today: `LaptopShell chrome=true` default and `bestCategory: "Music"` placeholder. Grep `app/ components/` for "designer's defaults", "for the gallery", "placeholder", "TODO" near JSX props or returned object fields to find more.)

---

## OPEN ITEMS (carry-over)

### From session 19 (still un-fixed)

Both still live on `fix-regenerate-picks-and-dups` branch (stashed WIP from session 19, untouched this session).

1. **Regenerate STILL wipes selected picks** — PR #47 added `lib/host/mergePickedAfterRefetch.ts` but bug persists.
2. **Duplicate questions on regenerate** — `runGenerationJob` doesn't pass existing prompts as an exclude list to Claude.

### Architectural follow-ups identified this session (not blocking Heather)

1. **Server-driven scheduled resolve** — the "TV is the fallback" fix (PR #52 — `44f7b09`) gets us from tier 1 (phone-only) to tier 2 (phone + host laptop). Tier 3 (bulletproof) needs Vercel Workflow or pg_cron to find stale `live` questions and resolve them server-side. Recommended for a future PR.
2. **Sweep for other "designer default" leaks** — see the lesson above. Likely candidates: `HostLiveConsole` still has a `title?: string` prop that nothing reads (dead since the chrome removal); `HostGenOverview`/`HostGenPick`/etc. still have `shellTitle?: string` props that nothing reads. Cleanup PR.
3. **TV scale-to-fit instead of element auto-fit** — Brandon raised this. Current pattern: question text auto-fits, everything else stays at design pixel size. The "scale everything together via transform" pattern is cleaner architecturally but a 12-frame visual sweep. Worth doing after tonight's go-live.
4. **Host-UI typography sweep** — multiple primary action buttons in host views (Edit / Image / Discard / Replace) are styled identically to passive labels (11-12px muted gray, no fill). Same root cause as the buried "mark correct" affordance. Worth a coordinated pass.
5. **Categories table denormalized counters** — `games.category_count` and `games.question_count` were 6/7 on a game with 0 actual child rows during the Ghost Game 2 investigation. Either back them with a trigger or remove them.

---

## How the next session should handle a fresh bug report

1. **Start by reading Brandon's message** — he'll have specific findings (screen, what happened, device).
2. **Find the root cause before proposing fixes.** Brandon's clear preference: don't present `AskUserQuestion` multi-option menus for engineering tactics. Once root cause is found, the fix is determined. Reserve `AskUserQuestion` for genuine product ambiguity. See `feedback_root_cause_no_menu.md`.
3. **Categorize:**
   - **Implementation bug** (something the prior plan got wrong) → fix on a fresh branch off main → PR.
   - **Spec gap** (a behavior wasn't decided in design) → brief brainstorm with Brandon, update the spec, then fix.
   - **Manual-validation-only concern** (subjective timing/feel) → confirm with Brandon, then tune.
4. **Verify before claiming done.** `full-flow-prod.mjs` (extended this session to assert step 3b empty-game refusal) is the single best smoke. For UI fixes: spin up local dev with prod Supabase (`SMOKE_BASE_URL=http://localhost:3000`), Playwright + screenshot the changed surface.
5. **PR-first, always.** Never push to main. Open a PR, Brandon validates Vercel preview, Brandon merges.
6. **Watch for the squash-merge trap.** Once a PR squash-merges, the source branch's history diverges from main. Don't keep pushing commits to the merged branch — they get stranded. Start a fresh branch off main for follow-ups. (Hit this exact trap this session — that's why PR #53 exists as a separate PR.)

---

## Key files / pointers

- Main: https://github.com/Vyntechs/Tr1via.com — latest `953650a`
- Full-flow prod (extended): `scripts/full-flow-prod.mjs` (~175s for 1-pass house theme, ~330s for both passes; SMOKE_BASE_URL points it at any host)
- AI system prompt (now has accuracy section): `lib/ai/prompts.ts`
- Audio kill switches: `lib/audio/welcomeChime.ts` + `lib/audio/thunder.ts`
- Server start guard: `app/api/games/[id]/start/route.ts`
- TV resolve fallback: `components/tv/TVStateMachine.tsx:402` (onZero callback)
- Mark-correct affordance: `components/host/gen/HostGenEdit.tsx:166-204`
- Best-category compute: `app/(player)/room/[code]/page.tsx:1485-1565` (summarizeGame)
- LaptopShell (now stripped): `components/shells/LaptopShell.tsx`

---

## Rollout safety reminder

- May/Storm is fully theme-gated. Switch night theme away from May → falls back to current behavior. Emergency override: `?theme=house` URL flag.
- Sound is fully disabled across all surfaces. To revive: flip `SOUNDS_DISABLED` in both `lib/audio/*` modules + unskip the test blocks.
- The Mac chrome is gone — if anyone misses it, the `chrome` prop was the toggle (removed entirely; would need to re-add).
- Best-category compute returns `"—"` / `"0/0"` rather than fake data — if Brandon sees that, it means the question→category fetch didn't resolve OR the player has zero answers (joined late and never locked anything).
