# TR1VIA — Full Marketing Pass — Design Spec

**Date:** 2026-06-08
**Branch (worktree):** `marketing-root-themes`
**Status:** Design — awaiting user review before writing the implementation plan.

---

## 1. Why this exists (the two goals)

This marketing pass serves two goals at once, with one leading:

1. **Revenue (leads):** convert a stranger who finds TR1VIA into a host signup. *(Primary lens.)*
2. **Credibility (a job):** the page is so well-built that a technical/hiring viewer is impressed enough to pass Brandon's name along.

**Resolution (decided):** one artifact does both jobs — a genuinely conversion-optimized page, built to a craft level that *is* the portfolio proof. We do **not** build a second "portfolio" page. The polish does double duty.

## 2. Non-negotiable constraints

- **the first host (the one live host) must see ZERO difference.** This pass touches **only** the public marketing surface: `app/(marketing)/**`, the root redirect, and `components/marketing/**`. It must NOT modify `app/host/**`, `app/(host)/**`, the player/TV runtime, `app/api/**`, `lib/theme/**` (read-only), or the database. A real saved game is running in prod within days — the host/player/TV path stays byte-for-byte unchanged.
- **No fabricated proof.** Exactly one real host exists. No invented testimonials, no fake venue logos, no made-up user counts. See §6.
- **SEO must not regress.** Preserve the existing metadata, JSON-LD, keyword targeting, canonical URL, static rendering, and share-previewability. `/trivia-night` stays the **canonical** URL; the root keeps redirecting to it (decided — no routing change).
- **Read-only on the theme system.** We consume `lib/theme/tokens.ts` (the 12 month palettes + `daylight`) as a source of truth; we do not change it. Whatever the gameplay themes look like is what the marketing page wears.

## 3. Audience

**"Any and all"** — the page is NOT narrowed to one buyer. It opens with a **universal hook** (the anti-cheat differentiator, which lands for everyone), then offers **lightweight segment cues** so each visitor self-identifies:

- **For your venue** — bar/brewery/restaurant owners filling slow weeknights.
- **For your night** — independent quizmasters who want to look pro with zero prep.
- **For your group** — office/community/party hosts who want easy, fair, free fun.

These are *cues* (a single strip), not separate funnel pages.

## 4. Information architecture (the whole site)

| Page | Role | Status |
| --- | --- | --- |
| **The hub** (`/trivia-night`, canonical; root `/` 307 → it) | The showpiece landing. ~80% of the work. | Redesign |
| **`/pricing`** | Honest free-vs-AI breakdown + objection-killing FAQ. SEO value. | New |
| **`/themes`** | The existing 12-month gallery. | Light polish to match |

Deferred (explicitly out of scope for this pass, queued as a fast-follow): a `/compare` SEO page ("TR1VIA vs TriviaMaker") and how-to content.

## 5. The signature concept — "The Year Scroll"

**The product's superpower is that it wears 12 faces (one per month). The marketing page should not pick one — it should BE that.**

As the visitor scrolls the hub top-to-bottom, the page's **atmosphere tours all twelve monthly themes** — each major section paints itself in one month's real `{paper, ink, accent}` palette and renders that month's ambient motif (e.g. `JuneSky`, `Lightning`, `ParticleField`, pumpkin/pine motifs). The page doesn't *claim* "a new look every month" — it *demonstrates* it under the visitor's thumb. This single mechanic is both the **core differentiator made visceral** and the **portfolio flex**.

### Why it stays readable (the key insight)
Every theme in `lib/theme/tokens.ts` ships its own `paper`/`ink` pair with contrast already designed in (June: `#F7D9B0` on `#2A1620`; October: `#120A06` under `#F4E6C4`). So a section riding on **its own theme's** `paper` background + `ink` text is **legible by construction** — we are not putting copy on arbitrary backgrounds. The section's CTA uses that theme's `accent`. Light↔dark flips between sections become a *feature* (rhythm), not a hazard.

### Theme ordering
- **Hero wears the *current* month** (today: `june`), so a visitor "right now" sees the real, live, seasonal face a host would see — strongest "this is alive" signal.
- The subsequent scroll sections proceed through the calendar so the journey reads as "a tour through the year."
- The dedicated **`/themes`** gallery shows all 12 in full, January→December.
- (Exact section→month mapping is a Figma-time detail; the spec fixes the *content* order in §7, the *atmosphere* tours underneath it.)

### Architecture — SSR-first, scroll as progressive enhancement
The current hub is a deliberately zero-client-JS server component. "The Year Scroll" needs scroll interaction, so the architecture becomes:

1. **Server-rendered shell (baseline, no JS required):** all copy, metadata, and JSON-LD render in static HTML. **Each section is statically themed** — its `{paper, ink, accent}` is baked into the server output. So even with JS disabled or for a crawler, the page is fully readable AND the theme tour *already works* (scrolling moves you through statically-themed sections). SEO, speed, and share-previews are preserved.
2. **Thin client island (`YearScroll` controller):** an `IntersectionObserver`/scroll-progress component layered on top adds (a) smooth cross-fade transitions of the accent/ambient layer between sections and (b) the ambient motion motifs. It enhances; it is never required.
3. **`prefers-reduced-motion`:** ambient motion is disabled; theme palettes still change per section, but instantly and without motion.
4. **No new gameplay coupling:** the controller reads theme tokens (already a static import); it does not touch `resolveTheme` or any host/night/DB state.

