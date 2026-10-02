// October · Sleepy Hollow Night: the bad-data fuzz.
//
// Throws thousands of randomized and edge-case nights at every October layer
// (the TV world and its screens, the pumpkin-patch canvas, the phones' "your
// pumpkin", the host's laptop console and phone preview) and checks that the
// theme never needs its crash guard: no "[theme] …" warning, the world never
// switches itself off, nothing throws.
//
// The same nights run on the other 13 themes too (a slice of them), as a
// smoke test of the everyday screens.
//
// Who broke it? Every night also plays on the "house" theme first, as the
// control. If the everyday game itself can't render a night (data the server
// never sends, like a player with no join time), that night is counted as a
// base-game crash and reported, not blamed on October. If house renders it,
// October must too, with zero guard fires.
//
// Repeatable: a seeded generator. FUZZ_SEED picks the nights, FUZZ_SCALE
// multiplies how many (1 = the quick everyday run; 25+ for the big proof).
// FUZZ_REPORT=<file.json> writes the tallies out.
//
// The browser's 2D canvas is replaced by a strict stand-in that throws where
// a real browser throws (negative radius, a zero-size image, a non-finite
// gradient) and counts every NaN/Infinity that reaches drawing math.

import { Component, StrictMode, type ReactNode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { TVStateMachine } from "@/components/tv/TVStateMachine";
import type { TVLobbyWelcomeEvent } from "@/components/tv/TVLobby";
import { ThemeProvider } from "@/components/system";
import { HostLiveConsole } from "@/components/host/HostLiveConsole";
import { HostVenueMonitor } from "@/components/host/HostVenueMonitor";
import {
  PlayerBetweenGames,
  PlayerLobby,
  PlayerLocked,
  PlayerQuestion,
  PlayerRevealCorrect,
  PlayerRevealWrong,
  PlayerWinnerCard,
} from "@/components/player";
import { YourPumpkin } from "@/components/experience/october/YourPumpkin";
import { FlamingHead } from "@/components/experience/october/tv/OctoberScreens";
import { OctoberPatchCanvas, type OctoberPatchInputs } from "@/components/experience/october/OctoberPatchCanvas";
import { ThemeLayerBoundary } from "@/components/system/ThemeLayerBoundary";
import {
  momentSecondsLeft,
  patchLayout,
  patchScene,
  type PatchAnswer,
  type PatchPlayer,
  type PumpkinMood,
} from "@/lib/experience/october/patch";
import type { TVMoment, TVMomentKind } from "@/lib/experience/tvMoment";
import { DEMO_PLAYER_NAMES } from "@/lib/experience/demoNight";
import { hasPhoneLayer, tvWorldFor } from "@/lib/experience/packs";
import { THEME_KEYS, type ThemeKey } from "@/lib/theme/tokens";
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
import { playerColorHex } from "@/lib/player/playerColor";

const SEED = Number(process.env.FUZZ_SEED ?? 20261007);
const SCALE = Math.max(0.1, Number(process.env.FUZZ_SCALE ?? 1));
const REPORT = process.env.FUZZ_REPORT;
const n = (base: number) => Math.max(1, Math.round(base * SCALE));
const COUNTS = {
  logic: n(4000),
  canvas: n(60),
  tv: n(36),
  phone: n(120),
  host: n(10),
};
const OTHER_THEMES = THEME_KEYS.filter((k) => k !== "october" && k !== "house");
const T0 = Date.parse("2026-10-07T23:50:00Z");
const TIMEOUT = 60 * 60_000;

// ── seeded randomness ───────────────────────────────────────────────────

class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    // mulberry32
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}

// ── the tallies ─────────────────────────────────────────────────────────

const tally = {
  seed: SEED,
  scale: SCALE,
  logicCases: 0,
  canvasCases: 0,
  canvasFrames: 0,
  tvNights: 0,
  tvSnapshotsRendered: 0,
  tvSnapshotsByTheme: {} as Record<string, number>,
  phoneRenders: 0,
  phoneRendersByTheme: {} as Record<string, number>,
  hostRenders: 0,
  junkNights: 0,
  hardJunkNights: 0,
  baseCrashNights: 0,
  basePhoneCrashes: 0,
  baseHostCrashes: 0,
  baseCrashSamples: [] as string[],
  otherThemeCrashes: [] as string[],
  otherThemeWrongTypeCrashes: [] as string[],
  guardFires: [] as string[],
  worldOff: [] as string[],
  thrown: [] as string[],
  nonFiniteCanvasArgs: {} as Record<string, number>,
  nonFiniteSamples: [] as string[],
  canvasDrawImageCalls: 0,
  guardFiresOnBaseCrashNights: 0,
  timerLeaks: [] as string[],
  harness: [] as string[],
  slowestCaseMs: 0,
  slowCases: [] as string[],
};

/** What each test adds to the shared tallies (so one test's findings don't
 *  fail the next). */
function mark() {
  const at = { thrown: tally.thrown.length, off: tally.worldOff.length, guard: tally.guardFires.length, other: tally.otherThemeCrashes.length };
  return {
    thrown: () => tally.thrown.slice(at.thrown),
    off: () => tally.worldOff.slice(at.off),
    guard: () => tally.guardFires.slice(at.guard),
    other: () => tally.otherThemeCrashes.slice(at.other),
  };
}

function bump(map: Record<string, number>, key: string, by = 1) {
  map[key] = (map[key] ?? 0) + by;
}

// ── browser stand-ins ───────────────────────────────────────────────────

/** Where every guard warning goes while a case runs. */
let themeWarnings: string[] = [];
let caseLabel = "";

const env = {
  panel: { w: 1600, h: 900 },
  fit: { w: 1600, h: 680 },
  imageMode: "ok" as "ok" | "fail" | "never",
  canvasMissing: false,
  reducedMotion: false,
};

class StrictCanvasError extends Error {}
let drawCount = 0;

function noteNonFinite(method: string, args: unknown[]) {
  if (args.some((a) => typeof a === "number" && !Number.isFinite(a))) {
    bump(tally.nonFiniteCanvasArgs, method);
    if (tally.nonFiniteSamples.length < 20) {
      tally.nonFiniteSamples.push(`${caseLabel} ${method}(${args.map((a) => (typeof a === "number" ? a : typeof a)).join(", ")})`);
    }
  }
}

function domError(message: string, name: string): Error {
  const error = new StrictCanvasError(message);
  error.name = name;
  return error;
}

function strictGradient() {
  return {
    addColorStop(offset: number, color: string) {
      if (!Number.isFinite(offset)) throw new TypeError(`addColorStop: non-finite offset ${offset}`);
      if (offset < 0 || offset > 1) throw domError(`addColorStop: offset ${offset} out of range`, "IndexSizeError");
      if (typeof color !== "string" || !color) throw domError(`addColorStop: bad color ${String(color)}`, "SyntaxError");
    },
  };
}

function strictContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  let fontPx = 10;
  const plain = (name: string) => (...args: unknown[]) => noteNonFinite(name, args);
  const ctx: Record<string, unknown> = {
    canvas,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    textBaseline: "alphabetic",
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
    clip: () => {},
    translate: plain("translate"),
    rotate: plain("rotate"),
    scale: plain("scale"),
    setTransform: plain("setTransform"),
    resetTransform: () => {},
    clearRect: plain("clearRect"),
    fillRect: plain("fillRect"),
    strokeRect: plain("strokeRect"),
    moveTo: plain("moveTo"),
    lineTo: plain("lineTo"),
    fillText: (text: unknown, ...rest: unknown[]) => {
      if (typeof text !== "string") throw new StrictCanvasError(`fillText: text is ${typeof text}`);
      noteNonFinite("fillText", rest);
    },
    measureText: (text: unknown) => ({ width: String(text).length * fontPx * 0.55 }),
    arc: (x: number, y: number, r: number, a0: number, a1: number) => {
      noteNonFinite("arc", [x, y, r, a0, a1]);
      if (Number.isFinite(r) && r < 0) throw domError(`arc: radius ${r} is negative`, "IndexSizeError");
    },
    arcTo: (x1: number, y1: number, x2: number, y2: number, r: number) => {
      noteNonFinite("arcTo", [x1, y1, x2, y2, r]);
      if (Number.isFinite(r) && r < 0) throw domError(`arcTo: radius ${r} is negative`, "IndexSizeError");
    },
    ellipse: (x: number, y: number, rx: number, ry: number, ...rest: number[]) => {
      noteNonFinite("ellipse", [x, y, rx, ry, ...rest]);
      if ((Number.isFinite(rx) && rx < 0) || (Number.isFinite(ry) && ry < 0)) {
        throw domError(`ellipse: radius ${rx},${ry} is negative`, "IndexSizeError");
      }
    },
    createRadialGradient: (...args: number[]) => {
      if (args.some((a) => !Number.isFinite(a))) throw new TypeError(`createRadialGradient: non-finite ${args.join(",")}`);
      if (args[2] < 0 || args[5] < 0) throw domError("createRadialGradient: negative radius", "IndexSizeError");
      return strictGradient();
    },
    createLinearGradient: (...args: number[]) => {
      if (args.some((a) => !Number.isFinite(a))) throw new TypeError(`createLinearGradient: non-finite ${args.join(",")}`);
      return strictGradient();
    },
    drawImage: (source: { width?: number; height?: number; __broken?: boolean } | null, ...rest: number[]) => {
      drawCount++;
      if (!source) throw new TypeError("drawImage: no image");
      if (source.__broken) throw domError("drawImage: broken image", "InvalidStateError");
      if (source instanceof HTMLCanvasElement && (source.width === 0 || source.height === 0)) {
        throw domError(`drawImage: canvas source is ${source.width}x${source.height}`, "InvalidStateError");
      }
      noteNonFinite("drawImage", rest);
    },
  };
  return new Proxy(ctx, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      throw new StrictCanvasError(`canvas: the stand-in has no "${prop}" (add it)`);
    },
    set(target, prop: string, value) {
      if (prop === "font" && typeof value === "string") {
        const match = /(\d+(?:\.\d+)?)px/.exec(value);
        if (match) fontPx = Number(match[1]);
      }
      if (prop === "globalAlpha" || prop === "lineWidth") noteNonFinite(`set ${prop}`, [value]);
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

class FuzzImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decoding = "async";
  width = 160;
  height = 200;
  complete = false;
  set src(_value: string) {
    const mode = env.imageMode;
    setTimeout(() => {
      if (mode === "ok") {
        this.complete = true;
        this.onload?.();
      } else if (mode === "fail") {
        (this as unknown as { __broken: boolean }).__broken = true;
        this.onerror?.();
      }
      // "never": the art never arrives (a stalled network).
    }, 5);
  }
}

type ROCallback = (entries: Array<{ target: Element; contentRect: { width: number; height: number } }>) => void;
const observers = new Set<FuzzResizeObserver>();
class FuzzResizeObserver {
  private targets = new Set<Element>();
  constructor(private cb: ROCallback) {}
  observe(target: Element) {
    this.targets.add(target);
    observers.add(this);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
    observers.delete(this);
  }
  fire(w: number, h: number) {
    if (!this.targets.size) return;
    this.cb([...this.targets].map((target) => ({ target, contentRect: { width: w, height: h } })));
  }
}

const PANEL_SIZES = [
  [0, 0], [1, 1], [2, 2], [48, 27], [320, 180], [390, 220], [1280, 720], [1440, 810], [1600, 900],
  [1920, 1080], [3840, 2160], [7680, 4320], [900, 1600], [1600, 12], [12, 900],
] as const;

const saved: Record<string, unknown> = {};

beforeAll(() => {
  saved.getContext = HTMLCanvasElement.prototype.getContext;
  saved.Image = window.Image;
  saved.ResizeObserver = globalThis.ResizeObserver;
  saved.matchMedia = window.matchMedia;
  saved.rect = HTMLElement.prototype.getBoundingClientRect;
  saved.offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
  saved.offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
  saved.clientHeight = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight");
  saved.dpr = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");

  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
    if (type !== "2d" || env.canvasMissing) return null;
    return strictContext(this);
  } as unknown as HTMLCanvasElement["getContext"];
  (window as unknown as { Image: unknown }).Image = FuzzImage;
  window.matchMedia = ((query: string) => ({
    matches: query.includes("reduced-motion") ? env.reducedMotion : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  // The patch canvas measures itself on screen; the fit boxes measure layout.
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const { w, h } = this instanceof HTMLCanvasElement ? env.panel : { w: 0, h: 0 };
    return { width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
  const fitBox = (el: HTMLElement): boolean => {
    const id = el.dataset?.testid ?? (el.parentElement as HTMLElement | null)?.dataset?.testid;
    return id === "october-fit-stage" || id === "shrink-to-fit" || el.hasAttribute("data-fit-scale") || !!el.querySelector?.(":scope > [data-fit-scale]");
  };
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return fitBox(this) ? env.fit.w : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return fitBox(this) ? env.fit.h : 0;
    },
  });
  Object.defineProperty(Element.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset?.testid === "shrink-to-fit" ? Math.round(env.fit.h * 0.8) : 0;
    },
  });

  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    const first = String(args[0] ?? "");
    if (first.startsWith("[theme]")) {
      const error = args[1] as { message?: string } | undefined;
      themeWarnings.push(`${first.slice(0, 120)} :: ${error?.message ?? String(error)}`);
    }
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  HTMLCanvasElement.prototype.getContext = saved.getContext as HTMLCanvasElement["getContext"];
  (window as unknown as { Image: unknown }).Image = saved.Image;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = saved.ResizeObserver;
  window.matchMedia = saved.matchMedia as typeof window.matchMedia;
  HTMLElement.prototype.getBoundingClientRect = saved.rect as HTMLElement["getBoundingClientRect"];
  for (const [key, proto] of [
    ["offsetWidth", HTMLElement.prototype],
    ["offsetHeight", HTMLElement.prototype],
    ["clientHeight", Element.prototype],
  ] as const) {
    const descriptor = saved[key] as PropertyDescriptor | undefined;
    if (descriptor) Object.defineProperty(proto, key, descriptor);
  }
  const dpr = saved.dpr as PropertyDescriptor | undefined;
  if (dpr) Object.defineProperty(window, "devicePixelRatio", dpr);
  vi.restoreAllMocks();
  tally.canvasDrawImageCalls = drawCount;
  if (REPORT) fs.writeFileSync(REPORT, JSON.stringify(tally, null, 2));
  // eslint-disable-next-line no-console
  console.info(
    `[fuzz] seed ${SEED} scale ${SCALE}: ${tally.logicCases} logic, ${tally.canvasCases} canvas (${tally.canvasFrames} frames), ` +
      `${tally.tvNights} TV nights (${tally.tvSnapshotsRendered} snapshots), ${tally.phoneRenders} phone, ${tally.hostRenders} host; ` +
      `guard fires ${tally.guardFires.length}, world off ${tally.worldOff.length}, base-game crash nights ${tally.baseCrashNights}`,
  );
});

