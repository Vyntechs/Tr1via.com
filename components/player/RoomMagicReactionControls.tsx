"use client";

import { useState } from "react";
import { Eyebrow, useTheme } from "@/components/system";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";
import {
  ROOM_MAGIC_REACTION_LABELS,
  ROOM_MAGIC_REACTION_KINDS,
  type RoomMagicReactionKind,
} from "@/lib/room-magic/reactions";

export interface RoomMagicReactionControlsProps {
  questionId: string;
  enabled: boolean;
  className?: string;
}

type SendState = "idle" | "sent" | "failed";

export function RoomMagicReactionControls({
  questionId,
  enabled,
  className,
}: RoomMagicReactionControlsProps) {
  const { t } = useTheme();
  const reducedMotion = usePrefersReducedMotion();
  const [state, setState] = useState<SendState>("idle");
  const [selected, setSelected] = useState<RoomMagicReactionKind | null>(null);

  if (!enabled) return null;

  const locked = state !== "idle";

  async function send(kind: RoomMagicReactionKind) {
    if (locked) return;
    setSelected(kind);
    setState("sent");
    try {
      const res = await fetch("/api/room-magic/reactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ questionId, kind }),
      });
      if (!res.ok) {
        setState("failed");
        return;
      }
      setState("sent");
    } catch {
      setState("failed");
    }
  }

  return (
    <div
      className={className}
      data-testid="room-magic-reaction-controls"
      style={{
        marginTop: 16,
        minHeight: 132,
        padding: "12px",
        borderRadius: 14,
        background: "rgba(14,8,5,.08)",
        border: "1px solid rgba(14,8,5,.14)",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <Eyebrow color="rgba(14,8,5,.56)" size={9}>
          Send a reaction
        </Eyebrow>
        <div
          aria-live="polite"
          style={{
            minWidth: 92,
            textAlign: "right",
            color: state === "failed" ? "rgba(14,8,5,.62)" : t.correct,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {state === "sent" ? "Sent to the room" : state === "failed" ? "Not sent" : ""}
        </div>
      </div>

      <div
        style={{
          marginTop: 10,
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 8,
        }}
      >
        {ROOM_MAGIC_REACTION_KINDS.map((kind) => {
          const isSelected = selected === kind;
          return (
            <button
              key={kind}
              type="button"
              disabled={locked}
              onClick={() => void send(kind)}
              style={{
                minHeight: 42,
                borderRadius: 10,
                border: `1.5px solid ${isSelected ? "#0E0805" : "rgba(14,8,5,.18)"}`,
                background: isSelected ? "#0E0805" : "rgba(255,255,255,.36)",
                color: isSelected ? t.correct : "#0E0805",
                fontFamily: "var(--font-sans)",
                fontSize: 13,
                fontWeight: 800,
                lineHeight: 1,
                cursor: locked ? "default" : "pointer",
                opacity: locked && !isSelected ? 0.48 : 1,
                transition: reducedMotion
                  ? "none"
                  : "background .16s ease, border-color .16s ease, opacity .16s ease",
              }}
            >
              {ROOM_MAGIC_REACTION_LABELS[kind]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
