// October · Sleepy Hollow Night, the TV world.
//
// Mounted once per TV surface (venue TV, host laptop console, host phone
// preview), ABOVE the TV's screen switcher, so the moon, the patch and a
// Horseman mid-ride carry straight through screen changes instead of
// restarting with every screen.
//
//   backdrop (hollow, moon, clouds, hill) ← behind
//   the TV screens (top part of the stage) ← unchanged game screens
//   pumpkin patch + Horseman + fog canvas  ← in front, bottom strip
//
// It reads the snapshot the TV already has and the moment each screen
// announces. It writes nothing.

"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ThemeLayerBoundary } from "@/components/system/ThemeLayerBoundary";
import { StageWorldContext, TVMomentPublisherContext } from "@/components/experience/StageWorld";
import type { TVWorldSpec } from "@/lib/experience/packs";
import { NO_MOMENT } from "@/lib/experience/tvMoment";
import { useStageScale, useTVWorldFeed } from "@/components/experience/shared/useTVWorldFeed";
import {
  nextHeadstoneTier,
  patchScene,
  type HeadstoneTier,
  type MoonPose,
  type PatchScene,
} from "@/lib/experience/october/patch";
import type { TVSnapshot } from "@/lib/hooks/useTVRoom";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";
import { questionDurationFor } from "@/lib/theme/lockInCeremony";
import { playerColorHex } from "@/lib/player/playerColor";
import { HARVEST_MOON, HOLLOW_TV, PATCH_HILL, artUrl } from "./art";
import { OctoberHeadstones } from "./OctoberHeadstones";
import { OctoberPatchCanvas, type OctoberPatchInputs } from "./OctoberPatchCanvas";

export interface OctoberTVWorldProps {
  spec: TVWorldSpec;
  snapshot: TVSnapshot;
  /** "still" for previews that should never animate (the host's phone). */
  tier: "full" | "still";
  /** True once the world has failed: it draws nothing and steps aside, but
   *  keeps the same wrapper so the game screens inside never remount. */
  off?: boolean;
  onFail: (error: unknown) => void;
  children: ReactNode;
}

const NIGHT_BLACK = "#120A06";
const STAGE_W = 1600;
// The same clock length the on-screen timer uses for this theme.
const QUESTION_CLOCK_S = questionDurationFor("october");
const STAGE_H = 900;

