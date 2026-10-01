// October · the pumpkin patch, the Headless Horseman and the fog, drawn on
// ONE canvas in front of the TV screens (bottom strip only; the Horseman's
// ride crosses the lower right at time's up).
//
// One canvas, not 40 animated page elements: research for this theme found
// separate animated pieces strain a venue TV, while one canvas with the art
// pre-drawn to bitmaps holds up. Every mood change is a fade of at least a
// few hundred milliseconds and ripples across the patch, so nothing flashes
// more than three times a second.
//
// Tiers: "full" animates everything; "lite" (a slow TV, found by timing the
// first frames) keeps the same story with fewer embers at lower resolution;
// "still" (reduced motion, the host's phone preview) draws each state once,
// with no animation loop at all.
//
// Read-only: it draws what it is told. If anything here throws, it stops and
// reports the failure so the world switches off and the game carries on.

"use client";

import { useEffect, useRef } from "react";
import {
  HORSEMAN,
  PUMPKIN_BLAZE,
  PUMPKIN_LIT,
  PUMPKIN_SMOKE_BODY,
  PUMPKIN_WAITING,
  artUrl,
  type OctoberArt,
} from "./art";
import {
  RIDE_LEAD_SECONDS,
  RIDE_TAIL_SECONDS,
  patchLayout,
  type PatchPlayer,
  type PatchScene,
  type PumpkinMood,
  type PumpkinSlot,
} from "@/lib/experience/october/patch";

export type WorldTier = "full" | "lite" | "still";

export interface OctoberPatchInputs {
  players: readonly PatchPlayer[];
  scene: PatchScene;
  /** Continuous seconds left (negative after zero), read every frame. */
  secondsLeftNow: () => number | null;
  colorFor: (playerKey: string) => string;
}

export interface OctoberPatchCanvasProps {
  inputs: OctoberPatchInputs;
  tier: "full" | "still";
  /** Scale the surrounding stage is drawn at; a change re-sizes the canvas
   *  so the pumpkins stay sharp. */
  stageScale?: number;
  onFail: (error: unknown) => void;
}

const STAGE_W = 1600;
const STAGE_H = 900;
const TOPPLE_DEG = -78;

type SpriteKey = "waiting" | "lit" | "blaze" | "smoke" | "horseman";
const SPRITE_ART: Record<SpriteKey, OctoberArt> = {
  waiting: PUMPKIN_WAITING,
  lit: PUMPKIN_LIT,
  blaze: PUMPKIN_BLAZE,
  smoke: PUMPKIN_SMOKE_BODY,
  horseman: HORSEMAN,
};

interface PumpkinRuntime {
  key: string;
  name: string;
  x: number;
  top: number;
  w: number;
  h: number;
  slot: PumpkinSlot;
  mood: PumpkinMood;
  prevMood: PumpkinMood;
  changedAt: number;
  delay: number;
  appearedAt: number;
  seed: number;
  nextEmberAt: number;
  nextWispAt: number;
}

interface Particle {
  kind: "ember" | "puff";
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  size: number;
}