function setupCase(rng: Rng, opts: { noResizeObserver?: boolean } = {}) {
  const [w, h] = rng.chance(0.6) ? ([1600, 900] as const) : rng.pick(PANEL_SIZES);
  env.panel = { w, h };
  const [fw, fh] = rng.chance(0.6) ? ([1600, 680] as const) : rng.pick(PANEL_SIZES);
  env.fit = { w: fw, h: fh };
  env.imageMode = rng.chance(0.85) ? "ok" : rng.chance(0.5) ? "fail" : "never";
  env.canvasMissing = rng.chance(0.03);
  env.reducedMotion = rng.chance(0.15);
  const dpr = rng.pick([1, 1, 2, 2, 3, 1.5, 0.5, 0, Number.NaN]);
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: dpr });
  // A browser with no ResizeObserver (an old smart-TV browser). Only the
  // patch canvas is tried without one: the everyday TV screens need it, so a
  // whole TV without it is a base-game question, not October's.
  const roll = rng.chance(0.05);
  if (opts.noResizeObserver && roll) delete (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver;
  else (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FuzzResizeObserver;
  observers.clear();
  themeWarnings = [];
}

function fireResize(rng: Rng) {
  const [w, h] = rng.pick(PANEL_SIZES);
  env.panel = { w, h };
  env.fit = { w, h: Math.round(h * 0.755) };
  for (const observer of [...observers]) observer.fire(w, h);
  window.dispatchEvent(new Event("resize"));
}

function startClock() {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
      "Date",
    ],
    now: T0,
  });
}

