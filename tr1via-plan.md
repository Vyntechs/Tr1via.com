# TR1VIA — Project Plan & Decisions

*Single source of truth. Living document — keep it updated as decisions are made.*
*Last updated: 2026-05-21.*

---

## SUMMARY — read this first

**What this is:** A from-scratch rebuild of a live trivia game web app, hosted at **tr1via.com** (Brandon owns the domain; it is a real production website).

**Who it's for:** One specific customer — a woman who hosts live trivia nights at a local pizza place (Wednesdays) and at other venues. She currently uses TriviaMaker.com (its Jeopardy-style "Grid" game). This app replaces TriviaMaker for her. Brandon is not charging her. She is his first real customer, and this is also his showcase project. The bar: the most beautiful, polished trivia experience possible — far beyond TriviaMaker.

**Who does what:**
- The **game's look and feel** (screens, layout, animations) → designed in **Claude Design** (Anthropic's design product, at claude.ai/design). Its finished design hands off to Claude Code to build.
- The **foundation and build** (game logic, data, the working app) → built with Claude Code.
- **Brandon** owns every product decision and reviews/merges all work himself.

**Where we are:** Still gathering requirements from a voice recording of Brandon and the host. **Brandon has more details from that recording not yet captured here.** Nothing is being built yet.

**The plan, in order:**
1. **Rules** — capture exactly how the game works (this document). No visuals yet.
2. **Look** — Brandon takes the finished rules into Claude Design and designs the screens.
3. **Build** — Claude Code writes the build plan around the real screens, splits it into small pieces built as pull requests; Brandon reviews and merges each one.

**How to read this document:**
- **LOCKED** = confirmed by Brandon. Treat as fact. Do not re-decide or re-open.
- **OPEN** = not yet decided. Still needs discussion.
- This document holds only what Brandon and the host have actually said — not guesses. If a LOCKED item is wrong, Brandon strikes it.

**For the next Claude session:** Read this whole document before doing anything. Do not rebuild assumptions or re-decide LOCKED items. Brandon is non-technical — explain everything in plain English, no jargon. Continue by helping Brandon resolve the OPEN items and relay the rest of the voice recording. Keep this file updated as decisions are made.

---

## LOCKED DECISIONS

### The game
- It is a **Jeopardy-style grid game**: several **categories**, each with **6 questions** worth **100, 200, 300, 400, 500, and 600 points**.
- It supports **many different topics/categories** and is **fully customizable** — the host picks the categories herself. It is **not** limited to any one subject.
- Questions are **multiple choice**, with **4 answer options**.
- **Every player plays solo.** No teams, ever. Even a table of 9, or a whole family — each person plays alone on their own phone.

### The session (the trivia night)
- The host's time slot is **1 hour 45 minutes**.
- She runs **2 separate, full games** per night (~50 minutes each), so people who arrive late can still play a complete game.
- Each game must be **precisely timed** so both fit in the slot. The **number of categories** is adjusted to fit the time available.

### How a question works (the live game flow)
- The host's **laptop is the source screen.** It connects to the venue **TV with an HDMI cord, and the TV mirrors the laptop exactly** — whatever is on her laptop is on the TV.
- The host **sees and reads each question privately first**, to capture the room's attention, before anyone else can see it. *(See OPEN — this private preview needs a device other than the mirrored laptop.)*
- When she is ready she **presses a button.** At that moment three things happen together: the **question appears on the TV**, the **4 answer options appear on every player's phone**, and the **20-second timer starts**.
- If a player doesn't pick an answer within the 20 seconds, they miss their chance on that question.
- The **question is shown only on the TV** — it is never sent to players' phones. Players read the question off the TV.
- **Anti-cheat — scrambled answer order:** each phone shows the 4 options as the real answer text, numbered **1–4**, but the **order is randomized separately on every phone**. If someone shouts "the answer is 3!", that "3" is a different answer on everyone else's phone — so it doesn't help cheaters. A player has to actually read their own options.
- After a player picks, they are **not told right or wrong** until the timer ends. When the timer ends, **everyone is shown right/wrong at the same moment** — on their own phone and on the TV.

