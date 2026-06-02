// DEEP MODE — verified multi-agent privacy-policy audit.
//
// Run via the Workflow tool ONLY when the user opts into multi-agent orchestration:
//   Workflow({ scriptPath: ".claude/skills/privacy-audit/workflow/privacy-policy-legal-audit.js",
//              args: { policyPath: "docs/legal/privacy-policy-ORIGINAL.md" } })
//
// args (all optional):
//   policyPath  - path to the policy markdown to audit (default below)
//   stackFacts  - string of known-stack facts to brief the agents (default = TR1VIA)
//
// Pipeline: 3 forensic ground-truth agents (read the code) -> barrier ->
//           5 legal lenses review the policy vs ground truth ->
//           every finding adversarially verified by an independent skeptic.
// Returns { groundTruth, surviving, refuted, needsAttorney, counts }.
// See ../references/lenses.md for the rubric these prompts encode.

export const meta = {
  name: 'privacy-policy-legal-audit',
  description: 'Audit a privacy policy against real code + privacy law; verify every finding',
  phases: [
    { title: 'Ground Truth', detail: 'read the code to establish what the app actually collects/shares/retains' },
    { title: 'Review', detail: '5 legal lenses review the policy against ground truth' },
    { title: 'Verify', detail: 'adversarially verify each finding against code + law' },
  ],
}

const POLICY = (args && args.policyPath) || 'docs/legal/privacy-policy-ORIGINAL.md'

const STACK_FACTS = (args && args.stackFacts) || `
TR1VIA = a live multiplayer trivia web app (Next.js App Router, deployed on Vercel at tr1via.com).
Operated by Vyntechs (DBA), Cleburne TX. Players join via a 6-char room code on their phone (no account).
Hosts run games from a dashboard.

KNOWN STACK FACTS (verify against code yourself, do not assume):
- package.json includes: @anthropic-ai/sdk (AI question generation), @supabase/supabase-js + @supabase/ssr (Postgres DB + auth + realtime).
- package.json does NOT include: resend/sendgrid/postmark/nodemailer (no email-send lib), @vercel/analytics, gtag/google-analytics, react-ga, posthog, mixpanel, segment, sentry, stripe.
- Supabase tables: hosts (email), players (display_name, device_id), answers, game_scores, game_participations, nights, games, categories, questions, reveals, adjustments, topic_suggestions. Migrations in supabase/migrations/0001..0009.
- Players carry a signed httpOnly 'tr1via_device' cookie (365-day UUID) written to players.device_id. Auth = "type email -> server mints a session" (magic-link removed); /auth/grant is an out-of-band cross-device link. Question images come from Pexels (images.pexels.com) via plain <img> (leaks viewer IP).
`

phase('Ground Truth')
log('Phase 1: establishing what the app actually collects, shares, and retains (3 code agents)')

const GROUND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['domain', 'summary', 'facts'],
  properties: {
    domain: { type: 'string' },
    summary: { type: 'string' },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['area', 'reality', 'evidence', 'contradicts_policy', 'policy_quote'],
        properties: {
          area: { type: 'string' },
          reality: { type: 'string', description: 'what the CODE actually does' },
          evidence: { type: 'array', items: { type: 'string' }, description: 'file:line citations' },
          contradicts_policy: { type: 'boolean' },
          policy_quote: { type: 'string' },
        },
      },
    },
  },
}

