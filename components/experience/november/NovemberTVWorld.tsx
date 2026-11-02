// November · Harvest Field, the TV world.
//
// Mounted once per TV surface, above the TV's screen switcher (exactly where
// October's world goes), so the field and the turkeys carry straight through
// screen changes.
//
//   field (sky, far field, harvest table, front grass, leaves) ← behind
//   the TV screens (top part of the stage)                      ← unchanged
//   the turkey row (one canvas, bottom strip)                   ← in front
//
// The light moves golden (lobby) → dusk (game 1) → night (string lights and
// candles; between games, game 2, the winner) by crossfades only. The layers
// drift a little at different speeds (zoomed 3% so an edge never shows).
// A few leaves blow across, more in the last five seconds. Still tier
// (reduced motion, the host's phone preview): one picture, nothing moves.
//
// It reads the snapshot the TV already has. It writes nothing.

"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ThemeLayerBoundary } from "@/components/system/ThemeLayerBoundary";
import { StageWorldContext, TVMomentPublisherContext } from "@/components/experience/StageWorld";
import { PlayerRowCanvas, type PlayerRowInputs } from "@/components/experience/shared/PlayerRowCanvas";
import { useStageScale, useTVWorldFeed } from "@/components/experience/shared/useTVWorldFeed";
import type { TVWorldSpec } from "@/lib/experience/packs";
import { NO_MOMENT } from "@/lib/experience/tvMoment";
import { momentSecondsLeft } from "@/lib/experience/october/patch";
import {
  gameStarted as gameStartedFor,
  harvestScene,
  sameHarvestScene,
  SKIES,
  skyLayerUrl,
  type HarvestScene,
  type HarvestSky,
} from "@/lib/experience/november/harvest";
import type { TVSnapshot } from "@/lib/hooks/useTVRoom";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";
import { questionDurationFor } from "@/lib/theme/lockInCeremony";
import { playerColorHex } from "@/lib/player/playerColor";
import { TURKEY_ROW_ART } from "./turkeyRowArt";

export interface NovemberTVWorldProps {
  spec: TVWorldSpec;
  snapshot: TVSnapshot;
  tier: "full" | "still";
  off?: boolean;
  onFail: (error: unknown) => void;
  children: ReactNode;
}

const FIELD_DARK = "#1E1208";
const STAGE_W = 1600;
const STAGE_H = 900;
const QUESTION_CLOCK_S = questionDurationFor("november");

export function NovemberTVWorld({ spec, snapshot, tier: requestedTier, off = false, onFail, children }: NovemberTVWorldProps) {
  const reducedMotion = usePrefersReducedMotion();
  const tier = reducedMotion ? "still" : requestedTier;
  const feed = useTVWorldFeed({ snapshot, off, onFail, name: "november:world", durationS: QUESTION_CLOCK_S });
  const { moment, questionClock, players, answers, serverNow, secondsLeftNow, report } = feed;

  const gameNo = useMemo(
    () => snapshot.games.find((g) => g.id === snapshot.currentGameId)?.gameNo ?? null,
    [snapshot.games, snapshot.currentGameId],
  );
  const started = useMemo(
    () => gameStartedFor({ currentGameId: snapshot.currentGameId, reveals: snapshot.reveals, scores: snapshot.scores }),
    [snapshot.reveals, snapshot.currentGameId, snapshot.scores],
  );
  const scores = snapshot.scores;

  const [scene, setScene] = useState<HarvestScene>(() =>
    harvestScene({ moment: NO_MOMENT, secondsLeft: null, players, answers, gameNo, gameStarted: started, scores }),
  );
  const timed = moment.kind === "question" || moment.kind === "reveal";
  useEffect(() => {
    if (off) return;
    const update = () => {
      try {
        const secondsLeft = momentSecondsLeft({
          moment,
          questionClock,
          players: [],
          answers: [],
          serverNowMs: serverNow(),
          durationS: QUESTION_CLOCK_S,
        });
        const next = harvestScene({ moment, secondsLeft, players, answers, gameNo, gameStarted: started, scores });
        setScene((prev) => (sameHarvestScene(prev, next) ? prev : next));
      } catch (error) {
        report(error);
      }
    };
    const first = window.setTimeout(update, 0);
    const id = timed ? window.setInterval(update, 200) : null;
    return () => {
      window.clearTimeout(first);
      if (id !== null) window.clearInterval(id);
    };
  }, [moment, questionClock, players, answers, gameNo, started, scores, timed, off, serverNow, report]);

  const inputs = useMemo<PlayerRowInputs<HarvestScene>>(
    () => ({ players, scene, secondsLeftNow, colorFor: playerColorHex }),
    [players, scene, secondsLeftNow],
  );

  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageScale = useStageScale(rootRef);
  // The row canvas times the frames; if the TV is slow it drops to lite and
  // tells us, and the field lightens too (no drift, leaves, blend or fades).
  const [slowTV, setSlowTV] = useState(false);
  const onLite = useCallback(() => setSlowTV(true), []);
  const fieldMode: FieldMode = tier === "still" ? "still" : slowTV ? "lite" : "full";

  return (
    <div
      ref={rootRef}
      data-testid="november-world"
      data-world-pack="november"
      data-world-moment={moment.kind}
      data-world-phase={scene.phase}
      data-world-sky={off ? undefined : scene.sky}
      data-world-turkeys={off ? undefined : players.length}
      data-world-off={off ? "true" : undefined}
      data-world-field={off ? undefined : fieldMode}
      style={{
        position: "relative",
        flex: 1,
        alignSelf: "stretch",
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        background: off ? "transparent" : FIELD_DARK,
        isolation: "isolate",
      }}
    >
      <div
        data-testid="november-stage"
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
          <ThemeLayerBoundary name="november:field" onFail={onFail}>
            <HarvestField sky={scene.sky} gust={scene.gust} mode={fieldMode} />
          </ThemeLayerBoundary>
        )}

        <StageWorldContext.Provider value={off ? null : spec}>
          <TVMomentPublisherContext.Provider value={off ? null : feed.publish}>
            <div style={{ position: "absolute", inset: 0, zIndex: 1, display: "flex", flexDirection: "column" }}>
              {children}
            </div>
          </TVMomentPublisherContext.Provider>
        </StageWorldContext.Provider>

        {off ? null : (
          <ThemeLayerBoundary name="november:row" onFail={onFail}>
            <PlayerRowCanvas
              art={TURKEY_ROW_ART}
              inputs={inputs}
              tier={tier === "still" ? "still" : "full"}
              stageScale={stageScale}
              onFail={onFail}
              onLite={onLite}
            />
          </ThemeLayerBoundary>
        )}
      </div>
    </div>
  );
}

