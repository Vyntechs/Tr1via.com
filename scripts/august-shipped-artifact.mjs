// Build the review page for the shipped August theme, with every screenshot
// base64-inlined so it renders with no external requests (the Artifact CSP
// blocks them). Output: tasks/august-concepts/august-shipped.html
//
//   node scripts/august-shipped-artifact.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SHOTS = "tasks/august-shipped";
const OUT = "tasks/august-concepts/august-shipped.html";

mkdirSync("tasks/august-concepts", { recursive: true });

const img = (file) =>
  `data:image/jpeg;base64,${readFileSync(join(SHOTS, file)).toString("base64")}`;

/** The night, in order. Captions are written for Heather, not for engineers. */
const TV = [
  ["tv-01-01-lobby.jpg", "Lobby", "The room fills up. A page torn out of a spiral notebook — punch holes down the gutter, the red margin rule, blue ruling. A football doodled in the middle of the page in ballpoint, and one leaf already taped in."],
  ["tv-02-01a-lobby-with-tonight-s-topics.jpg", "Lobby · with tonight's topics", "Same page, with the six categories listed so people know what they're walking into."],
  ["tv-03-02-grid.jpg", "The board", "The one screen with no spare page, so it gets no doodle — the categories, the standings and the up-next panel fill it. Two pressed leaves in the empty corner and the paper carry the month."],
  ["tv-04-03-question.jpg", "Question", "The play doodled in the margin: three linemen, a back, one route, one arrowhead. No team, no logo, no ball. On the right, the first leaf that turned, taped flat into the page."],
  ["tv-05-03a-question-may-storm-marquee-30s-timer.jpg", "Question · with the live marquee", "The same question screen with the scrolling lock-in marquee along the bottom."],
  ["tv-06-03b-question-long-prompt-with-image-regression-case.jpg", "Question · long prompt with a photo", "The hard layout case — a long question and an attached photo. The page holds."],
  ["tv-07-03c-question-may-storm-long-prompt-combined-regression-case.jpg", "Question · long prompt and marquee together", "The hardest case: everything on screen at once."],
  ["tv-08-04-reveal-correct.jpg", "Reveal", "The reveal drops its curtain of green — the notebook does not repaint over it, because that moment belongs to the answer. The leaves keep falling straight through it."],
  ["tv-09-05-reveal-stumper.jpg", "Reveal · stumper", "When nobody got it. Back on the page."],
  ["tv-10-06-leaderboard.jpg", "Standings", "A star scrawled beside whoever is winning, and three leaves pressed in along the bottom."],
  ["tv-11-07-section-complete-cinematic-over-the-grid.jpg", "Round complete", "The cinematic over the board between rounds."],
  ["tv-12-08-intermission.jpg", "Between games", "The paper football everyone folded in study hall, sitting on the page. School and football in one object — which is exactly what August is."],
  ["tv-13-09-finale-winner-heightened-weather.jpg", "Finale", "Five leaves taped in by now. The page fills up as the night goes, so by the end it is a record of the evening rather than a decorated background."],
];

const PLAYER = [
  ["player-00-01-join.jpg", "Join", "What a player sees when they scan the code."],
  ["player-01-02-lobby.jpg", "You're in", "Their name written at the top of the page."],
  ["player-02-02a-lobby-tonight-s-topics.jpg", "Waiting · tonight's topics", "The six categories, before the first question."],
  ["player-03-03-question-live-text.jpg", "Question", "The page, scaled to a phone: holes at the very edge, the margin rule left of everything, four answers written on the ruled lines."],
  ["player-04-03b-question-live-w-image.jpg", "Question · with a photo", "With the attached photo."],
  ["player-05-03c-question-live-long-163ch.jpg", "Question · long", "A 163-character question — the longest realistic case."],
  ["player-06-04-locked-live-count-standings.jpg", "Locked in", "After they answer: the live count and where they stand."],
  ["player-07-05-reveal-correct.jpg", "Got it right", "The correct takeover. Leaves fall through it; the paper stays out of the way."],
  ["player-08-06-reveal-wrong.jpg", "Got it wrong", "The other half of the room."],
  ["player-09-07-join-game-2.jpg", "Join game 2", "Between games."],
  ["player-10-07b-between-games-waiting.jpg", "Waiting for game 2", "While the host sets up."],
  ["player-11-08-winner-card-finale.jpg", "Winner card", "What the winner keeps — savable as a photo."],
  ["player-12-09-recap-finale.jpg", "Recap", "Everyone's night, at the end."],
];

const section = (title, kicker, items) => `
<section class="run">
  <div class="run-head">
    <p class="kicker">${kicker}</p>
    <h2>${title}</h2>
  </div>
  <div class="shots">
    ${items
      .map(
        ([file, name, caption]) => `
    <figure>
      <img src="${img(file)}" alt="${name}" loading="lazy" />
      <figcaption><b>${name}</b> ${caption}</figcaption>
    </figure>`,
      )
      .join("")}
  </div>
</section>`;

