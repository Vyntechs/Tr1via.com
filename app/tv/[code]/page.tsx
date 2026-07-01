// app/tv/[code]/page.tsx — the venue TV.
//
// Anonymous Client Component, no auth, no scrolling. Uses `useTVRoom` to
// pull a server-rendered snapshot of the night (the TV is anonymous so it
// can't read the tables directly), then hands the snapshot to a pure
// `<TVStateMachine />` that picks the right TV component per moment:
//
//   live game?  ┐
//     ├ live question?  → TVQuestion (with live lock-in pile)
//     │                    → TVReveal / TVRevealStumper on resolve
//     │
//     └ between questions → TVGrid
//   no game live?
//     ├ game 1 setup     → TVLobby
//     ├ game 1 done, no g2 → TVIntermission
//     └ game 2 done OR night closed → TVFinaleWinner
//
// The 16:9 stage is locked via CSS clamp so the rendered TV always fills
// the largest 16:9 box that fits the viewport (the venue TV runs in
// fullscreen on the host's laptop, so 100vw/100vh is the target).
//
// `TVStateMachine` is also reused, inline, in the host's mid-game console
// (HDMI'd hosts use one window). This route stays for venues that prefer
// a separate browser tab for the TV.
"use client";

import { use, useEffect, useState } from "react";
import { TVRoomMagicOverlay, TVSectionComplete, TVStateMachine } from "@/components/tv";
import type { TVLobbyWelcomeEvent } from "@/components/tv";
import { ThemeProvider, WELCOME_OVERLAY_DURATION_MS, PyrotechnicsBeatConductor } from "@/components/system";
import { fireLightningBeat } from "@/components/system/Lightning";
import { type ThemeKey } from "@/lib/theme/tokens";
import { resolveTheme } from "@/lib/theme/resolveTheme";
import { formatRoomCode } from "@/lib/game/room-code";
import { useTVRoom, type TVBroadcast, type TVSnapshot } from "@/lib/hooks/useTVRoom";
import { useSectionCompleteCelebration } from "@/lib/hooks/useSectionCompleteCelebration";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";
import { playWelcomeChime } from "@/lib/audio/welcomeChime";

export default function TVPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);
  const {
    status,
    snapshot,
    lastBroadcast,
    lastFireworksBeat,
    lastRoomMagicReaction,
  } = useTVRoom(code);

  // Hooks must run on every render — call BEFORE any conditional return.
  // (`snapshot` is null until the room loads; the hook reads `players?.length`
  //  defensively and only acts on a `player-joined` broadcast, so passing
  //  `snapshot?.players ?? []` is safe.) Leaving this below the early returns
  //  meant it was skipped while loading and suddenly ran once ready — the hook
  //  count changed between renders and React crashed the whole TV (React #310).
  const welcomeEvent = useTVWelcomeEvent(lastBroadcast, snapshot?.players ?? []);

  if (status === "loading") {
    return <TVMessageStage title="Loading..." subtitle="" />;
  }
  if (status === "not-found") {
    return (
      <TVMessageStage
        title="Room not found"
        subtitle={`Check tr1via.com/host — code ${formatRoomCode(code)} isn't open.`}
      />
    );
  }
  if (status === "error" || !snapshot) {
    return (
      <TVMessageStage
        title="Something's off."
        subtitle="Retrying… the venue TV will recover automatically when the connection comes back."
      />
    );
  }

  const themeKey: ThemeKey = resolveTheme(
    { theme_key: snapshot.night.themeKey },
    { default_theme_key: snapshot.night.hostDefaultThemeKey },
  );

  const broadcastRevealedAt =
    lastBroadcast?.event === "reveal" ? lastBroadcast.revealedAt ?? null : null;
  const broadcastServerNow =
    lastBroadcast?.event === "reveal" ? lastBroadcast.serverNow ?? null : null;

  // `welcomeEvent` is computed at the top of this component (above the early
  // returns) so its hook runs on every render — see the call site there.

  return (
    <ThemeProvider themeKey={themeKey}>
      <TVStageFrame>
        <TVStateMachine
          snapshot={snapshot}
          lastBroadcastRevealedAt={broadcastRevealedAt}
          lastBroadcastServerNow={broadcastServerNow}
          welcomeEvent={welcomeEvent}
          themeKey={themeKey}
        />
        <SectionCompleteOverlay snapshot={snapshot} />
        <TVRoomMagicOverlay
          enabled={snapshot.night.roomMagicEnabled}
          event={lastRoomMagicReaction}
          themeKey={themeKey}
        />
        {/* Schedules the July firework beat so this TV ignites the same burst
            at the same instant as the host preview (and, Phase 3, every phone).
            Render-less; no-op on non-July nights. */}
        <PyrotechnicsBeatConductor beat={lastFireworksBeat} />
      </TVStageFrame>
    </ThemeProvider>
  );
}

