// HOST · GENERATE · 3. GENERATING
// The moment questions are being created. A pinned header carries one
// three-stage tracker (writing -> fact-checking -> photos) whose fill comes
// only from real counts the server reports, plus a "live" pulse that stops
// the moment the server goes quiet. Certified questions land below as cards.
//
// Wired form: the pick route subscribes to `category:{id}` broadcasts and
// passes a live tally of questions + photos. Each loaded question lands
// here as a card with text (and a photo when ready). The remainder are
// shown as soft skeletons. All props are optional with demo defaults so
// the /dev/host/gen gallery still renders.

"use client";

import {
  Eyebrow,
  Numeric,
  ThemeProvider,
  useTheme,
} from "@/components/system";
import { LaptopShell } from "@/components/shells";
import { useMediaQuery } from "@/components/system/useMediaQuery";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";
import { useEffect, useState } from "react";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";
import { DifficultyBar, StockImage } from "./_shared";
import {
  buildTracker,
  formatElapsed,
  livenessAt,
  type HostGenProgress,
  type TrackerStage,
} from "./genProgress";

export type { HostGenProgress } from "./genProgress";

export interface HostGenLoadingQuestion {
  id: string;
  prompt: string;
  difficulty: number;
  /** When set, render with the image preview; when null, show "matching photo…". */
  imageUrl: string | null;
  /** Fallback seed when we don't have a real URL yet (demo only). */
  seed?: string;
}

export interface HostGenLoadingProps {
  themeKey?: ThemeKey;
  /** Title in the shell chrome. */
  shellTitle?: string;
  /** Topic name displayed in the headline. */
  topic?: string;
  /** Questions loaded so far (in arrival order). */
  loaded?: HostGenLoadingQuestion[];
  /** Total questions expected (default 20). */
  total?: number;
  /** Count of questions whose photo has landed. */
  photosLoaded?: number;
  /**
   * Real counts from the build (broadcast, or the polled job row after a
   * reload). Drives the pinned tracker. Omitted only by the /dev gallery,
   * which then shows a demo mid-build state.
   */
  progress?: HostGenProgress;
  /**
   * Overrides the subline under the topic (auto-resume / needs-attention
   * messages). Falls back to the tracker's current stage, or the default
   * copy when there is no progress at all.
   */
  statusLine?: string;
  /** Called when the host taps "Cancel". */
  onCancel?: () => void;
  /** Called when the host taps the "← back" button to return to the
   *  setup overview. The background generation job keeps running; the
   *  host can come back to this screen and pick up where she left off. */
  onBack?: () => void;
}

const DEMO_LOADED: HostGenLoadingQuestion[] = [
  { id: "1",  prompt: "What was Pixar's first feature film?",                                              difficulty: 1, imageUrl: "demo", seed: "pixar1" },
  { id: "2",  prompt: "In Up, what is the name of Carl's dog?",                                           difficulty: 2, imageUrl: "demo", seed: "pixar2" },
  { id: "3",  prompt: "Toy Story was released in what year?",                                              difficulty: 3, imageUrl: "demo", seed: "pixar3" },
  { id: "4",  prompt: "Which Pixar character is voiced by Ellen DeGeneres?",                               difficulty: 1, imageUrl: "demo", seed: "pixar4" },
  { id: "5",  prompt: "In Monsters, Inc., what does CDA stand for?",                                       difficulty: 6, imageUrl: "demo", seed: "pixar5" },
  { id: "6",  prompt: "Wall·E's love interest is named what?",                                             difficulty: 4, imageUrl: "demo", seed: "pixar6" },
  { id: "7",  prompt: "Ratatouille is set in which city?",                                                 difficulty: 2, imageUrl: "demo", seed: "pixar7" },
  { id: "8",  prompt: "Brave is Pixar's first film with what?",                                            difficulty: 3, imageUrl: "demo", seed: "pixar8" },
  { id: "9",  prompt: "In Coco, what is the boy's great-great-grandfather?",                              difficulty: 4, imageUrl: null },
  { id: "10", prompt: "Pixar's opening logo features which character?",                                    difficulty: 3, imageUrl: null },
  { id: "11", prompt: "Inside Out's five emotions are joy, sadness, anger, fear, and what?",               difficulty: 1, imageUrl: null },
  { id: "12", prompt: "The Incredibles' family surname is what?",                                          difficulty: 2, imageUrl: null },
];