const groundAgents = [
  {
    label: 'gt:retention',
    prompt: `${STACK_FACTS}

YOU ARE: a data-retention forensics agent. Read the DB migrations, seed, and the code paths that write/read player/answer/score data, plus any reset/delete/end-game logic.
The policy at ${POLICY} claims data is "deleted when the game ends" / "not retained" / "not linked to a persistent identifier."
DETERMINE WITH file:line EVIDENCE: (1) do display names persist after a game ends? (2) do answers/timestamps persist? Is there ANY deletion on game end? (3) are players linked to a persistent identifier (device id, FK across games)? (4) is there ANY automated deletion (cron/TTL/anonymize) anywhere? Report every place the "not retained/deleted" claims are FALSE.`,
  },
  {
    label: 'gt:subprocessors',
    prompt: `${STACK_FACTS}

YOU ARE: a third-party / sub-processor mapping agent. With file:line evidence establish EVERY external service that receives user/host data.
CHECK: (1) is Google Analytics actually installed (gtag/G-XXXX/react-ga)? (2) Vercel Analytics (@vercel/analytics)? (3) any email send (Resend/SendGrid/nodemailer/SMTP)? (4) the datastore (Supabase) — is it named in the policy's sub-processor table? (5) the AI provider — what data is sent, is it disclosed? (6) image CDNs/fonts/error reporting leaking viewer IP.
Output the ACTUAL processor list vs what the policy claims — flag omissions (real but undisclosed) AND phantoms (disclosed but not used).`,
  },
  {
    label: 'gt:auth-cookies-gpc',
    prompt: `${STACK_FACTS}

YOU ARE: an auth + cookies + tracking-signal forensics agent. Read login/session code and every place a cookie/header is set.
DETERMINE WITH file:line EVIDENCE: (1) the ACTUAL login flow (magic-link vs email-mint vs password?) — does the policy's description match? (2) EVERY cookie/identifier actually set: name, httpOnly/secure/sameSite, lifetime — vs the policy's cookie table (flag cookies set-but-undisclosed and disclosed-but-absent). (3) is there ANY code reading Sec-GPC / navigator.globalPrivacyControl? If the policy claims "we honor GPC" and there is none, that's an affirmative false statement (Sephora). (4) does the promised privacy-request form/route/deletion endpoint exist?`,
  },
]

const ground = (await parallel(
  groundAgents.map(a => () => agent(a.prompt, { label: a.label, phase: 'Ground Truth', schema: GROUND_SCHEMA })),
)).filter(Boolean)

const groundBlob = JSON.stringify(ground, null, 1)
log(`Ground truth established: ${ground.reduce((n, g) => n + ((g.facts && g.facts.length) || 0), 0)} facts across ${ground.length} domains`)

phase('Review')

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lens', 'findings'],
  properties: {
    lens: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'severity', 'category', 'policy_quote', 'problem', 'law', 'evidence', 'recommended_fix'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          category: { type: 'string', enum: ['accuracy-mismatch', 'missing-disclosure', 'legal-gap', 'overcommitment', 'placeholder', 'structural'] },
          policy_quote: { type: 'string', description: 'exact policy text, or "MISSING"' },
          problem: { type: 'string' },
          law: { type: 'string', description: 'specific statute/reg/precedent' },
          evidence: { type: 'array', items: { type: 'string' } },
          recommended_fix: { type: 'string' },
        },
      },
    },
  },
}

const LENSES = [
  { key: 'accuracy-ftc', prompt: `LENS: Truthfulness / FTC §5 deception (HIGHEST PRIORITY). Find EVERY place the policy text contradicts what the code does: phantom services, false retention promises, wrong auth description, wrong cookie table, unimplemented "honors GPC", DPA hedging, and any other untrue statement. Each finding = the exact false quote + the true state from ground truth.` },
  { key: 'coppa-minors', prompt: `LENS: COPPA / minors. If minors can plausibly use it (family venues, no age gate), assess whether the "not directed to children" position holds, whether persistent identifier + IP from a possible child creates exposure despite the disclaimer, the actual-knowledge handling, and under-16 state rules. Concrete risks + fixes.` },
  { key: 'ccpa-cpra', prompt: `LENS: California CCPA/CPRA. Scrutinize the GPC claim vs implementation (Sephora), "sharing" analysis if analytics isn't installed, notice-at-collection, Do-Not-Sell mechanics, retention disclosure (§1798.100(a)(3)), categories-of-third-parties, rights/timelines, and whether voluntarily claiming compliance creates an enforceable promise. Cite CCPA sections.` },
  { key: 'gdpr-transfers', prompt: `LENS: GDPR / UK GDPR + transfers. Assess whether serving an EU/UK visitor already triggers scope (Art. 3(2) is offering/monitoring, NOT marketing intent), the legal-basis table, ePrivacy/PECR cookie consent, the transfer mechanism specifics (Schrems II), Art. 27 representative, controller identity, and breach-duty framing (Art. 33 vs 34). Separate real exposure from theoretical.` },
  { key: 'structural-liability', prompt: `LENS: Structural completeness + "won't get sued" reality + US multi-state. Cover: leftover placeholders + dead links; the MISSING Terms of Service (the real liability shield — limitation of liability, arbitration, governing law, indemnity) as the single biggest get-sued gap, to be a SEPARATE doc; entity identity (a DBA is not a legal entity — no LLC = no shield); policy not published/linked = no legal effect; acceptance mechanics for account-less users; TX TDPSA + VA/CO/CT/UT rights+appeal; self-imposed over-commitments (e.g. 72h breach). Concrete fixes.` },
]

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'verdict', 'confidence', 'corrected_severity', 'evidence_check', 'reasoning'],
  properties: {
    id: { type: 'string' },
    verdict: { type: 'string', enum: ['confirmed', 'refuted', 'needs-attorney', 'adjusted'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    corrected_severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'n/a'] },
    evidence_check: { type: 'string' },
    reasoning: { type: 'string' },
  },
}