/**
 * Lifts `useTVRoom`'s `lastBroadcast` (which carries the `player-joined`
 * event) into a UI-shaped welcome event, holds it for ~3 seconds, then
 * unmounts. Also plays the chime locally on the TV the moment a join
 * lands.
 */
function useTVWelcomeEvent(
  lastBroadcast: TVBroadcast | null,
  players: TVSnapshot["players"],
): TVLobbyWelcomeEvent | null {
  const [event, setEvent] = useState<TVLobbyWelcomeEvent | null>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (!lastBroadcast || lastBroadcast.event !== "player-joined") return;
    if (!lastBroadcast.playerId || !lastBroadcast.displayName) return;
    // joinIndex = 1-based position in the join queue. We approximate by
    // counting how many roster entries already exist when this broadcast
    // arrives — players is updated by useTVRoom's snapshot refetch but
    // may lag the broadcast by one render tick, so worst case we
    // off-by-one (sparkle on player 6 instead of 5). Acceptable.
    const idx = Math.max(1, (players?.length ?? 0));
    setEvent({
      playerId: lastBroadcast.playerId,
      name: lastBroadcast.displayName,
      colorKey: lastBroadcast.colorKey,
      joinIndex: idx,
      prefersReducedMotion: reduced,
    });
    // Local chime on the TV — the host's HDMI'd laptop will play this
    // through the venue speakers. Best-effort.
    try {
      playWelcomeChime();
    } catch {
      /* silent */
    }
    const handle = window.setTimeout(() => setEvent(null), WELCOME_OVERLAY_DURATION_MS);
    return () => window.clearTimeout(handle);
    // Trigger off the broadcast's identity. `serverNow` changes per emit;
    // playerId changes per joiner — either is sufficient to detect a new
    // welcome.
  }, [
    lastBroadcast?.event,
    lastBroadcast?.playerId,
    lastBroadcast?.serverNow,
    // Intentionally omit `players` and `reduced` from the deps — they're
    // read at trigger time, and we don't want a roster mutation to
    // remount the welcome.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]);

  return event;
}

function SectionCompleteOverlay({
  snapshot,
}: {
  snapshot: ReturnType<typeof useTVRoom>["snapshot"];
}) {
  // Audience-only callsite — no host-advanced flag; the hook waits for the
  // sticky reveal to clear naturally before celebrating.
  const celebration = useSectionCompleteCelebration(snapshot);
  // Fire a close lightning strike on May "storm" nights when section-
  // complete kicks off. The Lightning component subscribes to the
  // module-level beat and renders the strike across the existing
  // TVStage's weather canvas. No-op for non-May themes (Lightning isn't
  // mounted).
  const celebrationQuestionId = celebration?.triggeredByQuestionId ?? null;
  useEffect(() => {
    if (celebrationQuestionId) fireLightningBeat("close");
  }, [celebrationQuestionId]);
  if (!celebration) return null;
  return (
    <TVSectionComplete
      topicName={celebration.topicName}
      color={celebration.color}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Stage frame: 16:9 contained inside the viewport, scaled to fit.
// ─────────────────────────────────────────────────────────────────────────

function TVStageFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#000",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          // CSS clamp: take the largest 16:9 box that fits the viewport.
          // Computed from 100vw and 100vh: the limiting dimension wins.
          width: "min(100vw, calc(100vh * 16 / 9))",
          height: "min(100vh, calc(100vw * 9 / 16))",
          aspectRatio: "16 / 9",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function TVMessageStage({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#0E0805",
        color: "#F4E6C4",
        fontFamily: "var(--font-sans)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "0 56px",
      }}
    >
      <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: "-0.025em" }}>{title}</div>
      {subtitle && (
        <div style={{ marginTop: 18, fontSize: 22, color: "rgba(244,230,196,.62)" }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}