### Setting up and running the game (host side)
- The host goes to **tr1via.com** and chooses **"Host."**
- She has a **painless setup** where she picks/enters the categories for the game.
- **The host drives the game by default** — she chooses which category/question comes next.
- There is also an **optional "auto" mode** where the game advances on its own.

### Building the questions (before the night)
- Today the host: uses ChatGPT to generate ~20 questions on a topic → picks the 6 she wants per category → finds related images on Google Images so the screens look polished.
- **She wants to do all of this inside the app's host side** — generate the questions, pick them, and add images — instead of bouncing between ChatGPT, Google, and TriviaMaker.

### Players suggesting topics
- Players can **suggest topics/categories** for future trivia nights.
- When the host sets up the next week's trivia, she **sees those suggestions** (e.g., "17 people suggested this") to help her choose categories.

### Cheating (a major concern)
- Cheating is a big problem — groups at tables sharing answers.
- Defenses already decided: the **20-second timer**, the **scrambled per-phone answer order**, and **keeping the question off players' phones**.
- Brandon also wants the app to **quietly track how long each player leaves the app** (switches to another app, or exits their browser) — as a signal the host can glance at.
- **Anti-cheat must never create friction** for the host or the players. It stays invisible and never accuses anyone.

### Look & feel
- The app is **themed by month** — its look matches the time of year:
  - January — ice, cold, snow
  - February — Valentine's Day
  - March — St. Patrick's Day
  - April — spring showers and Easter; pastel colors
  - May — spring, light rain, early-summer happy colors
  - June — bright, happy colors
  - July & August — summertime
  - September — partly still summertime
  - October — Halloween
  - November — Fall / Thanksgiving
  - December — Christmas; red, white, and green
- The host wants **lots of customizability** — the ability to change and adjust things.
- The experience must feel **premium**: next-level animations and transitions, polished and refined. Interactions should feel alive — for example, selecting an answer should have a satisfying animation, not a flat response. But not so over-animated that it becomes annoying — a tasteful middle.

### Technical decisions
- **Domain:** tr1via.com (Brandon owns it and deploys it himself).
- **Database:** Neon (a Postgres database).
- **Design tool:** Claude Design, for all UI/visual work.
- **Workflow:** the build is split into small pull requests, worked on across parallel sessions; Brandon reviews, validates, and merges everything to production himself.

---

## OPEN — still to discuss

- **Scoring.** Is a correct answer worth its flat point value (100–600), or is there a speed bonus for answering faster? Any penalty for a wrong answer? When does the leaderboard show — after every question, between rounds, or only at the end? *The host has not specified this yet.*
- **How players join the game.** The QR code on the TV scans poorly in the venue, and getting everyone connected eats the host's time — especially before the second game. *Needs a decision.* (Ideas raised earlier, none decided: a short typed code as a backup, printed cards on each table, and letting players stay joined across both games.)
- **The host's private question preview.** Because the TV mirrors her laptop exactly, her private preview of the upcoming question cannot be on the laptop — the room would see it on the TV. It most likely needs to be on her **phone**. *Not yet confirmed by Brandon — he needs to say how she actually does this.*
- **The grid itself.** Does the host tap a cell on a Jeopardy-style board, or pick the next category from a list? The board may be mostly a visual style. *Detail to settle.*
- **Question images.** An app cannot use Google Images directly. How images get onto questions needs an approach. *To solve.*
- **Question generation.** Which service generates the ~20 questions inside the app, and how it works. *To solve.*
- **Players week to week.** Do players keep an identity across weeks (returning regulars, longer-running leaderboards), or is each night fresh? *Not discussed yet.*
- **The rest of the voice recording.** Brandon has more details from the recording that are not yet captured here.

---

## NOTES
- Background research on TriviaMaker and on how live trivia nights run was done in the prior session. It is not reproduced here — this document is decisions and open questions only.
- This document is the single source of truth. Keep it updated as decisions are made and open questions are resolved.
- Brandon is non-technical: everything here, and all future discussion, stays in plain English.