export function HostGenLoading(props: HostGenLoadingProps) {
  const { themeKey, ...rest } = props;
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostGenLoadingInner {...rest} />
      </ThemeProvider>
    );
  }
  return <HostGenLoadingInner {...rest} />;
}

/** Ticks once a second so the elapsed clock and staleness stay current.
 *  null until mounted, so the server render never prints a clock that
 *  disagrees with the browser's. */
function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function HostGenLoadingInner({
  shellTitle = "pulling questions · pixar movies",
  topic = "Pixar Movies",
  loaded: loadedProp,
  total = 20,
  photosLoaded,
  progress: progressProp,
  statusLine,
  onCancel,
  onBack,
}: Omit<HostGenLoadingProps, "themeKey">) {
  void shellTitle;
  const { t } = useTheme();
  const mobile = useMediaQuery("(max-width: 860px)");
  const reducedMotion = usePrefersReducedMotion();
  const now = useNow();
  const loaded = loadedProp ?? DEMO_LOADED;
  const cc = categoryColor(topic, t.accent);
  const questionsLoaded = loaded.length;
  const photosCount = Math.max(
    typeof photosLoaded === "number" ? photosLoaded : 0,
    loaded.filter((l) => l.imageUrl).length,
  );

  // Demo state for the /dev gallery only (no props at all). A real caller
  // that passes `loaded` but no progress gets an honest "getting started".
  const [mountedAt] = useState(() => Date.now());
  const progress: HostGenProgress =
    progressProp ??
    (loadedProp === undefined && photosLoaded === undefined
      ? {
          phase: "images",
          target: total,
          written: total,
          certified: questionsLoaded,
          photos: photosCount,
          startedAt: mountedAt - 112_000,
          lastSignalAt: now ?? mountedAt,
        }
      : {
          phase: "queued",
          target: total,
          written: 0,
          certified: questionsLoaded,
          photos: photosCount,
          startedAt: mountedAt,
          lastSignalAt: null,
        });
  // A real caller's progress already floors photos from the cards when that
  // is safe (not on a reroll reload, where the cards are the OLD batch), so
  // only the demo/fallback states count photos from `loaded` here.
  const tracker = buildTracker({
    ...progress,
    photos: progressProp ? progress.photos : Math.max(progress.photos, photosCount),
  });
  const liveness = now === null ? null : livenessAt(now, progress);
  const live = liveness?.live ?? false;
  const elapsed =
    now === null
      ? null
      : `${formatElapsed(now - progress.startedAt)} ${progress.joinedMidway ? "since you opened this" : "so far"}`;
  const subline =
    statusLine ??
    (progressProp ? tracker.headline : "Writing the questions, then looking for photos.");
  const skeletonCount = Math.max(0, total - questionsLoaded);
  const photoNote =
    progress.phase === "images"
      ? "FINDING PHOTO…"
      : progress.phase === "ready" || progress.phase === "needs_attention"
        ? "NO PHOTO"
        : "PHOTO COMES NEXT";
  const pct = Math.round(tracker.overall * 100);

  return (
    <LaptopShell>
      <div
        data-testid="host-gen-loading-root"
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          // Cap at the viewport so the cards scroll under a header that
          // never moves (the host layout grows with content, so a plain
          // document scroll would carry the header away).
          maxHeight: "calc(100dvh - var(--host-chip-reserve, 0px))",
          minHeight: 0,
          minWidth: 0,
        }}
      >
        <div
          data-testid="host-gen-loading-layout"
          data-layout={mobile ? "mobile" : "desktop"}
          data-host-mobile-surface="true"
          style={{
            position: "sticky",
            top: 0,
            zIndex: 2,
            flex: "none",
            background: t.paper,
            padding: mobile ? "12px 16px 12px" : "20px 56px 16px",
            borderBottom: `1px solid ${t.line}`,
            minWidth: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: mobile ? 10 : 18, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: mobile ? 10 : 16, minWidth: 0 }}>
              {onBack && (
                <button
                  type="button"
                  onClick={onBack}
                  aria-label="Back to setup"
                  data-testid="host-pick-back-btn"
                  style={pillButton(t.line, t.inkMid)}
                >
                  <span aria-hidden="true">←</span> Back
                </button>
              )}
              <span aria-hidden style={{ width: 10, height: 10, flex: "none", borderRadius: 99, background: cc }} />
              <div style={{ minWidth: 0 }}>
                {!mobile && <Eyebrow color={t.accent} size={11}>PULLING {total} ON</Eyebrow>}
                <div style={{ marginTop: mobile ? 0 : 2, fontSize: mobile ? 20 : 26, fontWeight: 700, color: t.ink, letterSpacing: "-0.02em", lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{topic}</div>
                <div data-testid="host-gen-status-line" aria-live="polite" style={{ marginTop: 2, fontSize: 13, color: t.inkMid, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: mobile ? "nowrap" : "normal" }}>{subline}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flex: "none" }}>
              {!mobile && (
                <div style={{ textAlign: "right" }} data-testid="host-gen-overall">
                  <Numeric size={30} weight={700} color={t.ink}>{pct}%</Numeric>
                  <div style={{ fontSize: 11, color: t.inkMid }}>of the build, roughly</div>
                </div>
              )}
              {onCancel && (
                <button type="button" onClick={onCancel} style={pillButton(t.line, t.inkMid)}>
                  Cancel
                </button>
              )}
            </div>
          </div>

          <StageTracker stages={tracker.stages} color={cc} mobile={mobile} />

          <div style={{ marginTop: mobile ? 8 : 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minWidth: 0 }}>
            <div
              data-testid="host-gen-liveness"
              data-live={live ? "true" : "false"}
              data-reduced-motion={reducedMotion ? "true" : "false"}
              style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, fontSize: 12, color: live ? t.ink : t.inkMid }}
            >
              <LiveDot live={live} animate={live && !reducedMotion} color={t.pop} idle={t.inkMid} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{liveness?.text ?? ""}</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flex: "none", fontSize: 12, color: t.inkMid }}>
              {mobile && <span data-testid="host-gen-overall"><Numeric size={12} weight={700} color={t.ink}>{pct}%</Numeric> done</span>}
              {elapsed && <span data-testid="host-gen-elapsed"><Numeric size={12} color={t.inkMid}>{elapsed.split(" ")[0]}</Numeric> {elapsed.split(" ").slice(1).join(" ")}</span>}
            </div>
          </div>
        </div>

        <div
          data-host-mobile-surface="true"
          style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: mobile ? "16px 16px max(24px, env(safe-area-inset-bottom))" : "24px 56px 40px" }}
        >
          <div style={{ display: "grid", gridTemplateColumns: mobile ? "minmax(0, 1fr)" : "repeat(3, minmax(0, 1fr))", gap: 14 }}>
            {loaded.map((q) =>
              q.imageUrl ? (
                <PickCardSmall key={q.id} q={q} cc={cc} />
              ) : (
                <PickCardTextOnly
                  key={q.id}
                  q={q}
                  cc={cc}
                  note={photoNote}
                  shimmer={progress.phase === "images" && live && !reducedMotion}
                />
              ),
            )}
            {Array.from({ length: skeletonCount }).map((_, i) => (
              <SkeletonCard key={`s${i}`} delay={i * 150} animate={!reducedMotion} />
            ))}
          </div>
        </div>
      </div>
    </LaptopShell>
  );
}

