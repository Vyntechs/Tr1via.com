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
  useCallback,
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
import { NO_MOMENT, sameMoment, type TVMoment } from "@/lib/experience/tvMoment";
import {
  momentSecondsLeft,
  patchScene,
  type MoonPose,
  type PatchAnswer,
  type PatchPlayer,
  type PatchScene,
  type QuestionClock,
} from "@/lib/experience/october/patch";
import type { TVSnapshot } from "@/lib/hooks/useTVRoom";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";
import { playerColorHex } from "@/lib/player/playerColor";
import { HARVEST_MOON, HOLLOW_TV, PATCH_HILL, artUrl } from "./art";
import { OctoberPatchCanvas, type OctoberPatchInputs } from "./OctoberPatchCanvas";

export interface OctoberTVWorldProps {
  spec: TVWorldSpec;
  snapshot: TVSnapshot;
  /** "still" for previews that should never animate (the host's phone). */
  tier: "full" | "still";
  onFail: (error: unknown) => void;
  children: ReactNode;
}

const NIGHT_BLACK = "#120A06";

export function OctoberTVWorld({ spec, snapshot, tier: requestedTier, onFail, children }: OctoberTVWorldProps) {
  const reducedMotion = usePrefersReducedMotion();
  const tier = reducedMotion ? "still" : requestedTier;

  // ── which moment the TV is showing ──
  const [moment, setMoment] = useState<TVMoment>(NO_MOMENT);
  const [questionClock, setQuestionClock] = useState<QuestionClock | null>(null);
  const momentRef = useRef<TVMoment>(NO_MOMENT);
  const clockRef = useRef<QuestionClock | null>(null);
  const offsetRef = useRef(0);

  const publish = useCallback((next: TVMoment) => {
    const prev = momentRef.current;
    if (sameMoment(prev, next)) return;
    if (next.kind === "question" && next.questionId && next.revealedAtMs !== null) {
      // Same clock-skew rule as the on-screen timer.
      offsetRef.current = next.serverNowMs !== null ? next.serverNowMs - Date.now() : 0;
      clockRef.current = { questionId: next.questionId, revealedAtMs: next.revealedAtMs, endedAtMs: null };
      setQuestionClock(clockRef.current);
    } else if (prev.kind === "question" && clockRef.current && clockRef.current.endedAtMs === null) {
      clockRef.current = { ...clockRef.current, endedAtMs: Date.now() + offsetRef.current };
      setQuestionClock(clockRef.current);
    }
    momentRef.current = next;
    setMoment(next);
  }, []);

  // ── who is in the patch ──
  const players = useMemo<PatchPlayer[]>(
    () =>
      [...snapshot.players]
        .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
        .map((p) => ({ key: p.id, name: p.displayName })),
    [snapshot.players],
  );
  const answers = useMemo<PatchAnswer[]>(
    () =>
      snapshot.liveAnswers.map((a) => ({
        playerKey: a.player_key,
        questionId: a.question_id,
        isCorrect: a.is_correct,
      })),
    [snapshot.liveAnswers],
  );

  // The scene only changes at moment changes and at the 5 s / 0 s marks, so
  // re-checking it 5× a second is plenty; the canvas animates in between.
  // Kept as state (updated from timers) so rendering stays pure.
  const [scene, setScene] = useState<PatchScene>(() =>
    patchScene({ moment: NO_MOMENT, players, answers, serverNowMs: 0 }),
  );
  const timed = moment.kind === "question" || moment.kind === "reveal";
  useEffect(() => {
    const update = () => {
      const next = patchScene({
        moment,
        questionClock,
        players,
        answers,
        serverNowMs: Date.now() + offsetRef.current,
      });
      setScene((prev) => (sameScene(prev, next) ? prev : next));
    };
    const first = window.setTimeout(update, 0);
    const id = timed ? window.setInterval(update, 200) : null;
    return () => {
      window.clearTimeout(first);
      if (id !== null) window.clearInterval(id);
    };
  }, [moment, questionClock, players, answers, timed]);

  const secondsLeftNow = useCallback(
    () =>
      momentSecondsLeft({
        moment: momentRef.current,
        questionClock: clockRef.current,
        players: [],
        answers: [],
        serverNowMs: Date.now() + offsetRef.current,
      }),
    [],
  );

  const inputs = useMemo<OctoberPatchInputs>(
    () => ({ players, scene, secondsLeftNow, colorFor: playerColorHex }),
    [players, scene, secondsLeftNow],
  );

  return (
    <div
      data-testid="october-world"
      data-world-pack="october"
      data-world-moment={moment.kind}
      data-world-phase={scene.phase}
      style={{
        position: "relative",
        flex: 1,
        alignSelf: "stretch",
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        background: NIGHT_BLACK,
        isolation: "isolate",
      }}
    >
      <ThemeLayerBoundary name="october:backdrop" onFail={onFail}>
        <OctoberBackdrop scene={scene} tier={tier} />
      </ThemeLayerBoundary>

      <StageWorldContext.Provider value={spec}>
        <TVMomentPublisherContext.Provider value={publish}>
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

      <ThemeLayerBoundary name="october:patch" onFail={onFail}>
        <OctoberPatchCanvas inputs={inputs} tier={tier === "still" ? "still" : "full"} onFail={onFail} />
      </ThemeLayerBoundary>
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

// ── Backdrop: the hollow, the harvest moon, the hill ─────────────────────
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

function OctoberBackdrop({ scene, tier }: { scene: PatchScene; tier: "full" | "still" }) {
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
    width: "min(100%, calc(100cqh * 16 / 9))",
    aspectRatio: "16 / 9",
    transform: "translateX(-50%)",
  };

  return (
    <div
      aria-hidden
      data-testid="october-backdrop"
      style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", containerType: "size" }}
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
            position: "absolute",
            left: pct(pose.x, 1600),
            top: pct(pose.y, 900),
            width: pct(pose.size, 1600),
            height: "auto",
            filter: asking ? "brightness(1.12)" : "brightness(0.96)",
            transition: tier === "still" ? "none" : `left ${ease}, top ${ease}, width ${ease}, filter .6s ease`,
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
            top: pct(pose.hill, 900),
            width: "100%",
            height: "auto",
            transition: tier === "still" ? "none" : `top ${ease}`,
          }}
        />
      </div>
    </div>
  );
}
