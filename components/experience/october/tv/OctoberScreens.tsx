// October · Sleepy Hollow Night — the TV screens the design lays out anew.
//
// Same information as the everyday screens, arranged to the Figma frames
// ("01 Lobby", "8 Between games", "9 Winner") so the pumpkin patch has the
// bottom strip and the QR codes use every bit of space (lobby 448px, between
// games 308px). Positions are the frames' own pixels on a 1600×680 box
// (FitStage scales it to the panel). Nothing here is interactive, and every
// screen keeps the test ids the everyday version uses.

"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { TVStage, TVHeader } from "@/components/shells";
import { QRBlock, useTheme } from "@/components/system";
import type { TVLobbyProps } from "@/components/tv/TVLobby";
import type { TVIntermissionProps } from "@/components/tv/TVIntermission";
import type { TVFinaleWinnerProps } from "@/components/tv/TVFinaleWinner";
import { categoryColor } from "@/lib/theme/categories";
import { colorHexFromKey, playerColorHex } from "@/lib/player/playerColor";
import { FLAMING_HEAD, artUrl } from "../art";
import { FitStage } from "./FitStage";

const DARK = "#0E0805";
const CREAM = (a: number) => `rgba(244,230,196,${a})`;

const abs = (x: number, y: number, extra: CSSProperties = {}): CSSProperties => ({
  position: "absolute",
  left: x,
  top: y,
  ...extra,
});

const mono = (size: number, extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: "var(--font-mono)",
  fontSize: size,
  fontWeight: 600,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  ...extra,
});

const display = (size: number, extra: CSSProperties = {}): CSSProperties => ({
  fontFamily: "var(--font-display)",
  fontWeight: 700,
  fontSize: size,
  lineHeight: 1,
  whiteSpace: "nowrap",
  ...extra,
});

/** The flaming head the leader holds (original art from the Figma kit). */
export function FlamingHead({ height, style }: { height: number; style?: CSSProperties }) {
  const url = useMemo(() => artUrl(FLAMING_HEAD), []);
  const width = (height * FLAMING_HEAD.width) / FLAMING_HEAD.height;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      aria-hidden
      data-testid="october-flaming-head"
      width={width}
      height={height}
      style={{ display: "block", width, height, flexShrink: 0, ...style }}
    />
  );
}

function Header({ left, right }: { left: string; right?: string }) {
  return (
    <div style={abs(0, 0, { right: 0 })}>
      <TVHeader left={left} right={right} />
    </div>
  );
}

// ── 1 · Lobby ────────────────────────────────────────────────────────────