export function OctoberTVWorld({
  spec,
  snapshot,
  tier: requestedTier,
  off = false,
  onFail,
  children,
}: OctoberTVWorldProps) {
  const reducedMotion = usePrefersReducedMotion();
  const tier = reducedMotion ? "still" : requestedTier;

  // ── which moment the TV is showing, and who is in the patch ──
  // Shared with every month's world (useTVWorldFeed): the moment each screen
  // announces with its clock skew, and the row = the game on screen's
  // players (the whole room in the lobby), minus anyone silent for 10+
  // minutes who isn't answering this question (gone home).
  const feed = useTVWorldFeed({ snapshot, off, onFail, name: "october:world", durationS: QUESTION_CLOCK_S });
  const { moment, questionClock, publish, players, answers, serverNow, secondsLeftNow, report } = feed;

  // Which headstones stand, from the patch's own pumpkin count. Held as state
  // so a night hovering near a line never flickers (see nextHeadstoneTier).
  const pumpkinCount = players.length;
  const [stoneTier, setStoneTier] = useState<HeadstoneTier>(() => nextHeadstoneTier(null, pumpkinCount));
  const nextStoneTier = nextHeadstoneTier(stoneTier, pumpkinCount);
  if (nextStoneTier !== stoneTier) setStoneTier(nextStoneTier); // adjusts during render, no extra effect pass

  // The scene only changes at moment changes and at the 5 s / 0 s marks, so
  // re-checking it 5× a second is plenty; the canvas animates in between.
  // Kept as state (updated from timers) so rendering stays pure.
  const [scene, setScene] = useState<PatchScene>(() =>
    patchScene({ moment: NO_MOMENT, players, answers, serverNowMs: 0 }),
  );
  const timed = moment.kind === "question" || moment.kind === "reveal";
  useEffect(() => {
    if (off) return;
    const update = () => {
      try {
        const next = patchScene({
          moment,
          questionClock,
          players,
          answers,
          serverNowMs: serverNow(),
          durationS: QUESTION_CLOCK_S,
        });
        setScene((prev) => (sameScene(prev, next) ? prev : next));
      } catch (error) {
        // A timer's error never reaches React's crash guard: report it the
        // same way, then switch the world off.
        report(error);
      }
    };
    const first = window.setTimeout(update, 0);
    const id = timed ? window.setInterval(update, 200) : null;
    return () => {
      window.clearTimeout(first);
      if (id !== null) window.clearInterval(id);
    };
  }, [moment, questionClock, players, answers, timed, off, serverNow, report]);

  const inputs = useMemo<OctoberPatchInputs>(
    () => ({ players, scene, secondsLeftNow, colorFor: playerColorHex }),
    [players, scene, secondsLeftNow],
  );

  // The world is composed on the TV's own 1600×900 stage. The venue TV and
  // the host's phone preview already provide that stage (scale 1 here). The
  // host's laptop console gives a panel of whatever size the window is: there
  // the whole picture scales down as one, exactly like the TV, instead of the
  // screens being squeezed (a 13" laptop window would cut off the question).
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageScale = useStageScale(rootRef);

  return (
    <div
      ref={rootRef}
      data-testid="october-world"
      data-world-pack="october"
      data-world-moment={moment.kind}
      data-world-phase={scene.phase}
      data-world-horseman={scene.horseman}
      data-world-pumpkins={off ? undefined : players.length}
      data-world-stones={off ? undefined : stoneTier}
      data-world-off={off ? "true" : undefined}
      style={{
        position: "relative",
        flex: 1,
        alignSelf: "stretch",
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        background: off ? "transparent" : NIGHT_BLACK,
        isolation: "isolate",
      }}
    >
      <div
        data-testid="october-stage"
        data-stage-scale={off ? undefined : stageScale.toFixed(3)}
        style={
          off
            ? { position: "absolute", inset: 0 }
            : {
                position: "absolute",
                left: "50%",
                top: "50%",
                width: STAGE_W,
                height: STAGE_H,
                transform: `translate(-50%, -50%) scale(${stageScale})`,
                transformOrigin: "center center",
                overflow: "hidden",
              }
        }
      >
        {off ? null : (
          <ThemeLayerBoundary name="october:backdrop" onFail={onFail}>
            <OctoberBackdrop scene={scene} tier={tier} stones={stoneTier} />
          </ThemeLayerBoundary>
        )}

        <StageWorldContext.Provider value={off ? null : spec}>
          <TVMomentPublisherContext.Provider value={off ? null : publish}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 1,
                display: "flex",
                flexDirection: "column",
              }}
            >
              {children}
            </div>
          </TVMomentPublisherContext.Provider>
        </StageWorldContext.Provider>

        {off ? null : (
          <ThemeLayerBoundary name="october:patch" onFail={onFail}>
            <OctoberPatchCanvas
              inputs={inputs}
              tier={tier === "still" ? "still" : "full"}
              stageScale={stageScale}
              onFail={onFail}
            />
          </ThemeLayerBoundary>
        )}
      </div>
    </div>
  );
}

function sameScene(a: PatchScene, b: PatchScene): boolean {
  if (
    a.phase !== b.phase ||
    a.showNames !== b.showNames ||
    a.shiver !== b.shiver ||
    a.clouds !== b.clouds ||
    a.moon !== b.moon ||
    a.horseman !== b.horseman
  ) {
    return false;
  }
  const ak = Object.keys(a.moods);
  if (ak.length !== Object.keys(b.moods).length) return false;
  return ak.every((k) => a.moods[k] === b.moods[k]);
}

// ── Backdrop: the hollow, the harvest moon, the hill, the headstones ──
// The moon rises behind the pumpkin patch at the bottom and shifts with the
// moment (positions from the Figma frames), so the question area stays dark
// and readable. In the last five seconds clouds slide over it.

