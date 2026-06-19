// Procedural fireworks — the July "4th" theme's signature weather. Replaces
// the old four-loop SVG starbursts (`FireworkBursts`) with a real pyrotechnics
// engine:
//
//   • A single overlay canvas drawn above the scene with additive ("lighter")
//     compositing and screen blend, so every spark only ever brightens the
//     navy room — never darkens it.
//   • Launched shells that rise from the bottom edge, arc under gravity, leave
//     a sparkling rising trail, and explode at apex.
//   • Gravity-driven burst particles with air drag, fading life, a soft glow
//     sprite, and motion trails (the canvas fades toward transparent each
//     frame instead of hard-clearing — old positions linger as streaks).
//   • Color variety — red / white / blue / gold (the 4th-of-July palette),
//     with pure-white sparkle accents regardless of the configured colors.
//   • Burst-type variety — round peony, drooping willow, even ring, and a
//     twinkling crackle finish — picked at random for a non-repeating show.
//   • An `intensity` input (matching the rest of the weather system) that
//     scales cadence + density: 1 = calm ambient, 2.2 = the finale crescendo
//     (faster launches, occasional multi-shell salvos).
//
// Accessibility / performance:
//   • Honors `prefers-reduced-motion: reduce` → renders a calm static glow
//     fallback (no RAF, no flashing), exactly like `Lightning`/`ParticleField`.
//   • Hard `intensity <= 0` → renders nothing.
//   • DPR clamped to 2; a hard live-particle ceiling caps cost so the finale
//     can't blow the venue-laptop budget; spawning pauses when the tab is
//     hidden and a large frame delta is clamped so nothing teleports.
//
// The ambient engine is Phase 1. Phase 2 adds a synchronized "beat": a
// game-state callsite (a resolved answer, a game-end) ignites the SAME burst
// across every July screen at the SAME wall-clock instant via the module-level
// `publishPyrotechnicsBeat` below — published by PyrotechnicsBeatConductor at a
// scheduled `fireAt`, NOT on broadcast receipt (firing on receipt would let
// the screens drift apart). The beat rides the existing dual-publish broadcast
// conductor (no new sync system, no schema). Mirrors Lightning.fireLightningBeat
// and JuneSky.fireJuneBeat so callsites don't thread a prop through every stage.

"use client";

import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";

// ─── Module-level synchronized beat ─────────────────────────────────────────
// Mirrors Lightning.fireLightningBeat / JuneSky.fireJuneBeat so callsites don't
// thread a prop down through every TVStage — but unlike those, a firework burst
// is a SHARP instant, so it carries a target time and an id:
//
//   • Each TV view mounts its OWN TVStage → Weather → Pyrotechnics, so the same
//     resolve/game-end that triggers the beat ALSO remounts the engine. The beat
//     must therefore be SCHEDULED against the shared target instant (`targetAtMs`)
//     and re-scheduled by whichever engine is mounted — never "fired immediately
//     on whatever happens to be mounted right now," which would land on the
//     outgoing screen and/or fire late on the incoming one.
//   • The id (`pyroBeatSeq`) de-dups: a beat fires AT MOST ONCE per surface.
//     The first engine to reach `targetAtMs` claims it (`lastFiredPyroBeatId`);
//     any other engine (e.g. a late-mounting reveal view) sees it claimed and
//     stays quiet — no double-burst. A superseding beat (salvo → game-end finale)
//     bumps the id, so an in-flight earlier beat is dropped, latest wins.
export type PyrotechnicsBeatKind = "salvo" | "finale";

interface PyroBeat {
  id: number;
  kind: PyrotechnicsBeatKind;
  /** Absolute LOCAL time (ms, this surface's clock) to ignite. */
  targetAtMs: number;
}

// Never schedule farther out than this, and treat a target already this far in
// the past as stale (don't replay an old burst when an engine mounts much later).
const PYRO_BEAT_MAX_WAIT_MS = 2000;
const PYRO_BEAT_STALE_MS = 1500;

let currentPyroBeat: PyroBeat | null = null;
let lastFiredPyroBeatId = 0;
let pyroBeatSeq = 0;
const pyroBeatListeners = new Set<() => void>();

function subscribePyrotechnicsBeat(fn: () => void): () => void {
  pyroBeatListeners.add(fn);
  return () => pyroBeatListeners.delete(fn);
}

