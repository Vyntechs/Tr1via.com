// HOST LAPTOP — MID-GAME. The host laptop IS the TV: it's HDMI-mirrored to
// the venue screen, so whatever Heather sees, the patrons see. That means
// host chrome is patron-visible chrome — so it stays minimal.
//
// Layout: TV state machine fills the whole viewport. A thin bottom control
// strip surfaces only the buttons that are relevant for the current TV
// state (derived via deriveHostMode). Player management lives behind a
// Players sheet so the patron-visible surface stays clean.
//
// Cell-picking happens directly on the TV (TVGrid becomes interactive on
// the host's side via the `onCellClick` prop) — no separate host board.

"use client";

import { useEffect, useMemo, useState } from "react";
import { LaptopShell } from "@/components/shells";
import {
  Eyebrow,
  Numeric,
  QRBlock,
  ThemeProvider,
  useTheme,
} from "@/components/system";
import { TVSectionComplete, TVStateMachine } from "@/components/tv";
import { fireLightningBeat } from "@/components/system/Lightning";
import type { TVLobbyWelcomeEvent } from "@/components/tv";
import type { TVSnapshot } from "@/lib/hooks/useTVRoom";
import { deriveHostMode } from "@/lib/host/deriveHostMode";
import { useSectionCompleteCelebration } from "@/lib/hooks/useSectionCompleteCelebration";
import type { ThemeKey } from "@/lib/theme/tokens";
import { RemovePlayerButton } from "./RemovePlayerButton";

export interface HostLivePlayer {
  id: string;
  name: string;
  score: number;
  locked: boolean;
  /** Display string like "0s" / "4m 12s". */
  appOff: string;
  /** Show the row with the "off-app" red flag rail. */
  flag?: boolean;
}

export interface HostLiveConsoleProps {
  themeKey?: ThemeKey;
  /** Title displayed in the LaptopShell chrome (e.g. "game 1 · live"). */
  title?: string;
  /** Live roster sorted by score — surfaced in the Players sheet. */
  players?: HostLivePlayer[];
  /** Total players checked into the night. */
  playersTotal?: number;
  /** Count of players who've locked an answer for the current question. */
  lockedCount?: number;
  /** True while the 2s undo window is still open. */
  canUndo?: boolean;
  /** Room code (e.g. "WB3C3V"). Shown inside the Players sheet so the
   *  host can read it out to latecomers without exposing patron-visible
   *  chrome. */
  roomCode?: string;
  /** Full URL the QR encodes. Defaults to `${origin}/join?code=<roomCode>`. */
  joinUrl?: string;
  /** Called when the host taps a cell on the TV grid. */
  onRevealCell?: (questionId: string) => void;
  /** End-early reveals the live question now. */
  onEndEarly?: () => void;
  /** Undo the most recent reveal (only within 2s). */
  onUndo?: () => void;
  /** Open the adjust-points modal. */
  onAdjustPoints?: () => void;
  /** Host removes a player mid-night. When undefined the × button hides. */
  onRemovePlayer?: (playerId: string) => void;
  /** Host opens the add-latecomer flow. When undefined the + button hides. */
  onAddPlayer?: () => void;
  /** Promote game 1 from draft/ready to live so Heather can start playing.
   *  Surfaces a "Start Game 1" button during lobby mode. */
  onStartGame1?: () => void;
  /** Promote game 2 to live from intermission. Surfaces "Start Game 2". */
  onStartGame2?: () => void;
  /** When true, the Start Game 2 button is rendered greyed-out with a
   *  tooltip explaining why. Used when game 2 has no ready categories yet
   *  so the host doesn't accidentally start an empty game. */
  startGame2Disabled?: boolean;
  /** Tooltip shown when Start Game 2 is disabled. */
  startGame2DisabledReason?: string;
  /** End the current live game (game→done). Surfaces "End Game →" when
   *  every picked question is finished (P0.33). */
  onEndGame?: () => void;
  /** Close the night entirely. Surfaces "Done" during the finale. */
  onCloseNight?: () => void;
  /** Inline TV snapshot. When provided, the TV state machine renders
   *  fullscreen — Heather's laptop drives both surfaces in one window. */
  tvSnapshot?: TVSnapshot | null;
  /** Reveal-broadcast server timestamp, threaded through to the TV state
   *  machine so the live question timer aligns with the broadcast moment
   *  instead of the (slightly later) played_at column. */
  tvLastBroadcastRevealedAt?: string | null;
  /** Server "now" at the broadcast moment, for client-clock skew. */
  tvLastBroadcastServerNow?: string | null;
  /** Magic-Welcome: a fresh `player-joined` event, held by the parent
   *  for ~3s before being unset to null. Threaded into the embedded TV
   *  state machine so the host's laptop drives the same overlay the
   *  HDMI'd venue TV shows. */
  welcomeEvent?: TVLobbyWelcomeEvent | null;
}

