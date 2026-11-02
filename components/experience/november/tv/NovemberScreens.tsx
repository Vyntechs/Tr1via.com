// November · Harvest Field: the TV screens the design lays out anew.
//
// Lobby, board and between games, drawn at the Figma frames' own pixels
// ("1 Lobby" 5:68, "2 Board" 5:180, "8 Between games" 7:359) on the TV's top
// 1600×680 part (FitStage scales it to the panel). Each screen draws its own
// quiet panels, sized like the Figma so the string lights, the harvest table
// and the field read around them. Same information, behavior and test ids as
// the everyday screens; only the look is new.

"use client";

import type { CSSProperties, ReactNode } from "react";
import { TVStage } from "@/components/shells";
import { QRBlock, useTheme } from "@/components/system";
import type { TVLobbyProps } from "@/components/tv/TVLobby";
import type { TVIntermissionProps } from "@/components/tv/TVIntermission";
import type { TVGridProps } from "@/components/tv/TVGrid";
import { colorHexFromKey, playerColorHex } from "@/lib/player/playerColor";
import { NOV, NOV_PANEL_STYLE } from "@/lib/experience/november/tvLook";
import { leaderKey } from "@/lib/experience/november/harvest";
import { FitStage } from "../../october/tv/FitStage";

const QR_PLATE = NOV.ink;

/** A score as the screen shows it (a missing score reads 0). */
const points = (score: number): string => (Number.isFinite(score) ? score : 0).toLocaleString();

const abs = (x: number, y: number, extra: CSSProperties = {}): CSSProperties => ({
  position: "absolute",
  left: x,
  top: y,
  ...extra,
});

/** Small spaced label (Figma: Geist SemiBold, 14% tracking). */
const label = (size: number, color: string, extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: "var(--font-sans)",
  fontWeight: 600,
  fontSize: size,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
  color,
  ...extra,
});

const display = (size: number, extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: "var(--font-display)",
  fontWeight: 800,
  fontSize: size,
  lineHeight: 1,
  letterSpacing: "-0.02em",
  color: NOV.ink,
  ...extra,
});

const mono = (size: number, extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: "var(--font-mono)",
  fontWeight: 600,
  fontSize: size,
  lineHeight: 1.1,
  color: NOV.ink,
  whiteSpace: "nowrap",
  ...extra,
});

const ellipsis: CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

/** A board category name short enough for one 21 px line in its column. */
const fitsOneLine = (name: string): boolean => [...name].length <= 13;

function Panel({ x, y, w, h, testId }: { x: number; y: number; w: number; h: number; testId?: string }) {
  return <div aria-hidden="true" data-testid={testId} style={abs(x, y, { width: w, height: h, ...NOV_PANEL_STYLE })} />;
}

function QRPlate({ x, y, size, pad, testId, url }: { x: number; y: number; size: number; pad: number; testId: string; url: string }) {
  return (
    <div
      data-testid={testId}
      style={abs(x, y, {
        width: size + pad * 2,
        height: size + pad * 2,
        borderRadius: 18,
        background: QR_PLATE,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      })}
    >
      <QRBlock url={url} size={size} light />
    </div>
  );
}

function Screen({ page, testId, children }: { page: "lobby" | "board" | "intermission"; testId: string; children: ReactNode }) {
  return (
    <TVStage page={page} data-testid={testId} worldPanel={false} style={{ overflow: "visible" }}>
      <FitStage testId="november-fit-stage">{children}</FitStage>
    </TVStage>
  );
}

// ── 1 · Lobby ────────────────────────────────────────────────────────────

