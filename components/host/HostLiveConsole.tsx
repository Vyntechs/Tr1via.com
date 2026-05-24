// HOST LAPTOP — MID-GAME. Board + live player list + quick controls. This
// mirrors to the TV.
//
// Wired form: the live route passes the full game state — current question,
// the grid of revealed/picked cells, players + their lock status, and the
// action handlers (revealCell, undo, endEarly, adjustPoints, removePlayer,
// addPlayer). Every prop is optional with demo defaults so the /dev/host
// gallery still renders.

"use client";

import { LaptopShell } from "@/components/shells";
import {
  Eyebrow,
  Numeric,
  QRBlock,
  ThemeProvider,
  TVTimerArc,
  useTheme,
} from "@/components/system";
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

export interface HostLiveBoardCell {
  /** Logical question id for the cell. Used as the reveal target. */
  questionId: string;
  /** Numeric point value (100..700). */
  pointValue: number;
  /** True if this cell has been played (revealed and resolved). */
  played: boolean;
  /** True if this cell is the currently live question. */
  live: boolean;
}

export interface HostLiveBoardColumn {
  categoryId: string;
  /** Display name (uppercase rendered in the header). */
  name: string;
  /** 7 cells per column, ordered low → high point value. */
  cells: HostLiveBoardCell[];
}

export interface HostLiveCurrentQuestion {
  questionId: string;
  /** Question text (host sees it; the TV mirrors). */
  prompt: string;
  /** Category name shown in the eyebrow. */
  categoryName: string;
  pointValue: number;
  /** Seconds remaining (0..20). Pass null to hide the ring. */
  secondsRemaining: number | null;
}

export interface HostLiveConsoleProps {
  themeKey?: ThemeKey;
  /** Title displayed in the LaptopShell chrome (e.g. "game 1 · live"). */
  title?: string;
  /** All board columns. Provide an empty array for the pre-start state. */
  columns?: HostLiveBoardColumn[];
  /** Live question — null when the host is between reveals. */
  currentQuestion?: HostLiveCurrentQuestion | null;
  /** Live roster sorted by score (host's view). */
  players?: HostLivePlayer[];
  /** Total players checked into the night. */
  playersTotal?: number;
  /** Count of players who've locked an answer for the current question. */
  lockedCount?: number;
  /** True while the 2s undo window is still open. */
  canUndo?: boolean;
  /** Room code (e.g. "WB3C3V"). Surfaced prominently so the host can show
   *  the customer how to get players in — the live route already knows it. */
  roomCode?: string;
  /** Full URL the QR encodes. Defaults to `${origin}/join?code=<roomCode>`. */
  joinUrl?: string;
  /** Called when the host taps a cell on the grid. */
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
}

export function HostLiveConsole(props: HostLiveConsoleProps) {
  const { themeKey, ...rest } = props;
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostLiveConsoleInner {...rest} />
      </ThemeProvider>
    );
  }
  return <HostLiveConsoleInner {...rest} />;
}

const DEMO_COLUMNS: HostLiveBoardColumn[] = [
  "GEOGRAPHY",
  "ANIMALS",
  "FOOD",
  "MOVIES",
  "MUSIC",
  "HISTORY",
].map((name, ci) => ({
  categoryId: `demo-cat-${ci}`,
  name,
  cells: [100, 200, 300, 400, 500, 600, 700].map((v, ri) => ({
    questionId: `demo-q-${ci}-${ri}`,
    pointValue: v,
    played:
      (ci === 0 && ri === 0) ||
      (ci === 0 && ri === 1) ||
      (ci === 1 && ri === 0) ||
      (ci === 2 && ri === 0),
    live: ci === 0 && ri === 0,
  })),
}));

const DEMO_PLAYERS: HostLivePlayer[] = [
  { id: "p1",  name: "Devon",  score: 2140, locked: true, appOff: "0s" },
  { id: "p2",  name: "Iris",   score: 1990, locked: true, appOff: "0s" },
  { id: "p3",  name: "Priya",  score: 1820, locked: true, appOff: "0s" },
  { id: "p4",  name: "Cole",   score: 1740, locked: true, appOff: "12s" },
  { id: "p5",  name: "Ezra",   score: 1610, locked: true, appOff: "0s" },
  { id: "p6",  name: "Nadia",  score: 1530, locked: true, appOff: "0s" },
  { id: "p7",  name: "Maya",   score: 1460, locked: true, appOff: "0s" },
  { id: "p8",  name: "Theo",   score: 1380, locked: true, appOff: "0s" },
  { id: "p9",  name: "Jules",  score: 1290, locked: false, appOff: "0s" },
  { id: "p10", name: "Marcus", score: 1180, locked: false, appOff: "0s" },
  { id: "p11", name: "Sara",   score: 1110, locked: false, appOff: "0s" },
  { id: "p12", name: "Eli",    score: 1040, locked: false, appOff: "4m 12s", flag: true },
  { id: "p13", name: "Ana",    score: 980,  locked: false, appOff: "0s" },
  { id: "p14", name: "June",   score: 920,  locked: false, appOff: "0s" },
];

