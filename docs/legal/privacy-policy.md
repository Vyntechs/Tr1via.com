<!--
  CANONICAL hardened privacy policy (plain-text mirror of app/privacy/page.tsx).
  Rewritten from privacy-policy-ORIGINAL.md so every claim matches what the
  TR1VIA code actually does. Keep this file and app/privacy/page.tsx in sync.
  The audit that drove every change is in privacy-review.md.
-->

# Privacy Policy

TR1VIA · operated by Vyntechs · 1712 Raylene Dr, Cleburne, TX 76033 · support@vyntechs.com
Effective June 1, 2026 · Last updated June 1, 2026

This policy explains what information TR1VIA collects when you play or host live trivia at tr1via.com, why we collect it, who we share it with, how long we keep it, and what choices you have. It is written to be read, not to hide anything.

TR1VIA is operated by Vyntechs, based in Cleburne, Texas, United States. Mailing address: 1712 Raylene Dr, Cleburne, TX 76033. Questions: support@vyntechs.com.

## Who this policy covers

- **Players** — anyone who joins a game by entering a 6-character room code on their phone. No account, email, or password is required. You may type a display name so others can see your score; that name, and a device identifier we set (see "Cookies and your device"), are stored with your game data.
- **Hosts** — venue staff or organizers who run games. A host signs in by entering their email address; our server checks it against the list of host accounts and creates a login session. We do not send a magic-link or one-time-code email as part of normal sign-in. New hosts are added by the operator, who may share a one-time sign-in link directly.

## Children under 13

TR1VIA is a general-audience trivia service. It is not designed for, marketed to, or directed at children under 13, and we do not knowingly collect personal information from anyone under 13.

Be aware that TR1VIA runs in bars, restaurants, and venues that may admit minors. Because anyone can join a game by typing a room code, a child who picks up a phone and joins will have the same technical information collected automatically as any other player — an IP address and the device identifier described below — before they type anything. We do not ask for a player's age.

If you are a parent or guardian and believe a child under 13 has played and you want their information removed, email support@vyntechs.com with the date, venue, and the display name used, and we will locate and delete that record.

## What we collect automatically — from everyone

**Server logs.** Vercel, our hosting provider, receives and logs ordinary web-request data for every visit: your IP address (used to route the request and derive approximate city/region location), your browser and operating system (User-Agent), the page you came from (referrer), the pages you request, and timestamps. Vercel keeps these access logs for up to 30 days. We do not separately store them.

**The live game connection.** Live games use a continuous connection provided by Supabase Realtime, a US-based service we use (see "Who we share data with"). Through that connection Supabase receives your IP address and connection timing. Some connection-liveness information — for example, when you were last seen and how long the game tab was in the background — is written to your player record and is kept along with that record after the game ends.

**Answers, timing, and scores.** To score fairly, TR1VIA records which answer you chose and how quickly you locked it in. This information is stored in our database and is kept after the game ends — it powers the end-of-game recap, the leaderboard, and the host's ability to review past nights. It is linked to the device identifier described below.

**Display names.** If you enter a display name to join, it is shown to other players and to the host during the game, and it is stored with your game data and the device identifier and kept after the game ends. Please pick a nickname rather than your full real name.

## What we do NOT use

To be clear about what TR1VIA does *not* do: we do not use Google Analytics, Vercel Analytics, or any other third-party analytics product; we do not use advertising cookies, tracking pixels, or retargeting; we do not sell or share your personal information for advertising; and we do not currently process Global Privacy Control (GPC) signals, because there is no advertising sale or share to opt out of. If that ever changes, we will update this policy and add real controls before turning anything on.

## What we collect — hosts only

**Email address.** When a host account is created, we store the host's email address to identify the account and to create a login session when they sign in. We do not use host email addresses for marketing, and we do not send host emails through a third-party email-delivery provider.

**Login session.** When a host signs in, our authentication provider Supabase sets a session cookie in the browser to keep them logged in. It refreshes automatically and is cleared when the host signs out. It is used only for authentication, not for tracking or analytics.

**Host dashboard activity.** Actions a host takes in the dashboard — creating games, managing questions, ending sessions — are recorded so we can run the service and troubleshoot problems.

## Cookies and your device

TR1VIA uses a small number of first-party cookies and one browser storage value. We do not use any advertising or third-party tracking cookies.

