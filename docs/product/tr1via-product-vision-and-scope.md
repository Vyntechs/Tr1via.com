# TR1VIA Product Vision, Scope, and Development Doctrine

**Status:** canonical product scope draft
**Last updated:** 2026-07-07

## 1. Product Doctrine

TR1VIA is the room game console for real life.

It turns a shared physical room into a live game show: the TV is the stage, phones are controllers, the host is the director, AI is the production assistant, and the room feels alive together.

TR1VIA starts with host-led trivia nights because trivia is the clearest wedge. Venues already understand it. Hosts already run it. Players already know how to play. Heather's Classic gives the product a real protected format with a real live host.

The first market wedge is venue entertainment: bars, restaurants, breweries, community spaces, and recurring trivia hosts who want a polished night without hardware, table tablets, or app downloads.

The long-term expansion is broader live-room play: families, offices, classrooms, fundraisers, weddings, parties, and other rooms where people are physically together and want a shared game.

Every future TR1VIA mode must preserve the product grammar:

- TV is the stage.
- Phones are controllers.
- The host is the director.
- AI helps produce.
- The room feels interconnected.
- Joining stays easy.
- Heather's Classic stays protected.

TR1VIA expands by adding modes around Classic, not by eroding Classic.

### CEO Operating Doctrine

TR1VIA has two non-negotiable truths:

- Heather's product stays personal, familiar, and dependable.
- The company still aims to capture a very large market.

Those are not opposing goals. Heather's live night is the proof that the product
works in a real room. Market-capture work should preserve that proof and build
commercial leverage around it.

The default strategy is:

- keep Heather's Classic flow stable unless she explicitly opts into a change
- turn her comfort into the product's reliability benchmark
- add venue, host, content, pricing, onboarding, and GTM layers around Classic
- make new game formats separate modes, not surprise changes to Classic
- let Heather keep using TR1VIA as her personal product while the business grows

The agent operating posture is delegated execution with gated authority. Brandon
sets the CEO intent and hard gates; agents should drive discovery, planning,
implementation, proof, and PRs without waiting for Brandon to micromanage. Agents
still stop for production deploys, money/pricing commitments, risky data/auth
changes, public claims, and anything that would materially alter Heather's live
flow.

Business ambition should be treated seriously. TR1VIA is not just a nice tool for
one host; it should be built like a category-defining room-game platform. The
way to pursue that ambition is not to destabilize the host who made it real. The
way is to make Heather's working product the protected center and compound
market expansion around it.

## 2. Heather's Classic

Heather's Classic is the protected original TR1VIA experience: host-led Jeopardy-style trivia built for Heather's real weekly game.

Heather always has Heather's Classic.

No matter what TR1VIA becomes, Heather can still open the product and run the familiar Classic trivia night. Classic is not a temporary v1, not deprecated when new modes arrive, and not silently changed into another format.

Classic can improve forever, but its game contract remains recognizable.

Allowed by default:

- visual polish
- reliability improvements
- clearer host controls
- better setup and question review
- better mobile readability
- better TV pacing
- optional Room Magic overlays
- optional host-level settings

Not allowed by surprise:

- changed host-led flow
- changed answer, lock, reveal, or score expectations
- forced accounts
- new host moderation duties
- reaction-based scoring
- open player chat
- experimental mechanics inside Classic

Classic may become smoother, prettier, more reliable, and more magical. It must not make the host ask, "Wait, how do I run this now?"

## 3. North Star and Market Wedges

The north star is Universal Room Game Console.

The first market wedge is Venue Entertainment Network.

The future expansion is Family Night Reinvention and broader live-room play.

### Universal Room Game Console

TR1VIA becomes the engine for any shared physical room. Venue trivia comes first. Family night, classrooms, offices, weddings, fundraisers, watch parties, and retreats can come later. The product is not only trivia; it is live-room play.

### Venue Entertainment Network

A venue can run a full weekly entertainment program from TR1VIA: trivia night, recurring leagues, regulars, prize boards, sponsor moments, seasonal events, and venue-branded screens through one simple host flow.

Heather's Classic is the house format. The venue layer wraps around it with regulars, standings, event pages, summaries, and next-week momentum.

### Family Night Reinvention

A family opens TR1VIA on the TV. No board, no cards, no missing pieces, no setup friction. Phones become controllers. AI can help make rounds about family history, holidays, school, inside jokes, and mixed-age topics.

This is a future expansion, not the first wedge.

## 4. Room Magic Doctrine