/**
 * Decide whether — and how long to wait before — a mounted engine should ignite
 * the in-flight beat. Returns the ms to wait (>= 0), or null to skip: no beat,
 * already claimed by another engine on this surface, or stale/garbage target.
 * Pure (state passed in) so the scheduling rule is unit-testable without canvas.
 */
export function planEngineBeat(
  beat: PyroBeat | null,
  lastFiredId: number,
  nowMs: number,
): { waitMs: number } | null {
  if (!beat || beat.id === lastFiredId) return null;
  const wait = beat.targetAtMs - nowMs;
  if (wait > PYRO_BEAT_MAX_WAIT_MS || wait < -PYRO_BEAT_STALE_MS) return null;
  return { waitMs: Math.max(0, wait) };
}

/**
 * Publish a synchronized firework beat to ignite at `Date.now() + delayMs` on
 * THIS surface. Every mounted engine schedules it (and re-schedules on mount),
 * so it lands at the shared instant regardless of which view is mounted when —
 * and fires at most once (id de-dup). No-op visually unless a July Pyrotechnics
 * is on screen. Called by PyrotechnicsBeatConductor — the delay comes from the
 * conductor's clock-aware computeBeatDelayMs, never "fire on broadcast receipt."
 */
export function publishPyrotechnicsBeat(
  kind: PyrotechnicsBeatKind,
  delayMs: number,
): void {
  currentPyroBeat = {
    id: ++pyroBeatSeq,
    kind,
    targetAtMs: Date.now() + Math.max(0, delayMs),
  };
  for (const fn of pyroBeatListeners) fn();
}

// ─── Module-level lock-in burst ─────────────────────────────────────────────
// Mirrors Lightning.fireLightningBeat: a TV-LOCAL, player-tinted firework fired
// the instant a player locks in their answer. Unlike the synchronized beat above
// this is NOT scheduled or cross-device — it's an immediate flourish on whatever
// July engine is mounted on THIS surface (the TV / host preview), driven by the
// TVLockInCeremony queue which already paces + batches the locks. Players never
// call this (they don't mount the ceremony), so it never fires on phones.
type LockInBurstListener = (tint: string) => void;
const lockInBurstListeners = new Set<LockInBurstListener>();

function subscribeLockInBurst(fn: LockInBurstListener): () => void {
  lockInBurstListeners.add(fn);
  return () => lockInBurstListeners.delete(fn);
}

/**
 * Fire a player-tinted firework burst on every mounted July engine on this
 * surface. Called by TVLockInCeremony for the July "fireworks" ceremony.
 * No-op if no engine is mounted (non-July themes) or under reduced motion
 * (the engine effect early-returns before subscribing, exactly like Lightning).
 */
export function fireLockInBurst(tint: string): void {
  for (const fn of lockInBurstListeners) fn(tint);
}

/** Test-only hooks: drive the beat without mounting a canvas (jsdom has no 2D
 *  context, so the engine effect early-returns before it can subscribe). */
export const __pyroBeatTest = {
  subscribe: subscribePyrotechnicsBeat,
  state: (): { current: PyroBeat | null; lastFiredId: number } => ({
    current: currentPyroBeat,
    lastFiredId: lastFiredPyroBeatId,
  }),
  /** Simulate an engine claiming + igniting the current beat. */
  claimCurrent: (): PyrotechnicsBeatKind | null => {
    if (!currentPyroBeat || currentPyroBeat.id === lastFiredPyroBeatId) return null;
    lastFiredPyroBeatId = currentPyroBeat.id;
    return currentPyroBeat.kind;
  },
  reset: (): void => {
    currentPyroBeat = null;
    lastFiredPyroBeatId = 0;
    pyroBeatSeq = 0;
  },
};

/** Test-only hook for the lock-in burst pub/sub (canvas-free). */
export const __pyroLockInTest = {
  subscribe: subscribeLockInBurst,
};

// ─── Palette ──────────────────────────────────────────────────────────────
// Red / white / blue / gold — the 4th-of-July statement. Kept as a prop with
// this default so the engine stays generic (mirrors `Lightning`'s `color`
// prop). A module-level constant (not an inline default) so Weather's
// `<Pyrotechnics intensity={…}/>` re-renders don't hand us a fresh array
// reference every commit and reset the engine.
export const JULY_FIREWORK_COLORS = ["#E63946", "#FFFFFF", "#4DA6FF", "#FFD93D"];