function pillButton(line: string, color: string) {
  return {
    padding: "6px 12px",
    borderRadius: 99,
    border: `1px solid ${line}`,
    background: "transparent",
    color,
    fontSize: 12,
    fontWeight: 600,
    fontFamily: "var(--font-sans)",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flex: "none",
  } as const;
}

function LiveDot({ live, animate, color, idle }: { live: boolean; animate: boolean; color: string; idle: string }) {
  return (
    <span
      aria-hidden
      data-testid="host-gen-live-dot"
      data-animating={animate ? "true" : "false"}
      style={{
        width: 8,
        height: 8,
        flex: "none",
        borderRadius: 99,
        background: live ? color : "transparent",
        border: live ? "none" : `1.5px solid ${idle}`,
        boxSizing: "border-box",
        animation: animate ? "tr1via-pulse 1.4s ease-in-out infinite" : "none",
      }}
    />
  );
}

/**
 * One track split into three segments. Each segment's width is that stage's
 * usual share of the build time, so the filled length of the whole track is
 * the honest overall progress; each segment fills only from its own count.
 */
function StageTracker({ stages, color, mobile }: { stages: TrackerStage[]; color: string; mobile: boolean }) {
  const { t } = useTheme();
  const columns = stages.map((s) => `${s.weight}fr`).join(" ");
  const gap = mobile ? 4 : 6;
  return (
    <div data-testid="host-gen-tracker" style={{ marginTop: mobile ? 10 : 14, minWidth: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: columns, gap, minWidth: 0 }}>
        {stages.map((s) => (
          <div
            key={s.key}
            role="progressbar"
            aria-label={s.label}
            aria-valuemin={0}
            aria-valuemax={s.total}
            aria-valuenow={s.count}
            aria-valuetext={`${s.count} of ${s.total}${s.detail ? `, ${s.detail}` : ""}`}
            data-testid={`host-gen-stage-bar-${s.key}`}
            style={{ height: mobile ? 6 : 8, borderRadius: 99, background: t.line, overflow: "hidden", position: "relative" }}
          >
            <div
              data-testid={`host-gen-stage-fill-${s.key}`}
              style={{
                width: `${(s.fraction * 100).toFixed(1)}%`,
                height: "100%",
                borderRadius: 99,
                background: color,
                opacity: s.state === "waiting" ? 0.45 : 1,
                transition: "width 0.35s ease-out",
              }}
            />
            {s.key === "check" && (
              <span aria-hidden style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 2, marginLeft: -1, background: t.paper, opacity: 0.8 }} />
            )}
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: columns, gap, marginTop: 6, minWidth: 0 }}>
        {stages.map((s) => (
          <div
            key={s.key}
            data-testid={`host-gen-stage-${s.key}`}
            data-stage-state={s.state}
            style={{ minWidth: 0, color: s.state === "waiting" ? t.inkMid : t.ink }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0, flexWrap: mobile ? "wrap" : "nowrap" }}>
              <span style={{ fontSize: mobile ? 11 : 12.5, fontWeight: s.state === "active" ? 700 : 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {s.state === "done" && <span aria-hidden style={{ color }}>✓ </span>}
                {mobile ? s.shortLabel : s.label}
              </span>
              <Numeric size={mobile ? 11 : 12} weight={600} color={s.state === "waiting" ? t.inkMid : t.ink}>
                <span data-testid={`host-gen-stage-count-${s.key}`}>{s.count}/{s.total}</span>
              </Numeric>
            </div>
            {s.detail && (
              <div data-testid={`host-gen-stage-detail-${s.key}`} style={{ fontSize: mobile ? 10.5 : 11.5, color: t.inkMid, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {s.detail}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PickCardTextOnly({ q, cc, note, shimmer }: { q: HostGenLoadingQuestion; cc: string; note: string; shimmer: boolean }) {
  const { t } = useTheme();
  return (
    <div style={{
      borderRadius: 12, overflow: "hidden",
      border: `1px solid ${t.line}`,
      background: t.dark ? "rgba(244,230,196,.03)" : "#FFF",
      animation: "tr1via-rise .4s cubic-bezier(.2,.7,.3,1) both",
    }}>
      <div style={{
        height: 120, position: "relative", overflow: "hidden",
        background: t.dark ? "rgba(244,230,196,.05)" : "rgba(27,19,12,.04)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {shimmer && (
          <div aria-hidden style={{
            position: "absolute", inset: 0,
            background: `linear-gradient(90deg, transparent, ${t.pop}33, transparent)`,
            backgroundSize: "200% 100%",
            animation: "tr1via-shimmer 1.6s linear infinite",
          }} />
        )}
        <span style={{
          padding: "4px 10px", borderRadius: 99, background: t.dark ? "rgba(0,0,0,.4)" : "rgba(255,255,255,.85)",
          color: t.pop, fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 10, letterSpacing: "0.08em",
          position: "relative", zIndex: 1,
        }}>{note}</span>
      </div>
      <div style={{ padding: "12px 14px" }}>
        <div style={{ fontSize: 13.5, color: t.ink, fontWeight: 600, letterSpacing: "-0.005em", lineHeight: 1.35, minHeight: 38 }}>{q.prompt}</div>
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <DifficultyBar value={q.difficulty} color={cc} />
          <Numeric size={12} color={cc} weight={700}>{q.difficulty * 100}</Numeric>
        </div>
      </div>
    </div>
  );
}

function PickCardSmall({ q, cc }: { q: HostGenLoadingQuestion; cc: string }) {
  const { t } = useTheme();
  return (
    <div style={{
      borderRadius: 12, overflow: "hidden",
      border: `1.5px solid ${t.line}`,
      background: t.dark ? "rgba(244,230,196,.03)" : "#FFF",
      animation: "tr1via-rise .4s cubic-bezier(.2,.7,.3,1) both",
    }}>
      <StockImage src={q.imageUrl && q.imageUrl !== "demo" ? q.imageUrl : null} seed={q.seed ?? q.id} height={120} radius="11px 11px 0 0" caption={null} />
      <div style={{ padding: "12px 14px" }}>
        <div style={{ fontSize: 13.5, color: t.ink, fontWeight: 600, letterSpacing: "-0.005em", lineHeight: 1.35, minHeight: 38 }}>{q.prompt}</div>
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <DifficultyBar value={q.difficulty} color={cc} />
          <Numeric size={12} color={cc} weight={700}>{q.difficulty * 100}</Numeric>
        </div>
      </div>
    </div>
  );
}

function SkeletonCard({ delay = 0, animate = true }: { delay?: number; animate?: boolean }) {
  const { t } = useTheme();
  return (
    <div style={{
      borderRadius: 12, overflow: "hidden",
      border: `1px solid ${t.line}`,
      background: t.surface,
      // Placeholder, not a progress claim: a soft pulse is fine here.
      animation: animate ? `tr1via-skeleton-pulse 1.6s ease-in-out ${delay}ms infinite` : "none",
      minHeight: 200,
      display: "flex", flexDirection: "column",
    }}>
      <div style={{ height: 120, background: t.dark ? "rgba(244,230,196,.05)" : "rgba(27,19,12,.04)" }} />
      <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ height: 11, width: "85%", borderRadius: 4, background: t.dark ? "rgba(244,230,196,.06)" : "rgba(27,19,12,.05)" }} />
        <div style={{ height: 11, width: "60%", borderRadius: 4, background: t.dark ? "rgba(244,230,196,.06)" : "rgba(27,19,12,.05)" }} />
        <div style={{ height: 5, width: "40%", borderRadius: 4, background: t.dark ? "rgba(244,230,196,.04)" : "rgba(27,19,12,.04)", marginTop: 6 }} />
      </div>
    </div>
  );
}