/** Let time pass: timers, animation frames and promises (the art loading)
 *  all run, inside act so React keeps up. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function renderAsync(ui: ReactNode) {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(ui);
  });
  return view;
}

async function unmountAsync(view: ReturnType<typeof render>) {
  await act(async () => {
    view.unmount();
  });
}

async function rerenderAsync(view: ReturnType<typeof render>, ui: ReactNode) {
  await act(async () => {
    view.rerender(ui);
  });
}

/** Catches what the everyday game itself can't render (outside any theme guard). */
class OuterCatch extends Component<{ onCrash: (error: unknown) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.onCrash(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const errorText = (error: unknown): string => {
  if (error instanceof AggregateError) return error.errors.map(errorText).join(" + ");
  return error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : String(error).slice(0, 200);
};

// ── generators ──────────────────────────────────────────────────────────

const NAME_SHAPES: Array<(rng: Rng) => string> = [
  (rng) => rng.pick(DEMO_PLAYER_NAMES),
  (rng) => rng.pick(DEMO_PLAYER_NAMES),
  (rng) => rng.pick(["Bob", "Bob", "Jen B.", "Jen B."]), // duplicates
  () => "W".repeat(40), // the longest name a player can pick
  () => "Supercalifragilistic Quiz Wizards 2026!",
  () => "🎃👻💀🦇🕷️",
  () => "👨‍👩‍👧‍👦👨‍👩‍👧‍👦 Family",
  () => "🏳️‍🌈🏳️‍🌈🏳️‍🌈🏳️‍🌈🏳️‍🌈",
  () => "مرحبا بالعالم",
  () => "שלום עליכם",
  () => "‮gnirts desrever",
  () => "Zálgǫ̸̢͈͖ ţ̷̛̛̳ę̶̛͖x̸̛̹t̵̢̛",
  () => "<b>Bold</b> & \"quotes\" 'n' \\slashes",
  () => "名前はとても長いです日本語のチーム",
  () => "Ｗｉｄｅ　ｗｏｒｄｓ",
  () => "a",
  () => "x",
  () => "constructor",
  () => "__proto__",
  () => "toString",
  () => "null",
];
// Two kinds of bad data. "Soft": the right type but a value the server never
// sends (an empty name, NaN, a date that isn't a date). "Hard": the wrong
// type altogether (null where a name belongs). Hard junk only goes into
// some nights, so most nights stay renderable by the everyday game (the
// control) and October gets tested on them.
let allowHard = true;
function junk<T>(rng: Rng, soft: readonly T[], hard: readonly unknown[]): T {
  return (allowHard && rng.chance(hard.length / (soft.length + hard.length)) ? rng.pick(hard) : rng.pick(soft)) as T;
}

const SOFT_NAMES: Array<(rng: Rng) => string> = [
  () => "",
  () => "   ",
  (rng) => "y".repeat(rng.int(41, 400)),
  () => "line\nbreak\ttab",
  () => "\uD800 lone half",
];
const HARD_NAMES: unknown[] = [null, undefined, 42];

function nameFor(rng: Rng, rate: number): string {
  if (rng.chance(rate)) {
    const pick = junk<((r: Rng) => string) | unknown>(rng, SOFT_NAMES, HARD_NAMES);
    return (typeof pick === "function" ? (pick as (r: Rng) => string)(rng) : pick) as string;
  }
  return rng.pick(NAME_SHAPES)(rng);
}

const iso = (ms: number) => new Date(ms).toISOString();
const TEXTS = [
  "Which city's subway system has the most stations of any metro network in the world?",
  "Which work boot company, still operating in Chippewa Falls, Wisconsin, is known for making custom boots to order for specific trades like firefighting, logging and linework, and has done so since 1910?",
  "",
  "?",
  "🎃".repeat(60),
  "مرحبا بالعالم — what does this mean?",
  "A".repeat(500),
];

interface NightWorld {
  players: TVPlayer[];
  games: TVGame[];
  categories: TVCategory[];
  questions: TVQuestion[];
  junk: number;
  /** Wrong-type junk allowed in this night. */
  hard: boolean;
  removed: string[];
}

function timeValue(rng: Rng, now: number, rate: number): string {
  if (rng.chance(rate)) return junk(rng, ["not a date", "", "2026-13-45T99:99:99Z"], [null, undefined]);
  return iso(now - rng.int(0, 4 * 3600_000));
}

function newWorld(rng: Rng, now: number): NightWorld {
  const junk = rng.chance(0.4) ? 0 : rng.pick([0.02, 0.05, 0.1, 0.25]);
  const hard = junk > 0 && rng.chance(0.2);
  allowHard = hard;
  const count = rng.chance(0.5) ? rng.pick([0, 1, 2, 65, 150]) : rng.int(0, 150);
  const players: TVPlayer[] = Array.from({ length: count }, (_, i) => ({
    id: rng.chance(junk * 0.2) ? `pk-${Math.max(0, i - 1)}` : `pk-${i}`,
    displayName: nameFor(rng, junk),
    joinedAt: timeValue(rng, now, junk * 0.5),
    lastSeenAt: lastSeen(rng, now, junk),
  }));
  rng.shuffle(players);
  const games: TVGame[] = [1, 2].map((no) => ({
    id: `g${no}`,
    gameNo: no as 1 | 2,
    state: "draft",
    startedAt: null,
    endedAt: null,
    categoryCount: 6,
    questionCount: 42,
  }));
  const categories: TVCategory[] = [];
  const questions: TVQuestion[] = [];
  for (const game of games) {
    const cats = rng.chance(0.08) ? 0 : rng.int(1, 6);
    for (let c = 0; c < cats; c++) {
      const id = `${game.id}-c${c}`;
      categories.push({
        id,
        gameId: game.id,
        name: rng.chance(0.15) ? rng.pick(["", "🎃 Halloween 🎃", "C".repeat(80), "Pixar Movies"]) : rng.pick(["Geography", "Space", "1990s Music", "Rodents"]),
        topic: "topic",
        position: rng.chance(0.1) ? 0 : c,
        color: rng.chance(0.1) ? rng.pick(["#zzz", "", "red"]) : null,
        state: rng.pick(["draft", "generating", "review", "ready", "ready", "ready"] as const),
      });
      const qs = rng.chance(0.06) ? 0 : rng.int(1, 7);
      for (let q = 0; q < qs; q++) {
        questions.push({
          id: `${id}-q${q}`,
          categoryId: id,
          pointValue: rng.chance(0.05) ? null : ([100, 200, 300, 400, 500, 600, 700] as const)[q % 7],
          prompt: rng.pick(TEXTS),
          options: [0, 1, 2, 3].map(() => (rng.chance(0.1) ? rng.pick(["", "O".repeat(120), "🎃"]) : rng.pick(["Tokyo", "New York City", "Red Wing Heritage Workwear Company"]))) as TVQuestion["options"],
          correctIndex: null,
          imageUrl: rng.chance(0.1) ? rng.pick(["data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E", "not a url", ""]) : null,
          factBlurb: rng.chance(0.3) ? rng.pick(["", "A fact.", "F".repeat(600)]) : null,
          playedAt: null,
          finishedAt: null,
          isPicked: rng.chance(0.9),
        });
      }
    }
  }
  return { players, games, categories, questions, junk, hard, removed: [] };
}

function lastSeen(rng: Rng, now: number, rate: number): string {
  if (rng.chance(rate)) return junk(rng, ["nope", ""], [null]);
  const r = rng.next();
  if (r < 0.75) return iso(now - rng.int(0, 20_000)); // here
  if (r < 0.9) return iso(now - rng.int(11, 180) * 60_000); // went home
  return iso(now + rng.int(1, 3600) * 1000); // clock ahead
}

type Stage =
  | "lobby"
  | "board"
  | "question"
  | "reveal"
  | "between-games"
  | "g2-board"
  | "g2-question"
  | "g2-reveal"
  | "winner"
  | "closed"
  | "chaos";
const STAGES: Stage[] = ["lobby", "board", "question", "reveal", "between-games", "g2-board", "g2-question", "g2-reveal", "winner", "closed", "chaos"];
const NATURAL: Stage[] = ["lobby", "board", "question", "reveal", "board", "question", "question", "reveal", "between-games", "g2-board", "g2-question", "g2-reveal", "winner", "closed"];

function scoreValue(rng: Rng, rate: number, prev: number | null): number {
  if (rng.chance(rate)) return junk(rng, [Number.NaN, Infinity, -Infinity], [null, undefined, "300"]);
  if (prev !== null && rng.chance(0.25)) return prev; // ties
  return rng.pick([0, 0, rng.int(0, 20_000), rng.int(-900, -1), 1_000_000_000, rng.int(100, 9000)]);
}

interface Built {
  snapshot: TVSnapshot;
  revealedAt: string | null;
  serverNow: string | null;
  welcome: TVLobbyWelcomeEvent | null;
}

function buildSnapshot(rng: Rng, world: NightWorld, stage: Stage, now: number): Built {
  const rate = world.junk;
  allowHard = world.hard;
  const games = world.games.map((g) => ({ ...g }));
  const questions = world.questions.map((q) => ({ ...q }));
  const [g1, g2] = games;
  let currentGameId: string | null = g1.id;
  let closedAt: string | null = null;
  let liveQuestionId: string | null = null;
  let targetQuestionId: string | null = null;
  let liveAnswers: TVAnswer[] = [];
  const reveals: TVReveal[] = [];
  let revealedAt: string | null = null;
  let serverNow: string | null = null;

  const setGames = (s1: TVGame["state"], s2: TVGame["state"], current: string | null) => {
    g1.state = s1;
    g2.state = s2;
    currentGameId = current;
  };
  const gameQuestion = (gameId: string) => {
    const pool = questions.filter((q) => world.categories.find((c) => c.id === q.categoryId)?.gameId === gameId);
    return pool.length ? rng.pick(pool) : null;
  };
  const players = world.players;
  const inGame = (gameNo: 1 | 2) =>
    gameNo === 1 ? players : players.filter((_, i) => i % 7 !== 3); // Game 2 sit-outs
  const live = (gameId: string, gameNo: 1 | 2, resolved: boolean) => {
    const q = gameQuestion(gameId);
    if (!q) return;
    const elapsed = rng.chance(rate) ? rng.pick([-60_000, 3_600_000, Number.NaN]) : rng.int(0, 40_000);
    const playedMs = now - elapsed;
    q.playedAt = Number.isFinite(playedMs) ? iso(playedMs) : "garbage";
    if (resolved) {
      q.finishedAt = iso(now - rng.int(0, 8000));
      q.correctIndex = rng.pick([0, 1, 2, 3] as const);
      reveals.push({ id: `rs-${q.id}`, gameId, questionId: q.id, event: "resolve", occurredAt: q.finishedAt, metadata: null });
    }
    reveals.push({ id: `rv-${q.id}`, gameId, questionId: q.id, event: "reveal", occurredAt: q.playedAt, metadata: null });
    liveQuestionId = rng.chance(0.9) ? q.id : rng.pick([null, "ghost-question"]);
    targetQuestionId = rng.chance(0.9) ? q.id : null;
    const answerers = inGame(gameNo).filter(() => rng.chance(rng.pick([0, 0.3, 0.7, 1])));
    liveAnswers = answerers.map((p, order) => ({
      question_id: q.id,
      player_key: p.id,
      player_name: p.displayName,
      ms_to_lock: rng.chance(rate) ? rng.pick([-5, Number.NaN, 1e12]) : 1500 + order * 400,
      is_correct: resolved ? rng.chance(0.6) : null,
      chosen_index: resolved ? rng.pick([0, 1, 2, 3] as const) : null,
    }));
    // Answers from players the host removed, and a stray duplicate.
    for (const key of world.removed) {
      liveAnswers.push({ question_id: q.id, player_key: key, player_name: "Gone", ms_to_lock: 2000, is_correct: resolved ? true : null, chosen_index: null });
    }
    if (liveAnswers.length && rng.chance(0.1)) liveAnswers.push({ ...liveAnswers[0] });
    if (rng.chance(0.1)) {
      liveAnswers.push({ question_id: "some-other-question", player_key: players[0]?.id ?? "x", player_name: "x", ms_to_lock: 1, is_correct: true, chosen_index: 0 });
    }
    const broadcast = rng.next();
    revealedAt = broadcast < 0.6 ? q.playedAt : broadcast < 0.75 ? null : broadcast < 0.9 ? iso(now - rng.int(-5000, 60_000)) : "garbage";
    const skew = rng.chance(0.2) ? rng.int(-3_600_000, 3_600_000) : rng.int(-2000, 2000);
    serverNow = rng.chance(0.85) ? iso(now - rng.int(0, 3000) + skew) : rng.pick([null, "garbage", ""]);
  };

  switch (stage) {
    case "lobby":
      setGames("ready", "draft", rng.chance(0.5) ? g1.id : null);
      break;
    case "board":
      setGames("live", "draft", g1.id);
      break;
    case "question":
      setGames("live", rng.pick(["draft", "ready"]), g1.id);
      live(g1.id, 1, false);
      break;
    case "reveal":
      setGames("live", "draft", g1.id);
      live(g1.id, 1, true);
      break;
    case "between-games":
      setGames("done", "ready", rng.chance(0.5) ? g1.id : g2.id);
      break;
    case "g2-board":
      setGames("done", "live", g2.id);
      break;
    case "g2-question":
      setGames("done", "live", g2.id);
      live(g2.id, 2, false);
      break;
    case "g2-reveal":
      setGames("done", "live", g2.id);
      live(g2.id, 2, true);
      break;
    case "winner":
      setGames("done", rng.chance(0.8) ? "done" : "draft", rng.pick([g2.id, g1.id]));
      break;
    case "closed":
      setGames(rng.pick(["done", "live"]), rng.pick(["done", "draft"]), rng.pick([g1.id, g2.id, null]));
      closedAt = iso(now - 1000);
      break;
    case "chaos": {
      const states: TVGame["state"][] = ["draft", "ready", "live", "done"];
      setGames(rng.pick(states), rng.pick(states), rng.pick([g1.id, g2.id, null, "ghost-game"]));
      if (rng.chance(0.5)) live(rng.pick([g1.id, g2.id]), rng.pick([1, 2] as const), rng.chance(0.5));
      if (rng.chance(0.2)) closedAt = rng.pick([iso(now), "garbage"]);
      break;
    }
  }

  const gameNo: 1 | 2 = currentGameId === g2.id ? 2 : 1;
  let prev: number | null = null;
  const scoreRows: TVScore[] = (stage === "lobby" ? (rng.chance(0.5) ? [] : players) : inGame(gameNo))
    .filter(() => !rng.chance(0.03))
    .map((p) => {
      const score = scoreValue(rng, rate, prev);
      prev = typeof score === "number" && Number.isFinite(score) ? score : prev;
      return {
        player_key: p.id,
        display_name: p.displayName,
        score,
        correct_count: rng.chance(rate) ? Number.NaN : rng.int(0, 21),
        answered_count: rng.int(0, 21),
        fastest_correct_ms: rng.chance(0.3) ? null : rng.chance(rate) ? -1 : rng.int(300, 25_000),
      };
    });
  for (const key of world.removed) {
    scoreRows.push({ player_key: key, display_name: "Removed player", score: 500, correct_count: 1, answered_count: 1, fastest_correct_ms: null });
  }
  scoreRows.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));