// ── The field ─────────────────────────────────────────────────────────────

const LAYERS = [
  { id: "sky", amp: 0, dur: 0 },
  { id: "far", amp: 0.25, dur: 54 },
  { id: "table", amp: 0.45, dur: 46 },
  { id: "front", amp: 0.7, dur: 38 },
] as const;

/** How dark the grass-shadow band behind the row is: the golden light is
 *  as bright as the turkeys, so it needs the most. */
const BAND: Record<HarvestSky, number> = { golden: 0.66, dusk: 0.52, night: 0.4 };

const FADE_MS = 2000;

const AMBIENT_LEAVES = [
  { leaf: 1, y: 150, size: 26, dur: 21, delay: -3, path: "a" },
  { leaf: 4, y: 300, size: 22, dur: 26, delay: -11, path: "b" },
  { leaf: 2, y: 90, size: 20, dur: 24, delay: -17, path: "c" },
  { leaf: 6, y: 420, size: 24, dur: 19, delay: -7, path: "a" },
  { leaf: 3, y: 230, size: 18, dur: 28, delay: -22, path: "b" },
  { leaf: 5, y: 520, size: 22, dur: 23, delay: -14, path: "c" },
] as const;

const GUST_LEAVES = Array.from({ length: 10 }, (_, i) => ({
  leaf: (i % 6) + 1,
  y: 110 + ((i * 137) % 520),
  size: 18 + ((i * 7) % 12),
  dur: 2.6 + ((i * 3) % 5) * 0.25,
  delay: (i * 0.14) % 1.4,
  path: (["a", "b", "c"] as const)[i % 3],
}));

const FIELD_CSS = `
@keyframes nov-drift { from { transform: translate3d(calc(var(--amp) * -1%), 0, 0) scale(1.03); } to { transform: translate3d(calc(var(--amp) * 1%), 0, 0) scale(1.03); } }
@keyframes nov-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes nov-breathe { from { opacity: .72; } to { opacity: 1; } }
@keyframes nov-leaf-a { 0% { transform: translate3d(-60px,0,0) rotate(0deg); } 30% { transform: translate3d(480px,46px,0) rotate(140deg); } 60% { transform: translate3d(980px,-8px,0) rotate(290deg); } 100% { transform: translate3d(1680px,40px,0) rotate(470deg); } }
@keyframes nov-leaf-b { 0% { transform: translate3d(-60px,0,0) rotate(30deg); } 35% { transform: translate3d(560px,-30px,0) rotate(-90deg); } 70% { transform: translate3d(1150px,36px,0) rotate(-230deg); } 100% { transform: translate3d(1680px,6px,0) rotate(-330deg); } }
@keyframes nov-leaf-c { 0% { transform: translate3d(-60px,0,0) rotate(-20deg); } 50% { transform: translate3d(820px,60px,0) rotate(200deg); } 100% { transform: translate3d(1680px,24px,0) rotate(400deg); } }
`;

type FieldMode = "full" | "lite" | "still";

