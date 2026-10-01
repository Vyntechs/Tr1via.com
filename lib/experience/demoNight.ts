// A believable night at Soul Fire Pizza, as the venue TV would receive it.
//
// Used by the /dev/tv/world preview and by the experience-pack tests to
// walk every TV moment (lobby → board → question → lock-ins → last five
// seconds → time's up → reveal → between games → winner) without a
// database. Pure data: no network, no clocks except the `nowMs` passed in.

import type {
  TVAnswer,
  TVCategory,
  TVGame,
  TVPlayer,
  TVQuestion,
  TVReveal,
  TVScore,
  TVSnapshot,
} from "@/lib/hooks/useTVRoom";

export type DemoMoment =
  | "lobby"
  | "board"
  | "question"
  | "reveal"
  | "between-games"
  | "winner";

export const DEMO_PLAYER_NAMES: readonly string[] = [
  "Les Quizerables", "Coach K", "Smarty Pints", "Jen B.", "Two Brews",
  "Pizza Rat", "Wanda", "Marco", "Big Al", "Tina", "Dee", "Ricky Bobby",
  "Hot Sauce", "Ruby", "The Neighbors", "Kev", "Quizzly Bears",
  "Pun Intended", "Trivia Newton", "Big Brain Energy", "Sir Quizalot",
  "Know-It-Ales", "Dirty Martini", "Cheesy Bread", "Mom's Spaghetti",
  "The Usual", "Ghost Toast", "Booorito", "Couch Potato", "Lady Bird",
  "Taco Tues", "Bob", "Sasquatch", "Gin Rummy", "Pickles", "Jo", "Hank",
  "Nacho Mama", "Mr. Spooky", "Beth", "Waldo", "Kitty", "Dutch", "Momo",
  "Big Lou", "Ziggy", "Pepper", "Captain", "Noodle", "Rocket", "Lulu",
  "Fig", "Trixie", "Ace", "Doc", "Bean", "Sunny", "Gus", "Pip", "Moxie",
  "Juno", "Bix", "Dot", "Rex", "Tater",
];

const CATEGORY_NAMES = [
  "Willie Nelson", "Geography", "Subway", "Rodents", "Rum drinks", "The color Green",
];
const VALUES = [100, 200, 300, 400, 500, 600, 700] as const;

export interface DemoNightOptions {
  moment: DemoMoment;
  /** Players in the room (1-65). Default 29, the design's count. */
  players?: number;
  /** Question moment only: seconds left on the 25 s clock (0-25). */
  secondsLeft?: number;
  /** Question and reveal moments: how many have locked in. */
  locked?: number;
  /** Question and reveal moments: when the question went live (ms). Lets a
   *  preview keep one question's clock across its question and reveal. */
  revealedAtMs?: number;
  /** Clock the snapshot is built against. */
  nowMs?: number;
}

export interface DemoNight {
  snapshot: TVSnapshot;
  /** The live/just-resolved question's reveal timestamp, for timers. */
  revealedAt: string | null;
}