Room Magic is the first expansion layer because it improves Heather's Classic without changing the rules.

Room Magic is not chat. It is not social media. It is not another dashboard for the host to manage.

Room Magic is the feeling that every device knows the room is alive.

Core principles:

- Reactions happen at safe moments: lock-in, reveal, leaderboard, intermission, finale.
- Reactions never interrupt answering.
- Reactions never change score in Heather's Classic.
- The TV turns individual actions into shared atmosphere.
- Player phones feel personal; the TV feels collective.
- Host controls stay calm.
- The host should never babysit the room.
- No free text at first.
- Use bounded reactions first: applause, good job, wow, close one, comeback, happy, shocked.
- Encourage kindness and energy, not heckling.

Example moments:

- A player locks in and their phone gives a tiny "sent to the room" pulse.
- The TV shows lock-in energy gathering as more players answer.
- On reveal, players can tap applause or "nice one."
- If only a few players got it right, the TV gives them a subtle spotlight.
- If most players missed, the room gets a shared "that one was brutal" beat.
- The host sees energy, not chaos.

Taste rule:

> TR1VIA should feel like the room is smiling back.

Room Magic should feel like a live game show with a little magic in the walls: warm, clever, bounded, and legible.

## 5. Capability Map

The product is scoped globally and implemented locally. The map below is not a timeline. It is the set of product capability domains that future sessions pull from.

### 5.1 Heather's Classic

**Purpose:** preserve and polish the original live trivia product.

**Users:** Heather, future hosts like Heather, and players in a live venue.

**Promise:** a host can run a professional live trivia night with one laptop or TV, a private host phone, and players' phones.

**Scope:**

- host setup
- live host console
- TV surface
- player phones
- scoring
- reveal
- recap
- reliability
- polish
- optional room magic overlays

**Rule:** improve the experience, do not change the game contract.

**Done means:** Heather can run the same night she knows, but it feels smoother, clearer, and more alive.

### 5.2 Reliability and Ops

**Purpose:** protect the "one press, three surfaces" promise.

**Users:** everyone, especially the host under pressure.

**Promise:** when the host acts, TV and phones respond quickly, recover gracefully, and never embarrass the host.

**Scope:**

- realtime health
- reconnect states
- stale state detection
- smoke tests
- production-safe deploy flow
- rollback discipline
- venue Wi-Fi resilience
- live-game monitoring

**Non-goals:**

- flashy features that hide instability
- risky deploys during active venue nights
- rewrites without proof

**Done means:** the product feels boringly dependable under messy venue conditions.

### 5.3 Content Quality and Cost Control

**Purpose:** make generated questions trustworthy and affordable.

**Users:** hosts, players, and the business.

**Promise:** hosts get fast question help without being embarrassed by false answers or crushed by API cost.

**Doctrine:**

> AI never creates final trivia. AI creates candidates. TR1VIA earns the right to publish them.

**Scope:**

- candidate question generation
- fact verification
- ambiguity detection
- multiple-correct-answer detection
- stale/current-events risk detection
- human-review flags
- approved question bank
- reusable and remixable approved content
- image attachment only after question survival
- cost tracking per accepted question and usable category

**Question quality rules:**

- Every accepted question has one defensible answer.
- If wording could cause a bar argument, rewrite or reject it.
- If the answer depends on date, geography, interpretation, ranking, "first," "largest," or "best," flag it.
- If source confidence is low, do not ship silently.
- Host review should explain why the question is safe in plain language.

**Cost rules:**

- Do not spend image/API money on bad candidates.
- Do not generate from scratch when approved content already exists.
- Do not use expensive models for every step.
- Do not verify every question the same way.
- Measure cost per trusted question, not raw generation cost.

**Done means:** the product optimizes for cost per trusted question, not cost per API call.

### 5.4 Room Magic

**Purpose:** make every device feel interconnected.

**Users:** players first, then host, then spectators watching the TV.

**Promise:** the room feels like one shared living game show, not isolated phones.

**Scope:**

- bounded reactions
- applause after reveal
- lock-in energy
- "room is split" moments
- comeback moments
- TV atmosphere responding to player actions
- phone micro-feedback showing that actions reached the room

**Non-goals:**

- no open chat first
- no free text first
- no reaction spam
- no scoring impact in Heather's Classic
- no host moderation burden

**Done means:** players naturally interact more without needing instructions.

### 5.5 Host Power

**Purpose:** make the host feel calm, prepared, and in control.

**Users:** Heather and future hosts.