export function OctoberLobby({
  venueName = "",
  scheduledDate = "",
  roomCode = "",
  inRoomCount = 0,
  roster = [],
  rosterPlayerIds,
  joinUrl = "",
  gameStatusLine = "GAME 1 OF 2 · WAITING",
  welcomeEvent = null,
  topics = [],
}: Omit<TVLobbyProps, "themeKey">) {
  const { t } = useTheme();
  const newest = roster[0] ?? null;
  const newestId = rosterPlayerIds?.[0] ?? null;
  const toastName = welcomeEvent?.name ?? newest;
  const toastColor = welcomeEvent
    ? welcomeEvent.color ??
      (welcomeEvent.colorKey !== undefined
        ? colorHexFromKey(welcomeEvent.colorKey)
        : playerColorHex(welcomeEvent.joinToken))
    : newestId
      ? playerColorHex(newestId)
      : t.accent;
  const listFade = [1, 1, 1, 0.62, 0.54, 0.46, 0.38];

  return (
    <TVStage page="lobby" data-testid="tv-lobby" style={{ overflow: "visible" }}>
      <FitStage>
        <Header left={`${venueName} · ${scheduledDate}`} right={gameStatusLine} />

        {/* Left: the invitation */}
        <div style={abs(56, 104)}>
          {[
            ["Scan,", t.ink],
            ["play,", t.accent],
            ["win.", t.pop],
          ].map(([word, color], i) => (
            <div
              key={word}
              style={display(84, {
                color,
                lineHeight: 0.9,
                letterSpacing: "-0.05em",
                height: 76,
                marginTop: i === 0 ? 0 : 0,
              })}
            >
              {word}
            </div>
          ))}
        </div>
        <p
          style={abs(56, 358, {
            margin: 0,
            width: 520,
            fontSize: 19,
            lineHeight: 1.35,
            color: CREAM(0.7),
          })}
        >
          Open your camera, point at the code, pick a name. You&apos;re in the game in under ten seconds.
        </p>
        <span style={abs(56, 424, mono(11, { color: t.inkMid }))}>OR ON YOUR PHONE</span>
        <span
          style={abs(56, 442, {
            fontFamily: "var(--font-mono)",
            fontWeight: 600,
            fontSize: 30,
            color: t.ink,
          })}
        >
          tr1via.com
        </span>
        <span style={abs(300, 424, mono(11, { color: t.inkMid }))}>GAME CODE</span>
        <div
          data-testid="tv-lobby-room-code"
          style={abs(300, 440, {
            width: 190,
            height: 46,
            borderRadius: 8,
            background: t.accent,
            color: DARK,
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            fontSize: 30,
            letterSpacing: "0.05em",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          })}
        >
          {roomCode}
        </div>
        {topics.length > 0 ? (
          <div
            data-testid="tv-lobby-topics"
            data-readability="scrim"
            style={abs(56, 508, {
              width: 544,
              height: 178,
              borderRadius: 10,
              background: "rgba(14,8,5,.6)",
              boxSizing: "border-box",
              padding: "14px 20px",
            })}
          >
            <span style={mono(11, { color: t.inkMid })}>TONIGHT&apos;S TOPICS</span>
            <div
              style={{
                marginTop: 16,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gridAutoFlow: "column",
                gridTemplateRows: "repeat(3, 42px)",
                columnGap: 24,
              }}
            >
              {topics.slice(0, 6).map((topic) => (
                <div
                  key={`${topic.position}-${topic.label}`}
                  data-testid="tv-lobby-topic"
                  style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 22,
                      borderRadius: 4,
                      flexShrink: 0,
                      background: topic.color ?? categoryColor(topic.name),
                    }}
                  />
                  <span
                    style={{
                      fontSize: 22,
                      fontWeight: 600,
                      color: t.ink,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {topic.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Middle: the door into the room — as big as the space allows */}
        <div
          style={abs(632, 96, {
            width: 564,
            height: 590,
            borderRadius: 28,
            background: CREAM(0.05),
            border: `1px solid ${CREAM(0.16)}`,
            boxSizing: "border-box",
          })}
        />
        <div
          style={abs(632, 116, {
            width: 564,
            textAlign: "center",
            fontSize: 22,
            fontWeight: 700,
            color: t.ink,
          })}
        >
          Players — scan to join this game
        </div>
        <div
          data-testid="tv-lobby-qr"
          style={abs(666, 156, {
            width: 496,
            height: 496,
            borderRadius: 18,
            background: "#FFFFFF",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          })}
        >
          <QRBlock url={joinUrl} size={448} light />
        </div>

        {/* Right: who's here */}
        <div
          style={abs(1228, 104, {
            padding: "14px 22px",
            borderRadius: 99,
            background: t.pop,
            color: DARK,
            display: "flex",
            alignItems: "center",
            gap: 10,
          })}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 99,
              background: DARK,
              animation: "tr1via-pulse 1.6s ease-in-out infinite",
            }}
          />
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 30, lineHeight: 1 }}>
            {inRoomCount}
          </span>
          <span style={{ fontSize: 17, fontWeight: 600 }}>players joined</span>
        </div>
        <span style={abs(1228, 186, mono(11, { color: t.inkMid }))}>JUST JOINED</span>
        <div data-testid="tv-lobby-roster" style={abs(1228, 210, { width: 316 })}>
          {roster.slice(0, 7).map((name, i) => (
            <div
              key={`${name}-${i}`}
              style={{
                height: i === 0 ? 36 : 36,
                fontSize: i === 0 ? 22 : 19,
                fontWeight: 700,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                color: i === 0 ? (newestId ? playerColorHex(newestId) : t.accent) : CREAM(listFade[i] ?? 0.38),
              }}
            >
              {name}
            </div>
          ))}
        </div>
        {toastName ? (
          <div
            key={welcomeEvent?.joinToken ?? toastName}
            data-testid="october-join-toast"
            style={abs(1228, 588, {
              width: 316,
              boxSizing: "border-box",
              padding: "14px 18px",
              borderRadius: 14,
              background: `${toastColor}33`,
              display: "flex",
              flexDirection: "column",
              gap: 4,
              animation: welcomeEvent && !welcomeEvent.prefersReducedMotion
                ? "tr1via-tick .6s cubic-bezier(.2,.7,.3,1) both"
                : undefined,
            })}
          >
            <span style={mono(10, { color: CREAM(0.75) })}>JUST JOINED</span>
            <span
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: t.ink,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {toastName}
            </span>
            <span style={{ fontSize: 14, fontWeight: 500, color: t.pop }}>A new pumpkin in the patch</span>
          </div>
        ) : null}
      </FitStage>
    </TVStage>
  );
}

// ── 8 · Between games ────────────────────────────────────────────────────

export function OctoberBetweenGames({
  headerLeft = "GAME 1 · COMPLETE",
  headerRight = "GAME 2 LAUNCHES WHEN HOST SAYS GO",
  podium = [],
  roomCode = "",
  joinUrl = "",
  nightStats = [],
}: Omit<TVIntermissionProps, "themeKey">) {
  const { t } = useTheme();
  const rowColors = [t.accent, t.pop, t.correct];

  return (
    <TVStage page="intermission" data-testid="tv-intermission" style={{ overflow: "visible" }}>
      <FitStage>
        <Header left={headerLeft} right={headerRight} />

        <div style={abs(56, 100, display(68, { letterSpacing: "-0.04em", color: t.ink }))}>
          <span style={{ color: t.accent }}>Game 1.</span> Winners.
        </div>

        {podium.slice(0, 3).map((p, i) => {
          const color = p.color ?? rowColors[i] ?? t.accent;
          const first = i === 0;
          return (
            <div
              key={`${p.rank}-${p.name}`}
              data-testid="tv-intermission-podium-row"
              style={abs(56, 192 + i * 118, {
                width: 880,
                height: 106,
                boxSizing: "border-box",
                borderRadius: 18,
                border: `2px solid ${color}`,
                background: first ? color : "rgba(14,8,5,.35)",
                color: first ? DARK : t.ink,
                display: "flex",
                alignItems: "center",
                padding: "0 26px 0 28px",
                gap: 22,
              })}
            >
              <span
                style={{
                  width: 64,
                  fontFamily: "var(--font-mono)",
                  fontWeight: 700,
                  fontSize: 60,
                  color: first ? DARK : color,
                  lineHeight: 1,
                }}
              >
                {p.rank}
              </span>
              <span
                style={display(50, {
                  letterSpacing: "-0.03em",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: 500,
                })}
              >
                {p.name}
              </span>
              {first && p.score > 0 ? <FlamingHead height={97} style={{ marginTop: -18 }} /> : null}
              <span
                style={{
                  marginLeft: "auto",
                  fontFamily: "var(--font-mono)",
                  fontWeight: 700,
                  fontSize: 40,
                }}
              >
                {p.score.toLocaleString()}
              </span>
            </div>
          );
        })}

        <span style={abs(56, 560, mono(11, { color: t.inkMid }))}>GAME 1 IN NUMBERS</span>
        {nightStats.slice(0, 3).map((s, i) => (
          <div
            key={s.l}
            style={abs(56 + i * 300, 584, {
              width: 280,
              height: 88,
              boxSizing: "border-box",
              borderRadius: 14,
              background: "rgba(14,8,5,.6)",
              border: `1px solid ${CREAM(0.12)}`,
              padding: "14px 20px",
            })}
          >
            <div style={mono(10, { color: CREAM(0.5) })}>{s.l}</div>
            <div
              style={{
                marginTop: 6,
                fontFamily: "var(--font-mono)",
                fontWeight: 700,
                fontSize: 36,
                color: t.ink,
                lineHeight: 1,
              }}
            >
              {s.v}
            </div>
          </div>
        ))}

        {/* Ready for Game 2 */}
        <div
          style={abs(968, 100, {
            width: 576,
            height: 168,
            boxSizing: "border-box",
            borderRadius: 18,
            background: t.accent,
            color: DARK,
            padding: "20px 26px",
          })}
        >
          <div style={mono(11, { color: "rgba(14,8,5,.7)" })}>READY FOR GAME 2</div>
          <div style={display(50, { marginTop: 6, letterSpacing: "-0.03em" })}>Game 2 rides soon.</div>
          <div style={{ marginTop: 10, fontSize: 17, fontWeight: 500, lineHeight: 1.3, color: "rgba(14,8,5,.85)" }}>
            Open your phone. Tap <span style={{ fontWeight: 700 }}>Join Game 2</span> — your name is already
            in. Everyone starts back at zero.
          </div>
        </div>

        {/* New here: scan in */}
        <div
          style={abs(968, 284, {
            width: 576,
            height: 388,
            boxSizing: "border-box",
            borderRadius: 18,
            background: "rgba(14,8,5,.72)",
            border: `1px solid ${CREAM(0.16)}`,
          })}
        />
        <div
          data-testid="tv-intermission-qr"
          style={abs(992, 308, {
            width: 340,
            height: 340,
            borderRadius: 14,
            background: "#FFFFFF",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          })}
        >
          <QRBlock url={joinUrl} size={308} light />
        </div>
        <span style={abs(1356, 320, mono(11, { color: CREAM(0.7) }))}>NEW HERE?</span>
        <div style={abs(1356, 342, display(30, { width: 170, whiteSpace: "normal", lineHeight: 1.05, color: t.ink }))}>
          Scan to jump into Game 2.
        </div>
        <span style={abs(1356, 500, mono(10, { color: CREAM(0.5) }))}>OR GO TO</span>
        <span style={abs(1356, 516, { fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 20, color: t.ink })}>
          tr1via.com
        </span>
        <span style={abs(1356, 560, mono(10, { color: CREAM(0.5) }))}>GAME CODE</span>
        <div
          style={abs(1356, 578, {
            width: 164,
            height: 40,
            borderRadius: 8,
            background: t.accent,
            color: DARK,
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            fontSize: 24,
            letterSpacing: "0.05em",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          })}
        >
          {roomCode}
        </div>
      </FitStage>
    </TVStage>
  );
}

// ── 9 · Winner ───────────────────────────────────────────────────────────

export function OctoberWinner({
  headerEyebrow = "",
  headerRight = "GAME 2 · FINAL",
  winner,
  podium = [],
}: Omit<TVFinaleWinnerProps, "themeKey">) {
  const { t } = useTheme();
  if (!winner) return null;

  return (
    <TVStage page="finale" data-testid="tv-finale-winner" style={{ overflow: "visible" }}>
      <FitStage>
        <Header left={headerEyebrow} right={headerRight} />

        <span style={abs(56, 150, mono(13, { color: t.accent }))}>WON THE NIGHT · HOLDS THE FLAMING HEAD</span>
        <FlamingHead height={166} style={abs(56, 170)} />
        {/* The champion's name at full size when it fits; a long name or a
            tie ("Sarah + Mike") shrinks to fit whole, never cut off. */}
        <FitWidth maxWidth={890} style={abs(168, 180, { height: 175 })}>
          <span
            data-testid="tv-finale-winner-name"
            style={display(190, { color: t.ink, lineHeight: 0.92, letterSpacing: "-0.05em" })}
          >
            {winner.name}.
          </span>
        </FitWidth>
        <div style={abs(60, 390, { display: "flex", alignItems: "baseline", gap: 28 })}>
          <span
            data-testid="tv-finale-winner-score"
            style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 84, color: t.accent, lineHeight: 1.1 }}
          >
            {winner.score.toLocaleString()}
          </span>
          <span style={{ fontSize: 26, fontWeight: 500, color: t.inkMid }}>points</span>
        </div>
        <div style={abs(60, 500, { display: "flex", gap: 16 })}>
          {winner.correct !== undefined && winner.of !== undefined ? (
            <WinnerChip label="GOT RIGHT" value={`${winner.correct} of ${winner.of}`} color={t.correct} width={236} />
          ) : null}
          {winner.fastest ? (
            <WinnerChip label="FASTEST ANSWER" value={winner.fastest} color={t.pop} width={260} />
          ) : null}
        </div>

        <span style={abs(1080, 112, mono(11, { color: t.inkMute }))}>SECOND AND THIRD</span>
        {podium.slice(0, 2).map((p, i) => (
          <div
            key={`${p.rank}-${p.name}`}
            style={abs(1080, 136 + i * 112, {
              width: 464,
              height: 98,
              boxSizing: "border-box",
              borderRadius: 14,
              background: "rgba(14,8,5,.7)",
              border: `1px solid ${CREAM(0.14)}`,
              padding: "10px 20px",
            })}
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 40, color: t.accent, lineHeight: 1 }}>
                {p.rank}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 22, color: t.ink }}>
                {p.score.toLocaleString()}
              </span>
            </div>
            <div style={display(34, { marginTop: 4, color: t.ink, letterSpacing: "-0.02em", overflow: "hidden", textOverflow: "ellipsis" })}>
              {p.name}
            </div>
          </div>
        ))}
      </FitStage>
    </TVStage>
  );
}

