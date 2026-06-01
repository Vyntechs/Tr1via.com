---
name: privacy-audit
description: >-
  Audit and harden a privacy policy (or Terms of Service / cookie notice) against
  what an app's code ACTUALLY does, then publish + link it. Use when asked to
  review, verify, check, fix, harden, or "make sure I won't get sued by" a privacy
  policy, privacy notice, data-handling disclosure, or legal doc — for TR1VIA or
  any project. Catches the #1 liability: a policy that describes a product the code
  doesn't match (false deletion promises, phantom trackers, undisclosed processors,
  fake "we honor GPC"). Cheap single-pass by default; can escalate to a verified
  multi-agent fleet on request.
---

# Privacy-policy audit & hardening

## The one idea that matters

**A privacy policy gets you in trouble when it describes a product you don't actually run.** Regulators (FTC §5) and state AGs don't have to prove negligence — only that you *said* something untrue. So the audit is not "is this policy well-written?" It's **"does every sentence match the code?"** Truth-align the policy to the implementation and you delete the entire enforceable-deception category, which is the only one with a real track record against a small company.

Secondary truth: **a privacy policy is not a liability shield.** The shield is a *Terms of Service* (limitation of liability, arbitration, governing law, host indemnity). Always surface a missing ToS as a finding — it's usually the biggest "get sued" gap, bigger than anything in the privacy policy itself.

## When to use which mode

- **Default — cheap single-pass (this skill, inline).** One agent runs the ground-truth checklist + the five lenses + a quick self-verify. Costs a few tool calls. Right for: a policy update, a re-check after code changes, a first pass, "is this accurate?"
- **Deep mode — verified fleet (opt-in).** Run `workflow/privacy-policy-legal-audit.js` via the Workflow tool (pass the policy path as `args`). ~15–60 agents: forensic ground truth → 5 lenses → adversarial verification of every finding. Right for: pre-launch sign-off, an adversarial "tear it apart," or when the cheap pass found a lot and you want each finding independently confirmed. **Only run deep mode when the user opts into multi-agent orchestration** (says "workflow", "deep", "thorough fleet", or ultracode is on).

## The procedure (cheap default)

Work top to bottom. Cite `file:line` for every claim — no assertion without code evidence.

### 1. Get the policy text into the repo
Extract the policy to a markdown file (e.g. `docs/legal/privacy-policy-ORIGINAL.md`) as the audit baseline. This is what you measure against and later edit.

### 2. Establish ground truth FROM THE CODE (never assume)
This is where the real findings come from. Check, with evidence:
- **Dependencies** (`package.json`): which analytics / email / payment / AI / DB / error-reporting services are *actually installed*? A policy section for a service not in deps is a **phantom** (delete it). A service in deps not in the policy is a **missing disclosure** (add it).
- **Database schema** (migrations): what personal-ish data persists, in which tables? Is there ANY deletion/anonymization/TTL/cron job? If not, every "deleted when…/not retained after…" claim is **false** — the highest-severity category.
- **Cookies & identifiers**: grep every `cookie.set` / `Set-Cookie` / `localStorage`. Get exact names, flags, lifetimes. Persistent device/user IDs defeat any "anonymous / no persistent identifier" claim.
- **Auth flow**: how do users actually log in? (e.g. magic-link vs. email-mint vs. password). Policies often describe an old/aspirational flow.
- **Privacy-signal handling**: is there code reading `Sec-GPC` / `navigator.globalPrivacyControl`? If the policy says "we honor GPC" and there's no code, that's a **Sephora-style false statement** (Cal. AG fined $1.2M for exactly this).
- **Rights mechanics**: does the promised deletion endpoint / "privacy request form" / route actually exist? If not, the promise is undeliverable.
- **Outbound data leaks**: direct `<img>`/fetch to third-party CDNs (e.g. image providers) leak viewer IP/User-Agent to an undisclosed processor.

### 3. Apply the five lenses to the policy vs. ground truth
See `references/lenses.md` for the full rubric. In short:
1. **Truthfulness / FTC §5** (highest priority) — every claim that contradicts the code.
2. **Children / COPPA** — esp. if minors can use it; persistent ID + IP from a child = COPPA "personal information" regardless of a "not directed to children" disclaimer.
3. **California / CCPA-CPRA** — GPC claims, sale/share, notice-at-collection, retention disclosure, undisclosed processors, voluntarily-claimed-compliance-becomes-a-promise.
4. **Europe / GDPR** — applies on *processing an EU/UK visitor*, not on "marketing intent"; legal-basis table, transfer mechanism specifics, Art. 27 rep, breach-duty framing.
5. **Structural / liability** — leftover placeholders, **missing Terms of Service**, entity identity (a "DBA" is not a legal entity — no LLC = no shield, personal assets exposed), policy not published/linked (no legal effect), acceptance mechanics for account-less users.

### 4. Self-verify before reporting
For each high/critical finding, re-open the cited file and confirm it's real. Drop anything you can't back with code. (Deep mode does this with independent adversarial agents instead.)

### 5. Harden = rewrite to the truth
Produce a corrected policy where every statement matches the code: delete phantoms, disclose real processors + cookies, replace false retention with honest retention, remove unbacked GPC/compliance claims, fix auth description, strip placeholders, route rights to a channel that exists.

### 6. Publish + link (or it has no legal effect)
Publish at a real route (e.g. `app/privacy/page.tsx` → `/privacy`), on-brand, and link it at the **notice-at-collection** points (signup/join screens, footer). Keep a plain-text mirror in `docs/legal/`.

### 7. Write the plain-English report
`docs/legal/privacy-review.md`: the bottom line, the biggest problems, what you fixed, and — separated clearly — **what you did NOT do because it needs the owner's decision, a lawyer, or new code** (form an entity/LLC, draft the ToS, build deletion tooling, add an age gate). Always end with an honest "I'm not a lawyer; this removes provable misstatements but is not legal clearance."

## Hard rules
- **Never free-hand a binding Terms of Service and ship it as "protective."** Recommend it; offer to draft; don't merge contract terms without the owner's sign-off.
- **Never claim a policy makes someone "lawsuit-proof."** No policy does. Be honest about residual risk.
- **Plain English** in the policy and the report (no legalese the owner can't read).
- **Truth over flattery**: if the code can't honor a nice-sounding promise, change the promise — don't keep it.

## Project notes (TR1VIA)
Stack to cross-check: Supabase (DB/auth/realtime — holds everything), Vercel (host), Pexels (images — leaks viewer IP), Anthropic (question gen). No analytics/email/Stripe installed as of June 2026. Auth = email-mint, not magic-link. Players carry a 365-day `tr1via_device` cookie. PR-first: never merge to main; open a PR on a branch off `origin/staging` (base `staging`); the owner validates + merges.
