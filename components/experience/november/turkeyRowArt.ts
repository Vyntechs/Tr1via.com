// November · the turkey row: Harvest Field's art for the shared player row
// (components/experience/shared/PlayerRowCanvas.tsx). The row decides where
// each turkey stands and when its mood changes; this only draws.
//
// Each turkey is one frame of a Blender-rendered sprite strip (which strip
// and frame: turkeyPose in lib/experience/november/harvest.ts). On top: a
// soft contact shadow, a warm glow behind right answers, loose feathers that
// drift off wrong answers (capped), and a cream name plate.

import { ROW_GEOMETRY } from "@/lib/experience/shared/playerRow";
import { turkeyPlateTop } from "@/lib/experience/november/tvLook";
import {
  FEATHER_SPAWN_FRAME,
  TURKEY_ANIMS,
  TURKEY_BASELINE_PX,
  TURKEY_FRAME_PX,
  featherUrl,
  turkeyPose,
  turkeyUrl,
  type HarvestScene,
  type TurkeyAnim,
} from "@/lib/experience/november/harvest";
import {
  clamp01,
  easeOut,
  type RowArt,
  type RowKit,
  type RowRenderer,
  type RowSlotState,
  type RowSprite,
} from "@/components/experience/shared/rowArt";

/** A turkey's square frame, as a share of its slot's width. */
const FRAME_OF_SLOT = 1.12;
/** Ground line, as a share of the slot's art-box height (the name plate
 *  starts at 0.784). */
const GROUND_OF_BOX = 0.765;
const WALK_MS = 1400;
const WALK_FROM = 150; // stage units to the left of the slot
const MAX_FEATHERS = 60;
const FEATHER_W = 22;

const strip = (anim: TurkeyAnim): RowSprite => ({
  url: turkeyUrl(anim),
  width: TURKEY_FRAME_PX * TURKEY_ANIMS[anim].frames,
  height: TURKEY_FRAME_PX,
  frames: TURKEY_ANIMS[anim].frames,
  designW: ROW_GEOMETRY.frontW * FRAME_OF_SLOT,
});
const feather = (n: 1 | 2 | 3 | 4): RowSprite => ({ url: featherUrl(n), width: 48, height: 48, designW: FEATHER_W });

interface TurkeyFx {
  /** When this turkey's loose feathers leave (−1 = none due). */
  feathersAt: number;
}

type Turkey = RowSlotState<TurkeyFx>;

interface Feather {
  sprite: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  rot: number;
  born: number;
  life: number;
}

const ANIMS = Object.keys(TURKEY_ANIMS) as TurkeyAnim[];

export const TURKEY_ROW_ART: RowArt<HarvestScene, TurkeyFx> = {
  name: "november:row",
  testId: "november-row",
  geometry: ROW_GEOMETRY,
  sprites: {
    ...Object.fromEntries(ANIMS.map((a) => [a, strip(a)])),
    feather1: feather(1),
    feather2: feather(2),
    feather3: feather(3),
    feather4: feather(4),
  },
  newFx: () => ({ feathersAt: -1 }),
  create: createTurkeyRenderer,
};