// ─── Tuning constants ───────────────────────────────────────────────────────
// Hard ceiling on live particles. A backstop against pathological density at
// high intensity — bursts stop spawning (existing ones still fade out) rather
// than letting the array grow without bound.
const MAX_PARTICLES = 1600;
// Per-instance performance budget. The venue TV (large canvas) keeps the full
// 1600-particle / DPR-2 budget — byte-identical to Phase 1/2. Phone-sized
// canvases (and low-core devices) self-degrade so 20-40 phones, including
// low-end ones, never jank the reveal UI. Pure + exported for unit testing.
const PHONE_CANVAS_MAX_W = 520; // below this, treat as a phone surface
export function pyroBudget(
  cssW: number,
  cores: number | undefined,
): { maxParticles: number; dprCap: number } {
  if (cssW >= PHONE_CANVAS_MAX_W) return { maxParticles: MAX_PARTICLES, dprCap: 2 };
  const lowCore = typeof cores === "number" && cores <= 4;
  return { maxParticles: lowCore ? 350 : 550, dprCap: 1.5 };
}
// Per-frame trail fade. Each frame the canvas alpha is multiplied by
// (1 - TRAIL_FADE) via a destination-out fill, so a spark's recent positions
// linger ~6-8 frames as a streak before vanishing.
const TRAIL_FADE = 0.16;
// Gravity / drag are expressed relative to canvas height so the show reads the
// same on the 1280×720 venue TV and the smaller dev gallery frames.
const GRAVITY_FACTOR = 0.52; // px/s² = GRAVITY_FACTOR * canvasHeight
// Frame delta is clamped so a backgrounded tab (huge dt on return) doesn't
// fling every particle off-screen in one step.
const MAX_DT = 0.05;

type BurstType = "peony" | "willow" | "ring" | "crackle";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Remaining life (s). */
  life: number;
  /** Initial life (s) — drives the alpha envelope. */
  maxLife: number;
  /** Radius (px) of the glow sprite when drawn. */
  size: number;
  /** Index into the sprite list (palette colors then the always-white sprite). */
  sprite: number;
  /** Per-second velocity retention (air drag). 0.9 hangs, 0.8 falls quickly. */
  drag: number;
  /** Multiplier on gravity (willow droops harder). */
  gravity: number;
  /** Twinkle — randomize alpha each frame for the crackle finish. */
  flicker: boolean;
}

interface Shell {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Dominant palette color index for the burst. */
  color: number;
  /** Second palette color for two-tone bursts (=== color when single-tone). */
  color2: number;
  burst: BurstType;
}

export interface PyrotechnicsProps {
  /** 0 = off (renders nothing), 1 = calm ambient, >1 = heightened (finale).
   *  Matches the rest of the weather system's intensity convention. */
  intensity?: number;
  /** Spark palette. Defaults to the July red/white/blue/gold. */
  colors?: string[];
}