/** One line at its natural size, scaled down as a whole if wider than
 *  `maxWidth`. Measures layout width, so a scaled stage isn't counted twice. */
function FitWidth({ maxWidth, style, children }: { maxWidth: number; style: CSSProperties; children: ReactNode }) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const fit = () => {
      const natural = inner.offsetWidth;
      if (natural <= 0) return;
      const next = Math.min(1, maxWidth / natural);
      setScale((current) => (Math.abs(current - next) < 0.005 ? current : next));
    };
    const first = window.setTimeout(fit, 0);
    if (typeof ResizeObserver === "undefined") return () => window.clearTimeout(first);
    const observer = new ResizeObserver(fit);
    observer.observe(inner);
    return () => {
      window.clearTimeout(first);
      observer.disconnect();
    };
  }, [maxWidth]);
  return (
    <div style={{ ...style, width: maxWidth, display: "flex", alignItems: "center" }}>
      <div
        ref={innerRef}
        data-fit-scale={scale.toFixed(2)}
        style={{
          whiteSpace: "nowrap",
          flexShrink: 0,
          transform: scale === 1 ? undefined : `scale(${scale})`,
          transformOrigin: "left center",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function WinnerChip({ label, value, color, width }: { label: string; value: string; color: string; width: number }) {
  return (
    <div
      style={{
        width,
        height: 64,
        boxSizing: "border-box",
        borderRadius: 12,
        background: color,
        color: DARK,
        padding: "10px 18px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 4,
      }}
    >
      <span style={mono(10, { color: "rgba(14,8,5,.6)" })}>{label}</span>
      <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 26, lineHeight: 1 }}>{value}</span>
    </div>
  );
}