  const snapshot: TVSnapshot = {
    live: null,
    night: {
      id: "fuzz-night",
      venueName: rng.chance(0.2) ? rng.pick(["", "V".repeat(120), "🎃 Soul Fire 🎃", "مطعم"]) : "Soul Fire Pizza",
      themeKey: rng.chance(rate) ? rng.pick(["halloween", "", "constructor", "__proto__", null]) : "october",
      hostDefaultThemeKey: rng.chance(0.5) ? null : rng.pick(THEME_KEYS),
      roomCode: rng.chance(0.1) ? rng.pick(["", "abc", "K9PR4M-TOO-LONG", "🎃🎃🎃"]) : "K9PR4M",
      openedAt: iso(now - 3600_000),
      closedAt,
      scheduledAt: rng.chance(0.7) ? null : rng.pick([iso(now), "garbage"]),
      isLocked: rng.chance(0.1),
      roomMagicEnabled: false,
    },
    games: rng.chance(rate * 0.3) ? [] : rng.chance(0.1) ? [g1] : games,
    currentGameId,
    categories: world.categories,
    questions,
    liveQuestionId,
    targetQuestionId,
    players,
    scores: scoreRows,
    liveAnswers,
    reveals: rng.shuffle(reveals),
  };

  const welcome: TVLobbyWelcomeEvent | null =
    stage === "lobby" && rng.chance(0.4)
      ? {
          joinToken: rng.pick(["tok-1", "", "tok-2"]),
          name: nameFor(rng, rate),
          color: rng.chance(0.3) ? rng.pick(["#F2A02D", "", "notacolor"]) : undefined,
          colorKey: rng.chance(0.5) ? rng.pick([0, 3, 9, 10, -1, Number.NaN, 1e9]) : undefined,
          joinIndex: rng.int(-1, 200),
          prefersReducedMotion: rng.chance(0.2),
        }
      : null;
  return { snapshot, revealedAt, serverNow, welcome };
}

/** One step of the night: who joined, who left, who the host removed. */
function evolveWorld(rng: Rng, world: NightWorld, now: number) {
  allowHard = world.hard;
  const r = rng.next();
  if (r < 0.25 && world.players.length < 150) {
    const add = rng.int(1, 8);
    for (let i = 0; i < add; i++) {
      world.players.push({
        id: `pk-late-${now}-${i}-${rng.int(0, 1e6)}`,
        displayName: nameFor(rng, world.junk),
        joinedAt: iso(now),
        lastSeenAt: iso(now),
      });
    }
  } else if (r < 0.35 && world.players.length) {
    const gone = world.players.splice(rng.int(0, world.players.length - 1), 1)[0];
    world.removed.push(gone.id); // the host removed them
  } else if (r < 0.45) {
    world.players = world.players.map((p) => (rng.chance(0.2) ? { ...p, lastSeenAt: iso(now - 30 * 60_000) } : p));
  } else if (r < 0.5) {
    world.players = world.players.map((p) => (rng.chance(0.3) ? { ...p, displayName: nameFor(rng, world.junk) } : p));
  }
}

// ── 1 · the patch logic, pure ───────────────────────────────────────────

const MOMENT_KINDS: TVMomentKind[] = ["lobby", "board", "question", "reveal", "standings", "between-games", "winner"];
const WEIRD_NUMBERS = [0, -1, 1, 1e15, -1e15, Number.NaN, Infinity, -Infinity, 0.0001, 25_000];