const NIGHT_START = Date.parse("2026-10-07T23:30:00Z");

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function demoNight(opts: DemoNightOptions): DemoNight {
  const nowMs = opts.nowMs ?? Date.now();
  const playerCount = Math.max(1, Math.min(DEMO_PLAYER_NAMES.length, opts.players ?? 29));
  const players: TVPlayer[] = DEMO_PLAYER_NAMES.slice(0, playerCount).map((name, i) => ({
    id: `pk-${i + 1}`,
    displayName: name,
    joinedAt: iso(NIGHT_START + i * 41_000),
    lastSeenAt: iso(nowMs),
  }));

  const game1: TVGame = {
    id: "game-1",
    gameNo: 1,
    state: "live",
    startedAt: iso(NIGHT_START + 30 * 60_000),
    endedAt: null,
    categoryCount: 6,
    questionCount: 42,
  };
  const game2: TVGame = {
    id: "game-2",
    gameNo: 2,
    state: "draft",
    startedAt: null,
    endedAt: null,
    categoryCount: 6,
    questionCount: 42,
  };

  const categories: TVCategory[] = [];
  const questions: TVQuestion[] = [];
  for (const game of [game1, game2]) {
    CATEGORY_NAMES.forEach((name, c) => {
      const categoryId = `${game.id}-cat-${c}`;
      categories.push({
        id: categoryId,
        gameId: game.id,
        name,
        topic: name,
        position: c,
        color: null,
        state: "ready",
      });
      VALUES.forEach((value) => {
        questions.push({
          id: `${categoryId}-q${value}`,
          categoryId,
          pointValue: value,
          prompt: "Which city's subway system has the most stations of any metro network in the world?",
          options: ["New York City", "Tokyo", "Moscow", "Shanghai"],
          correctIndex: null,
          imageUrl: null,
          factBlurb: null,
          playedAt: null,
          finishedAt: null,
          isPicked: true,
        });
      });
    });
  }

  // The board has seen a few questions already, like the design's board.
  const playedIds = [
    "game-1-cat-0-q100", "game-1-cat-0-q200",
    "game-1-cat-1-q100", "game-1-cat-1-q200",
    "game-1-cat-2-q100", "game-1-cat-2-q200",
    "game-1-cat-3-q100",
  ];
  playedIds.forEach((id, i) => {
    const q = questions.find((x) => x.id === id);
    if (!q) return;
    q.playedAt = iso(NIGHT_START + 40 * 60_000 + i * 90_000);
    q.finishedAt = iso(NIGHT_START + 40 * 60_000 + i * 90_000 + 25_000);
    q.correctIndex = 0;
  });

  const scores: TVScore[] = players.map((p, i) => ({
    player_key: p.id,
    display_name: p.displayName,
    score: Math.max(0, 1450 - i * 120 - (i % 3) * 10),
    correct_count: Math.max(0, 7 - Math.floor(i / 4)),
    answered_count: 7,
    fastest_correct_ms: 1100 + i * 230,
  }));

  const reveals: TVReveal[] = [];
  let liveAnswers: TVAnswer[] = [];
  let liveQuestionId: string | null = null;
  let targetQuestionId: string | null = null;
  let revealedAt: string | null = null;
  let closedAt: string | null = null;
  let currentGameId: string | null = game1.id;

  const subway = questions.find((q) => q.id === "game-1-cat-2-q300");
  if (!subway) throw new Error("demoNight: missing subway question");
  subway.pointValue = 100;
  subway.factBlurb =
    "New York's subway has 472 stations — more than any other system on Earth, and it runs 24 hours a day.";

  switch (opts.moment) {
    case "lobby": {
      game1.state = "ready";
      game1.startedAt = null;
      for (const q of questions) {
        q.playedAt = null;
        q.finishedAt = null;
        q.correctIndex = null;
      }
      for (const s of scores) {
        s.score = 0;
        s.correct_count = 0;
        s.answered_count = 0;
        s.fastest_correct_ms = null;
      }
      break;
    }
    case "board":
      break;
    case "question": {
      const secondsLeft = Math.max(0, Math.min(25, opts.secondsLeft ?? 14));
      const revealedMs = opts.revealedAtMs ?? nowMs - (25 - secondsLeft) * 1000;
      revealedAt = iso(revealedMs);
      subway.playedAt = revealedAt;
      liveQuestionId = subway.id;
      targetQuestionId = subway.id;
      const locked = Math.max(0, Math.min(playerCount, opts.locked ?? Math.round(playerCount * 0.6)));
      liveAnswers = lockOrder(playerCount)
        .slice(0, locked)
        .map((index, order) => ({
          question_id: subway.id,
          player_key: players[index].id,
          player_name: players[index].displayName,
          ms_to_lock: 1800 + order * 610,
          is_correct: null,
          chosen_index: null,
        }));
      reveals.push({
        id: "rv-subway",
        gameId: game1.id,
        questionId: subway.id,
        event: "reveal",
        occurredAt: revealedAt,
        metadata: null,
      });
      break;
    }
    case "reveal": {
      const revealedMs = opts.revealedAtMs ?? nowMs - 27_000;
      revealedAt = iso(revealedMs);
      subway.playedAt = revealedAt;
      subway.finishedAt = iso(revealedMs + 25_000);
      subway.correctIndex = 0;
      targetQuestionId = subway.id;
      const locked = Math.max(0, Math.min(playerCount, opts.locked ?? Math.round(playerCount * 0.9)));
      liveAnswers = lockOrder(playerCount)
        .slice(0, locked)
        .map((index, order) => {
          const correct = order % 5 !== 3;
          return {
            question_id: subway.id,
            player_key: players[index].id,
            player_name: players[index].displayName,
            ms_to_lock: 1800 + order * 610,
            is_correct: correct,
            chosen_index: correct ? 0 : ((order % 3) + 1) as 1 | 2 | 3,
          };
        });
      reveals.push(
        {
          id: "rv-subway",
          gameId: game1.id,
          questionId: subway.id,
          event: "reveal",
          occurredAt: revealedAt,
          metadata: null,
        },
        {
          id: "rs-subway",
          gameId: game1.id,
          questionId: subway.id,
          event: "resolve",
          occurredAt: subway.finishedAt,
          metadata: null,
        },
      );
      break;
    }
    case "between-games": {
      game1.state = "done";
      game1.endedAt = iso(nowMs - 60_000);
      game2.state = "ready";
      scores.forEach((s, i) => {
        s.score = Math.max(0, 4820 - i * 510 - (i % 4) * 30);
      });
      for (const q of questions) {
        if (categories.find((c) => c.id === q.categoryId)?.gameId === game1.id) {
          q.playedAt = q.playedAt ?? iso(NIGHT_START);
          q.finishedAt = q.finishedAt ?? iso(NIGHT_START + 25_000);
          q.correctIndex = q.correctIndex ?? 0;
        }
      }
      break;
    }
    case "winner": {
      game1.state = "done";
      game1.endedAt = iso(nowMs - 60 * 60_000);
      game2.state = "done";
      game2.startedAt = iso(nowMs - 55 * 60_000);
      game2.endedAt = iso(nowMs - 60_000);
      currentGameId = game2.id;
      closedAt = null;
      const order = [1, 0, 2];
      scores.forEach((s, i) => {
        s.score = Math.max(0, 8020 - i * 470);
      });
      scores[order[0]].score = 9640;
      scores[order[0]].correct_count = 12;
      scores[order[0]].answered_count = 14;
      scores[order[0]].fastest_correct_ms = 900;
      scores[order[1]].score = 8910;
      scores[order[2]].score = 8020;
      break;
    }
  }

  const snapshot: TVSnapshot = {
    live: null,
    night: {
      id: "demo-night",
      venueName: "Soul Fire Pizza",
      themeKey: "october",
      hostDefaultThemeKey: null,
      roomCode: "K9PR4M",
      openedAt: iso(NIGHT_START),
      closedAt,
      scheduledAt: iso(NIGHT_START + 30 * 60_000),
      isLocked: false,
      roomMagicEnabled: false,
    },
    games: [game1, game2],
    currentGameId,
    categories,
    questions,
    liveQuestionId,
    targetQuestionId,
    players,
    scores,
    liveAnswers,
    reveals,
  };
  return { snapshot, revealedAt };
}

/** A fixed, scattered lock order so lit pumpkins don't fill left to right. */
function lockOrder(count: number): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  let seed = 7;
  for (let i = order.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
