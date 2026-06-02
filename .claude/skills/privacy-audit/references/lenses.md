# The five lenses — full rubric

Each lens reviews the policy text **against the code ground truth**, not in the abstract. Severity = (likelihood of enforcement/suit) × (damage). Cite statute/precedent + `file:line`.

## 1. Truthfulness / FTC §5 (HIGHEST PRIORITY)
The most enforceable category for a small company. A statement that doesn't match the product is a deceptive act under 15 U.S.C. §45 and mirror-image state UDAP statutes (e.g. Tex. DTPA §17.46), regardless of intent.
- **Phantom services** — a section for analytics/email/payment/AI not in `package.json` or code. (Over-disclosure is still misrepresentation.)
- **False retention** — "deleted at session end / not retained" with no deletion code. Precedent: *In re Snapchat* (FTC 2014).
- **False anonymity** — "no persistent identifier" while a device/user ID persists. Precedent: *In re Nomi* (FTC 2015).
- **Wrong auth/security description** — magic-link vs. email-mint, CSRF claimed but absent.
- **Hedge language** — "we have confirmed or are confirming DPAs" admits you may not have them.

## 2. Children / COPPA (16 C.F.R. Part 312)
Critical when minors can plausibly use the product (family venues, no age gate).
- Persistent identifier + geolocation/IP are **standalone "personal information"** under §312.2 (2013 amendment). Collecting them automatically from any child who joins contradicts a "we don't collect from under-13s" line.
- A self-declared "not directed to children" is **not a safe harbor** — it's a multi-factor totality test, and the bar/restaurant-context defense has been rejected (*HyperBeard* 2020). Treat a frictionless, anyone-can-join game in family venues as at least **mixed-audience**.
- "Actual knowledge" (e.g. a parent emails) + continued retention with no verifiable parental consent = violation. Penalties up to ~$53k/child; cf. *Epic/Fortnite* ($275M, 2022), *Musical.ly/TikTok* ($5.7M, 2019).
- Fix pattern: neutral age screen → under-13 into a no-PI ephemeral mode (no persistent cookie, no stored name); plus a real child-data takedown path.

## 3. California / CCPA-CPRA
- **GPC**: affirmatively claiming to honor GPC with no `Sec-GPC`/`navigator.globalPrivacyControl` handler = *Sephora* ($1.2M, 2022), *Honda* (CPPA 2024), *Todd Snyder* (2025). Remove the claim or implement it.
- **Sale/share**: if no ad tech, state "we do not sell or share … as defined by CCPA" and drop Do-Not-Sell links/opt-outs. If sharing exists, a working mechanism is mandatory (§1798.135).
- **Retention disclosure** (§1798.100(a)(3)): must state actual period or criteria; a favorable-but-false period is inverted and provably wrong.
- **Categories of third parties** (§1798.130(a)(5)(C)): must list who actually receives PI; naming phantoms while hiding the real datastore is a notice defect.
- **Voluntary compliance = enforceable promise**: claiming CCPA machinery while below the business threshold still binds you to it. Decide deliberately; consider "offered as a matter of policy, best-efforts."

## 4. Europe / GDPR + UK GDPR
- **Scope (Art. 3(2))** turns on offering services to / **monitoring** EU-UK data subjects — **not** marketing intent. A globally-reachable site with IP-geo + a persistent cookie can trip the monitoring limb (Recital 24) with no marketing at all. Either geo-block and say so, or treat as in-scope. *(Often a needs-attorney call — mere accessibility alone is not enough under EDPB 3/2018; weigh the full picture.)*
- **Legal-basis table** (Art. 6): must be accurate; non-essential cookies usually need **consent**, not "legitimate interest." ePrivacy/PECR require **prior** consent for non-essential storage (CNIL cookie fines).
- **Transfers** (Ch. V): name each US recipient + the specific mechanism (EU SCCs module, UK IDTA/Addendum) + a TIA reference; "SCCs where applicable" is inadequate post-*Schrems II*.
- **Representative** (Art. 27), **controller identity** (Art. 13), **breach** (Art. 33 = 72h to DPA, Art. 34 = without undue delay to subjects — don't misapply 72h to "notify users").

## 5. Structural / liability + US multi-state
- **Leftover placeholders** (`[X months]`, form URLs) = visibly unfinished + dead links = deceptive.
- **Missing Terms of Service** — usually the single biggest "get sued" gap. The ToS holds the actual shields: AS-IS/no-warranty, **limitation of liability** (cap at fees paid), **host indemnity**, **governing law + venue**, **arbitration + class-action waiver** (the difference between small-claims and a class action). A privacy policy has none of these. Flag as a **separate document** to draft, surfaced + accepted before use. Cf. *Concepcion* (2011), *Epic v. Lewis* (2018); presentation must satisfy *Berman v. Freedom Financial* (2022) / *Specht* (2002).
- **Entity identity** — a "DBA" is a trade name, not a legal person. No LLC/corp behind it = **no liability shield**; a judgment reaches personal assets (and the printed home address). Resolve before any ToS — every protective clause needs a real contracting entity.
- **Not published / not linked** = no legal effect, and collecting data with no posted notice is itself a violation. Must be live + linked at notice-at-collection points.
- **Acceptance mechanics** — deemed "continued use = acceptance" fails for account-less users with no conspicuous notice. Add a sign-in-wrap line with working links.
- **State patchwork** — TX TDPSA (home state), VA/CO/CT/UT: rights set + appeal right + response windows; don't over-commit self-imposed deadlines (e.g. a 72h breach promise exceeding the 60-day TX statute).