describe("October crash fuzz", () => {
  it(`patch logic: ${COUNTS.logic} random scenes and layouts never throw or produce NaN positions`, () => {
    const rng = new Rng(SEED);
    allowHard = true;
    const bad: string[] = [];
    for (let i = 0; i < COUNTS.logic; i++) {
      const now = rng.chance(0.8) ? T0 + rng.int(-1e6, 1e6) : rng.pick(WEIRD_NUMBERS);
      const kind = rng.chance(0.95) ? rng.pick(MOMENT_KINDS) : (rng.pick(["", "nope", undefined]) as unknown as TVMomentKind);
      const revealedAtMs = rng.chance(0.7) ? now - rng.int(-5000, 60_000) : (rng.pick([null, ...WEIRD_NUMBERS]) as number | null);
      const moment: TVMoment = {
        kind,
        questionId: rng.chance(0.8) ? "q1" : rng.pick([null, "", "q2"]),
        revealedAtMs,
        serverNowMs: rng.chance(0.5) ? now : (rng.pick([null, ...WEIRD_NUMBERS]) as number | null),
      };
      const count = rng.chance(0.5) ? rng.pick([0, 1, 2, 44, 45, 65, 150, 400]) : rng.int(0, 160);
      const players: PatchPlayer[] = Array.from({ length: count }, (_, p) => ({ key: rng.chance(0.02) ? "dup" : `p${p}`, name: nameFor(rng, 0.1) }));
      const answers: PatchAnswer[] = players
        .filter(() => rng.chance(0.5))
        .map((p) => ({ playerKey: p.key, questionId: rng.chance(0.9) ? "q1" : "q2", isCorrect: rng.pick([null, true, false]) }));
      const input = {
        moment,
        questionClock: rng.chance(0.5)
          ? { questionId: rng.pick(["q1", "q2"]), revealedAtMs: rng.pick([now - 24_000, ...WEIRD_NUMBERS]), endedAtMs: rng.pick([null, now, ...WEIRD_NUMBERS]) }
          : null,
        players,
        answers,
        serverNowMs: now,
        durationS: rng.chance(0.9) ? 25 : rng.pick([0, -5, Number.NaN, 1e9]),
      };
      const scene = patchScene(input);
      momentSecondsLeft(input);
      const slots = patchLayout(count);
      if (slots.length !== count) bad.push(`layout(${count}) gave ${slots.length} slots`);
      for (const s of slots) {
        const values = [s.cx, s.top, s.w, s.h, s.stakeTop, s.stakeH, s.stakeFont, s.stakeMaxW];
        if (!values.every(Number.isFinite) || s.w <= 0 || s.stakeMaxW - s.stakeFont * 1.6 <= 0) {
          bad.push(`layout(${count}) slot ${values.join(",")}`);
          break;
        }
      }
      if (Object.keys(scene.moods).length > players.length) bad.push(`scene has more moods than players`);
      tally.logicCases++;
    }
    // A theme key that happens to be a built-in name never finds a world.
    for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty", "", "halloween"]) {
      expect(tvWorldFor(key as ThemeKey)).toBeNull();
      expect(hasPhoneLayer(key as ThemeKey)).toBe(false);
    }
    expect(tvWorldFor("october")?.pack).toBe("october");
    expect(bad.slice(0, 10)).toEqual([]);
  });

  // ── 2 · the patch canvas, drawing for real ──────────────────────────────

  it(`patch canvas: ${COUNTS.canvas} random patches animate through random moments without failing`, async () => {
    const rng = new Rng(SEED + 1);
    allowHard = true;
    const found = mark();
    for (let i = 0; i < COUNTS.canvas; i++) {
      caseLabel = `canvas#${i}`;
      setupCase(rng, { noResizeObserver: true });
      startClock();
      const started = process.hrtime.bigint();
      const onFail = vi.fn();
      try {
        const count = rng.chance(0.5) ? rng.pick([0, 1, 2, 65, 150]) : rng.int(0, 150);
        let players: PatchPlayer[] = Array.from({ length: count }, (_, p) => ({ key: `p${p}`, name: nameFor(rng, 0.15) }));
        const makeInputs = (): OctoberPatchInputs => {
          const now = Date.now();
          const kind = rng.pick(MOMENT_KINDS);
          const left = rng.pick([20, 6, 4.9, 2, 1, 0.2, 0, -0.5, -2, Number.NaN]);
          const moment: TVMoment = {
            kind,
            questionId: "q1",
            revealedAtMs: kind === "question" ? now - (25 - left) * 1000 : null,
            serverNowMs: now,
          };
          const answers: PatchAnswer[] = players
            .filter(() => rng.chance(0.6))
            .map((p) => ({ playerKey: p.key, questionId: "q1", isCorrect: kind === "reveal" ? rng.chance(0.6) : null }));
          const scene = patchScene({
            moment,
            questionClock: { questionId: "q1", revealedAtMs: now - (25 - left) * 1000, endedAtMs: now },
            players,
            answers,
            serverNowMs: now,
          });
          return {
            players,
            scene,
            secondsLeftNow: () => (Number.isFinite(left) ? left - 0.001 : null),
            colorFor: rng.chance(0.95) ? playerColorHex : () => rng.pick(["", "nope", "#F5C451"]),
          };
        };
        const tier = rng.chance(0.25) ? "still" : "full";
        let inputs = makeInputs();
        // Wrapped exactly as the TV world wraps it.
        const view = await renderAsync(
          <StrictMode>
            <ThemeLayerBoundary name="october:patch" onFail={onFail}>
              <OctoberPatchCanvas inputs={inputs} tier={tier} stageScale={1} onFail={onFail} />
            </ThemeLayerBoundary>
          </StrictMode>,
        );
        const steps = rng.int(3, 12);
        for (let s = 0; s < steps; s++) {
          const ms = rng.chance(0.3) ? rng.int(0, 120) : rng.int(200, 6000);
          await advance(ms);
          tally.canvasFrames += Math.round(ms / 16);
          if (rng.chance(0.3)) {
            players = rng.chance(0.5)
              ? players.slice(0, rng.int(0, players.length))
              : [...players, ...Array.from({ length: rng.int(1, 20) }, (_, p) => ({ key: `late${s}-${p}`, name: nameFor(rng, 0.15) }))];
          }
          if (rng.chance(0.25)) await act(async () => fireResize(rng));
          inputs = makeInputs();
          await rerenderAsync(
            view,
            <StrictMode>
              <ThemeLayerBoundary name="october:patch" onFail={onFail}>
                <OctoberPatchCanvas inputs={inputs} tier={tier} stageScale={rng.chance(0.8) ? 1 : rng.pick([0.2, 0.5, 2.4, 0.01])} onFail={onFail} />
              </ThemeLayerBoundary>
            </StrictMode>,
          );
        }
        await advance(1000);
        await unmountAsync(view);
        // Nothing of the patch may keep running once it's gone.
        const leftover = vi.getTimerCount();
        if (leftover) tally.timerLeaks.push(`${caseLabel}: ${leftover} timers/frames still pending after unmount`);
      } catch (error) {
        tally.thrown.push(`${caseLabel}: ${errorText(error)}`);
      } finally {
        vi.useRealTimers();
        cleanup();
      }
      for (const call of onFail.mock.calls) tally.worldOff.push(`${caseLabel}: canvas stopped: ${errorText(call[0])}`);
      for (const warning of themeWarnings) tally.guardFires.push(`${caseLabel}: ${warning}`);
      recordTime(caseLabel, started);
      tally.canvasCases++;
    }
    expect(found.thrown()).toEqual([]);
    expect(found.off()).toEqual([]);
    expect(found.guard()).toEqual([]);
    expect(tally.timerLeaks).toEqual([]);
  }, TIMEOUT);

  // ── 3 · the venue TV, whole nights ──────────────────────────────────────

  it(`venue TV: ${COUNTS.tv} random nights on October, each also on house (control) and a slice on the other 12 themes`, async () => {
    const rng = new Rng(SEED + 2);
    const found = mark();
    for (let i = 0; i < COUNTS.tv; i++) {
      // Script the night first, so every theme plays exactly the same one.
      const script = scriptNight(new Rng(rng.int(0, 2 ** 31)));
      tally.tvNights++;
      if (script.junk) tally.junkNights++;
      if (script.world.hard) tally.hardJunkNights++;
      const control = await playNight(script, "house", `tv#${i}/house`);
      const october = await playNight(script, "october", `tv#${i}/october`);
      if (control.crash) {
        tally.baseCrashNights++;
        tally.guardFiresOnBaseCrashNights += october.guard.length;
        if (tally.baseCrashSamples.length < 25) tally.baseCrashSamples.push(`tv#${i}: ${control.crash}`);
      } else {
        if (october.crash) tally.thrown.push(`tv#${i}/october: ${october.crash}`);
        tally.guardFires.push(...october.guard.map((g) => `tv#${i}/october: ${g}`));
        tally.worldOff.push(...october.off.map((o) => `tv#${i}/october: ${o}`));
        // Once the TV screen closes, October may leave nothing running that
        // the everyday screens don't (timers, animation frames).
        if (october.leftover > control.leftover) {
          tally.timerLeaks.push(`tv#${i}/october: ${october.leftover} pending after unmount vs ${control.leftover} on house`);
        }
      }
      if (i % 3 === 0) {
        const theme = OTHER_THEMES[(i / 3) % OTHER_THEMES.length];
        const other = await playNight(script, theme, `tv#${i}/${theme}`);
        if (!control.crash && (other.crash || other.guard.length)) {
          const line = `tv#${i}/${theme}: ${other.crash ?? other.guard.join(" | ")}`;
          // Wrong-type data (a player with no name at all) the server never
          // sends can trip a month's own extras (May's name marquee); that's
          // reported, not October's to fix. Anything else fails.
          if (script.world.hard) tally.otherThemeWrongTypeCrashes.push(line);
          else tally.otherThemeCrashes.push(line);
        }
      }
    }
    expect(found.thrown()).toEqual([]);
    expect(found.off()).toEqual([]);
    expect(found.guard()).toEqual([]);
    expect(found.other()).toEqual([]);
    expect(tally.timerLeaks).toEqual([]);
    expect(tally.harness).toEqual([]);
  }, TIMEOUT);

  // ── 4 · phones ──────────────────────────────────────────────────────────

  it(`phones: ${COUNTS.phone} random phone screens with your pumpkin, on October and every other theme`, async () => {
    const rng = new Rng(SEED + 3);
    const SECONDS = [25, 12, 5, 4.99, 1, 0.01, 0, -1, -100, 1e9, Number.NaN, Infinity, undefined];
    const MOODS: PumpkinMood[] = ["waiting", "lit", "blaze", "smoke", "toppled"];
    const found = mark();
    for (let i = 0; i < COUNTS.phone; i++) {
      const theme: ThemeKey = i % 4 === 3 ? THEME_KEYS[(i >> 2) % THEME_KEYS.length] : "october";
      // The screens this phone shows (props drawn once, so the control and
      // the theme see exactly the same thing).
      const make = new Rng(rng.int(0, 2 ** 31));
      const caseSeed = make.int(0, 2 ** 31);
      allowHard = make.chance(0.3);
      const seconds = make.pick(SECONDS) as number;
      const name = nameFor(make, 0.2);
      const standing = { rank: make.int(-1, 150), name, score: scoreValue(make, 0.2, null), isYou: make.chance(0.5) };
      const screens: ReactNode[] = [
        <PlayerQuestion key="q" seconds={seconds} prompt={make.pick(TEXTS)} category={name} />,
        <PlayerLocked key="l" seconds={seconds} chosenSlot={make.pick([1, 2, 3, 4, undefined])} lockedCount={make.int(-1, 200)} totalPlayers={make.int(0, 150)} standings={{ top: [standing], you: make.chance(0.5) ? standing : null }} />,
        <PlayerRevealCorrect key="c" awardedPoints={scoreValue(make, 0.2, null)} msToLock={make.pick([0, 4000, -1, Number.NaN])} rank={make.pick([null, 1, 0, -3, 150])} />,
        <PlayerRevealWrong key="w" chosenSlot={make.pick([1, 2, 3, 4, null, undefined])} rank={make.pick([null, 1, 0, 150])} />,
        <PlayerLobby key="lo" playerName={name} hostName={nameFor(make, 0.2)} inRoomCount={make.int(0, 150)} />,
        <PlayerBetweenGames key="b" playerName={name} top={[standing, standing]} you={standing} />,
        <PlayerWinnerCard key="win" finalScore={scoreValue(make, 0.2, null)} />,
      ];
      // October's own phone pieces (only October shows them; on the control
      // they are left out).
      const octoberOnly: ReactNode[] = [
        <FlamingHead key="fh" height={make.pick([52, 0, 1, 400])} />,
        <YourPumpkin key="yp" mood={make.chance(0.95) ? make.pick(MOODS) : (make.pick(["", "exploded", undefined]) as unknown as PumpkinMood)} size={make.pick([56, 0, 1, 900, Number.NaN])} shiver={make.chance(0.5)} />,
      ];
      const first = make.shuffle([...screens]).slice(0, make.int(1, 3));
      const second = make.shuffle([...screens]).slice(0, make.int(1, 3));
      const extras = make.chance(0.5) ? octoberOnly : [];
      const waits = [make.int(0, 3000), make.int(0, 3000)];

      const runPhone = async (on: ThemeKey) => {
        caseLabel = `phone#${i}/${on}`;
        setupCase(new Rng(caseSeed));
        startClock();
        const started = process.hrtime.bigint();
        let crash: string | null = null;
        const withExtras = (nodes: ReactNode[]) => (on === "october" ? [...nodes, ...extras] : nodes);
        try {
          const ui = (nodes: ReactNode[]) => (
            <StrictMode>
              <OuterCatch onCrash={(e) => (crash = errorText(e))}>
                <ThemeProvider themeKey={on}>{nodes}</ThemeProvider>
              </OuterCatch>
            </StrictMode>
          );
          const view = await renderAsync(ui(withExtras(first)));
          await advance(waits[0]);
          await rerenderAsync(view, ui(withExtras(second)));
          await advance(waits[1]);
          await unmountAsync(view);
        } catch (error) {
          crash = errorText(error);
        } finally {
          vi.useRealTimers();
          cleanup();
        }
        recordTime(caseLabel, started);
        bump(tally.phoneRendersByTheme, on);
        tally.phoneRenders++;
        return { crash: crash as string | null, guard: [...themeWarnings] };
      };

      const control = await runPhone("house");
      const result = theme === "house" ? control : await runPhone(theme);
      if (control.crash) {
        tally.basePhoneCrashes++;
        if (tally.baseCrashSamples.length < 40) tally.baseCrashSamples.push(`phone#${i}: ${control.crash}`);
        // October's own pieces must still hold up on their own.
        if (theme === "october") {
          const alone = await (async () => {
            caseLabel = `phone#${i}/october-pieces`;
            setupCase(new Rng(caseSeed));
            startClock();
            let crash: string | null = null;
            try {
              const view = await renderAsync(
                <StrictMode>
                  <OuterCatch onCrash={(e) => (crash = errorText(e))}>
                    <ThemeProvider themeKey="october">{octoberOnly}</ThemeProvider>
                  </OuterCatch>
                </StrictMode>,
              );
              await advance(waits[0]);
              await unmountAsync(view);
            } catch (error) {
              crash = errorText(error);
            } finally {
              vi.useRealTimers();
              cleanup();
            }
            return { crash: crash as string | null, guard: [...themeWarnings] };
          })();
          if (alone.crash) tally.thrown.push(`${caseLabel}: ${alone.crash}`);
          tally.guardFires.push(...alone.guard.map((g) => `${caseLabel}: ${g}`));
        }
        continue;
      }
      if (result.crash) tally.thrown.push(`phone#${i}/${theme}: ${result.crash}`);
      tally.guardFires.push(...result.guard.map((g) => `phone#${i}/${theme}: ${g}`));
    }
    expect(found.guard()).toEqual([]);
    expect(found.thrown()).toEqual([]);
  }, TIMEOUT);

  // ── 5 · the host's laptop console and phone preview ─────────────────────

  it(`host: ${COUNTS.host} random nights in the host's laptop console and phone preview`, async () => {
    const rng = new Rng(SEED + 4);
    const found = mark();
    for (let i = 0; i < COUNTS.host; i++) {
      const script = scriptNight(new Rng(rng.int(0, 2 ** 31)));
      let controlCrash: string | null = null;
      for (const theme of ["house", "october"] as ThemeKey[]) {
        caseLabel = `host#${i}/${theme}`;
        setupCase(new Rng(script.seed));
        startClock();
        const started = process.hrtime.bigint();
        let crash: string | null = null;
        let world: NightWorld = cloneWorld(script.world);
        try {
          const ui = (built: Built) => (
            <StrictMode>
              <OuterCatch onCrash={(e) => (crash = errorText(e))}>
                <ThemeProvider themeKey={theme}>
                  <div style={{ width: 1440, height: 900 }}>
                    <HostLiveConsole
                      themeKey={theme}
                      roomCode={built.snapshot.night.roomCode}
                      tvSnapshot={built.snapshot}
                      tvLastBroadcastRevealedAt={built.revealedAt}
                      tvLastBroadcastServerNow={built.serverNow}
                      playersTotal={built.snapshot.players.length}
                    />
                  </div>
                  <HostVenueMonitor
                    snapshot={built.snapshot}
                    themeKey={theme}
                    lastBroadcastRevealedAt={built.revealedAt}
                    lastBroadcastServerNow={built.serverNow}
                  />
                </ThemeProvider>
              </OuterCatch>
            </StrictMode>
          );
          const stepRng = new Rng(script.seed + 1);
          const view = await renderAsync(ui(buildSnapshot(stepRng, world, script.steps[0].stage, Date.now())));
          for (const step of script.steps.slice(1)) {
            await advance(step.ms);
            if (step.jumpMs) vi.setSystemTime(Date.now() + step.jumpMs);
            world = step.evolve ? evolved(world, step.seed) : world;
            await rerenderAsync(view, ui(buildSnapshot(stepRng, world, step.stage, Date.now())));
            tally.hostRenders++;
          }
          await unmountAsync(view);
        } catch (error) {
          crash = errorText(error);
        } finally {
          vi.useRealTimers();
          cleanup();
        }
        recordTime(caseLabel, started);
        if (theme === "house") {
          controlCrash = crash;
          if (crash) {
            tally.baseHostCrashes++;
            if (tally.baseCrashSamples.length < 40) tally.baseCrashSamples.push(`host#${i}: ${crash}`);
          }
          continue;
        }
        if (controlCrash) continue;
        if (crash) tally.thrown.push(`${caseLabel}: ${crash}`);
        for (const warning of themeWarnings) tally.guardFires.push(`${caseLabel}: ${warning}`);
      }
    }
    expect(found.guard()).toEqual([]);
    expect(found.thrown()).toEqual([]);
  }, TIMEOUT);
});