log('Phase 2+3: 5 legal lenses review, each finding adversarially verified as its lens completes')

const reviewed = await pipeline(
  LENSES,
  lens => agent(
    `${STACK_FACTS}

The privacy policy under review is at ${POLICY} — READ IT IN FULL.

GROUND TRUTH (what the code actually does, with file:line evidence — trust these facts):
${groundBlob}

${lens.prompt}

Be exhaustive within your lens but do not invent law — cite real statutes/regs/precedent. Severity = likelihood × damage of an actual suit/fine/enforcement. Return findings per schema.`,
    { label: `review:${lens.key}`, phase: 'Review', schema: FINDINGS_SCHEMA },
  ),
  (review, lens) => {
    const findings = (review && review.findings) || []
    if (!findings.length) return []
    return parallel(findings.map(f => () =>
      agent(
        `You are an adversarial verifier (a skeptical senior privacy attorney + engineer). A reviewer raised this finding about the privacy policy at ${POLICY}.

FINDING:
${JSON.stringify(f, null, 1)}

GROUND TRUTH from code forensics:
${groundBlob}

Independently verify. You have Read/Grep/Bash — CHECK the actual code and policy text yourself; do not take the reviewer's word. Decide: "confirmed" (real, severity right) / "adjusted" (real but wrong severity — give corrected_severity) / "refuted" (not a real problem — explain) / "needs-attorney" (genuine legal-judgment call). Quote the specific code or policy text you checked.`,
        { label: `verify:${f.id}`, phase: 'Verify', schema: VERDICT_SCHEMA },
      ).then(v => ({ ...f, lens: lens.key, verdict: v })).catch(() => ({ ...f, lens: lens.key, verdict: null })),
    ))
  },
)

const verifiedFindings = reviewed.flatMap(r => (Array.isArray(r) ? r : [])).filter(Boolean)
const surviving = verifiedFindings.filter(f => f.verdict && f.verdict.verdict !== 'refuted')
const refuted = verifiedFindings.filter(f => f.verdict && f.verdict.verdict === 'refuted')
const needsAttorney = verifiedFindings.filter(f => f.verdict && f.verdict.verdict === 'needs-attorney')

log(`Review complete: ${verifiedFindings.length} raised, ${surviving.length} survived, ${refuted.length} refuted, ${needsAttorney.length} need-attorney`)

return {
  groundTruth: ground,
  surviving,
  refuted,
  needsAttorney,
  counts: {
    total: verifiedFindings.length,
    surviving: surviving.length,
    refuted: refuted.length,
    needsAttorney: needsAttorney.length,
    bySeverity: surviving.reduce((m, f) => {
      const s = (f.verdict && f.verdict.corrected_severity && f.verdict.corrected_severity !== 'n/a') ? f.verdict.corrected_severity : f.severity
      m[s] = (m[s] || 0) + 1
      return m
    }, {}),
  },
}