function HostLiveConsoleInner({
  title = "game 1 · live",
  columns = DEMO_COLUMNS,
  currentQuestion = {
    questionId: "demo-q-0-0",
    prompt: "Which U.S. state has the longest coastline?",
    categoryName: "GEOGRAPHY",
    pointValue: 100,
    secondsRemaining: 11,
  },
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
}: Omit<HostLiveConsoleProps, "themeKey">) {
  const { t } = useTheme();
  const totalPlayers = playersTotal ?? players.length;
  const locks = lockedCount ?? players.filter((p) => p.locked).length;
  const resolvedJoinUrl =
    joinUrl ?? (roomCode ? `https://tr1via.com/join?code=${roomCode}` : null);
  const eyebrow = currentQuestion
    ? `QUESTION LIVE · ${currentQuestion.categoryName.toUpperCase()} · ${currentQuestion.pointValue}`
    : "BOARD READY · WAITING";
  const promptText = currentQuestion?.prompt ?? "Tap a cell to reveal the next question.";

  return (
    <LaptopShell title={title}>
      <div
        data-testid="host-live-console"
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          overflow: "hidden",
        }}
      >
        {roomCode ? (
          <div
            data-testid="host-tv-panel"
            style={{
              flexShrink: 0,
              width: "100%",
              aspectRatio: "16 / 9",
              maxHeight: "62vh",
              borderBottom: `1px solid ${t.line}`,
              background: "#000",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <iframe
              src={`/tv/${roomCode}`}
              title="TV view"
              style={{
                width: "100%",
                height: "100%",
                border: "none",
                display: "block",
              }}
            />
          </div>
        ) : null}
        <div
          style={{
            padding: "20px 28px",
            display: "grid",
            gridTemplateColumns: "1fr 320px",
            gap: 24,
            flex: 1,
            overflow: "hidden",
            minHeight: 0,
          }}
        >
        {/* Board mini + question status */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <Eyebrow color={t.accent} size={11}>
                {eyebrow}
              </Eyebrow>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 22,
                  color: t.ink,
                  fontWeight: 500,
                  letterSpacing: "-0.015em",
                }}
              >
                {promptText}
              </div>
            </div>
            {currentQuestion?.secondsRemaining !== null &&
            currentQuestion?.secondsRemaining !== undefined ? (
              <TVTimerArc seconds={currentQuestion.secondsRemaining} size={84} />
            ) : null}
          </div>

          <div
            style={{
              flex: 1,
              display: "grid",
              gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, 1fr)`,
              gridTemplateRows: "24px repeat(7, 1fr)",
              gap: 6,
            }}
          >
            {columns.map((c) => (
              <div
                key={c.categoryId}
                style={{
                  padding: "4px 8px",
                  borderRadius: 4,
                  background: t.dark ? "rgba(255,255,255,.04)" : "rgba(20,19,15,.03)",
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  color: t.ink,
                  textAlign: "center",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {c.name.toUpperCase()}
              </div>
            ))}
            {/* Walk rows then columns so the layout matches the grid CSS. */}
            {Array.from({ length: 7 }).map((_, rIdx) =>
              columns.map((col) => {
                const cell = col.cells[rIdx];
                if (!cell) {
                  return (
                    <div
                      key={`${col.categoryId}-empty-${rIdx}`}
                      style={{
                        background: t.dark ? "rgba(255,255,255,.02)" : t.surface,
                        borderRadius: 6,
                      }}
                    />
                  );
                }
                const clickable =
                  !cell.played && !cell.live && Boolean(onRevealCell);
                return (
                  <button
                    key={`${col.categoryId}-${cell.questionId}`}
                    type="button"
                    onClick={
                      clickable
                        ? () => onRevealCell?.(cell.questionId)
                        : undefined
                    }
                    disabled={!clickable}
                    data-testid={`host-question-${cell.questionId}`}
                    style={{
                      background: cell.live
                        ? t.accent
                        : cell.played
                          ? "transparent"
                          : t.dark
                            ? "rgba(255,255,255,.06)"
                            : t.surface,
                      border:
                        cell.played && !cell.live
                          ? `1px dashed ${t.line}`
                          : "none",
                      borderRadius: 6,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: cell.live
                        ? t.dark
                          ? "#0E0E0C"
                          : "#FFF"
                        : cell.played
                          ? t.inkMute
                          : t.ink,
                      fontFamily: "var(--font-mono)",
                      fontSize: 14,
                      fontWeight: 500,
                      opacity: cell.played && !cell.live ? 0.4 : 1,
                      cursor: clickable ? "pointer" : "default",
                      padding: 0,
                    }}
                  >
                    {cell.pointValue}
                  </button>
                );
              }),
            )}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            {/* Test wrapper exposes the same End-early action under both
                host-end-early-btn AND host-reveal-btn — in this UI the
                end-early button IS the manual reveal trigger, so both
                selectors point to it. */}
            <div data-testid="host-reveal-btn" style={{ flex: 1, display: "flex" }}>
              <button
                type="button"
                onClick={onEndEarly}
                disabled={!currentQuestion}
                data-testid="host-end-early-btn"
                style={{
                  flex: 1,
                  padding: "12px 0",
                  borderRadius: 10,
                  background: t.ink,
                  color: t.paper,
                  border: "none",
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: "var(--font-sans)",
                  cursor: currentQuestion ? "pointer" : "not-allowed",
                  opacity: currentQuestion ? 1 : 0.5,
                }}
              >
                End early · reveal
              </button>
            </div>
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              data-testid="host-undo-btn"
              style={{
                flex: 1,
                padding: "12px 0",
                borderRadius: 10,
                background: "transparent",
                color: canUndo ? t.ink : t.inkMute,
                border: `1px solid ${t.line}`,
                fontSize: 13,
                fontWeight: 500,
                fontFamily: "var(--font-sans)",
                cursor: canUndo ? "pointer" : "not-allowed",
                opacity: canUndo ? 1 : 0.55,
              }}
            >
              ↺ Undo
            </button>
            <button
              type="button"
              onClick={onAdjustPoints}
              style={{
                flex: 1,
                padding: "12px 0",
                borderRadius: 10,
                background: "transparent",
                color: t.inkMid,
                border: `1px solid ${t.line}`,
                fontSize: 13,
                fontWeight: 500,
                fontFamily: "var(--font-sans)",
                cursor: "pointer",
              }}
            >
              Adjust points
            </button>
          </div>
        </div>

        {/* Player list */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {(roomCode || resolvedJoinUrl) && (
            <div
              style={{
                display: "flex",
                gap: 14,
                alignItems: "center",
                padding: "12px 14px",
                marginBottom: 12,
                background: t.dark ? "rgba(244,230,196,.04)" : "rgba(20,19,15,.03)",
                border: `1px solid ${t.line}`,
                borderRadius: 12,
              }}
            >
              {resolvedJoinUrl ? (
                <div style={{ flexShrink: 0 }}>
                  <QRBlock url={resolvedJoinUrl} size={92} light />
                </div>
              ) : null}
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <Eyebrow color={t.accent} size={9}>
                  PLAYERS JOIN
                </Eyebrow>
                {roomCode ? (
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 24,
                      fontWeight: 700,
                      color: t.ink,
                      letterSpacing: "0.08em",
                      lineHeight: 1,
                    }}
                  >
                    {roomCode}
                  </div>
                ) : null}
                <div
                  style={{
                    fontSize: 10.5,
                    color: t.inkMid,
                    lineHeight: 1.4,
                  }}
                >
                  tr1via.com/join
                  <br />
                  <span style={{ color: t.inkMute }}>scan or type the code</span>
                </div>
              </div>
            </div>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingBottom: 12,
              borderBottom: `1px solid ${t.line}`,
              gap: 8,
            }}
          >
            <Eyebrow color={t.inkMid} size={10}>
              PLAYERS · {totalPlayers} LIVE
            </Eyebrow>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Numeric size={12} color={t.inkMid}>
                {locks} / {totalPlayers} in
              </Numeric>
              {onAddPlayer && (
                <button
                  type="button"
                  onClick={onAddPlayer}
                  aria-label="Add a latecomer"
                  style={{
                    padding: "2px 8px",
                    borderRadius: 6,
                    border: `1px solid ${t.line}`,
                    background: "transparent",
                    color: t.inkMid,
                    fontFamily: "var(--font-mono)",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    lineHeight: 1.4,
                  }}
                >
                  + add
                </button>
              )}
            </div>
          </div>
          <div
            style={{
              flex: 1,
              overflow: "auto",
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
                    gridTemplateColumns: onRemovePlayer
                      ? "20px 1fr 70px 18px 28px"
                      : "20px 1fr 70px 18px",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 0",
                    borderBottom: `1px solid ${t.lineSoft}`,
                    background: p.flag
                      ? t.dark
                        ? "rgba(229,138,138,.05)"
                        : "rgba(156,47,47,.03)"
                      : "transparent",
                    paddingLeft: p.flag ? 8 : 0,
                    paddingRight: p.flag ? 8 : 0,
                    marginLeft: p.flag ? -8 : 0,
                    marginRight: p.flag ? -8 : 0,
                    borderRadius: p.flag ? 6 : 0,
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
                  {onRemovePlayer && (
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <RemovePlayerButton
                        playerName={p.name}
                        onConfirm={() => onRemovePlayer(p.id)}
                      />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
        </div>
      </div>
    </LaptopShell>
  );
}