const MOON_POSES: Record<MoonPose, { x: number; y: number; size: number; hill: number }> = {
  lobby: { x: 1080, y: 560, size: 600, hill: 780 },
  board: { x: 900, y: 600, size: 560, hill: 800 },
  question: { x: 820, y: 470, size: 720, hill: 760 },
  reveal: { x: 870, y: 550, size: 620, hill: 770 },
  between: { x: 640, y: 570, size: 620, hill: 790 },
  winner: { x: 830, y: 350, size: 820, hill: 790 },
};

const CLOUDS = [
  { x: 920, y: 594, w: 380, h: 46, delay: 0 },
  { x: 1010, y: 638, w: 440, h: 54, delay: 0.12 },
  { x: 1100, y: 682, w: 500, h: 62, delay: 0.24 },
];

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

function OctoberBackdrop({
  scene,
  tier,
  stones,
}: {
  scene: PatchScene;
  tier: "full" | "still";
  stones: HeadstoneTier;
}) {
  const pose = MOON_POSES[scene.moon];
  const ease = tier === "still" ? "none" : "1.6s cubic-bezier(.4,0,.2,1)";
  const asking = scene.phase === "asking" || scene.phase === "final-seconds";
  const hollowUrl = useMemo(() => artUrl(HOLLOW_TV), []);
  const moonUrl = useMemo(() => artUrl(HARVEST_MOON), []);
  const hillUrl = useMemo(() => artUrl(PATCH_HILL), []);

  const box: CSSProperties = {
    position: "absolute",
    left: "50%",
    bottom: 0,
    // The stage is always 1600×900 (16:9), so the full width is the
    // backdrop's 16:9 box. (No container units: older TVs' browsers lack them.)
    width: "100%",
    aspectRatio: "16 / 9",
    transform: "translateX(-50%)",
  };

  return (
    <div
      aria-hidden
      data-testid="october-backdrop"
      style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={hollowUrl}
        alt=""
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "50% 100%",
        }}
      />
      <div style={box}>
        {/* The finale's warm glow behind the champion. */}
        <div
          style={{
            position: "absolute",
            left: pct(100, 1600),
            top: pct(-100, 900),
            width: pct(1400, 1600),
            height: pct(900, 900),
            borderRadius: "50%",
            background: "radial-gradient(closest-side, rgba(240,140,42,.22), rgba(240,140,42,0))",
            opacity: scene.phase === "winner" ? 1 : 0,
            transition: tier === "still" ? "none" : "opacity 1.2s ease",
          }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={moonUrl}
          alt=""
          data-testid="october-moon"
          data-moon-pose={scene.moon}
          style={{
            // A fixed 900-unit box moved and sized by transform alone, so the
            // glide between moments costs no layout work.
            position: "absolute",
            left: 0,
            top: 0,
            width: pct(900, 1600),
            height: "auto",
            transformOrigin: "0 0",
            transform: `translate(${(pose.x / 900) * 100}%, ${(pose.y / 900) * 100}%) scale(${pose.size / 900})`,
            filter: asking ? "brightness(1.12)" : "brightness(0.96)",
            transition: tier === "still" ? "none" : `transform ${ease}, filter .6s ease`,
          }}
        />
        {CLOUDS.map((c) => (
          <div
            key={c.x}
            style={{
              position: "absolute",
              left: pct(c.x, 1600),
              top: pct(c.y, 900),
              width: pct(c.w, 1600),
              height: pct(c.h, 900),
              borderRadius: "50%",
              background: "rgba(11,6,8,.92)",
              filter: "blur(7px)",
              opacity: scene.clouds ? 0.85 : 0,
              transform: scene.clouds ? "translateX(0)" : "translateX(18%)",
              transition:
                tier === "still"
                  ? "none"
                  : `opacity .9s ease ${c.delay}s, transform 1.4s cubic-bezier(.2,.7,.3,1) ${c.delay}s`,
            }}
          />
        ))}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={hillUrl}
          alt=""
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: "100%",
            height: "auto",
            transform: `translateY(${(pose.hill / 300) * 100}%)`,
            transition: tier === "still" ? "none" : `transform ${ease}`,
          }}
        />
        {/* Headstones stand on the hill, behind the screens and the patch. */}
        <OctoberHeadstones tier={stones} still={tier === "still"} />
      </div>
    </div>
  );
}
