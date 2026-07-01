"use client";

import { useEffect, useMemo, useState } from "react";
import { DEMO_FASTEST, TVReveal, TVRoomMagicOverlay } from "@/components/tv";
import {
  ROOM_MAGIC_REACTION_LABELS,
  type RoomMagicReactionEvent,
  type RoomMagicReactionKind,
} from "@/lib/room-magic/reactions";

const REACTION_SEQUENCE: RoomMagicReactionKind[] = [
  "wow",
  "applause",
  "nice_one",
  "brutal",
];

export default function RoomMagicReactionDemo() {
  const [active, setActive] = useState<{
    kind: RoomMagicReactionKind;
    nonce: number;
  }>({ kind: "wow", nonce: 0 });

  useEffect(() => {
    const replayHandle = window.setTimeout(() => {
      setActive((current) => ({ ...current, nonce: current.nonce + 1 }));
    }, 120);

    const handle = window.setInterval(() => {
      setActive((current) => {
        const currentIndex = REACTION_SEQUENCE.indexOf(current.kind);
        const nextKind =
          REACTION_SEQUENCE[(currentIndex + 1) % REACTION_SEQUENCE.length];
        return { kind: nextKind, nonce: current.nonce + 1 };
      });
    }, 1800);

    return () => {
      window.clearTimeout(replayHandle);
      window.clearInterval(handle);
    };
  }, []);

  const event = useMemo<RoomMagicReactionEvent>(
    () => ({
      kind: active.kind,
      questionId: "dev-reveal-room-signs-back",
      playerId: `demo-player-${active.kind}-${active.nonce}`,
      serverNow: new Date().toISOString(),
    }),
    [active.kind, active.nonce],
  );

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "min(4vw, 48px)",
        background:
          "radial-gradient(circle at 50% 0%, rgba(247, 198, 94, .16), transparent 36%), #0b1224",
        color: "#f9f3e7",
        fontFamily: "var(--font-sans)",
      }}
    >
      <section
        style={{
          width: "min(1280px, 100%)",
          display: "grid",
          gap: 18,
        }}
      >
        <div
          data-testid="room-magic-reaction-demo-stage"
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: "16 / 9",
            borderRadius: 18,
            overflow: "hidden",
            border: "1px solid rgba(249, 243, 231, .22)",
            boxShadow:
              "0 36px 90px rgba(0, 0, 0, .5), 0 0 120px rgba(242, 201, 76, .16)",
            background: "#0e0805",
          }}
        >
          <TVReveal
            themeKey="july"
            headerEyebrow="GAME 1 · MOVIES · 100 PTS"
            question="Which Pixar movie begins with a married life montage?"
            correctNumber={1}
            correctText="Up"
            fact="The room gets the answer, then the room signs back."
            gotIt={23}
            ofTotal={31}
            fastest="1.2s"
            speedBonus="+110"
            fastestFive={DEMO_FASTEST}
          />
          <TVRoomMagicOverlay enabled event={event} themeKey="july" />
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          {REACTION_SEQUENCE.map((kind) => {
            const selected = kind === active.kind;
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  setActive((current) => ({
                    kind,
                    nonce: current.nonce + 1,
                  }))
                }
                style={{
                  minWidth: 112,
                  padding: "10px 14px",
                  borderRadius: 999,
                  border: selected
                    ? "1px solid rgba(249, 243, 231, .9)"
                    : "1px solid rgba(249, 243, 231, .24)",
                  background: selected
                    ? "rgba(249, 243, 231, .18)"
                    : "rgba(249, 243, 231, .07)",
                  color: "#f9f3e7",
                  fontWeight: 800,
                  fontSize: 13,
                  letterSpacing: 0,
                  cursor: "pointer",
                }}
              >
                {ROOM_MAGIC_REACTION_LABELS[kind]}
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}