// ── night scripts ──────────────────────────────────────────────────────────

interface NightStep {
  stage: Stage;
  ms: number;
  /** The tab was hidden (or the laptop slept) this long: the clock jumps
   *  and nothing ran meanwhile. */
  jumpMs: number;
  evolve: boolean;
  seed: number;
  resize: boolean;
  hide: boolean;
}


interface NightScript {
  seed: number;
  world: NightWorld;
  steps: NightStep[];
  tier: "full" | "still";
  junk: boolean;
}

function scriptNight(rng: Rng): NightScript {
  const seed = rng.int(0, 2 ** 31);
  const world = newWorld(rng, T0);
  const length = rng.int(5, 15);
  const natural = rng.chance(0.5);
  let cursor = rng.int(0, NATURAL.length - 1);
  const steps: NightStep[] = Array.from({ length }, () => {
    const stage = natural ? NATURAL[cursor++ % NATURAL.length] : rng.chance(0.85) ? rng.pick(STAGES) : "chaos";
    // Mostly real pacing; sometimes a burst of flips 0-150 ms apart; now and
    // then a long stay on one screen.
    const ms = rng.chance(0.3) ? rng.int(0, 150) : rng.chance(0.9) ? rng.int(200, 8000) : rng.int(10_000, 45_000);
    const jumpMs = rng.chance(0.08) ? rng.pick([10_000, 60_000, 11 * 60_000, 3_600_000]) : 0;
    return { stage, ms, jumpMs, evolve: rng.chance(0.4), seed: rng.int(0, 2 ** 31), resize: rng.chance(0.15), hide: false };
  });
  return { seed, world, steps, tier: rng.chance(0.2) ? "still" : "full", junk: world.junk > 0 };
}

