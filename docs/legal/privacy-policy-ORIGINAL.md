<!--
  AS-DELIVERED baseline — the privacy policy Brandon had drafted, transcribed verbatim
  from TR1VIA_Privacy_Policy.pdf (Effective Date June 1, 2026). DO NOT EDIT.
  This is the audit baseline the review fleet measures against. The corrected,
  published policy lives in docs/legal/privacy-policy.md + app/privacy/page.tsx.
-->

# Privacy Policy (ORIGINAL / as-delivered)

TR1VIA · Vyntechs (DBA) · 1712 Raylene Dr, Cleburne, TX 76033 · support@vyntechs.com
Effective Date: June 1, 2026 · Last Updated: June 1, 2026

This privacy policy explains what information TR1VIA collects when you use our live trivia platform at tr1via.com, why we collect it, who we share it with, how long we keep it, and what rights you have over it.

TR1VIA is operated by Vyntechs (DBA), based in Texas, United States. Our mailing address is 1712 Raylene Dr, Cleburne, TX 76033. Questions: support@vyntechs.com

## Who This Policy Covers

There are two types of people who interact with TR1VIA:

- **Players** — anyone who joins a trivia game using a 6-character room code on their phone browser. No account required. We do not ask for your name or email address.
- **Hosts** — venue staff or trivia organizers who log in to run games. Hosts log in via a magic link sent to their email address.

## Children Under 13

TR1VIA is not directed at children under the age of 13. We do not knowingly collect personal information from anyone under 13.

TR1VIA is used in bars, restaurants, and venues that may admit minors, but the platform itself is not designed for, marketed to, or intended for children. If you are a parent or guardian and believe your child under 13 has submitted information through TR1VIA, contact us at support@vyntechs.com and we will delete it promptly.

We comply with the Children's Online Privacy Protection Act (COPPA).

## What We Collect — Automatically, From Everyone

When anyone loads tr1via.com — player or host — our servers and analytics tools automatically receive certain technical data.

### Server Logs

Vercel, the infrastructure provider that hosts TR1VIA, receives and logs the following for every web request:

- IP address — used to route your request and derive approximate geographic location (city/region level)
- User-Agent string — your browser type and version, operating system
- Referrer URL — the page you came from, if any
- Timestamps — when requests were made
- Page paths requested

Vercel retains server access logs for up to 30 days. TR1VIA does not separately store these logs.

### WebSocket Connection Data

Live trivia games use a persistent WebSocket connection. During an active game session, the following are visible to our servers:

- Your IP address
- Connection timestamps and session duration

This data is not retained after a game ends.

### Answer and Game Timing Data

To run fair scoring, TR1VIA records timestamps of when a question was displayed and when you submitted an answer. These are used only for scoring, are not linked to any persistent identifier for players, and are not retained after the game session ends.

### Player Display Names

If you enter a nickname or display name to join a game, that name is visible to others in the session and to the host. Display names are personal data if they identify you. We do not retain player display names after a game ends.

## What We Collect — Analytics Tools

TR1VIA uses two analytics services: Vercel Analytics and Google Analytics (GA4).

### Vercel Analytics

Vercel Analytics collects performance and usage data. This includes: pages visited and navigation paths, page load times (Web Vitals), browser type and version, operating system, screen resolution, referrer URL, and IP-derived approximate location (country/region level). Vercel does not store raw IP addresses persistently.

Vercel retains analytics data for [Y days — configure in Vercel dashboard].

### Google Analytics (GA4)

Google Analytics 4 collects:

- IP address — used to derive approximate geographic location; then discarded/anonymized by Google
- Device identifiers — a unique identifier assigned by Google to your browser/device
- Browser type and version, operating system
- Referrer URL
- Session behavior — pages visited, time on page, navigation flow
- Screen resolution, engagement time

Under the CCPA, sharing data with Google Analytics may constitute "sharing" personal information. TR1VIA does not use Google Analytics for advertising or retargeting — only to understand platform usage. We have configured GA to limit data use for Google's own advertising purposes, but we cannot represent that no "sharing" occurs under CCPA's definition.

Google Analytics data is retained for [X months — configure in GA4 Admin → Data Settings → Data Retention].

To opt out: Install the Google Analytics Opt-Out Browser Add-On.

Global Privacy Control (GPC): TR1VIA honors GPC signals. If your browser sends a GPC signal, we treat it as a request to opt out of sharing your personal information with third-party analytics tools.

## What We Collect — Hosts Only

### Email Address

When a host account is provisioned, we collect the host's email address to send magic link authentication emails. We do not use host email addresses for marketing. Host email addresses are transmitted to Resend for magic link delivery.

### Authentication Tokens and Session Cookies

When a host clicks a magic link, a session token is set in their browser. This token authenticates the host for subsequent requests, is stored as a browser cookie, and is not used for tracking or analytics. CSRF tokens are also set in the browser as security mechanisms to prevent cross-site request forgery — not for tracking.

### Host Dashboard Activity Logs

Actions taken by hosts in the TR1VIA dashboard — creating games, managing questions, ending sessions — are logged for operational and troubleshooting purposes.

## Cookies and Tracking Technologies

| Cookie / Tool | Set By | Purpose | Duration |
| --- | --- | --- | --- |
| _ga | Google Analytics | Distinguishes unique users | 2 years |
| _ga_[ID] | Google Analytics | Session state for GA4 | 2 years |
| Session token cookie | TR1VIA | Authenticates host login | Until logout |
| CSRF token | TR1VIA | Prevents request forgery | Session |
| Vercel Analytics | Vercel | Performance measurement (no persistent cookie) | N/A |