export function OctoberPatchCanvas({ inputs, tier, stageScale = 1, onFail }: OctoberPatchCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputsRef = useRef(inputs);
  const onFailRef = useRef(onFail);
  const drawRef = useRef<(() => void) | null>(null);
  const resizeRef = useRef<(() => void) | null>(null);
  // The animation loop reads the latest inputs from refs, refreshed after
  // every render (never during one).
  useEffect(() => {
    inputsRef.current = inputs;
    onFailRef.current = onFail;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let stopped = false;
    let raf = 0;
    let lite = false;
    const still = tier === "still";
    const frameTimes: number[] = [];
    let lastFrameAt = 0;
    let framesSeen = 0;

    // Size + mapping from the 1600×900 design stage to this canvas: the whole
    // scene fits ("meet") and sits on the bottom edge, so the patch lines up
    // with the hill whatever shape the TV panel is.
    let cssW = 0;
    let cssH = 0;
    let dpr = 1;
    let k = 1;
    let ox = 0;
    let oy = 0;
    let bitmaps: Partial<Record<SpriteKey, HTMLCanvasElement>> = {};
    let bitmapScale = 0;
    const images: Partial<Record<SpriteKey, HTMLImageElement>> = {};

    const pumpkins = new Map<string, PumpkinRuntime>();
    const particles: Particle[] = [];
    let initialized = false;
    let fontFamily = "system-ui, sans-serif";
    let lastDrawAt = 0;
    const labelCache = new Map<string, string>();
    let puffSprite: HTMLCanvasElement | null = null;
    let lastLayoutCount = -1;
    let layout: PumpkinSlot[] = [];
    let lastPhase: PatchScene["phase"] | null = null;
    let namesAlpha = inputsRef.current.scene.showNames ? 1 : 0;
    let horsemanAlpha = 0;
    let fogStartedAt = -1;

    const fail = (error: unknown) => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      onFailRef.current(error);
    };

    const loadImages = () =>
      Promise.all(
        (Object.keys(SPRITE_ART) as SpriteKey[]).map(
          (key) =>
            new Promise<void>((resolve) => {
              const img = new Image();
              img.decoding = "async";
              img.onload = () => {
                images[key] = img;
                resolve();
              };
              img.onerror = () => resolve();
              img.src = artUrl(SPRITE_ART[key]);
            }),
        ),
      );

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      cssW = Math.max(1, rect.width);
      cssH = Math.max(1, rect.height);
      dpr = Math.min(lite || still ? 1 : 2, window.devicePixelRatio || 1);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      k = Math.min(cssW / STAGE_W, cssH / STAGE_H);
      ox = (cssW - STAGE_W * k) / 2;
      oy = cssH - STAGE_H * k;
      bitmapScale = 0; // re-rasterize at the new size
    };

    const rasterize = () => {
      const front = layout.reduce((m, s) => Math.max(m, s.w), 0) || 124;
      const scale = k * dpr;
      if (Math.abs(scale - bitmapScale) < 0.01 && Object.keys(bitmaps).length) return;
      bitmapScale = scale;
      const next: Partial<Record<SpriteKey, HTMLCanvasElement>> = {};
      for (const key of Object.keys(SPRITE_ART) as SpriteKey[]) {
        const img = images[key];
        if (!img) continue;
        const art = SPRITE_ART[key];
        const designW = key === "horseman" ? 640 : front;
        const w = Math.max(8, Math.ceil(designW * scale));
        const h = Math.max(8, Math.ceil((w * art.height) / art.width));
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d")?.drawImage(img, 0, 0, w, h);
        next[key] = c;
      }
      bitmaps = next;
    };

    const syncPumpkins = (now: number) => {
      const { players, scene } = inputsRef.current;
      if (players.length !== lastLayoutCount) {
        layout = patchLayout(players.length);
        lastLayoutCount = players.length;
        bitmapScale = 0;
      }
      const seen = new Set<string>();
      // Moods change as a ripple, left to right, so a rush of lock-ins or
      // the whole patch blazing reads as a wave, never a flash.
      let rippleIndex = 0;
      const phaseChanged = scene.phase !== lastPhase;
      players.forEach((p, i) => {
        const slot = layout[i];
        if (!slot) return;
        seen.add(p.key);
        const target = scene.moods[p.key] ?? "lit";
        let rt = pumpkins.get(p.key);
        if (!rt) {
          rt = {
            key: p.key,
            name: p.name,
            x: slot.cx,
            top: slot.top,
            w: slot.w,
            h: slot.h,
            slot,
            mood: target,
            prevMood: target === "lit" ? "waiting" : target,
            changedAt: now,
            delay: 0,
            appearedAt: initialized ? now : -1e9,
            seed: hashSeed(p.key),
            nextEmberAt: now + 400,
            nextWispAt: now + 2500,
          };
          pumpkins.set(p.key, rt);
        }
        rt.slot = slot;
        rt.name = p.name;
        if (rt.mood !== target) {
          rt.prevMood = rt.mood;
          rt.mood = target;
          rt.changedAt = now;
          rt.delay = moodDelay(scene.phase, phaseChanged, slot, rippleIndex++);
          if (target === "smoke") spawnPuffs(rt, now + rt.delay);
          if (target === "lit" && rt.prevMood === "waiting") spawnSpark(rt, now + rt.delay);
        }
      });
      for (const key of pumpkins.keys()) if (!seen.has(key)) pumpkins.delete(key);
      initialized = true;
      if (scene.phase !== lastPhase) {
        if (scene.phase === "times-up") fogStartedAt = now;
        lastPhase = scene.phase;
      }
    };

    const moodDelay = (
      phase: PatchScene["phase"],
      phaseChanged: boolean,
      slot: PumpkinSlot,
      rippleIndex: number,
    ): number => {
      const across = (slot.cx - 56) / 1488; // 0 → 1 left to right
      if (still) return 0;
      if (phase === "reveal" || phase === "winner") return across * 1000; // ~1 s blaze wave
      if (phase === "times-up") return 60 + across * 480; // tiny freeze, then the topple sweeps
      if (phaseChanged) return across * 600; // snuff/relight ripple
      return Math.min(rippleIndex, 30) * 100; // lock-in rush: ~0.1 s apart
    };

    const puffCount = () => particles.reduce((n, p) => n + (p.kind === "puff" ? 1 : 0), 0);
    const MAX_PUFFS = 60;

    const spawnPuffs = (rt: PumpkinRuntime, at: number) => {
      if (still || puffCount() >= MAX_PUFFS) return;
      for (let i = 0; i < 3; i++) {
        particles.push({
          kind: "puff",
          x: rt.slot.cx + (i - 1) * rt.w * 0.08,
          y: rt.slot.top + rt.h * 0.42,
          vx: (i - 1) * 6,
          vy: -26 - i * 6,
          born: at + i * 260,
          life: 2400,
          size: rt.w * (0.16 + i * 0.03),
        });
      }
    };

    const spawnSpark = (rt: PumpkinRuntime, at: number) => {
      if (still) return;
      for (let i = 0; i < (lite ? 1 : 3); i++) {
        particles.push({
          kind: "ember",
          x: rt.slot.cx + (Math.random() - 0.5) * rt.w * 0.3,
          y: rt.slot.top + rt.h * 0.5,
          vx: (Math.random() - 0.5) * 30,
          vy: -50 - Math.random() * 40,
          born: at,
          life: 900 + Math.random() * 500,
          size: 2 + Math.random() * 2,
        });
      }
    };

    // ── drawing ──────────────────────────────────────────────────────────
    const toX = (x: number) => (ox + x * k) * dpr;
    const toY = (y: number) => (oy + y * k) * dpr;
    const toS = (v: number) => v * k * dpr;

    const drawSprite = (
      key: SpriteKey,
      cx: number,
      top: number,
      w: number,
      h: number,
      alpha: number,
      rotateDeg = 0,
      pivotY = 0.6,
      scaleY = 1,
    ) => {
      const bmp = bitmaps[key];
      if (!bmp || alpha <= 0.01) return;
      ctx.save();
      ctx.globalAlpha = Math.min(1, alpha);
      const px = toX(cx);
      const py = toY(top + h * pivotY);
      ctx.translate(px, py);
      if (rotateDeg) ctx.rotate((rotateDeg * Math.PI) / 180);
      if (scaleY !== 1) ctx.scale(1, scaleY);
      ctx.drawImage(bmp, -toS(w) / 2, -toS(h) * pivotY, toS(w), toS(h));
      ctx.restore();
    };

    const spriteFor = (mood: PumpkinMood): SpriteKey =>
      mood === "blaze" ? "blaze" : mood === "smoke" ? "smoke" : mood === "lit" ? "lit" : "waiting";

    const drawPumpkin = (rt: PumpkinRuntime, now: number, scene: PatchScene) => {
      // Glide to a new slot when players join and the patch reflows.
      const ease = still ? 1 : 0.12;
      rt.x += (rt.slot.cx - rt.x) * ease;
      rt.top += (rt.slot.top - rt.top) * ease;
      rt.w += (rt.slot.w - rt.w) * ease;
      rt.h += (rt.slot.h - rt.h) * ease;

      const dur = rt.mood === "toppled" || rt.prevMood === "toppled" ? 450 : 320;
      const p = still ? 1 : clamp01((now - rt.changedAt - rt.delay) / dur);
      const e = easeInOut(p);
      const t = now / 1000;

      // A new player's pumpkin is set into the patch and flickers awake.
      const born = still ? 1 : clamp01((now - rt.appearedAt) / 700);
      const rise = (1 - easeOut(born)) * rt.h * 0.25;
      const top = rt.top + rise;
      const bornAlpha = born;

      const toppledNow = rt.mood === "toppled" ? e : rt.prevMood === "toppled" ? 1 - e : 0;
      let rotate = TOPPLE_DEG * toppledNow;
      const pivotY = 0.6 + 0.2 * toppledNow;

      const shiver =
        !still && scene.shiver && rt.mood === "waiting"
          ? 2.4 * Math.sin(t * 2 * Math.PI * 7 + rt.seed)
          : 0;
      rotate += shiver;

      // Lit pumpkins breathe slowly (well under once a second).
      const breathe =
        still ? 1 : 0.9 + 0.1 * Math.sin(t * 2 * Math.PI * 0.6 + rt.seed);
      const flameY =
        still ? 1 : 1 + 0.035 * Math.sin(t * 2 * Math.PI * 2.2 + rt.seed);

      const from = spriteFor(rt.prevMood === "toppled" ? "waiting" : rt.prevMood);
      const to = spriteFor(rt.mood === "toppled" ? "waiting" : rt.mood);
      const opacity = (rt.mood === "toppled" ? 0.9 : 1) * bornAlpha;

      if (from === to || e >= 1) {
        drawSprite(to, rt.x, top, rt.w, rt.h, opacity * glowOf(to, breathe), rotate, pivotY, to === "blaze" ? flameY : 1);
      } else if (RANK[to] >= RANK[from]) {
        // Lighting up: the new glow fades in over the old pumpkin.
        drawSprite(from, rt.x, top, rt.w, rt.h, opacity * glowOf(from, breathe), rotate, pivotY, from === "blaze" ? flameY : 1);
        drawSprite(to, rt.x, top, rt.w, rt.h, e * opacity * glowOf(to, breathe), rotate, pivotY, to === "blaze" ? flameY : 1);
      } else {
        // Going out: the old glow fades away off the darker pumpkin.
        drawSprite(to, rt.x, top, rt.w, rt.h, opacity, rotate, pivotY);
        drawSprite(from, rt.x, top, rt.w, rt.h, (1 - e) * opacity * glowOf(from, breathe), rotate, pivotY, from === "blaze" ? flameY : 1);
      }

      // Blazing pumpkins throw embers; the winner's patch erupts.
      if (!still && rt.mood === "blaze" && p >= 1 && now >= rt.nextEmberAt) {
        const winner = scene.phase === "winner";
        const cap = lite ? (winner ? 60 : 30) : winner ? 220 : 110;
        if (particles.length < cap) {
          particles.push({
            kind: "ember",
            x: rt.x + (Math.random() - 0.5) * rt.w * 0.25,
            y: top + rt.h * 0.12,
            vx: (Math.random() - 0.5) * 24,
            vy: -60 - Math.random() * (winner ? 90 : 50),
            born: now,
            life: 1400 + Math.random() * 1200,
            size: 1.6 + Math.random() * 2.4,
          });
        }
        rt.nextEmberAt = now + (winner ? 180 : 520) + Math.random() * 500;
      }
      // Smoking pumpkins keep a thin wisp going.
      if (!still && rt.mood === "smoke" && p >= 1 && now >= rt.nextWispAt && puffCount() < MAX_PUFFS) {
        particles.push({
          kind: "puff",
          x: rt.x,
          y: top + rt.h * 0.42,
          vx: (Math.random() - 0.5) * 8,
          vy: -18,
          born: now,
          life: 2600,
          size: rt.w * 0.13,
        });
        rt.nextWispAt = now + 2600 + Math.random() * 1800;
      }
    };

    const drawStake = (rt: PumpkinRuntime, alpha: number) => {
      if (alpha <= 0.01) return;
      const s = rt.slot;
      const font = s.stakeFont;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `600 ${toS(font)}px ${fontFamily}`;
      ctx.textBaseline = "middle";
      const maxW = toS(s.stakeMaxW - font * 1.6);
      const cacheKey = `${rt.name}|${ctx.font}|${Math.round(maxW)}`;
      let label = labelCache.get(cacheKey);
      if (label === undefined) {
        label = fitLabel(ctx, rt.name, maxW);
        if (labelCache.size > 400) labelCache.clear();
        labelCache.set(cacheKey, label);
      }
      const textW = ctx.measureText(label).width;
      const padL = toS(font * 0.5);
      const dot = toS(font * 0.38);
      const gap = toS(font * 0.3);
      const padR = toS(font * 0.55);
      const w = padL + dot + gap + textW + padR;
      const h = toS(s.stakeH);
      const x = toX(rt.x) - w / 2;
      const y = toY(s.stakeTop);
      roundRect(ctx, x, y, w, h, toS(6));
      ctx.fillStyle = "rgba(26,15,8,0.88)";
      ctx.fill();
      ctx.lineWidth = Math.max(1, toS(1));
      ctx.strokeStyle = "rgba(90,58,32,0.9)";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + padL + dot / 2, y + h / 2, dot / 2, 0, Math.PI * 2);
      ctx.fillStyle = inputsRef.current.colorFor(rt.key);
      ctx.fill();
      ctx.fillStyle = "rgba(244,230,196,0.92)";
      ctx.fillText(label, x + padL + dot + gap, y + h / 2 + toS(0.5));
      ctx.restore();
    };

    const drawParticles = (now: number) => {
      for (let i = particles.length - 1; i >= 0; i--) {
        const pt = particles[i];
        const age = now - pt.born;
        if (age < 0) continue;
        if (age > pt.life) {
          particles.splice(i, 1);
          continue;
        }
        const u = age / pt.life;
        const sec = age / 1000;
        const x = pt.x + pt.vx * sec;
        const y = pt.y + pt.vy * sec;
        ctx.save();
        if (pt.kind === "ember") {
          ctx.globalCompositeOperation = "lighter";
          ctx.globalAlpha = (1 - u) * 0.9;
          ctx.fillStyle = u < 0.5 ? "#FFE9A8" : "#F5C451";
          ctx.beginPath();
          ctx.arc(toX(x + Math.sin(sec * 3 + pt.size) * 6), toY(y), toS(pt.size), 0, Math.PI * 2);
          ctx.fill();
        } else {
          const r = toS(pt.size * (1 + u * 1.4));
          const sprite = puffSprite ?? (puffSprite = makePuffSprite());
          if (sprite) {
            ctx.globalAlpha = 0.55 * (1 - u);
            ctx.drawImage(sprite, toX(x) - r, toY(y) - r, r * 2, r * 2);
          }
        }
        ctx.restore();
      }
    };

    // The Horseman. One original pose: he bobs like a gallop, appears small
    // on the far ridge in the last seconds, then rides through the patch as
    // answers close, timed to finish just after zero.
    const drawHorseman = (now: number, scene: PatchScene, layer: "back" | "front") => {
      const cue = scene.horseman;
      const t = now / 1000;
      const secondsLeft = inputsRef.current.secondsLeftNow();
      let pose: { cx: number; top: number; w: number; rot: number } | null = null;
      let target = 0;

      if (cue === "ride" && secondsLeft !== null) {
        if (layer !== "front") return;
        const u = clamp01((RIDE_LEAD_SECONDS - secondsLeft) / (RIDE_LEAD_SECONDS + RIDE_TAIL_SECONDS));
        if (still) {
          pose = { cx: 1160, top: 588, w: 600, rot: 0 };
          target = u < 0.95 ? 1 : 0;
        } else {
          const at = ridePath(u);
          const bob = Math.sin(t * 2 * Math.PI * 2.6) * 9 * (at.w / 600);
          pose = { cx: at.cx, top: at.top + bob, w: at.w, rot: Math.sin(t * 2 * Math.PI * 2.6 + 1) * 2.5 };
          target = 1;
        }
      } else if (cue === "ridge") {
        if (layer !== "back") return;
        const bob = still ? 0 : Math.sin(t * 2 * Math.PI * 1.2) * 2;
        pose = { cx: 1235, top: 668 + bob, w: 170, rot: 0 };
        target = 1;
      } else if (cue === "bridge") {
        if (layer !== "back") return;
        const bob = still ? 0 : Math.sin(t * 2 * Math.PI * 0.5) * 1.5;
        pose = { cx: 937, top: 680 + bob, w: 170, rot: 0 };
        target = 1;
      } else if (cue === "rear") {
        if (layer !== "back") return;
        const sway = still ? 0 : Math.sin(t * 2 * Math.PI * 0.35);
        pose = { cx: 1240, top: 470 + sway * 4, w: 560, rot: -8 + sway * 2 };
        target = 1;
      } else {
        horsemanAlpha = still ? 0 : Math.max(0, horsemanAlpha - 0.06);
        return;
      }
      horsemanAlpha = still ? target : horsemanAlpha + (target - horsemanAlpha) * 0.15;
      const h = (pose.w * HORSEMAN.height) / HORSEMAN.width;
      drawSprite("horseman", pose.cx, pose.top, pose.w, h, horsemanAlpha, pose.rot, 0.75);
    };

    const drawFog = (now: number, scene: PatchScene) => {
      if (still || fogStartedAt < 0) return;
      const age = (now - fogStartedAt) / 1000;
      if (age > 3.2 || (scene.phase !== "times-up" && scene.phase !== "reveal")) return;
      const alpha = age < 0.6 ? age / 0.6 : age > 2 ? Math.max(0, 1 - (age - 2) / 1.2) : 1;
      const cx = -150 + 950 + age * 160;
      ctx.save();
      ctx.globalAlpha = alpha;
      const rx = toS(950);
      const ry = toS(80);
      const x = toX(cx);
      const y = toY(880);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rx);
      g.addColorStop(0, "rgba(216,198,174,0.20)");
      g.addColorStop(0.6, "rgba(216,198,174,0.10)");
      g.addColorStop(1, "rgba(216,198,174,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const draw = () => {
      if (stopped) return;
      const now = performance.now();
      const scene = inputsRef.current.scene;
      syncPumpkins(now);
      rasterize();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      drawHorseman(now, scene, "back");

      const ordered = [...pumpkins.values()].sort((a, b) => a.slot.row - b.slot.row);
      for (const rt of ordered) drawPumpkin(rt, now, scene);

      namesAlpha = still
        ? scene.showNames ? 1 : 0
        : namesAlpha + ((scene.showNames ? 1 : 0) - namesAlpha) * 0.12;
      if (namesAlpha > 0.01) {
        for (const rt of ordered) {
          drawStake(rt, still ? namesAlpha : namesAlpha * Math.min(1, (now - rt.appearedAt) / 700));
        }
      }

      drawParticles(now);
      drawHorseman(now, scene, "front");
      drawFog(now, scene);
    };
    drawRef.current = () => {
      try {
        draw();
      } catch (error) {
        fail(error);
      }
    };

    const tick = (ts: number) => {
      if (stopped) return;
      try {
        if (lastFrameAt && framesSeen > 20 && frameTimes.length < 90) {
          frameTimes.push(ts - lastFrameAt);
          if (frameTimes.length === 90 && median(frameTimes) > 24 && !lite) {
            // A slow TV: same story, fewer embers, lower resolution.
            lite = true;
            resize();
          }
        }
        framesSeen++;
        lastFrameAt = ts;
        // ~60 frames a second is plenty (30 on a slow TV); fast displays
        // (120 Hz laptops) don't need twice the work.
        if (ts - lastDrawAt >= (lite ? 31 : 15)) {
          lastDrawAt = ts;
          draw();
        }
        raf = requestAnimationFrame(tick);
      } catch (error) {
        fail(error);
      }
    };

    const observer = new ResizeObserver(() => {
      try {
        resize();
        if (still) drawRef.current?.();
      } catch (error) {
        fail(error);
      }
    });
    observer.observe(canvas);
    // On the venue TV the canvas keeps its 1600×900 layout box and only the
    // stage's scale changes (e.g. a small window going fullscreen), which a
    // ResizeObserver never reports. Re-measure after the stage re-scales.
    let resizeRaf = 0;
    const onWindowResize = () => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = requestAnimationFrame(() => {
          try {
            resize();
            if (still) drawRef.current?.();
          } catch (error) {
            fail(error);
          }
        });
      });
    };
    window.addEventListener("resize", onWindowResize);
    resizeRef.current = onWindowResize;
    resize();
    const sans = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim();
    if (sans) fontFamily = sans;

    void loadImages().then(() => {
      if (stopped) return;
      if (still) drawRef.current?.();
      else raf = requestAnimationFrame(tick);
    });

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(resizeRaf);
      window.removeEventListener("resize", onWindowResize);
      resizeRef.current = null;
      observer.disconnect();
      drawRef.current = null;
    };
  }, [tier]);

  // The stage around us re-scaled (the host's window changed size).
  const lastScaleRef = useRef(stageScale);
  useEffect(() => {
    if (lastScaleRef.current === stageScale) return;
    lastScaleRef.current = stageScale;
    resizeRef.current?.();
  }, [stageScale]);

  // Still tier: redraw whenever what we're told changes (no loop running).
  useEffect(() => {
    if (tier === "still") drawRef.current?.();
  }, [tier, inputs]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      data-testid="october-patch"
      data-world-tier={tier}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 2,
      }}
    />
  );
}

