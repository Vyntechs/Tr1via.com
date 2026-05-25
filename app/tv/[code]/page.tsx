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

import { use } from "react";
import { TVStateMachine } from "@/components/tv";
import { ThemeProvider } from "@/components/system";
import { type ThemeKey } from "@/lib/theme/tokens";
import { resolveTheme } from "@/lib/theme/resolveTheme";
import { formatRoomCode } from "@/lib/game/room-code";
import { useTVRoom } from "@/lib/hooks/useTVRoom";

export default function TVPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);
  const { status, snapshot, lastBroadcast } = useTVRoom(code);

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

  return (
    <ThemeProvider themeKey={themeKey}>
      <TVStageFrame>
        <TVStateMachine
          snapshot={snapshot}
          lastBroadcastRevealedAt={broadcastRevealedAt}
          lastBroadcastServerNow={broadcastServerNow}
        />
      </TVStageFrame>
    </ThemeProvider>
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