**Promise:** the host spends less time fighting setup and more time running the room.

**Scope:**

- better category creation
- manual edit polish
- saved templates
- reusable nights
- image control
- question quality review
- safer undo
- host phone improvements
- "what happens next" clarity

**Non-goals:**

- no enterprise dashboard bloat
- no complex setup wizard before the first win
- no AI doing things the host cannot review

**Done means:** a host trusts TR1VIA more than spreadsheets, cards, or improvised tools.

### 5.6 AI Creation

**Purpose:** make AI the production assistant, not the game master.

**Users:** hosts.

**Promise:** a host can create a great night faster while TR1VIA protects quality.

**Scope:**

- category generation
- difficulty shaping
- local/event-specific rounds
- theme packs
- image suggestions
- rewrite suggestions
- "make this safer/funnier/easier"
- creative variants over already-trusted content

**Non-goals:**

- no unverified AI questions in live games
- no black-box "trust me" generation
- no AI replacing host judgment

**Done means:** hosts feel like they have a producer, editor, and fact-checker beside them.

### 5.7 Venue Business

**Purpose:** make TR1VIA worth running every week.

**Users:** venue owners, managers, recurring hosts, regular players.

**Promise:** trivia night becomes a repeatable venue asset, not a one-off event.

**Scope:**

- venue profile
- recurring weekly night
- public event page
- QR join poster
- branded TV/lobby screen
- attendance summary
- returning player count
- league standings
- season winners
- prize tracking
- sponsor/promo moments
- next-week teaser
- host/venue performance summary

**Non-goals:**

- no heavy CRM early
- no ad network early
- no complicated venue admin before the core night works
- no features that make the live room feel commercial or cheap

**Done means:** a venue can say, "TR1VIA helps bring people back next week."

### 5.8 Player Identity

**Purpose:** let regulars feel recognized without slowing down join.

**Users:** repeat players.

**Promise:** players can stay lightweight and anonymous-ish, but still feel like regulars.

**Scope:**

- persistent device identity
- editable display name
- avatar/color
- returning-player welcome
- streaks
- badges
- venue-specific stats
- favorite categories
- optional account later
- privacy controls

**Non-goals:**

- no forced login
- no social network
- no public profile pressure
- no unnecessary personal data

**Done means:** joining still takes seconds, but regulars feel known.

### 5.9 GTM System

**Purpose:** turn product truth into repeatable growth.

**Users:** founder first, later GTM team.

**Promise:** TR1VIA can be demonstrated, sold, onboarded, and learned from without making false claims.

**Scope:**

- venue pitch
- demo night script
- founder-led sales checklist
- onboarding flow
- pricing packaging
- case studies
- host testimonial capture
- website funnels
- comparison pages
- CRM-lite tracking
- post-demo follow-up
- feedback loop into product packets

**Non-goals:**

- no fake logos
- no inflated metrics
- no selling unreleased features as done
- no enterprise sales theater before repeatable venue fit

**Done means:** someone other than the founder can explain why a venue should try TR1VIA.

### 5.10 Trust, Safety, Privacy

**Purpose:** make public-room play safe and defensible.

**Users:** hosts, venues, players, parents, and the operator.

**Promise:** TR1VIA creates fun without creating avoidable risk.

**Scope:**

- no unnecessary PII
- child/minor-aware posture
- player display-name controls
- content filters
- host moderation controls
- abuse prevention
- anti-cheat
- data deletion
- audit logs for important host actions
- AI content safety
- privacy policy alignment

**Non-goals:**

- no surveillance analytics by default
- no ad tracking by default
- no open chat until moderation exists
- no dark patterns around player identity

**Done means:** the product can grow into public rooms without becoming reckless.

### 5.11 New Game Formats

**Purpose:** expand beyond trivia without losing the TR1VIA grammar.

**Users:** venues first, then families, groups, classrooms, and events.

**Promise:** once the room engine is trusted, hosts can run more than one kind of live game.

**Potential formats:**

- Classic + Room Magic
- Venue League Classic
- family/party mode
- feud-style survey
- visual guessing
- prediction rounds
- rapid-fire
- "which player said it?"
- team mode
- photo rounds
- seasonal party packs
- classroom review games
- fundraiser games

**Rules:**

- new formats are separate modes
- Heather's Classic is never the testing ground
- every mode uses the TR1VIA grammar
- every mode has its own game contract and verification

**Done means:** TR1VIA is no longer only trivia, but it still feels like TR1VIA.

## 6. Game Mode Doctrine

