// HOST · GENERATE · 1. OVERVIEW
// Linda has just opened the setup workspace. Two games tonight. Game 1 has
// 4 of 6 categories ready; Game 2 is still empty. Big focus on "ready in 00:38".

"use client";

import {
  Display,
  Eyebrow,
  Numeric,
  ThemeProvider,
  useTheme,
} from "@/components/system";
import { LaptopShell } from "@/components/shells";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface HostGenOverviewProps {
  themeKey?: ThemeKey;
}

interface CategorySlotData {
  name: string;
  status: "locked" | "review" | "idle" | "empty";
  picked?: number;
  generated?: number;
  warn?: string;
}

export function HostGenOverview({ themeKey }: HostGenOverviewProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostGenOverviewInner />
      </ThemeProvider>
    );
  }
  return <HostGenOverviewInner />;
}

function HostGenOverviewInner() {
  const { t } = useTheme();
  const game1: CategorySlotData[] = [
    { name: "Geography",    status: "locked",  picked: 7 },
    { name: "Music",        status: "locked",  picked: 7 },
    { name: "Animals",      status: "locked",  picked: 7 },
    { name: "Pixar Movies", status: "review",  picked: 4, generated: 20 },
    { name: "Food",         status: "idle",    warn: "You ran this on May 14." },
    { name: "",             status: "empty" },
  ];
  const game2: CategorySlotData[] = [
    { name: "History",      status: "locked",  picked: 7 },
    { name: "",             status: "empty" },
    { name: "",             status: "empty" },
    { name: "",             status: "empty" },
    { name: "",             status: "empty" },
    { name: "",             status: "empty" },
  ];
  return (
    <LaptopShell title="set up tonight · soul fire pizza">
      <div style={{ padding: "32px 56px", display: "grid", gridTemplateColumns: "1fr 300px", gap: 36, flex: 1, overflow: "hidden" }}>
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Eyebrow color={t.accent} size={11}>TONIGHT · WED MAY 27</Eyebrow>
          <Display size={48} color={t.ink} style={{ marginTop: 8, display: "block" }} tracking={-0.025}>
            Two games. Twelve topics.
          </Display>
          <div style={{ marginTop: 8, color: t.inkMid, fontSize: 14.5, lineHeight: 1.45, maxWidth: 600 }}>
            Type a topic. We pull 20 fresh questions; you pick the seven for the board. Difficulty sorts itself.
          </div>

          <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 24, overflow: "auto", paddingRight: 8 }}>
            {[{ label: "GAME 1 · 7:00 PM", rows: game1 },
              { label: "GAME 2 · 7:55 PM", rows: game2 }].map((g) => (
              <div key={g.label}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
                  <Eyebrow color={t.inkMid} size={10}>{g.label}</Eyebrow>
                  <span style={{ fontSize: 12, color: t.inkMute }}>
                    {g.rows.filter((r) => r.status === "locked").length} of 6 ready
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                  {g.rows.map((c, i) => <CategorySlot key={i} c={c} idx={i} />)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ padding: "22px 24px", borderRadius: 16, background: t.accent, color: "#0E0805" }}>
            <Eyebrow color="rgba(14,8,5,.7)" size={10}>READY IN</Eyebrow>
            <Numeric size={56} weight={700} color="#0E0805" tracking={-0.04} style={{ display: "block", marginTop: 4, lineHeight: 1 }}>00:38</Numeric>
            <div style={{ marginTop: 12, height: 4, borderRadius: 99, background: "rgba(14,8,5,.2)", overflow: "hidden" }}>
              <div style={{ width: "47%", height: "100%", background: "#0E0805" }} />
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: "rgba(14,8,5,.7)" }}>5 of 12 categories locked.</div>
          </div>

          <div style={{ padding: "16px 18px", borderRadius: 14, border: `1px solid ${t.line}` }}>
            <Eyebrow color={t.inkMute} size={10}>OPTIONAL · LET THE ROOM PICK</Eyebrow>
            <div style={{ marginTop: 8, fontSize: 14, color: t.ink, fontWeight: 600, letterSpacing: "-0.005em" }}>Open audience vote</div>
            <div style={{ marginTop: 4, fontSize: 12, color: t.inkMid, lineHeight: 1.45 }}>~2 min. Majority wins. Players pick tonight&apos;s topics from their phones.</div>
          </div>

          <div style={{ padding: "16px 18px", borderRadius: 14, background: t.surface }}>
            <Eyebrow color={t.inkMute} size={10}>SUGGESTED BY THE ROOM</Eyebrow>
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { name: "Disney Pixar movies", count: 8 },
                { name: "NFL teams", count: 6 },
                { name: "Madison local history", count: 4 },
                { name: "2000s pop songs", count: 3 },
              ].map((s) => (
                <div key={s.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, color: t.ink, fontWeight: 500 }}>{s.name}</span>
                  <Numeric size={12} color={t.inkMid}>{s.count}</Numeric>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </LaptopShell>
  );
}

function CategorySlot({ c, idx }: { c: CategorySlotData; idx: number }) {
  const { t } = useTheme();
  const cc = c.name ? categoryColor(c.name, t.accent) : t.line;
  if (c.status === "empty") {
    return (
      <div style={{
        padding: "14px 16px", borderRadius: 12,
        border: `1px dashed ${t.line}`, background: "transparent",
        cursor: "pointer", minHeight: 96,
        display: "flex", flexDirection: "column", justifyContent: "space-between",
      }}>
        <Eyebrow color={t.inkMute} size={9}>SLOT {idx + 1}</Eyebrow>
        <div style={{ fontSize: 14, color: t.inkMute, fontWeight: 500 }}>+  add a topic</div>
      </div>
    );
  }
  const statusLabel =
    c.status === "locked"
      ? `${c.picked} picked`
      : c.status === "review"
      ? `pick 7 of ${c.generated}`
      : "not started";
  const statusColor =
    c.status === "locked" ? t.correct : c.status === "review" ? t.accent : t.inkMute;
  return (
    <div style={{
      padding: "14px 16px", borderRadius: 12,
      background: c.status === "review" ? (t.dark ? `${cc}14` : `${cc}11`) : "transparent",
      border: `1.5px solid ${c.status === "review" ? cc : t.line}`,
      minHeight: 96, display: "flex", flexDirection: "column", justifyContent: "space-between",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: cc }} />
        <Eyebrow color={t.inkMid} size={9}>SLOT {idx + 1}</Eyebrow>
      </div>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: t.ink, letterSpacing: "-0.005em" }}>{c.name}</div>
        {c.warn && <div style={{ marginTop: 4, fontSize: 11, color: t.wrong }}>{c.warn}</div>}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: statusColor, fontWeight: 600, letterSpacing: "0.06em" }}>{statusLabel.toUpperCase()}</span>
        {c.status !== "locked" && (
          <span style={{ fontSize: 11, color: t.inkMid, fontWeight: 600 }}>
            {c.status === "review" ? "continue →" : "generate →"}
          </span>
        )}
      </div>
    </div>
  );
}