function createTurkeyRenderer(kit: RowKit): RowRenderer<HarvestScene, TurkeyFx> {
  const { ctx, still, toX, toY, toS, drawSprite, drawSpriteFrame } = kit;
  const feathers: Feather[] = [];
  const glow = makeGlow();

  const spawnFeathers = (rt: Turkey, at: number) => {
    const side = rt.w * FRAME_OF_SLOT;
    const ground = rt.slot.top + rt.slot.h * GROUND_OF_BOX;
    const count = kit.isLite() ? 1 : 3;
    for (let i = 0; i < count && feathers.length < MAX_FEATHERS; i++) {
      feathers.push({
        sprite: `feather${1 + ((Math.floor(rt.seed * 10) + i) % 4)}`,
        // Tail side (the turkeys face right, so the tail is on the left).
        x: rt.slot.cx - side * (0.16 + i * 0.05),
        y: ground - side * (0.45 + i * 0.06),
        vx: 10 + Math.random() * 14,
        vy: -16 - Math.random() * 10,
        spin: (Math.random() - 0.5) * 70,
        rot: Math.random() * 360,
        born: at + i * 140,
        life: 3400,
      });
    }
  };

  const drawTurkey = (rt: Turkey, frame: { now: number }, scene: HarvestScene) => {
    const now = frame.now;
    if (!still && rt.fx.feathersAt > 0 && now >= rt.fx.feathersAt) {
      rt.fx.feathersAt = -1;
      if (rt.mood === "smoke") spawnFeathers(rt, now);
    }

    const side = rt.w * FRAME_OF_SLOT;
    const ground = rt.top + rt.h * GROUND_OF_BOX;
    const top = ground - side * (TURKEY_BASELINE_PX / TURKEY_FRAME_PX);

    // A new player walks in from the left (not the ones already here when the
    // TV opened: their appearedAt is far in the past).
    const walkU = still ? 1 : clamp01((now - rt.appearedAt) / WALK_MS);
    const walking = walkU < 1;
    const cx = rt.x - (walking ? (1 - easeOut(walkU)) * WALK_FROM : 0);
    const alpha = walking ? Math.min(1, walkU * 4) : 1;

    const msSince = now - rt.changedAt - rt.delay;
    const pose = walking
      ? { anim: "walk" as const, frame: Math.floor(now / (1000 / TURKEY_ANIMS.walk.fps)) % TURKEY_ANIMS.walk.frames }
      : turkeyPose({
          mood: rt.mood,
          prevMood: rt.prevMood,
          msSince,
          now,
          seed: rt.seed,
          leader: scene.leader === rt.key,
          still,
        });

    // Contact shadow on the grass.
    ctx.save();
    ctx.globalAlpha = 0.42 * alpha;
    ctx.fillStyle = "#0E0703";
    ctx.beginPath();
    ctx.ellipse(toX(cx + side * 0.02), toY(ground), toS(side * 0.3), toS(side * 0.055), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Warm glow behind a right answer (fades in; never pulses).
    if (rt.mood === "blaze" && glow && pose.anim !== "leader") {
      const g = still ? 1 : clamp01(msSince / 500);
      if (g > 0.01) {
        const r = side * 0.62;
        ctx.save();
        ctx.globalAlpha = 0.55 * g;
        ctx.drawImage(glow, toX(cx - r), toY(ground - side * 0.5 - r), toS(r * 2), toS(r * 2));
        ctx.restore();
      }
    }

    drawSpriteFrame(pose.anim, pose.frame, cx, top, side, side, alpha);
  };

  const drawFeathers = (now: number) => {
    if (still || feathers.length === 0) return;
    for (let i = feathers.length - 1; i >= 0; i--) {
      const f = feathers[i];
      const age = (now - f.born) / 1000;
      if (age > f.life / 1000) {
        feathers.splice(i, 1);
        continue;
      }
      if (age < 0) continue;
      // Up and away on the breeze, then a slow sway down.
      const x = f.x + f.vx * age + Math.sin(age * 2.2 + f.rot) * 6;
      const y = f.y + f.vy * age + 9 * age * age;
      const a = age < 0.25 ? age / 0.25 : Math.max(0, 1 - (age - (f.life / 1000 - 1)) / 1);
      drawSprite(f.sprite, x, y, FEATHER_W, FEATHER_W, Math.min(1, a), f.rot + f.spin * age, 0.5);
    }
  };

  const drawPlate = (rt: Turkey, alpha: number) => {
    const s = rt.slot;
    const name = String(rt.name ?? "");
    if (!name) return;
    const font = s.stakeFont;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `600 ${toS(font).toFixed(1)}px ${kit.fontFamily()}`;
    const padX = toS(font * 0.5);
    const label = kit.fitLabel(name, toS(s.stakeMaxW) - padX * 2);
    const tw = ctx.measureText(label).width;
    const w = tw + padX * 2;
    const h = toS(s.stakeH * 0.92);
    const x = toX(rt.x) - w / 2;
    // Plates stand in two lanes under the turkeys (never on a front tail).
    const y = toY(turkeyPlateTop(s, ROW_GEOMETRY));
    const r = Math.min(h / 2, toS(5));
    ctx.fillStyle = "rgba(14,7,3,0.35)";
    roundRect(ctx, x, y + toS(1.5), w, h, r);
    ctx.fill();
    ctx.fillStyle = "#F2DEAE";
    roundRect(ctx, x, y, w, h, r);
    ctx.fill();
    ctx.fillStyle = "#1E1208";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + w / 2, y + h / 2 + toS(0.5));
    ctx.restore();
  };

  return {
    onMoodChange: (rt, at) => {
      rt.fx.feathersAt =
        rt.mood === "smoke" && !still ? at + (FEATHER_SPAWN_FRAME * 1000) / TURKEY_ANIMS.wrong.fps : -1;
    },
    drawSlot: drawTurkey,
    drawLabel: drawPlate,
    drawFront: (now) => drawFeathers(now),
  };
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

/** One soft warm glow, drawn once and reused behind every right answer. */
function makeGlow(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  if (!g) return null;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,196,96,0.9)");
  grad.addColorStop(0.45, "rgba(242,150,58,0.35)");
  grad.addColorStop(1, "rgba(242,150,58,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return c;
}