function cloneWorld(world: NightWorld): NightWorld {
  return { ...world, players: world.players.map((p) => ({ ...p })), removed: [...world.removed] };
}

function evolved(world: NightWorld, seed: number): NightWorld {
  const next = cloneWorld(world);
  evolveWorld(new Rng(seed), next, Date.now());
  return next;
}

async function playNight(script: NightScript, theme: ThemeKey, label: string) {
  caseLabel = label;
  const rng = new Rng(script.seed);
  setupCase(rng);
  startClock();
  const started = process.hrtime.bigint();
  let crash: string | null = null;
  const off: string[] = [];
  let world = cloneWorld(script.world);
  const stepRng = new Rng(script.seed + 1);
  const ui = (built: Built) => (
    <StrictMode>
      <OuterCatch onCrash={(e) => (crash = errorText(e))}>
        <ThemeProvider themeKey={theme}>
          <TVStateMachine
            snapshot={built.snapshot}
            lastBroadcastRevealedAt={built.revealedAt}
            lastBroadcastServerNow={built.serverNow}
            welcomeEvent={built.welcome}
            themeKey={theme}
            worldTier={script.tier}
          />
        </ThemeProvider>
      </OuterCatch>
    </StrictMode>
  );
  let leftover = 0;
  const checkOff = (container: HTMLElement) => {
    if (container.querySelector("[data-world-off=true]")) off.push("the world switched itself off");
  };
  try {
    const view = await renderAsync(ui(buildSnapshot(stepRng, world, script.steps[0].stage, Date.now())));
    bump(tally.tvSnapshotsByTheme, theme);
    tally.tvSnapshotsRendered++;
    for (const step of script.steps.slice(1)) {
      if (crash) break;
      await advance(step.ms);
      if (step.resize) await act(async () => fireResize(rng));
      if (step.jumpMs) {
        vi.setSystemTime(Date.now() + step.jumpMs);
        await advance(16);
      }
      world = step.evolve ? evolved(world, step.seed) : world;
      await rerenderAsync(view, ui(buildSnapshot(stepRng, world, step.stage, Date.now())));
      bump(tally.tvSnapshotsByTheme, theme);
      tally.tvSnapshotsRendered++;
      checkOff(view.container);
    }
    await advance(2000);
    checkOff(view.container);
    await unmountAsync(view);
    if (view.container.innerHTML) throw new Error("fuzz: the TV did not unmount");
    leftover = vi.getTimerCount();
  } catch (error) {
    crash = errorText(error);
  } finally {
    vi.useRealTimers();
    cleanup();
  }
  // The fuzz itself must stay sound: every night starts on an empty page.
  if (document.body.children.length) tally.harness.push(`${label}: page not empty after the night`);
  recordTime(label, started);
  return { crash: crash as string | null, guard: [...themeWarnings], off: [...new Set(off)], leftover };
}

function recordTime(label: string, started: bigint) {
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  if (ms > tally.slowestCaseMs) tally.slowestCaseMs = Math.round(ms);
  if (ms > 5000 && tally.slowCases.length < 20) tally.slowCases.push(`${label}: ${Math.round(ms)} ms`);
}
