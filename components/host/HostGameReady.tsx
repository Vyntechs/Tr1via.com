"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTheme } from "@/components/system";
import { readableForeground } from "@/lib/theme/contrast";
import { BOOTSTRAP_TIMEOUT_MS } from "@/lib/realtime/readTimeout";

export interface HostPreflight {
  checks: {
    content: "ready" | "invalid";
    tv: "unknown" | "missing";
    players: "unknown";
    network: "control-path-healthy";
    controls: "ready" | "unavailable";
  };
  canStart: boolean;
  startReason: string | null;
  checkedAt: string;
  elapsedMs: number;
  playerCount: number;
  content: {
    gameId: string | null;
    categoryCount: number;
    expectedCategoryCount: number;
    pickedQuestionCount: number;
    expectedQuestionCount: number;
    reason: string | null;
  };
}

export interface HostGameReadyProps {
  roomCode: string;
  preflight: HostPreflight;
  onCheck: (signal: AbortSignal) => Promise<HostPreflight>;
  onStart: () => void;
  isStarting?: boolean;
  refreshTimeoutMs?: number;
}

export function HostGameReady({
  roomCode,
  preflight,
  onCheck,
  onStart,
  isStarting = false,
  refreshTimeoutMs = BOOTSTRAP_TIMEOUT_MS,
}: HostGameReadyProps) {
  const { t } = useTheme();
  const [refreshed, setRefreshed] = useState<{
    baseCheckedAt: string;
    value: HostPreflight;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const current = refreshed?.baseCheckedAt === preflight.checkedAt
    ? refreshed.value
    : preflight;

  const rows = readinessRows(current);
  const confirmed = rows.filter((row) => row.tone === "confirmed").length;
  const unknown = rows.filter((row) => row.tone === "unknown").length;
  const attention = rows.filter((row) => row.tone === "attention").length;
  const summary = [
    `${confirmed} confirmed`,
    unknown > 0 ? `${unknown} not confirmed` : null,
    attention > 0 ? `${attention} needs attention` : null,
  ].filter(Boolean).join(" · ");

  async function checkAgain() {
    if (checking) return;
    const controller = new AbortController();
    setChecking(true);
    setRefreshMessage("Checking the control path…");
    const timeout = setTimeout(() => controller.abort(), refreshTimeoutMs);
    try {
      const next = await Promise.race([
        onCheck(controller.signal),
        rejectOnAbort(controller.signal),
      ]);
      if (!mounted.current) return;
      setRefreshed({ baseCheckedAt: preflight.checkedAt, value: next });
      setRefreshMessage(`Checked in ${next.elapsedMs} ms · TV and phone delivery still require observations.`);
    } catch {
      if (!mounted.current) return;
      setRefreshMessage(
        controller.signal.aborted
          ? "Check timed out. Try again when the connection settles."
          : "Check failed. The last confirmed facts remain visible.",
      );
    } finally {
      clearTimeout(timeout);
      if (mounted.current) setChecking(false);
    }
  }

  const shellStyle: CSSProperties = {
    color: t.ink,
    background: t.paper,
    minHeight: "100%",
    padding: "clamp(14px, 4vw, 28px)",
    paddingBottom: "max(18px, env(safe-area-inset-bottom))",
    boxSizing: "border-box",
    fontFamily: "var(--font-sans)",
  };
  const panelStyle: CSSProperties = {
    border: `1px solid ${t.line}`,
    borderRadius: 16,
    background: t.surface,
  };

  return (
    <section aria-label="Game Ready preflight" style={shellStyle}>
      <header style={{ marginBottom: 16 }}>
        <p style={{ margin: 0, color: t.accent, fontSize: 10, fontWeight: 900, letterSpacing: ".16em", textTransform: "uppercase" }}>
          Game ready
        </p>
        <h1 style={{ margin: "5px 0 4px", fontFamily: "var(--font-display)", fontSize: "clamp(25px, 7vw, 38px)", lineHeight: 1.02 }}>
          Game 1 is ready for a final check
        </h1>
        <p style={{ margin: 0, color: t.inkMid, fontSize: 13 }}>{summary}</p>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 14, alignItems: "start" }}>
        <section aria-label="Expected venue TV" style={{ ...panelStyle, padding: 12 }}>
          <p style={{ margin: "0 0 8px", color: t.inkMid, fontSize: 11, fontWeight: 800 }}>
            Expected venue TV · not observed
          </p>
          <div
            role="img"
            aria-label="Expected venue TV preview — not observed"
            style={{
              aspectRatio: "16 / 9",
              borderRadius: 10,
              border: `1px solid ${t.line}`,
              background: t.paper,
              color: t.ink,
              display: "grid",
              placeItems: "center",
              textAlign: "center",
              padding: 12,
              boxSizing: "border-box",
            }}
          >
            <div>
              <p style={{ margin: 0, color: t.accent, fontSize: 10, fontWeight: 900, letterSpacing: ".14em" }}>TR1VIA</p>
              <p style={{ margin: "7px 0 2px", fontFamily: "var(--font-display)", fontSize: "clamp(18px, 5vw, 28px)", fontWeight: 900 }}>Waiting for Game 1</p>
              <p style={{ margin: 0, color: t.inkMid, fontSize: 11 }}>Join code {roomCode}</p>
            </div>
          </div>
          <a
            href={`/tv/${roomCode}`}
            target="_blank"
            rel="noreferrer"
            aria-label="Open venue screen"
            style={{
              minWidth: 48,
              minHeight: 48,
              marginTop: 8,
              padding: "0 12px",
              border: `1px solid ${t.line}`,
              borderRadius: 10,
              color: t.accent,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxSizing: "border-box",
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            Open venue screen ↗
          </a>
        </section>

        <section aria-label="Readiness checks" style={{ ...panelStyle, overflow: "hidden" }}>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {rows.map((row, index) => (
              <li
                key={row.label}
                style={{
                  minHeight: 54,
                  padding: "10px 12px",
                  borderTop: index === 0 ? undefined : `1px solid ${t.lineSoft}`,
                  display: "grid",
                  gridTemplateColumns: "18px minmax(0, 1fr)",
                  gap: 9,
                  alignItems: "start",
                  boxSizing: "border-box",
                }}
              >
                <span aria-hidden="true" style={{ color: row.tone === "confirmed" ? t.correct : row.tone === "attention" ? t.wrong : t.inkMute, fontWeight: 900 }}>
                  {row.tone === "confirmed" ? "✓" : row.tone === "attention" ? "!" : "?"}
                </span>
                <div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 800 }}>{row.label}</p>
                  <p style={{ margin: "2px 0 0", color: t.inkMid, fontSize: 11, lineHeight: 1.35 }}>{row.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {current.startReason && (
        <p id="game-ready-blocker" role="alert" style={{ margin: "12px 0 0", color: t.wrong, fontSize: 12, fontWeight: 750 }}>
          {current.startReason}
        </p>
      )}
      {refreshMessage && (
        <p
          role={refreshMessage.includes("failed") || refreshMessage.includes("timed out") ? "alert" : "status"}
          style={{ margin: "12px 0 0", color: t.inkMid, fontSize: 11 }}
        >
          {refreshMessage}
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: 10, marginTop: 14 }}>
        <button
          type="button"
          onClick={() => void checkAgain()}
          disabled={checking || isStarting}
          style={buttonStyle(t.surfaceH, t.ink, t.line)}
        >
          {checking ? "Checking TV & phones…" : "Check TV & phones"}
        </button>
        <button
          type="button"
          onClick={onStart}
          disabled={!current.canStart || checking || isStarting}
          aria-describedby={!current.canStart && current.startReason ? "game-ready-blocker" : undefined}
          style={{
            ...buttonStyle(t.accent, readableForeground(t.accent), t.accent),
            opacity: !current.canStart || checking || isStarting ? 0.48 : 1,
          }}
        >
          {isStarting ? "Starting Game 1…" : "Start Game 1"}
        </button>
      </div>
    </section>
  );
}

type RowTone = "confirmed" | "unknown" | "attention";

function readinessRows(preflight: HostPreflight): Array<{ label: string; detail: string; tone: RowTone }> {
  return [
    {
      label: preflight.checks.content === "ready"
        ? "Saved Game 1 content is complete"
        : "Game 1 content needs attention",
      detail: `${preflight.content.pickedQuestionCount} of ${preflight.content.expectedQuestionCount} picked questions are complete.`,
      tone: preflight.checks.content === "ready" ? "confirmed" : "attention",
    },
    {
      label: preflight.checks.tv === "missing" ? "Venue TV surface unavailable" : "Venue TV not confirmed",
      detail: preflight.checks.tv === "missing"
        ? "Open a valid venue TV surface before starting."
        : "No TV browser observation exists yet; the preview is only expected state.",
      tone: preflight.checks.tv === "missing" ? "attention" : "unknown",
    },
    {
      label: preflight.playerCount === 0
        ? "No players joined · rehearsal is allowed"
        : `${preflight.playerCount} joined · phone delivery not confirmed`,
      detail: "Joined count comes from the database; browser delivery is not observed.",
      tone: "unknown",
    },
    {
      label: "Server round-trip healthy · venue Wi-Fi not measured",
      detail: `Authenticated control-path check completed in ${preflight.elapsedMs} ms.`,
      tone: "confirmed",
    },
    {
      label: preflight.checks.controls === "ready"
        ? "Control path and database responded"
        : "Game controls are unavailable",
      detail: preflight.checks.controls === "ready"
        ? "Host ownership and the read-only Game 1 query succeeded."
        : "This trivia night is closed, so Game 1 cannot be started.",
      tone: preflight.checks.controls === "ready" ? "confirmed" : "attention",
    },
  ];
}

function buttonStyle(background: string, color: string, borderColor: string): CSSProperties {
  return {
    minWidth: 48,
    minHeight: 48,
    padding: "0 16px",
    border: `1px solid ${borderColor}`,
    borderRadius: 12,
    background,
    color,
    font: "inherit",
    fontSize: 13,
    fontWeight: 900,
    cursor: "pointer",
  };
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
}