This SSR-baseline-plus-enhancement split is itself a strong engineering signal for the job goal.

## 6. Proof — honest by design

- **Primary:** one **real** quote from the first host about her actual weekly night, **attributed anonymously** (e.g. *"— a host running TR1VIA weekly"*) — her real name is NOT used. *Blocked on input:* we need her real words from Brandon before this ships. Until then the section renders a clearly-marked placeholder and/or is hidden behind a flag — **we never invent the quote.**
- **Supporting honest signal:** "live trivia nights running weekly," the anti-cheat guarantee, the free-forever promise — all true today.
- **Optional founder's note:** a short, honest "why I built this" line in Brandon's voice. Doubles as the human/credibility signal for the job goal without claiming social proof we don't have.
- **Forbidden:** fabricated testimonials, fake venue logos, invented counts/ratings.

## 7. The hub — section spine (content order is fixed; theme atmosphere tours underneath)

1. **Header** — wordmark, "Host · Sign in," primary CTA. (Carry over, restyled.)
2. **Hero** — universal hook. Keep the proven line **"Everybody plays solo. Nobody can cheat."** Bigger, cinematic. Dual CTA: *Start hosting — free* / *Got a code? Join*. Wears the current month.
3. **★ The Moment** — the centerpiece, and the new thing. A visual proof of the anti-cheat trick: one question on the "TV," ≥3 phones beside it each showing the four answers **in a different order**. Caption: *"Shout 'it's number three!' — it means nothing."* The most screenshotted, most differentiated, most craft-heavy beat.
4. **How it works in one night** — the 4 steps (carry over, elevated).
5. **Whatever your room is** — the segment-cue strip (venue / night / group), §3.
6. **Why it's different** — the 4 differentiators (carry over, elevated).
7. **A new look every month** — the live `ThemeShowcase`, now the *payoff* of the tour the visitor has been feeling. Links to `/themes`.
8. **Proof** — §6.
9. **Pricing** — free-forever + $4.99 AI add-on inline; links to `/pricing`.
10. **Final CTA** — "Your next trivia night starts here."
11. **Footer** — Privacy, /themes, /pricing.

## 8. What carries over (do not rebuild from scratch)
- All SEO: `metadata`, JSON-LD `SoftwareApplication` + offers, keyword set, canonical, OG/Twitter.
- The daylight design system + `components/system` primitives (`Display`, `Eyebrow`, etc.).
- `ThemeShowcase` and `CardWeather` (already "come alive" with real weather/boards).
- The scope-guard discipline already written into the page headers.

## 9. Figma workflow (after this spec is approved)
1. **Art-direction frames (hero):** 3 hero compositions of "The Year Scroll" hero in Figma → Brandon picks one.
2. **Full comps:** each hub section + `/pricing` + the `/themes` polish, built on the real theme palettes, in Figma → Brandon reviews.
3. **Then** build in Next.js per §5 architecture → verify → ship a PR (Brandon merges; never push to `main`).

Figma is the **design** medium here (the visual companion); the Next.js build is the implementation that follows approval.

## 10. Success criteria / verification
- **the first host-safe:** `git diff` touches only `app/(marketing)/**`, `app/page.tsx`, `components/marketing/**`, and the new spec/plan docs. Nothing under host/player/tv/api/lib-theme/supabase changes. (Hard gate, checked before any PR.)
- **SEO preserved:** metadata, JSON-LD, canonical, and full content are present in server-rendered HTML (curl the route, grep for the H1, the JSON-LD, the description).
- **No-JS baseline:** with JS disabled, the page is fully readable and the per-section themes still render.
- **Reduced-motion:** ambient motion is suppressed under `prefers-reduced-motion`.
- **Readability:** every section's copy sits on its own theme's `ink`-on-`paper` (contrast designed-in).
- **Conversion path intact:** a single, obvious "Start hosting — free" path is reachable from hero, mid-page, and final CTA.
- **Honesty:** no testimonial/quote ships without the first host's real (anonymized) words.

## 11. Risks / open items
- **Open (blocking the Proof section only):** the first host's real quote. Everything else can proceed; Proof ships last.
- **Risk:** scroll-theme transitions feeling busy. Mitigation: content order is a fixed conversion spine; only the atmosphere tours; cross-fades are restrained; reduced-motion respected.
- **Risk:** client island regressing SEO/perf. Mitigation: SSR baseline is the source of truth; the island is pure enhancement and ships behind the static-themed sections.
- **Decided, not open:** lens (revenue-first), buyer (any-and-all), scope (hub + /pricing + /themes polish), structure (showpiece hub), routing (/trivia-night canonical), art-direction (The Year Scroll).
- **CONFIRMED 2026-06-08 (Brandon, at Figma comp review):** the theme-showcase section (§7 item 7) MUST reuse the existing live horizontal `ThemeShowcase` scroller already in production (the "cards come alive — real weather, real boards" component), NOT a new static grid. The static 12-card grid in the Figma comp was only a visual stand-in. Hub direction (Cinematic hero / full Year-Scroll comp) approved.