export function Pyrotechnics({
  intensity = 1,
  colors = JULY_FIREWORK_COLORS,
}: PyrotechnicsProps) {
  const reduced = usePrefersReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafIdRef = useRef<number | null>(null);
  // Read intensity live inside the RAF loop without re-subscribing it. Synced
  // in an effect (never mutate a ref during render). Changes within the
  // positive range — e.g. the finale ramp to 2.2 — are picked up live by the
  // loop, so the show is never reset mid-ramp.
  const intensityRef = useRef(intensity);
  useEffect(() => {
    intensityRef.current = intensity;
  }, [intensity]);

  // Stable key so the engine only re-initializes when the palette actually
  // changes (not on every render that passes an equal array).
  const colorsKey = colors.join(",");
  // Whether the engine should run at all. Crossing the 0 boundary (off↔on)
  // re-runs the effect; positive→positive changes do not (handled live via
  // intensityRef). Reading the prop here — not intensityRef — is what makes an
  // off→on transition actually start the loop.
  const active = intensity > 0;

  useEffect(() => {
    if (reduced || !active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // jsdom / unsupported — component still mounts cleanly.

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const palette = colorsKey.split(",");

    // ── Pre-rendered glow sprites ──
    // One soft radial-gradient sprite per palette color, plus a guaranteed
    // pure-white sprite (index = palette.length) for sparkle accents, the
    // explosion flash, and crackle — so highlights stay white even if the
    // configured palette has no white. drawImage of a cached sprite is far
    // cheaper than a per-particle shadowBlur for hundreds of particles.
    const SPRITE_PX = 32;
    const sprites: HTMLCanvasElement[] = [...palette, "#FFFFFF"].map((hex) =>
      makeGlowSprite(hex, SPRITE_PX),
    );
    const whiteSprite = sprites.length - 1;

    const shells: Shell[] = [];
    const particles: Particle[] = [];

    let cssW = 0;
    let cssH = 0;

    function resize() {
      const c = canvasRef.current;
      if (!c) return;
      const parent = c.parentElement;
      if (!parent) return;
      cssW = parent.clientWidth;
      cssH = parent.clientHeight;
      c.width = Math.max(1, Math.floor(cssW * dpr));
      c.height = Math.max(1, Math.floor(cssH * dpr));
      c.style.width = `${cssW}px`;
      c.style.height = `${cssH}px`;
    }
    resize();
    const budget = pyroBudget(
      cssW,
      typeof navigator !== "undefined" ? navigator.hardwareConcurrency : undefined,
    );
    const maxParticles = budget.maxParticles;
    dpr = Math.min(window.devicePixelRatio || 1, budget.dprCap);
    resize(); // re-apply the backing-store size with the clamped DPR

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && canvas.parentElement) {
      ro = new ResizeObserver(resize);
      ro.observe(canvas.parentElement);
    } else {
      window.addEventListener("resize", resize);
    }

    const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
    const randInt = (n: number) => Math.floor(Math.random() * n);

    function pickBurst(): BurstType {
      const r = Math.random();
      if (r < 0.5) return "peony";
      if (r < 0.74) return "willow";
      if (r < 0.9) return "ring";
      return "crackle";
    }

    function launchShell() {
      if (cssW === 0 || cssH === 0) return;
      const color = randInt(palette.length);
      // ~35% of shells are two-tone (a second palette color in the spread).
      const color2 = Math.random() < 0.35 ? randInt(palette.length) : color;
      const g = GRAVITY_FACTOR * cssH;
      // Choose how high it rises, then derive the launch velocity so the shell
      // decelerates to a stop right there (apex ≈24%-52% down from the top).
      const desiredRise = rand(0.5, 0.78) * cssH;
      const vy = -Math.sqrt(2 * g * desiredRise);
      shells.push({
        x: rand(0.12, 0.88) * cssW,
        y: cssH * 1.02,
        vx: rand(-0.05, 0.05) * cssW,
        vy,
        color,
        color2,
        burst: pickBurst(),
      });
    }

    // How many shells to launch this beat, and how soon the next beat is.
    // Cadence tightens and salvos appear as intensity climbs.
    function nextInterval(): number {
      const i = Math.max(0.5, intensityRef.current);
      return rand(1.5, 2.6) / i;
    }
    function salvoSize(): number {
      const i = intensityRef.current;
      if (i <= 1.2) return 1;
      // Heightened: chance of a 2-3 shell salvo grows with intensity.
      if (Math.random() < (i - 1) * 0.5) return 1 + 1 + randInt(2);
      return 1;
    }

    function explode(shell: Shell) {
      if (particles.length >= maxParticles) return;
      const { x, y, color, color2, burst } = shell;
      const g = cssH; // burst speeds scale with canvas height

      // Explosion flash — a brief, bright, large white pop at the center.
      particles.push({
        x, y, vx: 0, vy: 0,
        life: 0.14, maxLife: 0.14,
        size: cssH * 0.05,
        sprite: whiteSprite,
        drag: 0.5, gravity: 0, flicker: false,
      });

      // Density scales gently with intensity (capped so the finale stays
      // inside the perf budget).
      const dens = Math.min(1.5, 0.85 + 0.3 * intensityRef.current);

      if (burst === "willow") {
        // Slow, long-hanging, drooping gold/white trails.
        const n = Math.round(rand(42, 60) * dens);
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + rand(-0.08, 0.08);
          const sp = rand(0.08, 0.2) * g;
          particles.push({
            x, y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            life: rand(1.8, 2.6), maxLife: 2.6,
            size: rand(2.2, 3.6),
            sprite: Math.random() < 0.3 ? whiteSprite : color,
            drag: 0.9, gravity: 1.15, flicker: false,
          });
        }
      } else if (burst === "ring") {
        // Even ring, slightly flattened for a 3-D tilt.
        const n = Math.round(rand(46, 64) * dens);
        const sp = rand(0.2, 0.3) * g;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2;
          particles.push({
            x, y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp * 0.55,
            life: rand(1.1, 1.6), maxLife: 1.6,
            size: rand(2.4, 3.6),
            sprite: Math.random() < 0.12 ? whiteSprite : color,
            drag: 0.85, gravity: 0.9, flicker: false,
          });
        }
      } else if (burst === "crackle") {
        // A round bloom of tiny, fast-fading, twinkling sparks.
        const n = Math.round(rand(90, 130) * dens);
        for (let k = 0; k < n; k++) {
          const a = Math.random() * Math.PI * 2;
          const sp = rand(0.06, 0.34) * g;
          particles.push({
            x, y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            life: rand(0.5, 0.95), maxLife: 0.95,
            size: rand(1.4, 2.6),
            sprite: Math.random() < 0.6 ? whiteSprite : color,
            drag: 0.82, gravity: 0.8, flicker: true,
          });
        }
      } else {
        // Peony — the classic round burst. Two-tone when color2 differs.
        const n = Math.round(rand(64, 92) * dens);
        for (let k = 0; k < n; k++) {
          const a = Math.random() * Math.PI * 2;
          const sp = rand(0.12, 0.34) * g;
          const accent = Math.random() < 0.18;
          const tone = k < n / 2 ? color : color2;
          particles.push({
            x, y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            life: rand(0.9, 1.5), maxLife: 1.5,
            size: rand(2.6, 4.2),
            sprite: accent ? whiteSprite : tone,
            drag: 0.83, gravity: 1, flicker: false,
          });
        }
      }
    }

    // ── Synchronized beat ──
    // An immediate air-burst cluster AT the ignition instant. We explode
    // directly rather than launch a rising shell — a shell would delay the
    // visible flash ~1s and break the "every screen together" moment. `salvo`
    // = a few bursts (per-question celebration); `finale` = a wider, denser
    // barrage (game-end). explode() self-limits against the particle ceiling.
    function fireBeat(kind: PyrotechnicsBeatKind) {
      if (cssW === 0 || cssH === 0) return;
      const n = kind === "finale" ? 7 : 3;
      for (let k = 0; k < n; k++) {
        const color = randInt(palette.length);
        const color2 = Math.random() < 0.5 ? randInt(palette.length) : color;
        explode({
          x: rand(0.14, 0.86) * cssW,
          y: rand(0.16, 0.42) * cssH,
          vx: 0,
          vy: 0,
          color,
          color2,
          burst: pickBurst(),
        });
      }
    }
    // Schedule the in-flight beat against its shared target instant. Runs on
    // every beat publish AND once on mount (so a view that mounts late — e.g.
    // the reveal screen after a slow snapshot refetch — still ignites at the
    // target, or immediately if the target already passed, but only if no other
    // engine already claimed it). planEngineBeat de-dups by id, so the burst
    // lands exactly once per surface and never double-fires across the remount.
    const beatTimers = new Set<number>();
    function scheduleCurrentBeat() {
      const plan = planEngineBeat(currentPyroBeat, lastFiredPyroBeatId, Date.now());
      if (!plan || !currentPyroBeat) return;
      const beatId = currentPyroBeat.id;
      const kind = currentPyroBeat.kind;
      const t = window.setTimeout(() => {
        beatTimers.delete(t);
        // Claim at fire time: still the current beat, not yet fired by another
        // engine on this surface (the outgoing view's engine), AND this engine
        // can actually draw. The last clause matters: fireBeat no-ops on a
        // 0×0 canvas, so claiming before we can draw would block a sibling
        // engine that COULD — silently dropping the burst on this surface.
        if (
          currentPyroBeat?.id === beatId &&
          lastFiredPyroBeatId !== beatId &&
          cssW > 0 &&
          cssH > 0
        ) {
          lastFiredPyroBeatId = beatId;
          fireBeat(kind);
        }
      }, plan.waitMs);
      beatTimers.add(t);
    }
    const unsubscribeBeat = subscribePyrotechnicsBeat(scheduleCurrentBeat);
    scheduleCurrentBeat();

    // ── Lock-in burst (player-tinted) ──
    // A single modest peony in the locking player's brand color, white-accented,
    // fired immediately on lock-in (TVLockInCeremony paces the queue). The
    // player's tint usually isn't in the configured palette, so we lazily render
    // a glow sprite for it and append to the sprite list — cached by hex so the
    // handful of distinct player colors only ever build a sprite once. The white
    // core stays white (mirrors Lightning's tint philosophy). Smaller + shorter
    // than a finale burst so it never buries the live question.
    const tintSpriteIndex = new Map<string, number>();
    function spriteIndexForTint(hex: string): number {
      const cached = tintSpriteIndex.get(hex);
      if (cached !== undefined) return cached;
      const idx = sprites.length;
      sprites.push(makeGlowSprite(hex, SPRITE_PX));
      tintSpriteIndex.set(hex, idx);
      return idx;
    }
    function fireLockInBurstLocal(tint: string) {
      if (cssW === 0 || cssH === 0) return;
      if (particles.length >= maxParticles) return;
      const tintIdx = spriteIndexForTint(tint);
      const x = rand(0.18, 0.82) * cssW;
      const y = rand(0.16, 0.4) * cssH;
      const g = cssH;
      // Brief white flash at the core.
      particles.push({
        x, y, vx: 0, vy: 0,
        life: 0.12, maxLife: 0.12,
        size: cssH * 0.035,
        sprite: whiteSprite,
        drag: 0.5, gravity: 0, flicker: false,
      });
      const n = Math.round(rand(44, 60));
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2;
        const sp = rand(0.12, 0.3) * g;
        const accent = Math.random() < 0.22;
        particles.push({
          x, y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: rand(0.85, 1.35), maxLife: 1.35,
          size: rand(2.4, 3.8),
          sprite: accent ? whiteSprite : tintIdx,
          drag: 0.83, gravity: 1, flicker: false,
        });
      }
    }
    const unsubscribeLockIn = subscribeLockInBurst(fireLockInBurstLocal);

    let last = 0;
    let spawnTimer = rand(0.2, 0.9); // first shell lands quickly after mount

    function frame(now: number) {
      const c = canvasRef.current;
      const cx = c?.getContext("2d");
      if (!c || !cx) {
        rafIdRef.current = requestAnimationFrame(frame);
        return;
      }

      // Delta time. A huge delta (e.g. returned-from-hidden tab) is clamped to
      // one nominal frame so existing particles step forward without
      // teleporting; spawning is also skipped this tick (see `stalled` below).
      let dt = last === 0 ? 1 / 60 : (now - last) / 1000;
      last = now;
      const stalled = dt > MAX_DT;
      if (stalled) dt = 1 / 60;

      cx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Trails: fade what's already drawn toward transparent, then draw new
      // sparks additively on top.
      cx.globalCompositeOperation = "destination-out";
      cx.fillStyle = `rgba(0,0,0,${TRAIL_FADE})`;
      cx.fillRect(0, 0, cssW, cssH);
      cx.globalCompositeOperation = "lighter";

      // Spawn (skip while hidden, mid-stall, or over the particle ceiling).
      const hidden = typeof document !== "undefined" && document.hidden;
      if (!hidden && !stalled) {
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
          if (particles.length < maxParticles) {
            const salvo = salvoSize();
            for (let s = 0; s < salvo; s++) launchShell();
          }
          spawnTimer = nextInterval();
        }
      }

      const g = GRAVITY_FACTOR * cssH;

      // Shells: rise, arc, trail, explode at apex.
      for (let i = shells.length - 1; i >= 0; i--) {
        const sh = shells[i];
        sh.vy += g * dt;
        sh.x += sh.vx * dt;
        sh.y += sh.vy * dt;
        // Bright moving head (the fade-trail leaves the rising streak behind).
        drawSprite(cx, sprites[sh.color], sh.x, sh.y, rand(3, 4), 0.9);
        if (Math.random() < 0.5) drawSprite(cx, sprites[whiteSprite], sh.x, sh.y, 2, 0.5);
        // Apex (or just over the top) → explode.
        if (sh.vy >= 0 || sh.y < cssH * 0.06) {
          explode(sh);
          shells.splice(i, 1);
        }
      }

      // Particles: integrate, fade, draw. In-place swap-remove for dead ones.
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        if (p.life <= 0) {
          particles[i] = particles[particles.length - 1];
          particles.pop();
          continue;
        }
        p.vy += g * p.gravity * dt;
        const d = Math.pow(p.drag, dt);
        p.vx *= d;
        p.vy *= d;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        // Alpha envelope: ease out over life, with an optional twinkle.
        const lifeT = p.life / p.maxLife;
        let alpha = lifeT * lifeT;
        if (p.flicker) alpha *= 0.4 + Math.random() * 0.6;
        drawSprite(cx, sprites[p.sprite], p.x, p.y, p.size, alpha);
      }

      rafIdRef.current = requestAnimationFrame(frame);
    }

    rafIdRef.current = requestAnimationFrame(frame);

    return () => {
      unsubscribeBeat();
      unsubscribeLockIn();
      for (const t of beatTimers) window.clearTimeout(t);
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", resize);
    };
  }, [reduced, colorsKey, active]);

  if (intensity <= 0) return null;

  // Reduced motion: a calm, static glow — a few settled bursts, no animation,
  // no flashing. Same philosophy as Lightning's LegacyFlicker.
  if (reduced) {
    return <PyrotechnicsStatic colors={colors} />;
  }

  return (
    <div
      data-testid="pyrotechnics-root"
      style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          mixBlendMode: "screen",
        }}
      />
    </div>
  );
}