TR1VIA does not use advertising cookies, tracking pixels, or retargeting technologies.

## Why We Use This Data (Legal Bases)

| Purpose | GDPR Basis | US Basis |
| --- | --- | --- |
| Running the trivia platform | Contract / Legitimate interest | Necessary for service |
| Authenticating host logins | Contract performance | Necessary for service |
| Analytics and performance | Legitimate interest | Disclosed use |
| Security and fraud prevention | Legitimate interest / Legal obligation | Necessary for service |
| Privacy rights requests | Legal obligation | Legal obligation |

## How Long We Keep Data

| Data Type | Retention Period |
| --- | --- |
| Server access logs (Vercel) | Up to 30 days |
| Google Analytics data | [X months — configure in GA4] |
| Vercel Analytics data | [Y days — configure in Vercel] |
| Player display names | Deleted when game session ends |
| Player session data and answer timestamps | Not retained after game ends |
| Host email address | While account is active; deleted within 30 days of deletion request |
| Host dashboard activity logs | [Z days — configure and enter here] |
| WebSocket connection metadata | Not retained after session ends |

## Who We Share Data With

TR1VIA does not sell your personal information. We do not use your data for advertising or retargeting. We do not share your data with third parties except as described below.

| Provider | Role | Data Shared | Privacy Policy |
| --- | --- | --- | --- |
| Vercel | Infrastructure and analytics processor | IP address, User-Agent, page requests, performance data | vercel.com/legal/privacy-policy |
| Google | Analytics processor (GA4) | IP address, device identifiers, browser/OS, session behavior | policies.google.com/privacy |
| Resend | Email delivery processor | Host email address, magic link content | resend.com/legal/privacy-policy |

Each provider acts as a data processor — processing data on our behalf, bound by data processing agreements (DPAs). We have confirmed or are confirming DPAs with Vercel and Google.

We may also disclose information if required by law, court order, or to protect the rights and safety of TR1VIA, its users, or the public.

## International Data Transfers

TR1VIA is based in the United States. Vercel and Google process data in the US. If you are located in the EU, EEA, UK, or another jurisdiction with data transfer restrictions, your information may be transferred to and processed in the United States. We rely on appropriate transfer mechanisms — including Standard Contractual Clauses (SCCs) — where applicable.

TR1VIA is currently marketed to US venues. If TR1VIA expands to serve EU or UK customers, this policy will be updated to include an EU/UK representative before that expansion takes place.

## Security

We take reasonable technical and organizational measures to protect the data we handle:

- All data transmitted to and from tr1via.com is encrypted in transit using TLS (HTTPS)
- Access to host data and dashboard logs is restricted to authorized personnel
- Magic link authentication tokens expire after use and are not reusable
- Session tokens are stored in browser cookies with appropriate security attributes

If a security breach occurs that affects hosts' personal data, we will notify affected hosts within 72 hours of becoming aware of the breach, as required by applicable law. If you discover a security issue, report it to support@vyntechs.com.

## Your Privacy Rights

Your rights over your personal information depend on where you live.

| Right | Who Has It | How to Exercise |
| --- | --- | --- |
| Right to know / access | Everyone | Email support@vyntechs.com or use the privacy request form |
| Right to delete | Everyone | Email support@vyntechs.com or use the privacy request form |
| Right to correct | Everyone | Email support@vyntechs.com or use the privacy request form |
| Right to portability | EU/UK + California | Email support@vyntechs.com or use the privacy request form |
| Right to object | EU/UK residents | Email support@vyntechs.com or use the privacy request form |
| Right to restrict processing | EU/UK residents | Email support@vyntechs.com or use the privacy request form |
| Right to opt out of sharing | California + all users via GPC | Send GPC signal via browser, or email support@vyntechs.com |
| Right to non-discrimination | California (CCPA) | Automatic |
| Right to appeal | Virginia, Colorado, Texas | Email support@vyntechs.com within 30 days of our decision |
| Right to lodge a complaint | EU/UK residents | Contact your national data protection authority or the ICO (UK) |

### Response Timeframes

We will respond to privacy rights requests within 30 days. For California residents, we will acknowledge within 10 business days and complete within 45 calendar days. If we need more time, we will notify you.

Because players do not create accounts or provide identifying information, we may not be able to locate data for a specific player. If you played a game and want to exercise your rights, provide the date, venue, and approximate time so we can search.

## How We Handle "Do Not Sell or Share" Requests

TR1VIA does not sell personal information. However, because Google Analytics involves transmitting data to Google, this may constitute "sharing" under CCPA. You can opt out by:

- Using the Google Analytics Opt-Out Browser Add-On
- Enabling a Global Privacy Control (GPC) signal in your browser — TR1VIA honors GPC signals as opt-out requests
- Emailing support@vyntechs.com to request opt-out

## Changes to This Policy

When we make material changes to this policy, we will:

- Update the "Last Updated" date at the top
- Email hosts at least 30 days before the changes take effect
- Post a notice at tr1via.com

Continued use of TR1VIA after changes take effect means you accept the updated policy. If you are a host and do not agree, contact us at support@vyntechs.com.

## Contact Us

Email: support@vyntechs.com
Privacy request form: [PRIVACY REQUEST FORM URL — build at tr1via.com/privacy-request]
Mailing address: Vyntechs, 1712 Raylene Dr, Cleburne, TX 76033

This policy was written to be readable, not to obscure anything. If something is unclear, email us.
