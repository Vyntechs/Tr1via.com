// Internal gallery for the host's question-generation flow. Each of the 10
// screens renders inside a 1280×780 laptop-sized box (the production target
// for the host's MacBook viewport). A single theme picker controls all
// screens at once, driven by the root <ThemeProvider> in app/layout.tsx.
//
// Also pins the chosen lock-in choreography below for cross-referencing
// against the host flow.

"use client";

import type { ReactNode } from "react";
import { useTheme, Wordmark, Eyebrow } from "@/components/system";
import { TR1VIA_THEMES, THEME_KEYS, type ThemeKey } from "@/lib/theme/tokens";
import {
  HostGenOverview,
  HostGenTopicEntry,
  HostGenLoading,
  HostGenPick,
  HostGenEdit,
  HostGenImageSwap,
  HostGenImageUpload,
  HostGenImageUploadReady,
  HostGenFlavor,
  HostGenLaunch,
} from "@/components/host/gen";
import { LockInPileUp } from "@/components/tv/lockin";

interface Screen {
  step: string;
  title: string;
  note: string;
  render: () => ReactNode;
}

export default function HostGenGallery() {
  const { themeKey, setThemeKey, t } = useTheme();

  // Each screen mirrors a step in Linda's loop. Workflow order matches the
  // build plan's Phase 2.5/2.6 sequence.
  const screens: Screen[] = [
    {
      step: "1",
      title: "Overview",
      note: "Both games at a glance. 5 of 12 categories locked.",
      render: () => <HostGenOverview />,
    },
    {
      step: "2",
      title: "Topic entry",
      note: "Typing a topic. Repeat warning + flavor settings.",
      render: () => <HostGenTopicEntry />,
    },
    {
      step: "3",
      title: "Loading",
      note: "Pulling 20 questions; photos match in a second stream.",
      render: () => <HostGenLoading />,
    },
    {
      step: "4",
      title: "Pick 7 of 20",
      note: "Picking the seven for the board; sidebar fills as she picks.",
      render: () => <HostGenPick />,
    },
    {
      step: "5",
      title: "Edit",
      note: "Inline panel for editing a single question.",
      render: () => <HostGenEdit />,
    },
    {
      step: "6",
      title: "Image swap",
      note: "12 alternative photos to swap from the library.",
      render: () => <HostGenImageSwap />,
    },
    {
      step: "6b",
      title: "Image upload · idle",
      note: "Drop zone or paste-URL — empty state.",
      render: () => <HostGenImageUpload state="idle" />,
    },
    {
      step: "6b",
      title: "Image upload · uploading",
      note: "Same surface, mid-upload. Shimmer + progress.",
      render: () => <HostGenImageUpload state="uploading" />,
    },
    {
      step: "6c",
      title: "Image upload · ready",
      note: "Uploaded photo, crop frame + use.",
      render: () => <HostGenImageUploadReady />,
    },
    {
      step: "7",
      title: "Flavor re-pull",
      note: "Sharper applied. Picks kept, others dissolving.",
      render: () => <HostGenFlavor />,
    },
    {
      step: "8",
      title: "Launch",
      note: "Both boards ready, room about to open.",
      render: () => <HostGenLaunch />,
    },
  ];

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "32px 48px 96px",
        background: t.paper,
        color: t.ink,
        fontFamily: "var(--font-sans)",
      }}
    >
      <div style={{ maxWidth: 1440, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Wordmark size={36} />
            <span style={{ width: 1, height: 22, background: t.line }} />
            <Eyebrow color={t.inkMid} size={12}>HOST · QUESTION GENERATION FLOW</Eyebrow>
          </div>
          <select
            value={themeKey}
            onChange={(e) => setThemeKey(e.target.value as ThemeKey)}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: `1px solid ${t.line}`,
              background: t.surface,
              color: t.ink,
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {THEME_KEYS.map((k) => (
              <option key={k} value={k} style={{ background: t.paper, color: t.ink }}>
                {TR1VIA_THEMES[k].name}
              </option>
            ))}
          </select>
        </div>

        <p style={{ maxWidth: 720, fontSize: 14, color: t.inkMid, lineHeight: 1.5, marginTop: 0, marginBottom: 36 }}>
          Linda&apos;s most-frequent loop: open the app, type 6 topics, pick 7 questions per topic.
          Target: 60 seconds total, zero prep beforehand. Each frame below is the laptop&apos;s
          1280×780 viewport.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 56 }}>
          {screens.map((s, i) => (
            <ScreenCard key={`${s.step}-${i}`} step={s.step} title={s.title} note={s.note}>
              {s.render()}
            </ScreenCard>
          ))}
        </div>

        <div style={{ marginTop: 96 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
            <Eyebrow color={t.inkMid} size={12}>TV · LOCK-IN CHOREOGRAPHY · CHOSEN VARIANT</Eyebrow>
          </div>
          <p style={{ maxWidth: 720, fontSize: 14, color: t.inkMid, lineHeight: 1.5, marginTop: 0, marginBottom: 24 }}>
            The pile-up. Each name tile drops in like a card on a table — weighty, not bouncy.
            Driven by a <code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>tiles</code> prop so
            it&apos;ll later read from live data; the gallery uses the 21-name demo roster.
          </p>
          <ScreenCard step="LIVE" title="Lock-in · pile-up" note="A · NAMES STACK UP" widescreen>
            <LockInPileUp />
          </ScreenCard>
        </div>
      </div>
    </main>
  );
}

function ScreenCard({
  step,
  title,
  note,
  children,
  widescreen = false,
}: {
  step: string;
  title: string;
  note: string;
  children: ReactNode;
  widescreen?: boolean;
}) {
  const { t } = useTheme();
  // Host laptop: 1280×780. TV: 16:9 (1280×720). Both honored by the wrapper.
  const width = 1280;
  const height = widescreen ? 720 : 780;
  return (
    <section>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <Eyebrow color={t.accent} size={11}>STEP {step}</Eyebrow>
          <span style={{ fontSize: 15, color: t.ink, fontWeight: 600, letterSpacing: "-0.005em" }}>{title}</span>
        </div>
        <span style={{ fontSize: 12, color: t.inkMute }}>{note}</span>
      </div>
      <div
        style={{
          width,
          height,
          maxWidth: "100%",
          margin: "0 auto",
          borderRadius: 16,
          overflow: "hidden",
          border: `1px solid ${t.line}`,
          boxShadow: t.dark
            ? "0 20px 60px -20px rgba(0,0,0,.6)"
            : "0 20px 60px -20px rgba(27,19,12,.18)",
          background: t.paper,
        }}
      >
        {children}
      </div>
    </section>
  );
}