// ── helpers ──────────────────────────────────────────────────────────────

const RANK: Record<SpriteKey, number> = { waiting: 0, smoke: 0, lit: 1, blaze: 2, horseman: 0 };

function glowOf(sprite: SpriteKey, breathe: number): number {
  return sprite === "lit" || sprite === "blaze" ? breathe : 1;
}

/** Ride keyframes in stage units: far ridge → lunge into the foreground →
 *  through the patch at zero → off the right edge. */
function ridePath(u: number): { cx: number; top: number; w: number } {
  const keys = [
    { u: 0, cx: 1235, top: 668, w: 170 },
    { u: 0.45, cx: 1010, top: 610, w: 500 },
    { u: 0.6, cx: 1160, top: 588, w: 600 },
    { u: 1, cx: 1990, top: 600, w: 640 },
  ];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1];
    const b = keys[i];
    if (u <= b.u) {
      const f = easeInOut((u - a.u) / (b.u - a.u));
      return { cx: lerp(a.cx, b.cx, f), top: lerp(a.top, b.top, f), w: lerp(a.w, b.w, f) };
    }
  }
  const last = keys[keys.length - 1];
  return { cx: last.cx, top: last.top, w: last.w };
}

/** One soft smoke puff, drawn once and reused for every puff. */
function makePuffSprite(): HTMLCanvasElement | null {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  if (!g) return null;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(154,144,136,1)");
  grad.addColorStop(1, "rgba(154,144,136,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}

function fitLabel(ctx: CanvasRenderingContext2D, name: string, maxW: number): string {
  const clean = name.trim();
  if (ctx.measureText(clean).width <= maxW) return clean;
  let n = clean.length;
  while (n > 1 && ctx.measureText(`${clean.slice(0, n).trimEnd()}…`).width > maxW) n--;
  return `${clean.slice(0, n).trimEnd()}…`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hashSeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 6283) / 1000;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const easeOut = (v: number) => 1 - (1 - v) * (1 - v);
const easeInOut = (v: number) => (v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2);