// ─── Glow sprite ─────────────────────────────────────────────────────────
// A soft radial-gradient disc on a transparent square. Center alpha is kept
// under 1 so additive overlaps build the hot core rather than clipping a
// single spark to white.
function makeGlowSprite(hex: string, px: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = px;
  c.height = px;
  const cx = c.getContext("2d");
  if (!cx) return c;
  const r = px / 2;
  const { r: rr, g, b } = hexToRgb(hex);
  const grad = cx.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, `rgba(${rr},${g},${b},0.95)`);
  grad.addColorStop(0.35, `rgba(${rr},${g},${b},0.55)`);
  grad.addColorStop(1, `rgba(${rr},${g},${b},0)`);
  cx.fillStyle = grad;
  cx.beginPath();
  cx.arc(r, r, r, 0, Math.PI * 2);
  cx.fill();
  return c;
}

function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLCanvasElement,
  x: number,
  y: number,
  radius: number,
  alpha: number,
): void {
  if (alpha <= 0) return;
  ctx.globalAlpha = Math.min(1, alpha);
  const d = radius * 2;
  ctx.drawImage(sprite, x - radius, y - radius, d, d);
  ctx.globalAlpha = 1;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace(/^#/, "");
  const full =
    cleaned.length === 3
      ? cleaned.split("").map((ch) => ch + ch).join("")
      : cleaned;
  const n = parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(n)) return { r: 255, g: 255, b: 255 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// ─── Reduced-motion fallback ───────────────────────────────────────────────
// Three soft, static settled bursts in the firework colors. No motion, no
// flashing — present enough to feel festive for users who opt out of motion.
function PyrotechnicsStatic({ colors }: { colors: string[] }) {
  const spots = [
    { x: "22%", y: "26%", c: colors[0] ?? "#E63946", s: "34%" },
    { x: "74%", y: "20%", c: colors[2] ?? colors[1] ?? "#4DA6FF", s: "30%" },
    { x: "52%", y: "40%", c: colors[3] ?? colors[1] ?? "#FFD93D", s: "26%" },
  ];
  return (
    <div
      data-testid="pyrotechnics-reduced"
      style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}
    >
      {spots.map((sp, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: sp.x,
            top: sp.y,
            width: sp.s,
            height: sp.s,
            transform: "translate(-50%, -50%)",
            background: `radial-gradient(circle, ${sp.c}55, ${sp.c}18 40%, transparent 70%)`,
            mixBlendMode: "screen",
          }}
        />
      ))}
    </div>
  );
}