const html = `<title>August · Still Summer — built</title>
<style>
  :root {
    --paper: #F0EAD4;
    --page: #F6F1DE;
    --ink: #1D2616;
    --ink-mid: rgba(29,38,22,.68);
    --ink-mute: rgba(29,38,22,.44);
    --accent: #DE7F1E;
    --pop: #4A8B46;
    --pen: #27498C;
    --rule: rgba(216,84,64,.55);
    --ruling: rgba(96,150,215,.22);
    --edge: rgba(29,38,22,.14);
    --ground: #EFE7CE;
    --shadow: 0 26px 60px -34px rgba(60,54,32,.6);
    --sans: ui-sans-serif, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ground: #14120E;
      --edge: rgba(244,238,216,.16);
      --shadow: 0 30px 70px -30px rgba(0,0,0,.85);
    }
  }
  :root[data-theme="dark"] {
    --ground: #14120E;
    --edge: rgba(244,238,216,.16);
    --shadow: 0 30px 70px -30px rgba(0,0,0,.85);
  }
  :root[data-theme="light"] {
    --ground: #EFE7CE;
    --edge: rgba(29,38,22,.14);
    --shadow: 0 26px 60px -34px rgba(60,54,32,.6);
  }

  body {
    margin: 0;
    background: var(--ground);
    color: var(--ink);
    font-family: var(--sans);
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }

  /* The review page is the concept: one sheet of ruled paper on a desk. */
  .sheet {
    max-width: 1140px;
    margin: 0 auto;
    background: var(--page);
    background-image:
      radial-gradient(60% 40% at 86% 2%, rgba(255,226,150,.5), transparent 62%),
      repeating-linear-gradient(to bottom, var(--ruling) 0 1px, transparent 1px 38px);
    background-attachment: scroll;
    box-shadow: var(--shadow);
    position: relative;
    padding: 0 clamp(22px, 5vw, 76px) 96px 0;
  }
  /* Punch holes + margin rule, in a gutter nothing is written into. */
  .gutter {
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: clamp(46px, 7vw, 86px);
    pointer-events: none;
  }
  .gutter::after {
    content: "";
    position: absolute;
    right: 0; top: 0; bottom: 0;
    width: 1px;
    background: var(--rule);
  }
  .hole {
    position: absolute;
    left: clamp(10px, 1.8vw, 22px);
    width: 18px; height: 18px;
    margin-top: -9px;
    border-radius: 50%;
    background: rgba(58,52,32,.4);
    box-shadow: inset 0 2px 3px rgba(0,0,0,.35), 0 1px 0 rgba(255,255,255,.5);
  }
  .body { margin-left: clamp(58px, 8.4vw, 106px); }

  /* Torn out of the book. */
  .torn { display: block; width: 100%; height: 16px; }

  header { padding: 42px 0 8px; }
  .kicker {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: .16em;
    text-transform: uppercase;
    color: var(--ink-mute);
    margin: 0 0 10px;
  }
  h1 {
    font-size: clamp(44px, 7vw, 86px);
    line-height: .95;
    letter-spacing: -.035em;
    margin: 0 0 6px;
    text-wrap: balance;
  }
  h1 .turn { color: var(--accent); }
  .lede {
    font-size: clamp(17px, 1.6vw, 21px);
    color: var(--ink-mid);
    max-width: 60ch;
    margin: 18px 0 0;
  }

  .verdict {
    margin: 40px 0 0;
    border: 1px solid var(--edge);
    border-left: 4px solid var(--accent);
    border-radius: 4px;
    background: rgba(255,255,255,.42);
    padding: 20px 24px;
    max-width: 74ch;
  }
  .verdict p { margin: 0 0 10px; }
  .verdict p:last-child { margin: 0; }
  .verdict b { color: var(--ink); }

  h2 {
    font-size: clamp(28px, 3.4vw, 42px);
    line-height: 1.02;
    letter-spacing: -.03em;
    margin: 0;
  }
  .run { padding-top: 68px; }
  .run-head { margin-bottom: 26px; }

  .shots { display: flex; flex-direction: column; gap: 46px; }
  .tv .shots { gap: 52px; }
  figure { margin: 0; }
  figure img {
    display: block;
    width: 100%;
    height: auto;
    border-radius: 10px;
    border: 1px solid var(--edge);
    box-shadow: 0 18px 40px -26px rgba(60,54,32,.6);
  }
  figcaption {
    margin-top: 12px;
    font-size: 15px;
    color: var(--ink-mid);
    max-width: 68ch;
  }
  figcaption b { color: var(--ink); }

  /* Phones are small; show them as a grid rather than one per row. */
  .phones .shots {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 34px 26px;
  }
  .phones figure img { border-radius: 22px; }
  .phones figcaption { font-size: 14px; }

  .note {
    margin-top: 28px;
    font-family: var(--mono);
    font-size: 12.5px;
    line-height: 1.7;
    color: var(--ink-mute);
    border-top: 1px solid var(--edge);
    padding-top: 18px;
    max-width: 78ch;
  }
  .note b { color: var(--ink-mid); }

  .pen {
    color: var(--pen);
    font-weight: 700;
  }

  @media (max-width: 640px) {
    .sheet { padding-right: 18px; }
    .body { margin-left: 52px; }
    .gutter { width: 44px; }
  }
</style>

<div class="sheet">
  <svg class="torn" viewBox="0 0 1280 16" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 0 H1280 V7 C1240 13 1210 4 1170 9 C1120 15 1090 5 1040 10 C990 15 960 4 910 9 C860 14 830 4 780 9 C730 15 700 5 650 10 C600 15 570 4 520 9 C470 14 440 4 390 9 C340 15 310 5 260 10 C210 15 180 4 130 9 C80 14 40 5 0 9 Z" fill="rgba(255,252,240,.95)"/>
  </svg>

  <div class="gutter" aria-hidden="true">
    <span class="hole" style="top:14%"></span>
    <span class="hole" style="top:34%"></span>
    <span class="hole" style="top:54%"></span>
    <span class="hole" style="top:74%"></span>
    <span class="hole" style="top:94%"></span>
  </div>

  <div class="body">
    <header>
      <p class="kicker">TR1VIA · August 2026 · built, not shipped</p>
      <h1>Still <span class="turn">Summer</span>.</h1>
      <p class="lede">
        The one you picked, now running inside the actual product. Every screen below
        is the real thing — the same components a venue TV and a player's phone render
        on the night — with the August theme switched on.
      </p>

      <div class="verdict">
        <p><b>What changed since the concepts.</b> Nothing about the look. This is the
        same page, the same half-green leaves and the same ballpoint hand you approved
        — moved out of the mockup and into the codebase, so it now happens by itself
        on every screen of the night instead of on eight canned ones.</p>
        <p><b>What August replaced.</b> The old August was a dark brown room wearing
        September's red and October's orange. That is why every fall month looked
        alike. August is now the only light page in the back half of the year, and
        September, October and November keep their palettes untouched.</p>
        <p><b>Where it stands.</b> Built and tested on this machine, nowhere else.
        Not committed, not merged, not deployed — and it cannot go live tonight,
        because tonight is a show.</p>
      </div>
    </header>

    ${section("The venue TV", "One press, three surfaces · 1280×720", TV).replace('<section class="run">', '<section class="run tv">')}

    ${section("A player's phone", "What 20–40 people are holding", PLAYER).replace('<section class="run">', '<section class="run phones">')}

    <section class="run">
      <div class="run-head">
        <p class="kicker">The argument, in one picture</p>
        <h2>It leaves fall something to wear.</h2>
      </div>
      <div class="shots">
        <figure>
          <img src="${img("marketing-themes.jpg")}" alt="All twelve monthly themes" loading="lazy" />
          <figcaption><b>Twelve months, side by side.</b> Your first note on the earlier
          round was that it spent fall's palette a month early. August is now the only
          light page down here — September, October and November are untouched, and the
          three of them still have the whole autumn to themselves.</figcaption>
        </figure>
      </div>
    </section>

    <section class="run">
      <div class="run-head">
        <p class="kicker">The host's own screens</p>
        <h2>Your laptop.</h2>
      </div>
      <div class="shots">
        <figure>
          <img src="${img("host-gallery-full.jpg")}" alt="Host laptop and phone surfaces" loading="lazy" />
          <figcaption><b>Dashboard, setup, onboarding and the host phone.</b> The two
          black panels are the live-console preview, which needs a real game to draw —
          in a live night that panel is the TV picture, so it wears the page too.</figcaption>
        </figure>
      </div>
    </section>

    <p class="note">
      <b>Rules the build follows.</b> Nothing ornamental ever covers a question, an
      answer, the timer or the host's lock-in counts — marginalia is placed only against
      screens whose empty space was checked against a real render, and a screen the theme
      hasn't been told the name of simply gets no doodle. A phone gets the page and the
      leaves but no marginalia; it is held one-handed and has no spare room. A screen that
      paints its own background — the reveal — is never painted over.<br /><br />
      <b>Proof.</b> 839 tests pass, 0 fail. Nine of them are new and pin the two decisions
      that are easy to undo by accident: that August stays off fall's palette, and that
      nothing ornamental lands where it can cover content. Type-check is clean apart from
      two pre-existing errors in an unrelated test file. All 27 screens above were captured
      with no console or page errors.<br /><br />
      <b>Still open.</b> Heather has not seen this yet. The category colours (the teal on
      Geography, the pink on Movies) are shared by all twelve months and are untouched here
      — worth a look on paper, but changing them is a separate call.
    </p>
  </div>
</div>
`;

writeFileSync(OUT, html);
console.log(`wrote ${OUT} — ${(html.length / 1024 / 1024).toFixed(2)} MB`);
