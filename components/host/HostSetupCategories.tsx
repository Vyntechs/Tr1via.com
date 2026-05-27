// HOST LAPTOP — TOPIC SETUP. Type a topic, see warnings, flavor buttons, then
// generate. Goal: 60 seconds, zero prep.

"use client";

import { LaptopShell } from "@/components/shells";
import { Eyebrow, Numeric, ThemeProvider, useTheme } from "@/components/system";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface HostSetupCategoriesProps {
  themeKey?: ThemeKey;
}

export function HostSetupCategories({ themeKey }: HostSetupCategoriesProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostSetupCategoriesInner />
      </ThemeProvider>
    );
  }
  return <HostSetupCategoriesInner />;
}

interface CatRow {
  name: string;
  status: "ready" | "review" | "idle";
  count: number;
  warn: string | null;
}

function HostSetupCategoriesInner() {
  const { t } = useTheme();
  const cats: CatRow[] = [
    { name: "Geography", status: "ready", count: 7, warn: null },
    { name: "Music", status: "ready", count: 7, warn: null },
    { name: "Animals", status: "ready", count: 7, warn: null },
    { name: "Food", status: "review", count: 20, warn: null },
    { name: "Movies", status: "idle", count: 0, warn: "Used last week — May 21." },
    { name: "90s nostalgia", status: "idle", count: 0, warn: null },
  ];

  return (
    <LaptopShell>
      <div
        style={{
          padding: "36px 56px",
          display: "grid",
          gridTemplateColumns: "1fr 320px",
          gap: 36,
          flex: 1,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Eyebrow color={t.accent} size={11}>
            GAME 1 · CATEGORIES
          </Eyebrow>
          <div
            style={{
              marginTop: 8,
              fontSize: 38,
              fontWeight: 500,
              letterSpacing: "-0.025em",
              color: t.ink,
              lineHeight: 1.05,
            }}
          >
            Six topics, seven questions each.
          </div>
          <div
            style={{
              marginTop: 10,
              color: t.inkMid,
              fontSize: 15,
              maxWidth: 540,
            }}
          >
            Type a topic. We&apos;ll generate twenty questions; you pick the seven that make the
            board. Every question is rated easiest to hardest automatically.
          </div>

          <div
            style={{
              marginTop: 28,
              flex: 1,
              overflow: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {cats.map((c, i) => (
              <div
                key={c.name || `idx-${i}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "32px 1fr auto auto",
                  alignItems: "center",
                  gap: 18,
                  padding: "16px 18px",
                  borderRadius: 12,
                  background:
                    c.status === "review"
                      ? t.dark
                        ? "rgba(255,255,255,.06)"
                        : "rgba(20,19,15,.03)"
                      : "transparent",
                  border: `1px solid ${c.status === "review" ? t.accent : t.line}`,
                }}
              >
                <Numeric size={14} color={t.inkMid}>
                  {i + 1}
                </Numeric>
                <div>
                  <div
                    style={{
                      fontSize: 17,
                      fontWeight: 500,
                      color: t.ink,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {c.name ? (
                      c.name
                    ) : (
                      <span style={{ color: t.inkMute }}>add a topic…</span>
                    )}
                  </div>
                  {c.warn && (
                    <div style={{ marginTop: 4, fontSize: 12, color: t.wrong }}>
                      ⚠ {c.warn}
                    </div>
                  )}
                </div>
                <Eyebrow
                  color={
                    c.status === "ready"
                      ? t.correct
                      : c.status === "review"
                        ? t.accent
                        : t.inkMute
                  }
                  size={10}
                >
                  {c.status === "ready"
                    ? "7 picked"
                    : c.status === "review"
                      ? "pick 7 of 20"
                      : "not started"}
                </Eyebrow>
                <button
                  style={{
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: `1px solid ${t.line}`,
                    background: c.status === "review" ? t.accent : "transparent",
                    color:
                      c.status === "review" ? (t.dark ? "#0E0E0C" : "#FFF") : t.ink,
                    fontSize: 12,
                    fontWeight: 500,
                    fontFamily: "var(--font-sans)",
                    cursor: "pointer",
                  }}
                >
                  {c.status === "ready"
                    ? "Review"
                    : c.status === "review"
                      ? "Continue"
                      : "Generate"}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              padding: "20px 22px",
              borderRadius: 14,
              background: t.dark
                ? "rgba(255,255,255,.04)"
                : "rgba(20,19,15,.03)",
            }}
          >
            <Eyebrow color={t.inkMute} size={10}>
              READY IN
            </Eyebrow>
            <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 8 }}>
              <Numeric
                size={36}
                weight={500}
                color={t.ink}
                style={{ letterSpacing: "-0.02em" }}
              >
                00:38
              </Numeric>
            </div>
            <Eyebrow color={t.inkMute} size={10}>
              4 of 6 done
            </Eyebrow>
            <div
              style={{
                marginTop: 8,
                height: 4,
                borderRadius: 99,
                background: t.line,
                overflow: "hidden",
              }}
            >
              <div style={{ width: "66%", height: "100%", background: t.accent }} />
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <Eyebrow color={t.inkMute} size={10}>
              OPTIONAL · LET THE ROOM VOTE
            </Eyebrow>
            <div
              style={{
                marginTop: 10,
                padding: "14px 16px",
                borderRadius: 12,
                border: `1px dashed ${t.line}`,
              }}
            >
              <div style={{ fontSize: 14, color: t.ink, fontWeight: 500 }}>
                Open audience vote
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 12,
                  color: t.inkMid,
                  lineHeight: 1.4,
                }}
              >
                Players pick tonight&apos;s topics from their phones. ~2 min. Majority wins.
              </div>
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <Eyebrow color={t.inkMute} size={10}>
              TOP SUGGESTIONS FROM PLAYERS
            </Eyebrow>
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
              {[
                { name: "Disney Pixar movies", count: 8 },
                { name: "NFL teams", count: 6 },
                { name: "Local Madison history", count: 4 },
                { name: "2000s pop songs", count: 3 },
              ].map((s) => (
                <div
                  key={s.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 0",
                    borderBottom: `1px solid ${t.lineSoft}`,
                  }}
                >
                  <span style={{ fontSize: 13, color: t.ink, fontWeight: 500 }}>
                    {s.name}
                  </span>
                  <Numeric size={12} color={t.inkMid}>
                    {s.count}
                  </Numeric>
                </div>
              ))}
            </div>
          </div>

          <button
            style={{
              marginTop: "auto",
              background: t.accent,
              color: t.dark ? "#0E0E0C" : "#FFF",
              border: "none",
              borderRadius: 12,
              padding: "16px 0",
              fontSize: 15,
              fontWeight: 600,
              fontFamily: "var(--font-sans)",
              cursor: "pointer",
              opacity: 0.55,
            }}
          >
            Open Game 1 to the room{" "}
            <span style={{ opacity: 0.7, fontFamily: "var(--font-mono)", fontSize: 11 }}>
              · finish picks first
            </span>
          </button>
        </div>
      </div>
    </LaptopShell>
  );
}