// Takes only the plain values it draws from (not the whole scene, which
// changes on every mood change), so memo skips the re-render on game updates.
const HarvestField = memo(function HarvestField({ sky: sceneSky, gust, mode }: { sky: HarvestSky; gust: boolean; mode: FieldMode }) {
  // Still: one picture. Lite (a slow TV): the same pictures, but nothing
  // drifts, no leaves, no blend, and the sky swaps instead of crossfading.
  const still = mode === "still";
  const calm = mode !== "full";
  // Fetch every sky's layers a few seconds after the first paint and keep
  // them, so the dusk and night fields are ready before the sky changes.
  // Still (the host phone's mini-TV) swaps instantly, so it skips this.
  useEffect(() => {
    if (still) return;
    const kept: HTMLImageElement[] = [];
    const id = window.setTimeout(() => {
      for (const s of SKIES)
        for (const layer of LAYERS) {
          const img = new Image();
          img.decoding = "async";
          img.src = skyLayerUrl(s, layer.id);
          kept.push(img);
        }
    }, 3000);
    return () => {
      window.clearTimeout(id);
      kept.length = 0;
    };
  }, [still]);
  // The sky on screen now, and the one fading out under it.
  const [sky, setSky] = useState<{ cur: HarvestSky; prev: HarvestSky | null }>({ cur: sceneSky, prev: null });
  if (sky.cur !== sceneSky) setSky({ cur: sceneSky, prev: calm ? null : sky.cur });
  useEffect(() => {
    if (!sky.prev) return;
    const id = window.setTimeout(() => setSky((s) => ({ ...s, prev: null })), FADE_MS + 200);
    return () => window.clearTimeout(id);
  }, [sky.prev, sky.cur]);

  const full: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%" };
  const night = sky.cur === "night";

  return (
    <div aria-hidden data-testid="november-field" style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none" }}>
      {calm ? null : <style>{FIELD_CSS}</style>}
      {LAYERS.map((layer) => (
        <div
          key={layer.id}
          style={{
            ...full,
            transform: "scale(1.03)",
            ["--amp" as string]: layer.amp,
            animation: calm || layer.dur === 0 ? undefined : `nov-drift ${layer.dur}s ease-in-out infinite alternate`,
            willChange: calm || layer.dur === 0 ? undefined : "transform",
          }}
        >
          {sky.prev ? <LayerImg key={sky.prev} sky={sky.prev} layer={layer.id} /> : null}
          <LayerImg
            key={sky.cur}
            sky={sky.cur}
            layer={layer.id}
            style={sky.prev ? { animation: `nov-fade ${FADE_MS}ms ease both` } : undefined}
          />
          {layer.id === "table" ? (
            // Candle and string-light warmth at night: a slow swell, never a flash.
            <div
              style={{
                ...full,
                background:
                  "radial-gradient(ellipse 34% 16% at 50% 66%, rgba(255,178,84,.30), rgba(255,178,84,0) 70%), radial-gradient(ellipse 60% 9% at 50% 6%, rgba(255,196,110,.20), rgba(255,196,110,0) 70%)",
                mixBlendMode: calm ? undefined : "screen",
                opacity: night ? (calm ? 0.6 : 1) : 0,
                transition: still ? "none" : `opacity ${FADE_MS}ms ease`,
              }}
            >
              <div
                style={{
                  ...full,
                  background: "radial-gradient(ellipse 22% 10% at 50% 67%, rgba(255,190,96,.22), rgba(255,190,96,0) 70%)",
                  animation: calm || !night ? undefined : "nov-breathe 4.5s ease-in-out infinite alternate",
                }}
              />
            </div>
          ) : null}
        </div>
      ))}

      {calm
        ? null
        : AMBIENT_LEAVES.map((l, i) => (
            <Leaf key={`a${i}`} {...l} style={{ animation: `nov-leaf-${l.path} ${l.dur}s linear ${l.delay}s infinite` }} />
          ))}
      {!calm && gust
        ? GUST_LEAVES.map((l, i) => (
            <Leaf key={`g${i}`} {...l} style={{ animation: `nov-leaf-${l.path} ${l.dur}s cubic-bezier(.3,.1,.6,1) ${l.delay}s both` }} />
          ))
        : null}

      {/* Grass-shadow band behind the row (the golden-light fix): turkeys and
          name plates stand out from the bright grass. */}
      <div
        data-testid="november-band"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 640,
          bottom: 0,
          background:
            "linear-gradient(to bottom, rgba(18,9,3,0) 0%, rgba(18,9,3,.85) 38%, rgba(18,9,3,.95) 70%, rgba(18,9,3,.8) 100%)",
          WebkitMaskImage: "linear-gradient(to right, transparent 0%, #000 7%, #000 93%, transparent 100%)",
          maskImage: "linear-gradient(to right, transparent 0%, #000 7%, #000 93%, transparent 100%)",
          opacity: BAND[sky.cur],
          transition: still ? "none" : `opacity ${FADE_MS}ms ease`,
        }}
      />
    </div>
  );
});

function LayerImg({ sky, layer, style }: { sky: HarvestSky; layer: string; style?: CSSProperties }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={skyLayerUrl(sky, layer as "sky")}
      alt=""
      decoding="async"
      data-layer={`${sky}-${layer}`}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", ...style }}
    />
  );
}

function Leaf({ leaf, y, size, style }: { leaf: number; y: number; size: number; style: CSSProperties }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/themes/november/leaves/leaf-${leaf}.webp`}
      alt=""
      style={{ position: "absolute", left: 0, top: y, width: size, height: size, willChange: "transform", ...style }}
    />
  );
}
