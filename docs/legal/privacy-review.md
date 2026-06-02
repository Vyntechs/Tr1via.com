# TR1VIA Privacy Policy — Review & What Changed

_Date: June 1, 2026. Reviewed the as-delivered policy (`privacy-policy-ORIGINAL.md`) against what the TR1VIA code actually does, then rewrote it (`privacy-policy.md` + the published `/privacy` page) so every claim is true._

> **Plain-English bottom line.** The draft you had made was well-written, but it described a *different product* than the one you actually run. It promised to delete player data the moment a game ends (your database never deletes it), named three trackers and an email service you don't use (Google Analytics, Vercel Analytics, Resend), promised players they're anonymous (every player gets a year-long device cookie), and never mentioned Supabase — the one company that actually holds all the data. **That gap is the single biggest way a policy gets you in trouble:** regulators and plaintiffs don't need to prove you were careless, only that you said something that wasn't true. I rewrote the policy to tell the truth, which removes that whole category of risk. What I *couldn't* fix with words alone — because it needs your decision, a real lawyer, or new code — is listed at the bottom. **A privacy policy is not a shield against lawsuits; the missing piece that actually limits lawsuits is a Terms of Service, and you don't have one yet.**

---

## How this was checked

A fleet of 64 AI agents did the review in three passes: first, three "forensic" agents read the actual code (database migrations, the join/answer/session paths, every place a cookie is set) to establish what TR1VIA really collects, shares, and keeps. Then five legal lenses — truthfulness/FTC, children/COPPA, California (CCPA/CPRA), Europe (GDPR), and structure/liability — reviewed the policy against that ground truth. Finally, every single finding was handed to a separate skeptical agent to try to *disprove* it against the code and the law. **56 findings survived that adversarial check; 0 were thrown out; 7 were flagged as needing a real attorney's judgment.**

| Severity | Count | What it means |
| --- | --- | --- |
| Critical | 12 | False statements with a real enforcement track record (false deletion promises, false "we honor GPC", hidden core data processor, no published policy at all) |
| High | 18 | Clear inaccuracies or material gaps (phantom services, wrong cookie list, undisclosed processors, no Terms of Service) |
| Medium | 18 | Real but lower-probability issues (state-law specifics, consent framing) |
| Low | 8 | Tidy-ups and belt-and-suspenders clarity |

---

## The five biggest problems (all now fixed in the rewrite)

1. **It promised to delete data it never deletes.** The draft said player names, answers, and timing are "deleted when the game ends." The code does the opposite — closing a game just stamps a timestamp; nothing is ever deleted, and your host dashboard reads those old player rows from games that ended. There is no deletion job anywhere in the codebase. Falsely claiming deletion is the most enforceable privacy mistake there is (the FTC has fined companies for exactly this). **Fix:** the policy now says plainly that game data is kept after the game, why (recaps and leaderboards), and that you'll delete it on request.

2. **It described trackers and services you don't use.** Google Analytics, Vercel Analytics, and Resend (email) are all written up in detail — with cookies, opt-outs, and "we share with Google" admissions — but none of them are installed. **Fix:** all three removed. The policy now says clearly: no analytics, no ad tracking.

3. **It told players they're anonymous; they aren't.** Every player gets a signed `tr1via_device` cookie holding a one-year identifier that follows them across games. The draft said data is "not linked to any persistent identifier." **Fix:** the device cookie is now honestly disclosed in the cookie table, and the "anonymous" claim is gone.

4. **It hid the company that holds everything.** Supabase is your database, your login system, and your live game connection — it holds host emails, player names, the device IDs, and every answer. It wasn't mentioned once. Meanwhile the policy listed three companies that receive nothing. **Fix:** the "who we share with" list is now the real one — Vercel (hosting), Supabase (database/login/live), Pexels (question images — which also see each viewer's IP), and Anthropic (turns the host's typed topic into questions).

5. **It claimed to honor "Global Privacy Control" — there's no code that does.** Affirmatively saying you honor GPC when you don't is the exact thing California fined Sephora $1.2M for. **Fix:** removed. Since you don't sell or share data for advertising, the honest statement is "there's nothing to opt out of," which the policy now makes.

Plus the rest: the cookie table was replaced with your real cookies, the "magic link" login description was corrected (you mint a session when a host types their email — no email is sent), the leftover `[X months — configure...]` placeholders were removed, the broken link to a "privacy request form" that doesn't exist was replaced with your support email, and the over-promised "72-hour breach notice" was changed to match Texas law.

---

## Published and linked (this is required, not optional)

A privacy policy that isn't posted has no legal effect — and collecting data with *no* posted notice is itself a violation. So the rewrite is now a real page at **`/privacy`**, linked from the **host login** and from the **player join screen** ("By joining, you agree to our Privacy Policy"). That's the notice-at-collection the law expects.

---

## What I did NOT do — and why (your call / needs a lawyer / needs code)

I deliberately stopped at "make the words true." These remaining items change your business or your contracts, so they're yours to decide — ideally with a real attorney. They're listed worst-first.

- **You have no Terms of Service — this is the #1 lawsuit gap, bigger than anything in the privacy policy.** The privacy policy is a list of *promises* (it creates risk); the Terms of Service is the *shield* (it limits risk). A ToS is where the protections that actually keep you from getting sued live: "the app is provided as-is, no uptime guarantee" (directly relevant after the live-show laptop freeze), a cap on how much anyone can claim from you, hosts taking responsibility for the questions they write, Texas law and Texas courts, and an arbitration + no-class-action clause (the difference between a $400 dispute and a $4M class action). **I did not write this** because it's a binding contract and should not be free-handed and shipped without your sign-off. I can draft a first version next if you want.

- **Is "Vyntechs" an actual company, or just a name?** The policy prints "Vyntechs (DBA)" and your home address. A "DBA" is just a nickname — it's not a legal entity. If there's no LLC behind it, then *there is no liability shield at all*: a judgment comes straight at your personal assets, including the house. If you intend to be protected, the real protection is forming a Texas LLC and running TR1VIA under it — **before** go-live and before the ToS, because every protective clause has to be signed by a real company. This one genuinely needs a lawyer/accountant.

- **Kids in the venues.** "Not directed to children" is a weak defense for a frictionless, anyone-can-join game running in pizza places, because a child gets a device cookie + IP collected automatically. The clean fix is a simple "enter your age" screen at join that routes under-13 players into a no-cookie, no-stored-name mode. That's new code, not a wording change — worth doing before you scale to more venues.

- **The "delete my data" promise needs a real button.** The policy now honestly says you'll delete on request, but there's no tool that actually finds and deletes a player's rows yet. If you start getting requests, you'll need that. Small build; flag it when you want it.

- **The 7 lawyer-judgment calls.** A real attorney should weigh in on: whether you want to keep claiming full California (CCPA) compliance when you're almost certainly below its size threshold (claiming it makes it a promise you must keep); whether European rules apply at all given the site is reachable worldwide; and the entity/LLC question above. These aren't things an AI should decide for you.

---

## Honest disclaimer

I am not a lawyer, and this is not legal advice. What this review *did* do, with evidence from your own code, is remove the provably-false statements that were the most likely thing to get you in trouble, and publish an accurate notice. What it did **not** do is make you lawsuit-proof — no privacy policy can. The Terms of Service and the entity (LLC) question are the two things that actually limit lawsuits, and both need you and a real attorney. Treat this as a strong, code-verified first pass that a lawyer can now review cheaply, not as a final clearance.

_Full machine-readable findings (all 56, with code citations and statute references) plus the code ground-truth are in `privacy-findings.json` alongside this report._