| Name | Set by | Purpose | Lasts |
| --- | --- | --- | --- |
| tr1via_device | TR1VIA | A signed cookie holding a random device identifier. It lets us recognize your device so we can keep your score during a game and recognize you if you rejoin. It is a persistent identifier and is stored with your player record. | Up to 1 year (httpOnly) |
| tr1via_device_id | TR1VIA | A copy of the same device identifier kept in your browser's local storage so the app can read it on your device. | Until cleared |
| sb-…-auth-token | Supabase | Keeps a signed-in host logged in (hosts only). | Per Supabase defaults; cleared on sign-out |

## Who we share data with

We do not sell your personal information, and we do not use it for advertising or retargeting. We share data only with the service providers that make TR1VIA work. Each acts as our processor, handling data on our behalf.

| Provider | Role | What it receives | Policy |
| --- | --- | --- | --- |
| Vercel (US) | Hosting & server logs | IP address, User-Agent, page requests, timestamps. | vercel.com/legal/privacy-policy |
| Supabase (US) | Database, authentication & live connection | Host email; player display names; the device identifier; answers, timing, and scores; and player IP / connection timing through the live game connection. | supabase.com/privacy |
| Pexels (US) | Question images | Image-search text from our server, and — because question images load directly from Pexels in your browser — your IP address and browser type when an image is shown. | pexels.com/privacy-policy |
| Anthropic (US) | AI question generation | The trivia topic and instructions a host types, used to generate questions. No player or host personal information is sent. | anthropic.com/legal/privacy |

We may also disclose information if required by law or valid legal process, or to protect the rights and safety of TR1VIA, our users, or the public.

## How long we keep data

| Data | How long we keep it |
| --- | --- |
| Server access logs (Vercel) | Up to 30 days |
| Player display names, answers, timing, and scores | Stored in our database and kept after the game ends, so hosts can show recaps and leaderboards and review past nights. We keep this until you ask us to delete it, or until we no longer need it to run the service. |
| Device identifier (tr1via_device) | Up to 1 year in the cookie; stored with your player record until that record is deleted |
| Host email address | While the account is active; deleted within 30 days of a deletion request |
| Host dashboard activity | Kept while needed to operate and troubleshoot the service |

We are honest that most game data is retained rather than deleted the moment a game ends; if you want yours removed, see "Your choices and rights."

## International visitors

TR1VIA is based in the United States and is offered to US venues. Our providers (Vercel, Supabase, Pexels, Anthropic) process data in the United States. If you access TR1VIA from the EU, EEA, UK, or another region with data-transfer rules, your information is transferred to and processed in the United States, and we rely on appropriate transfer safeguards (such as Standard Contractual Clauses) where they apply. We do not currently market TR1VIA to EU or UK customers; if we begin serving them, we will update this policy and appoint a local representative as required before doing so.

## Security

- All traffic to and from tr1via.com is encrypted with HTTPS (TLS).
- Access to host data and activity logs is limited to authorized people.
- Session and device cookies are signed and carry standard security attributes.

No system is perfectly secure. If a breach affects hosts' personal data, we will notify affected hosts without unreasonable delay and within the time required by applicable law (in Texas, no later than 60 days after we confirm the breach). If you find a security problem, tell us at support@vyntechs.com.

## Your choices and rights

We offer the following rights to everyone as a matter of policy, regardless of where you live. Depending on your state or country (for example, California, Virginia, Colorado, Connecticut, Texas, the EU, or the UK) some of these may also be legal rights.

- **Know / access** — ask what information we hold about you.
- **Delete** — ask us to delete your information.
- **Correct** — ask us to fix inaccurate information.
- **Portability** — ask for a copy of your information.
- **Object or restrict** — ask us to stop or limit certain processing.
- **Appeal** — if we deny a request, ask us to reconsider. Residents of states with an appeal right (including Virginia, Colorado, Connecticut, and Texas) may also escalate to their state attorney general.

To exercise any of these, email support@vyntechs.com. We will respond within 45 days. Because players do not have accounts, we may not be able to find a specific player's data without help — if you played a game, include the date, venue, approximate time, and the display name you used so we can locate it. We will not treat you differently for exercising a right.

**Do we sell or share your data?** No. TR1VIA does not sell personal information and does not share it for cross-context behavioral advertising, as those terms are defined under California law. There is nothing to opt out of, so we do not provide a "Do Not Sell or Share" link.

## Changes to this policy

If we make material changes, we will update the "Last updated" date, post the new version here, and — for hosts, who have email on file — email notice at least 30 days before the change takes effect. Players do not have accounts or email on file, so for players the posted policy is the notice. Continued use after a change takes effect, once you have had reasonable notice through this posted policy, means you accept the update. If you are a host and disagree, contact us.

## Contact us

Email: support@vyntechs.com
Mailing address: Vyntechs, 1712 Raylene Dr, Cleburne, TX 76033