export function NovemberLobby({
  venueName = "",
  scheduledDate = "",
  roomCode = "",
  inRoomCount = 0,
  roster = [],
  rosterPlayerIds,
  joinUrl = "",
  hostStatusLine = "",
  gameStatusLine = "GAME 1 OF 2 · WAITING",
  welcomeEvent = null,
  topics = [],
}: Omit<TVLobbyProps, "themeKey">) {
  const newest = welcomeEvent?.name ?? roster[0] ?? null;
  const newestColor = welcomeEvent
    ? welcomeEvent.color ??
      (welcomeEvent.colorKey !== undefined ? colorHexFromKey(welcomeEvent.colorKey) : playerColorHex(welcomeEvent.joinToken))
    : rosterPlayerIds?.[0]
      ? playerColorHex(rosterPlayerIds[0])
      : NOV.burnt;
  const header = [venueName, scheduledDate, gameStatusLine].filter(Boolean).join(" · ");
  const shownTopics = topics.slice(0, 6);

  return (
    <Screen page="lobby" testId="tv-lobby">
      <Panel x={64} y={48} w={1472} h={520} testId="november-panel" />
      <div style={abs(112, 88, label(18, NOV.burnt, { maxWidth: 880, ...ellipsis }))}>{header}</div>
      <div style={abs(112, 118, display(84, { width: 800 }))}>Grab a spot in the field.</div>
      <div style={abs(112, 300, { width: 860, fontSize: 26, color: NOV.cream(0.8) })}>
        Scan to join. Your turkey walks in when you do.
      </div>

      <span style={abs(112, 372, label(15, NOV.cream(0.6)))}>Players joined</span>
      <span data-testid="november-lobby-count" style={abs(112, 396, mono(48))}>
        {inRoomCount}
      </span>

      <span style={abs(330, 372, label(15, NOV.cream(0.6)))}>Just joined</span>
      <div data-testid="tv-lobby-roster" style={abs(330, 400, { width: 290, display: "flex", alignItems: "center", gap: 12 })}>
        {newest ? (
          <>
            <span
              aria-hidden="true"
              style={{ width: 12, height: 12, borderRadius: 99, flexShrink: 0, background: newestColor }}
            />
            <span
              key={welcomeEvent?.joinToken ?? newest}
              data-testid="november-join-name"
              style={display(34, {
                fontWeight: 600,
                lineHeight: 1.2,
                minWidth: 0,
                ...ellipsis,
                animation:
                  welcomeEvent && !welcomeEvent.prefersReducedMotion
                    ? "tr1via-tick .6s cubic-bezier(.2,.7,.3,1) both"
                    : undefined,
              })}
            >
              {newest}
            </span>
          </>
        ) : (
          <span style={{ fontSize: 24, color: NOV.cream(0.6), lineHeight: "41px" }}>Be the first</span>
        )}
      </div>

      <span style={abs(640, 372, label(15, NOV.cream(0.6)))}>Room code · tr1via.com</span>
      <span data-testid="tv-lobby-room-code" style={abs(640, 400, mono(40))}>
        {roomCode}
      </span>

      {shownTopics.length > 0 ? (
        <div data-testid="tv-lobby-topics" style={abs(112, 482, { width: 880 })}>
          <span style={label(15, NOV.cream(0.6))}>Tonight&apos;s topics</span>
          <div style={{ marginTop: 10, fontSize: 21, fontWeight: 600, lineHeight: 1.3, color: NOV.ink, ...ellipsis }}>
            {shownTopics.map((topic, i) => (
              <span key={`${topic.position}-${topic.label}`}>
                {i > 0 ? <span style={{ color: NOV.cream(0.5) }}> · </span> : null}
                <span data-testid="tv-lobby-topic">{topic.label}</span>
              </span>
            ))}
          </div>
        </div>
      ) : hostStatusLine ? (
        <span style={abs(112, 508, label(15, NOV.cream(0.6)))}>{hostStatusLine}</span>
      ) : null}

      <QRPlate x={1040} y={72} size={448} pad={12} testId="tv-lobby-qr" url={joinUrl} />
    </Screen>
  );
}

// ── 2 · Board ────────────────────────────────────────────────────────────