export function HostLiveConsole(props: HostLiveConsoleProps) {
  const { themeKey, ...rest } = props;
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostLiveConsoleInner {...rest} themeKey={themeKey} />
      </ThemeProvider>
    );
  }
  return <HostLiveConsoleInner {...rest} />;
}

const DEMO_PLAYERS: HostLivePlayer[] = [
  { id: "p1",  name: "Devon",  score: 2140, locked: true, appOff: "0s" },
  { id: "p2",  name: "Iris",   score: 1990, locked: true, appOff: "0s" },
  { id: "p3",  name: "Priya",  score: 1820, locked: true, appOff: "0s" },
  { id: "p4",  name: "Cole",   score: 1740, locked: true, appOff: "12s" },
  { id: "p5",  name: "Ezra",   score: 1610, locked: true, appOff: "0s" },
  { id: "p6",  name: "Nadia",  score: 1530, locked: true, appOff: "0s" },
];

function HostLiveConsoleInner({
  title = "game 1 · live",
  players = DEMO_PLAYERS,
  playersTotal,
  lockedCount,
  canUndo = true,
  roomCode,
  joinUrl,
  onRevealCell,
  onEndEarly,
  onUndo,
  onAdjustPoints,
  onRemovePlayer,
  onAddPlayer,
  onStartGame1,
  onStartGame2,
  startGame2Disabled = false,
  startGame2DisabledReason,
  onEndGame,
  onCloseNight,
  tvSnapshot,
  tvLastBroadcastRevealedAt = null,
  tvLastBroadcastServerNow = null,
  welcomeEvent = null,
  themeKey,
}: HostLiveConsoleProps) {
  const { t } = useTheme();
  const totalPlayers = playersTotal ?? players.length;
  const locks = lockedCount ?? players.filter((p) => p.locked).length;
  // Build the QR URL off the origin the laptop is actually serving from —
  // so previews encode the preview URL, prod encodes prod, local tunnels
  // encode the tunnel. SSR fallback only matters before hydration.
  const resolvedJoinUrl =
    joinUrl ??
    (roomCode
      ? `${typeof window !== "undefined" ? window.location.origin : "https://tr1via.com"}/join?code=${roomCode}`
      : null);

  const [hostAdvanced, setHostAdvanced] = useState(false);
  const [playersOpen, setPlayersOpen] = useState(false);

  // Reset the "Pick next" override when a new live question arrives — the
  // override only matters for the brief window after a resolve before the
  // host picks the next cell. Once they pick, the snapshot's live-question
  // branch in TVStateMachine wins regardless.
  const liveQuestionId = tvSnapshot?.liveQuestionId ?? null;
  useEffect(() => {
    if (liveQuestionId) setHostAdvanced(false);
  }, [liveQuestionId]);

  const modeCtx = useMemo(
    () => deriveHostMode(tvSnapshot ?? null, hostAdvanced),
    [tvSnapshot, hostAdvanced],
  );
  const { mode, canEndGame } = modeCtx;

  const celebration = useSectionCompleteCelebration(tvSnapshot, hostAdvanced);

  // Section-complete fires a close lightning strike on May "storm" nights.
  // No-op for other themes (Lightning only mounts on May). Re-runs when
  // the celebration's triggering question id changes, i.e. each new
  // section-complete event.
  const celebrationQuestionId = celebration?.triggeredByQuestionId ?? null;
  useEffect(() => {
    if (celebrationQuestionId) fireLightningBeat("close");
  }, [celebrationQuestionId]);

  function handleRevealCell(questionId: string) {
    setHostAdvanced(false);
    onRevealCell?.(questionId);
  }

  return (
    <LaptopShell title={title}>
      <div
        data-testid="host-live-console"
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          overflow: "hidden",
          background: "#000",
          position: "relative",
        }}
      >
        <div
          data-testid="host-tv-panel"
          style={{
            flex: 1,
            position: "relative",
            overflow: "hidden",
            display: "flex",
          }}
        >
          {tvSnapshot ? (
            <TVStateMachine
              snapshot={tvSnapshot}
              lastBroadcastRevealedAt={tvLastBroadcastRevealedAt}
              lastBroadcastServerNow={tvLastBroadcastServerNow}
              onGridCellClick={handleRevealCell}
              hostAdvanced={hostAdvanced}
              welcomeEvent={welcomeEvent}
              themeKey={themeKey}
            />
          ) : (
            <DevPlaceholder />
          )}
          {celebration && (
            <TVSectionComplete
              topicName={celebration.topicName}
              color={celebration.color}
            />
          )}
        </div>

        <HostControlStrip
          mode={mode}
          canEndGame={canEndGame}
          celebrationCaption={
            celebration
              ? `Section complete — ${celebration.topicName} cleared.`
              : null
          }
          canUndo={canUndo && (mode === "question-live" || mode === "picking" || mode === "reveal-sticky")}
          lockedCount={locks}
          totalPlayers={totalPlayers}
          onStartGame1={onStartGame1}
          onStartGame2={onStartGame2}
          startGame2Disabled={startGame2Disabled}
          startGame2DisabledReason={startGame2DisabledReason}
          onEndEarly={onEndEarly}
          onUndo={onUndo}
          onAdjustPoints={onAdjustPoints}
          onPickNext={() => setHostAdvanced(true)}
          onEndGame={onEndGame}
          onCloseNight={onCloseNight}
          onOpenPlayers={() => setPlayersOpen(true)}
        />

        {playersOpen && (
          <PlayersSheet
            players={players}
            roomCode={roomCode}
            joinUrl={resolvedJoinUrl}
            onClose={() => setPlayersOpen(false)}
            onRemove={onRemovePlayer}
            onAdd={onAddPlayer}
          />
        )}
      </div>
    </LaptopShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Control strip — state-aware bottom toolbar
