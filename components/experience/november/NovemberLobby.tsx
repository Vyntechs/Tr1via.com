// November · the player lobby on the Harvest Field (Figma "01 Phone" P1).
//
//   top panel     host is setting up / "You're in." / your turkey walked in
//   hero          your turkey, big, walking into the field, on a cream name plate
//   bottom panel  who's in (you first, the newest next) and tonight's topics
//
// Same content as every other month's lobby, laid out as the Figma frame.
// The turkey takes whatever height is left, so a small phone (375x667) gets a
// smaller turkey instead of a scrolling screen.

"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Display, Eyebrow } from "@/components/system";
import { YourTurkey } from "@/components/experience/november/YourTurkey";
import {
  NOVEMBER_PHONE_ACCENT as ACCENT,
  NOVEMBER_PHONE_CREAM as CREAM,
  NOVEMBER_PHONE_PANEL,
  NOVEMBER_PHONE_PAPER as PAPER,
} from "@/lib/experience/november/phone";
import type { LobbyTopic } from "@/lib/tv/lobbyTopics";

const PANEL: CSSProperties = {
  background: NOVEMBER_PHONE_PANEL,
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  border: "1px solid rgba(242,222,174,.08)",
  borderRadius: 24,
  padding: "20px 20px 22px",
};
const LABEL = "rgba(242,222,174,.6)";
const CHIP: CSSProperties = { padding: "6px 12px", borderRadius: 999, fontSize: 14, fontWeight: 600, whiteSpace: "nowrap" };

/** The hero turkey's side in px: what fits the space, between 96 and 236. */
export function heroTurkeySize(boxW: number, boxH: number): number {
  const fit = Math.min(boxW * 0.62, boxH - 44);
  return Math.round(Math.max(96, Math.min(236, fit)));
}

export function NovemberLobby({
  playerName,
  hostName,
  inRoomCount,
  newestNames,
  topics,
}: {
  playerName: string;
  hostName: string;
  inRoomCount: number;
  newestNames: string[];
  topics: LobbyTopic[];
}) {
  const heroRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState(0);
  useLayoutEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const measure = () => setSize(heroTurkeySize(el.clientWidth, el.clientHeight));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const more = Math.max(0, inRoomCount - newestNames.length);

  return (
    <div data-testid="november-lobby" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", paddingTop: 10 }}>
      <section style={PANEL}>
        <Eyebrow color={LABEL} size={10}>{hostName.toUpperCase()} IS SETTING UP</Eyebrow>
        <Display size={46} color={CREAM} style={{ marginTop: 6, display: "block", textShadow: "0 1px 8px rgba(20,10,5,.9)" }}>
          You&apos;re in.
        </Display>
        <div style={{ marginTop: 8, color: "rgba(242,222,174,.85)", fontSize: 16, fontWeight: 500, lineHeight: 1.35 }}>
          Your turkey just walked into the field.
        </div>
      </section>

      <div
        ref={heroRef}
        data-testid="november-lobby-hero"
        style={{ flex: 1, minHeight: 140, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", paddingBottom: 12 }}
      >
        {size > 0 ? <YourTurkey mood="arrive" size={size} style={{ marginBottom: -Math.round(size * 0.08) }} /> : null}
        <span
          data-testid="november-name-plate"
          style={{
            position: "relative",
            maxWidth: "80%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            background: CREAM,
            color: PAPER,
            borderRadius: 8,
            padding: "5px 12px",
            fontSize: 17,
            fontWeight: 600,
            boxShadow: "0 2px 10px rgba(20,10,5,.45)",
          }}
        >
          {playerName}
        </span>
      </div>

      <section style={{ ...PANEL, flexShrink: 1, minHeight: 0, overflowY: "auto" }}>
        <Eyebrow color={LABEL} size={10}>IN THE GAME · {inRoomCount}</Eyebrow>
        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {newestNames.map((n, i) =>
            i === 0 ? (
              <span key={`${n}-${i}`} style={{ ...CHIP, background: ACCENT, color: PAPER }}>{n}</span>
            ) : (
              <span key={`${n}-${i}`} style={{ ...CHIP, border: "1px solid rgba(242,222,174,.25)", color: CREAM, display: "inline-flex", alignItems: "center", gap: 6 }}>
                {n}
                {i === 1 ? <span style={{ color: ACCENT, fontSize: 10, letterSpacing: "0.1em" }}>NEWEST</span> : null}
              </span>
            ),
          )}
          {more > 0 ? <span style={{ ...CHIP, color: LABEL }}>+{more}</span> : null}
        </div>

        {topics.length > 0 ? (
          <div data-testid="player-lobby-topics" style={{ marginTop: 18 }}>
            <Eyebrow color={LABEL} size={10}>TONIGHT&apos;S TOPICS</Eyebrow>
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
              {topics.map((topic, i) => (
                <span
                  key={`${topic.position}-${topic.label}`}
                  data-testid="player-lobby-topic"
                  style={{ ...CHIP, borderRadius: 10, background: "rgba(242,222,174,.08)", color: CREAM, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}
                >
                  <span style={{ color: LABEL, marginRight: 8 }}>{i + 1}</span>
                  {topic.label}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