TR1VIA can grow into many game formats, but every format is a separate mode, not a mutation of Heather's Classic.

Every mode must define:

- who hosts it
- who plays it
- what the TV shows
- what phones do
- how answers work
- how scoring works
- when reactions are allowed
- what AI can generate
- what safety rules apply
- how it is verified
- whether it can ship to `main` or needs staging

Host-facing mode list can eventually include:

- Heather's Classic
- Classic + Room Magic
- Venue League Night
- Family Party
- Survey Show
- Visual Guess
- Custom AI Night

Early on, Heather should simply keep seeing Classic unless something optional is intentionally exposed.

## 7. GTM Doctrine

TR1VIA should not go to market as another trivia app.

It should go to market as:

> The easiest way to turn a venue into a live game show using the phones already in the room.

The pitch is true:

- no hardware
- no app download
- no table tablets
- one host
- one TV
- every phone connected
- AI helps create the night
- the room feels alive

### First GTM wedge

The first commercial buyer is the venue or recurring host, not the family consumer.

Reasons:

- venues already need weeknight traffic
- trivia already exists as a known behavior
- repeat usage is natural
- public rooms create visible proof
- venue success can become case studies
- Heather's Classic gives the product a credible origin story

### GTM team role

A future GTM team should:

- sell the room transformation, not a dashboard
- onboard hosts carefully through Classic first
- bring product signal back from rooms
- package proof honestly

The GTM team does not invent the product. It packages, tests, sells, learns, and brings signal back.

### Pricing doctrine

Do not price before the value is clear, but keep value buckets visible:

- founder-led trial
- host subscription for AI creation
- venue plan for recurring nights
- league/season plan
- white-label or sponsor tools later
- consumer/family packs later

Pricing rule:

> Charge for saved preparation, recurring venue value, and production polish. Do not charge players to join.

Player join should stay frictionless.

## 8. Development Operating Model

TR1VIA is scoped globally and implemented locally.

The global scope doc guides all work, but every build session chooses one capability packet, writes a fresh implementation plan, verifies it, PRs it to the right branch, and stops.

Future sessions should not attempt to implement the whole map. They should pull one packet or sub-packet and work it end to end.

Every task packet should define:

- purpose
- user
- product promise
- what changes
- what must not change
- dependencies
- risks
- verification
- branch strategy
- whether it can go to `main` or needs staging
- how Heather's Classic is protected

No timelines are required in this document. Work is ordered by dependency and strategic leverage, not by calendar claims.

Dependency gravity:

1. Heather's Classic
2. Reliability and Ops
3. Content Quality and Cost Control
4. Room Magic
5. Host Power
6. AI Creation
7. Venue Business
8. Player Identity
9. GTM System
10. Trust, Safety, Privacy as a constant across all work
11. New Game Formats after the core is loved

## 9. Branch and Release Doctrine

`main` is production-safe and Heather's Classic-safe.

Nothing merges into `main` unless it preserves the live game Heather knows, passes verification, and can be trusted in production.

For small safe tasks:

- branch from `main`
- PR back to `main`
- merge only after verification and review

For bigger or risky work:

- branch from `main` into `staging/<initiative>`
- merge task PRs into that staging branch
- prove the whole initiative there
- only then PR staging back to `main`

For experimental future product:

- use feature flags, host-level settings, or separate modes
- keep Heather's host account on the known default
- do not force-migrate the live flow

Production rules:

- no surprise production behavior
- no live-night deploys
- no "fix it after merge" for game flow
- no risky work straight to `main`
- no experimental mode inside Classic by default

## 10. Product Review Questions

Before building anything, future sessions should ask:

- Does this preserve Heather's Classic?
- Is this improving the core, adding a Room Magic overlay, wrapping Venue Business around the core, or creating a new mode?
- Does it make the room feel more alive?
- Does it increase host confidence?
- Does it reduce or increase operational risk?
- Does it create moderation or privacy burden?
- Does it rely on unverified AI content?
- Does it affect API cost per trusted question?
- Can this ship safely to `main`, or does it need staging?
- How will we verify it across host, TV, and player phone?

If a task touches more than one capability class, split it or explicitly stage it.

## 11. Canonical Summary

TR1VIA is the room game console for real life.

Heather's Classic is the sacred original mode.

The venue wedge is first.

Room Magic makes the current product feel alive without changing its rules.

Content Quality and Cost Control protect trust and margin.

New modes grow around Classic, never through it.

Development happens through small, scoped task packets and production-safe PRs.