// ─────────────────────────────────────────────────────────────────────────

interface HostControlStripProps {
  mode:
    | "loading"
    | "lobby"
    | "picking"
    | "question-live"
    | "reveal-sticky"
    | "intermission"
    | "finale";
  canEndGame: boolean;
  /** When non-null, the bottom strip shows this caption instead of the
   *  default "Tap a cell to reveal" copy — used while the section-complete
   *  overlay is playing so the host gets matching language on their
   *  controls. */
  celebrationCaption: string | null;
  canUndo: boolean;
  lockedCount: number;
  totalPlayers: number;
  onStartGame1?: () => void;
  onStartGame2?: () => void;
  startGame2Disabled?: boolean;
  startGame2DisabledReason?: string;
  onEndEarly?: () => void;
  onUndo?: () => void;
  onAdjustPoints?: () => void;
  onPickNext?: () => void;
  onEndGame?: () => void;
  onCloseNight?: () => void;
  onOpenPlayers: () => void;
}

function HostControlStrip({
  mode,
  canEndGame,
  celebrationCaption,
  canUndo,
  lockedCount,
  totalPlayers,
  onStartGame1,
  onStartGame2,
  startGame2Disabled = false,
  startGame2DisabledReason,
  onEndEarly,
  onUndo,
  onAdjustPoints,
  onPickNext,
  onEndGame,
  onCloseNight,
  onOpenPlayers,
}: HostControlStripProps) {
  const { t } = useTheme();

  const lockLine =
    mode === "question-live"
      ? `${lockedCount} / ${totalPlayers} locked`
      : `${totalPlayers} player${totalPlayers === 1 ? "" : "s"}`;

  return (
    <div
      data-testid="host-control-strip"
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        background: t.dark ? "rgba(14,8,5,.92)" : "rgba(20,19,15,.04)",
        borderTop: `1px solid ${t.line}`,
        minHeight: 52,
      }}
    >
      {/* Primary CTAs — left side */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1 }}>
        {mode === "lobby" && onStartGame1 && (
          <PrimaryButton onClick={onStartGame1} testId="host-start-game-1-btn">
            Start Game 1
          </PrimaryButton>
        )}
        {mode === "intermission" && onStartGame2 && (
          <PrimaryButton
            onClick={onStartGame2}
            testId="host-start-game-2-btn"
            disabled={startGame2Disabled}
            disabledTitle={startGame2DisabledReason}
          >
            Start Game 2
          </PrimaryButton>
        )}
        {mode === "question-live" && onEndEarly && (
          <PrimaryButton onClick={onEndEarly} testId="host-end-early-btn">
            End early · reveal
          </PrimaryButton>
        )}
        {mode === "reveal-sticky" && onPickNext && (
          <PrimaryButton onClick={onPickNext} testId="host-pick-next-btn">
            Pick next →
          </PrimaryButton>
        )}
        {mode === "picking" && canEndGame && onEndGame && (
          <PrimaryButton onClick={onEndGame} testId="host-end-game-btn">
            End Game →
          </PrimaryButton>
        )}
        {mode === "picking" && !canEndGame && (
          <span
            style={{
              fontSize: 12,
              color: t.inkMute,
              fontFamily: "var(--font-sans)",
              fontWeight: 500,
              letterSpacing: "0.02em",
            }}
          >
            {celebrationCaption ?? "Tap a cell to reveal the next question"}
          </span>
        )}
        {mode === "finale" && onCloseNight && (
          <PrimaryButton onClick={onCloseNight} testId="host-close-night-btn">
            Done
          </PrimaryButton>
        )}
        {mode === "loading" && (
          <span style={{ fontSize: 12, color: t.inkMute, fontStyle: "italic" }}>
            loading…
          </span>
        )}
      </div>

      {/* Status — middle */}
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: t.inkMid,
          padding: "0 12px",
          borderLeft: `1px solid ${t.line}`,
          borderRight: `1px solid ${t.line}`,
        }}
      >
        {lockLine}
      </div>

      {/* Secondary controls — right side */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {canUndo && onUndo && (
          <SecondaryButton onClick={onUndo} testId="host-undo-btn">
            ↺ Undo
          </SecondaryButton>
        )}
        {onAdjustPoints &&
          (mode === "picking" || mode === "reveal-sticky" || mode === "intermission") && (
            <SecondaryButton onClick={onAdjustPoints} testId="host-adjust-btn">
              Adjust
            </SecondaryButton>
          )}
        <SecondaryButton onClick={onOpenPlayers} testId="host-players-btn">
          Players ({totalPlayers})
        </SecondaryButton>
      </div>
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  testId,
  disabled = false,
  disabledTitle,
}: {
  children: React.ReactNode;
  onClick: () => void;
  testId: string;
  disabled?: boolean;
  disabledTitle?: string;
}) {
  const { t } = useTheme();
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      data-testid={testId}
      disabled={disabled}
      title={disabled ? disabledTitle : undefined}
      style={{
        padding: "8px 18px",
        borderRadius: 8,
        background: t.accent,
        color: "#0E0805",
        border: "none",
        fontSize: 13,
        fontWeight: 700,
        fontFamily: "var(--font-sans)",
        cursor: disabled ? "not-allowed" : "pointer",
        letterSpacing: "-0.005em",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
  testId,
}: {
  children: React.ReactNode;
  onClick: () => void;
  testId: string;
}) {
  const { t } = useTheme();
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      style={{
        padding: "7px 14px",
        borderRadius: 8,
        background: "transparent",
        color: t.ink,
        border: `1px solid ${t.line}`,
        fontSize: 12,
        fontWeight: 500,
        fontFamily: "var(--font-sans)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Players sheet — slides in from the right, hidden until opened
// ─────────────────────────────────────────────────────────────────────────

interface PlayersSheetProps {
  players: HostLivePlayer[];
  roomCode?: string;
  joinUrl: string | null;
  onClose: () => void;
  onRemove?: (playerId: string) => void;
  onAdd?: () => void;
}

function PlayersSheet({
  players,
  roomCode,
  joinUrl,
  onClose,
  onRemove,
  onAdd,
}: PlayersSheetProps) {
  const { t } = useTheme();
  return (
    <div
      data-testid="host-players-sheet"
      role="dialog"
      aria-label="Players"
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 40,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 360,
          maxWidth: "92vw",
          height: "100%",
          background: t.paper,
          color: t.ink,
          padding: "20px 22px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          overflow: "hidden",
          boxShadow: "-10px 0 28px -6px rgba(0,0,0,0.4)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Eyebrow color={t.accent} size={11}>
            PLAYERS · {players.length}
          </Eyebrow>
          <button
            type="button"
            onClick={onClose}
            data-testid="host-players-sheet-close"
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: `1px solid ${t.line}`,
              background: "transparent",
              color: t.inkMid,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>

        {(roomCode || joinUrl) && (
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              padding: "10px 12px",
              background: t.dark ? "rgba(244,230,196,.04)" : "rgba(20,19,15,.03)",
              border: `1px solid ${t.line}`,
              borderRadius: 10,
            }}
          >
            {joinUrl ? <QRBlock url={joinUrl} size={72} light /> : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {roomCode && (
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 20,
                    fontWeight: 700,
                    color: t.ink,
                    letterSpacing: "0.08em",
                  }}
                >
                  {roomCode}
                </div>
              )}
              <div style={{ fontSize: 11, color: t.inkMid }}>
                tr1via.com/join
              </div>
            </div>
          </div>
        )}

        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            data-testid="host-add-player-btn"
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: `1px dashed ${t.line}`,
              background: "transparent",
              color: t.ink,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            + Add a latecomer
          </button>
        )}

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {players.length === 0 ? (
            <div
              style={{
                padding: "24px 0",
                color: t.inkMute,
                fontSize: 13,
                textAlign: "center",
              }}
            >
              Waiting for the first player to join…
            </div>
          ) : (
            players.map((p, i) => (
              <div
                key={p.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: onRemove
                    ? "22px 1fr 72px 18px 28px"
                    : "22px 1fr 72px 18px",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 0",
                  borderBottom: `1px solid ${t.lineSoft}`,
                }}
              >
                <Numeric size={11} color={t.inkMute}>
                  {i + 1}
                </Numeric>
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: 13,
                      color: t.ink,
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {p.name}
                  </span>
                  {p.flag && (
                    <span
                      style={{
                        fontSize: 10,
                        color: t.wrong,
                        fontFamily: "var(--font-mono)",
                        marginTop: 1,
                      }}
                    >
                      off-app {p.appOff}
                    </span>
                  )}
                </div>
                <Numeric size={12} color={t.ink} style={{ textAlign: "right" }}>
                  {p.score.toLocaleString()}
                </Numeric>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 99,
                    background: p.flag ? t.wrong : p.locked ? t.correct : t.inkMute,
                    opacity: p.locked || p.flag ? 1 : 0.4,
                  }}
                />
                {onRemove && (
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <RemovePlayerButton
                      playerName={p.name}
                      onConfirm={() => onRemove(p.id)}
                    />
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Dev placeholder — shown in the /dev/host gallery where tvSnapshot is
// not wired. Real /host/live/[nightId] always supplies a snapshot.
// ─────────────────────────────────────────────────────────────────────────

function DevPlaceholder() {
  const { t } = useTheme();
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: t.inkMute,
        fontFamily: "var(--font-mono)",
        fontSize: 13,
        letterSpacing: "0.06em",
      }}
    >
      TV STATE MACHINE · provide tvSnapshot to render
    </div>
  );
}