const GRID = { x: 112, y: 124, w: 988, h: 410 } as const;

export function NovemberBoard({
  gameStatusLine = "",
  rightHeaderLine = "",
  categories = [],
  cells,
  values = [],
  leaders = [],
  boardLeft = 0,
  footerLeft = "",
  footerRight = "",
  upNext,
  onCellClick,
}: Omit<TVGridProps, "themeKey">) {
  const { t } = useTheme();
  const board = cells ?? [];
  const cols = Math.max(1, categories.length);
  const footer = [footerLeft, footerRight].filter(Boolean).join("  ·  ");
  // The gold tail goes to one clear leader only (a tie at the top gets none):
  // the same rule the turkey row uses. Rows carry no player key, so the
  // position stands in for it (names can repeat).
  const goldTail = leaderKey("board", leaders.map((r, i) => ({ player_key: String(i), score: r.score }))) !== null;

  return (
    <Screen page="board" testId="tv-grid">
      <Panel x={64} y={48} w={1472} h={520} testId="november-panel" />
      <div style={abs(112, 84, label(18, NOV.burnt, { maxWidth: 640, ...ellipsis }))}>{gameStatusLine}</div>
      <div style={abs(760, 84, label(18, NOV.cream(0.7), { width: 340, textAlign: "right" }))}>
        <span data-testid="november-board-left">{boardLeft} left</span>
      </div>

      <div
        style={abs(GRID.x, GRID.y, {
          width: GRID.w,
          height: GRID.h,
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: `40px repeat(${Math.max(1, values.length)}, minmax(0, 1fr))`,
          columnGap: 12,
          rowGap: 8,
        })}
      >
        {categories.map((c) => (
          <div
            key={c}
            data-testid="november-board-category"
            style={{
              alignSelf: "start",
              fontWeight: 700,
              color: NOV.ink,
              // A column is ~155 px: short names keep one 21 px line; longer
              // ones ("The color Green") wrap to two smaller lines in the
              // same 40 px row instead of losing their end.
              ...(fitsOneLine(c)
                ? { fontSize: 21, lineHeight: 1.2, ...ellipsis }
                : {
                    fontSize: 17,
                    lineHeight: 1.1,
                    paddingTop: 3, // one line sits on the 21 px names' baseline
                    overflow: "hidden",
                    overflowWrap: "anywhere",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                  }),
            }}
          >
            {c}
          </div>
        ))}
        {values.map((v, rIdx) =>
          categories.map((c, cIdx) => {
            const cell = board[cIdx]?.[rIdx] ?? { played: false, selected: false, value: v };
            const isPlayed = cell.played;
            const isSelected = cell.selected;
            const clickable = !!onCellClick && !!cell.questionId && !isPlayed && !isSelected;
            const cellStyle: CSSProperties = {
              gridColumn: cIdx + 1,
              gridRow: rIdx + 2,
              borderRadius: 12,
              background: isSelected ? t.accent : isPlayed ? "transparent" : NOV.tile,
              border: isPlayed
                ? `1px dashed ${NOV.cream(0.14)}`
                : isSelected
                  ? `2px solid ${t.accent}`
                  : `1px solid ${NOV.tileEdge}`,
              boxShadow: isSelected ? `0 10px 36px -10px ${t.accent}aa, 0 0 0 4px ${t.accent}33` : "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
              overflow: "hidden",
              transition: "all .3s cubic-bezier(.2,.7,.3,1)",
              transform: isSelected ? "scale(1.04)" : "scale(1)",
              cursor: clickable ? "pointer" : "default",
            };
            const value = (
              <span
                style={mono(34, {
                  fontWeight: 700,
                  letterSpacing: "-0.03em",
                  color: isSelected ? NOV.paper : isPlayed ? NOV.cream(0.4) : NOV.ink,
                  textDecoration: isPlayed ? "line-through" : "none",
                  opacity: isPlayed ? 0.6 : 1,
                })}
              >
                {cell.value}
              </span>
            );
            if (clickable && cell.questionId) {
              const qid = cell.questionId;
              return (
                <button
                  key={`${cIdx}-${rIdx}`}
                  type="button"
                  data-testid={`host-question-${qid}`}
                  onClick={() => onCellClick?.(qid)}
                  style={{ ...cellStyle, padding: 0, appearance: "none", font: "inherit", color: "inherit" }}
                >
                  <span
                    data-testid={`tv-grid-cell-${cIdx}-${cell.value}`}
                    style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                  >
                    {value}
                  </span>
                </button>
              );
            }
            return (
              <div key={`${cIdx}-${rIdx}`} data-testid={`tv-grid-cell-${cIdx}-${cell.value}`} style={cellStyle}>
                {value}
              </div>
            );
          }),
        )}
      </div>

      {/* Standings */}
      <div style={abs(1150, 84, { width: 338 })}>
        <span style={label(18, NOV.cream(0.7), { display: "block", textAlign: "right" })}>
          {rightHeaderLine}
        </span>
      </div>
      {leaders.length > 0 ? (
        <div data-testid="tv-grid-standings" style={abs(1150, 124, { width: 338 })}>
          <span style={label(15, NOV.cream(0.6))}>Standings</span>
          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 22 }}>
            {leaders.slice(0, 5).map((r, i) => {
              const top = r.rank === 1;
              return (
                <div
                  // Ties share a rank and can share a name; the index keeps it unique.
                  key={`${r.rank}-${r.name}-${i}`}
                  data-testid={`tv-grid-standing-${r.rank}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "32px minmax(0, 1fr) auto",
                    alignItems: "baseline",
                    gap: 10,
                  }}
                >
                  <span style={mono(20, { color: top ? NOV.burnt : NOV.cream(0.6) })}>{r.rank}</span>
                  <span
                    data-testid="tv-grid-standing-name"
                    style={display(top ? 30 : 26, { fontWeight: 700, minWidth: 0, lineHeight: 1.2, ...ellipsis })}
                  >
                    {r.name}
                  </span>
                  <span style={mono(top ? 30 : 26, { fontWeight: 700, color: top ? NOV.burnt : NOV.ink })}>
                    {points(r.score)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {upNext ? (
        <div
          data-testid="november-board-up-next"
          style={abs(1150, 448, {
            width: 338,
            boxSizing: "border-box",
            padding: "10px 16px",
            borderRadius: 12,
            background: NOV.cream(0.08),
            border: `1px solid ${t.accent}`,
          })}
        >
          <div style={label(13, NOV.cream(0.7))}>Up next · host&apos;s pick</div>
          <div style={{ marginTop: 4, fontSize: 20, fontWeight: 700, color: NOV.ink, ...ellipsis }}>
            {upNext.category} · {upNext.value} pts
          </div>
          {upNext.sub ? <div style={{ fontSize: 14, color: NOV.cream(0.7), ...ellipsis }}>{upNext.sub}</div> : null}
        </div>
      ) : goldTail ? (
        <div style={abs(1150, 502, { fontSize: 21, color: NOV.cream(0.75) })}>Leader wears the gold tail.</div>
      ) : null}
      {footer ? (
        <div style={abs(112, 540, label(13, NOV.cream(0.55), { maxWidth: 1376, ...ellipsis }))}>{footer}</div>
      ) : null}
    </Screen>
  );
}

// ── 8 · Between games ────────────────────────────────────────────────────

export function NovemberBetweenGames({
  headerLeft = "GAME 1 · COMPLETE",
  headerRight = "GAME 2 LAUNCHES WHEN HOST SAYS GO",
  podium = [],
  readyCount = null,
  totalCount,
  roomCode = "",
  joinUrl = "",
  nightStats = [],
}: Omit<TVIntermissionProps, "themeKey">) {
  const stats = nightStats
    .slice(0, 3)
    .map((s) => `${s.v} ${s.l.toLowerCase()}`)
    .join(" · ");

  return (
    <Screen page="intermission" testId="tv-intermission">
      {/* Both panels end at 656 (where the everyday November panel ends), so
          nothing reaches the turkey row (it starts at 676). */}
      <Panel x={64} y={36} w={672} h={620} testId="november-panel" />
      <Panel x={1064} y={36} w={472} h={620} />

      {/* Left: standings */}
      <div style={abs(104, 64, label(18, NOV.burnt))}>{headerLeft}</div>
      <div style={abs(104, 90, display(60, { whiteSpace: "nowrap" }))}>Game 1. Standings.</div>
      {podium.slice(0, 6).map((p, i) => {
        const big = i < 3;
        const y = big ? 180 + i * 62 : 376 + (i - 3) * 38;
        return (
          <div
            // Position first: two tied players can share a name.
            key={`${i}-${p.rank}-${p.name}`}
            data-testid="tv-intermission-podium-row"
            style={abs(104, y, {
              width: 592,
              display: "grid",
              gridTemplateColumns: "40px minmax(0, 1fr) auto",
              alignItems: "baseline",
              gap: 8,
            })}
          >
            <span style={mono(big ? 26 : 21, { color: i === 0 ? NOV.burnt : NOV.cream(0.6) })}>{p.rank}</span>
            <span style={display(big ? 38 : 26, { fontWeight: big ? 800 : 600, lineHeight: 1.2, minWidth: 0, ...ellipsis })}>
              {p.name}
            </span>
            <span style={mono(big ? 40 : 26, { fontWeight: 700, color: i === 0 ? NOV.burnt : NOV.ink })}>
              {points(p.score)}
            </span>
          </div>
        );
      })}
      {stats ? (
        <>
          <span style={abs(104, 512, label(15, NOV.cream(0.6)))}>Game 1 in numbers</span>
          <div data-testid="november-intermission-stats" style={abs(104, 536, { width: 592, fontSize: 24, color: NOV.ink, ...ellipsis })}>
            {stats}
          </div>
        </>
      ) : null}
      <span style={abs(104, 604, label(15, NOV.cream(0.6), { maxWidth: 592, ...ellipsis }))}>{headerRight}</span>

      {/* Right: game 2 + scan in */}
      <div style={abs(1104, 64, label(18, NOV.burnt))}>Ready for Game 2</div>
      <div style={abs(1104, 90, display(40, { whiteSpace: "nowrap" }))}>Game 2 starts soon.</div>
      <div style={abs(1104, 140, { width: 392, fontSize: 20, lineHeight: 1.3, color: NOV.cream(0.8) })}>
        Open your phone and tap <span style={{ fontWeight: 700, color: NOV.ink }}>Join Game 2</span>. Your name is
        already in. Everyone starts back at zero.
      </div>
      {readyCount != null ? (
        <div data-testid="november-intermission-ready" style={abs(1104, 224, label(14, NOV.cream(0.7)))}>
          {totalCount ? `${readyCount} of ${totalCount} back in` : `${readyCount} back in`}
        </div>
      ) : null}
      {/* The room code shares the "New here?" line so the 308 QR still fits
          above the turkey row. */}
      <div
        style={abs(1104, 252, {
          width: 392,
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
        })}
      >
        <span style={label(15, NOV.cream(0.6))}>New here?</span>
        <span data-testid="november-intermission-room" style={mono(20, { minWidth: 0, ...ellipsis })}>
          tr1via.com{roomCode ? ` · ${roomCode}` : ""}
        </span>
      </div>
      <div style={abs(1104, 278, { fontSize: 24, fontWeight: 600, color: NOV.ink })}>Scan to jump into Game 2.</div>
      <QRPlate x={1134} y={312} size={308} pad={12} testId="tv-intermission-qr" url={joinUrl} />
    </Screen>
  );
}
