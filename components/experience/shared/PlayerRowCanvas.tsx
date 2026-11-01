// The player row: one figure per player along the bottom of the venue TV,
// drawn on ONE canvas in front of the TV screens. Shared by every month that
// has one; the month passes its art (what a slot draws in each mood, plus any
// effects in front or behind), see ./rowArt.ts.
//
// One canvas, not 40 animated page elements: research for October found
// separate animated pieces strain a venue TV, while one canvas with the art
// pre-drawn to bitmaps holds up. Every mood change is a fade of at least a
// few hundred milliseconds and ripples across the row, so nothing flashes
// more than three times a second.
//
// Tiers: "full" animates everything; "lite" (a slow TV, found by timing the
// frames) keeps the same story with less work at lower resolution; "still"
// (reduced motion, the host's phone preview) draws each state once, with no
// animation loop at all.
//
// Read-only: it draws what it is told. If anything here (or in the art)
// throws, it stops and reports the failure so the world switches off and the
// game carries on.

"use client";

import { useEffect, useRef } from "react";
import { rowLayout, type RowPlayer, type RowScene, type RowSlot } from "@/lib/experience/shared/playerRow";
import { clamp01, easeInOut, easeOut, type RowArt, type RowKit, type RowRenderer, type RowSlotState } from "./rowArt";

export type WorldTier = "full" | "lite" | "still";

export interface PlayerRowInputs<S extends RowScene> {
  players: readonly RowPlayer[];
  scene: S;
  /** Continuous seconds left (negative after zero), read every frame. */
  secondsLeftNow: () => number | null;
  colorFor: (playerKey: string) => string;
}

export interface PlayerRowCanvasProps<S extends RowScene, F> {
  /** The month's art. Must be a module-level constant (the canvas starts
   *  once per tier and never swaps art mid-night). */
  art: RowArt<S, F>;
  inputs: PlayerRowInputs<S>;
  tier: "full" | "still";
  /** Scale the surrounding stage is drawn at; a change re-sizes the canvas
   *  so the figures stay sharp. */
  stageScale?: number;
  onFail: (error: unknown) => void;
}

const STAGE_W = 1600;
const STAGE_H = 900;

export function PlayerRowCanvas<S extends RowScene, F>({
  art,
  inputs,
  tier,
  stageScale = 1,
  onFail,
}: PlayerRowCanvasProps<S, F>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputsRef = useRef(inputs);
  const onFailRef = useRef(onFail);
  const artRef = useRef(art);
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
    const art = artRef.current;

    let stopped = false;
    let raf = 0;
    let lite = false;
    const still = tier === "still";
    const frameTimes: number[] = [];
    let lastFrameAt = 0;
    let framesSeen = 0;

    // Size + mapping from the 1600×900 design stage to this canvas: the whole
    // scene fits ("meet") and sits on the bottom edge, so the row lines up
    // with the hill whatever shape the TV panel is.
    let cssW = 0;
    let cssH = 0;
    let dpr = 1;
    let k = 1;
    let ox = 0;
    let oy = 0;
    let bitmaps: Partial<Record<string, HTMLCanvasElement>> = {};
    let bitmapScale = 0;
    const images: Partial<Record<string, HTMLImageElement>> = {};
    const spriteKeys = Object.keys(art.sprites);

    const slots = new Map<string, RowSlotState<F>>();
    let initialized = false;
    let fontFamily = "system-ui, sans-serif";
    let lastDrawAt = 0;
    const labelCache = new Map<string, string>();
    let lastLayoutCount = -1;
    let layout: RowSlot[] = [];
    let lastPhase: RowScene["phase"] | null = null;
    let namesAlpha = inputsRef.current.scene.showNames ? 1 : 0;

    const fail = (error: unknown) => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      // Errors in animation frames never reach React's crash guard, so say
      // so here the same way the guard does (it's how a crash gets noticed).
      console.warn(`[theme] "${art.name}" stopped drawing after an error; the game keeps going.`, error);
      onFailRef.current(error);
    };

    const loadImages = () =>
      Promise.all(
        spriteKeys.map(
          (key) =>
            new Promise<void>((resolve) => {
              const img = new Image();
              img.decoding = "async";
              img.onload = () => {
                images[key] = img;
                resolve();
              };
              img.onerror = () => resolve();
              img.src = art.sprites[key].url;
            }),
        ),
      );

    // Re-measure if the on-screen size changed since the last measure (the
    // TV stage can finish sizing itself after the first measure, or re-scale
    // later without the canvas's own layout box changing).
    const checkSize = () => {
      const rect = canvas.getBoundingClientRect();
      if (Math.abs(rect.width - cssW) > 0.5 || Math.abs(rect.height - cssH) > 0.5) {
        resize();
        if (still) drawRef.current?.();
      }
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      cssW = Math.max(1, rect.width);
      cssH = Math.max(1, rect.height);
      // Never paint more than ~1920 (or 1280 on a slow TV) pixels across:
      // a 4K TV gains nothing visible from a bigger canvas, only work.
      dpr = Math.min(lite || still ? 1 : 2, window.devicePixelRatio || 1, (lite ? 1280 : 1920) / cssW);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      k = Math.min(cssW / STAGE_W, cssH / STAGE_H);
      ox = (cssW - STAGE_W * k) / 2;
      oy = cssH - STAGE_H * k;
      bitmapScale = 0; // re-rasterize at the new size
    };

    const rasterize = () => {
      const front = layout.reduce((m, s) => Math.max(m, s.w), 0) || art.geometry.frontW;
      const scale = k * dpr;
      if (Math.abs(scale - bitmapScale) < 0.01 && Object.keys(bitmaps).length) return;
      bitmapScale = scale;
      const next: Partial<Record<string, HTMLCanvasElement>> = {};
      for (const key of spriteKeys) {
        const img = images[key];
        if (!img) continue;
        const sprite = art.sprites[key];
        const designW = sprite.designW ?? front;
        const w = Math.max(8, Math.ceil(designW * scale));
        const h = Math.max(8, Math.ceil((w * sprite.height) / sprite.width));
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d")?.drawImage(img, 0, 0, w, h);
        next[key] = c;
      }
      bitmaps = next;
    };

    // ── drawing ──────────────────────────────────────────────────────────
    const toX = (x: number) => (ox + x * k) * dpr;
    const toY = (y: number) => (oy + y * k) * dpr;
    const toS = (v: number) => v * k * dpr;

    const drawSprite: RowKit["drawSprite"] = (key, cx, top, w, h, alpha, rotateDeg = 0, pivotY = 0.6, scaleY = 1) => {
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

    const kit: RowKit = {
      ctx,
      still,
      isLite: () => lite,
      toX,
      toY,
      toS,
      drawSprite,
      fitLabel: (name, maxW) => {
        const cacheKey = `${name}|${ctx.font}|${Math.round(maxW)}`;
        let label = labelCache.get(cacheKey);
        if (label === undefined) {
          label = fitLabel(ctx, name, maxW);
          if (labelCache.size > 400) labelCache.clear();
          labelCache.set(cacheKey, label);
        }
        return label;
      },
      fontFamily: () => fontFamily,
      secondsLeftNow: () => inputsRef.current.secondsLeftNow(),
      colorFor: (key) => inputsRef.current.colorFor(key),
    };

    let renderer: RowRenderer<S, F>;
    try {
      renderer = art.create(kit);
    } catch (error) {
      fail(error);
      return;
    }

    const moodDelay = (
      phase: RowScene["phase"],
      phaseChanged: boolean,
      slot: RowSlot,
      rippleIndex: number,
    ): number => {
      const across = (slot.cx - art.geometry.box.x) / art.geometry.box.w; // 0 → 1 left to right
      if (still) return 0;
      if (phase === "reveal" || phase === "winner") return across * 1000; // ~1 s blaze wave
      if (phase === "times-up") return 60 + across * 480; // tiny freeze, then the topple sweeps
      if (phaseChanged) return across * 600; // snuff/relight ripple
      return Math.min(rippleIndex, 30) * 100; // lock-in rush: ~0.1 s apart
    };

    const syncSlots = (now: number) => {
      const { players, scene } = inputsRef.current;
      if (players.length !== lastLayoutCount) {
        layout = rowLayout(players.length, art.geometry);
        lastLayoutCount = players.length;
        bitmapScale = 0;
      }
      const seen = new Set<string>();
      // Moods change as a ripple, left to right, so a rush of lock-ins or
      // the whole row blazing reads as a wave, never a flash.
      let rippleIndex = 0;
      const phaseChanged = scene.phase !== lastPhase;
      players.forEach((p, i) => {
        const slot = layout[i];
        if (!slot) return;
        seen.add(p.key);
        const target = scene.moods[p.key] ?? "lit";
        let rt = slots.get(p.key);
        if (!rt) {
          rt = {
            key: p.key,
            name: labelText(p.name),
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
            fx: art.newFx(now),
          };
          slots.set(p.key, rt);
        }
        rt.slot = slot;
        rt.name = labelText(p.name);
        if (rt.mood !== target) {
          rt.prevMood = rt.mood;
          rt.mood = target;
          rt.changedAt = now;
          rt.delay = moodDelay(scene.phase, phaseChanged, slot, rippleIndex++);
          renderer.onMoodChange?.(rt, now + rt.delay);
        }
      });
      for (const key of slots.keys()) if (!seen.has(key)) slots.delete(key);
      initialized = true;
      if (scene.phase !== lastPhase) {
        renderer.onPhaseChange?.(scene.phase, now);
        lastPhase = scene.phase;
      }
    };

    const drawSlot = (rt: RowSlotState<F>, now: number, scene: S) => {
      // Glide to a new slot when players join and the row reflows.
      const ease = still ? 1 : 0.12;
      rt.x += (rt.slot.cx - rt.x) * ease;
      rt.top += (rt.slot.top - rt.top) * ease;
      rt.w += (rt.slot.w - rt.w) * ease;
      rt.h += (rt.slot.h - rt.h) * ease;

      const dur = rt.mood === "toppled" || rt.prevMood === "toppled" ? 450 : 320;
      const p = still ? 1 : clamp01((now - rt.changedAt - rt.delay) / dur);
      const e = easeInOut(p);

      // A new player's figure is set into the row and flickers awake.
      const born = still ? 1 : clamp01((now - rt.appearedAt) / 700);
      const rise = (1 - easeOut(born)) * rt.h * 0.25;
      const top = rt.top + rise;

      renderer.drawSlot(rt, { now, p, e, top, born }, scene);
    };

    const draw = () => {
      if (stopped) return;
      if (cssW < 2 || cssH < 2) return; // not laid out yet; checkSize retries
      const now = performance.now();
      const scene = inputsRef.current.scene;
      syncSlots(now);
      rasterize();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      renderer.drawBack?.(now, scene);

      const ordered = [...slots.values()].sort((a, b) => a.slot.row - b.slot.row);
      for (const rt of ordered) drawSlot(rt, now, scene);

      // The reveal starts the figures blazing, smoking and toppling at once.
      // Names normally fade at time's up, but an early reveal (everyone locked
      // in, or the host shows the answer before the clock ends) skips it, so
      // any name still showing goes now: no name is ever beside a figure
      // that has begun to change.
      namesAlpha = still || scene.phase === "reveal"
        ? scene.showNames ? 1 : 0
        : namesAlpha + ((scene.showNames ? 1 : 0) - namesAlpha) * 0.12;
      if (namesAlpha > 0.01) {
        for (const rt of ordered) {
          const alpha = still ? namesAlpha : namesAlpha * Math.min(1, (now - rt.appearedAt) / 700);
          if (alpha > 0.01) renderer.drawLabel(rt, alpha);
        }
      }

      renderer.drawFront?.(now, scene);
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
        // Keep timing frames all night (the busiest moments, a full row and
        // the winner's effects, come late): if a run of 90 frames is slow,
        // drop to lite for the rest of the night. Same story, less work.
        if (lastFrameAt && framesSeen > 20 && !lite) {
          frameTimes.push(ts - lastFrameAt);
          if (frameTimes.length >= 90) {
            if (median(frameTimes) > 24) {
              lite = true;
              resize();
            }
            frameTimes.length = 0;
          }
        }
        framesSeen++;
        lastFrameAt = ts;
        if (framesSeen % 30 === 0) checkSize();
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

    // (Older TV browsers have no ResizeObserver: the frame loop's size check
    // and the window's resize event still keep the canvas the right size.)
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            try {
              resize();
              if (still) drawRef.current?.();
            } catch (error) {
              fail(error);
            }
          });
    observer?.observe(canvas);
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
    // The still version has no animation loop to notice size changes.
    const sizePoll = still
      ? window.setInterval(() => {
          try {
            checkSize();
          } catch (error) {
            fail(error);
          }
        }, 1000)
      : 0;
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
      if (sizePoll) window.clearInterval(sizePoll);
      resizeRef.current = null;
      observer?.disconnect();
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
      data-testid={art.testId}
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

/** A name as text, whatever arrived (a missing name draws an empty label). */
function labelText(name: unknown): string {
  return typeof name === "string" ? name : name == null ? "" : String(name);
}

function fitLabel(ctx: CanvasRenderingContext2D, name: string, maxW: number): string {
  // Anything past 80 characters is cut before measuring, so one odd name can
  // never cost a frame.
  const clean = name.trim().slice(0, 80);
  if (ctx.measureText(clean).width <= maxW) return clean;
  let n = clean.length;
  while (n > 1 && ctx.measureText(`${clean.slice(0, n).trimEnd()}…`).width > maxW) n--;
  return `${clean.slice(0, n).trimEnd()}…`;
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
