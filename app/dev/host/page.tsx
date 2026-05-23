// Internal host gallery. Browse every host-laptop screen at 1280×780, plus
// the two host-phone screens at 380×780. Pick a theme; every screen renders
// inside its own ThemeProvider so the picker drives all of them at once.
//
// Visit at /dev/host in dev.

"use client";

import { useState, type ReactNode } from "react";
import { ThemeProvider, useTheme, Wordmark, Eyebrow } from "@/components/system";
import {
  HostPhoneUpcoming,
  HostPhoneLive,
  HostDashboard,
  HostSetupCategories,
  HostLiveConsole,
} from "@/components/host";
import {
  OnboardingFirstDashboard,
  OnboardingFirstNightDone,
} from "@/components/onboarding";
import { TR1VIA_THEMES, THEME_KEYS, type ThemeKey } from "@/lib/theme/tokens";

interface ScreenEntry {
  key: string;
  title: string;
  Component: React.ComponentType;
}

const LAPTOP_SCREENS: ScreenEntry[] = [
  { key: "dashboard",          title: "01 · Dashboard",                Component: HostDashboard },
  { key: "setup-categories",   title: "02 · Setup · categories",       Component: HostSetupCategories },
  { key: "live-console",       title: "03 · Live console · mid-game",  Component: HostLiveConsole },
  { key: "onboard-dashboard",  title: "04 · Onboarding · first dashboard", Component: OnboardingFirstDashboard },
  { key: "onboard-done",       title: "05 · Onboarding · night one done",  Component: OnboardingFirstNightDone },
];

const PHONE_SCREENS: ScreenEntry[] = [
  { key: "phone-upcoming", title: "06 · Phone · upcoming", Component: HostPhoneUpcoming },
  { key: "phone-live",     title: "07 · Phone · live",     Component: HostPhoneLive },
];

export default function HostGallery() {
  const [themeKey, setThemeKey] = useState<ThemeKey>("house");

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "32px 48px",
        background: "#0E0805",
        color: "#F4E6C4",
        fontFamily: "var(--font-sans)",
      }}
    >
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <GalleryHeader themeKey={themeKey} setThemeKey={setThemeKey} />

        <SectionLabel>HOST LAPTOP · 5 SCREENS</SectionLabel>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 36,
            marginBottom: 56,
          }}
        >
          {LAPTOP_SCREENS.map(({ key, title, Component }) => (
            <LaptopFrame key={key} title={title} themeKey={themeKey}>
              <Component />
            </LaptopFrame>
          ))}
        </div>

        <SectionLabel>HOST PHONE · 2 SCREENS</SectionLabel>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
            gap: 28,
          }}
        >
          {PHONE_SCREENS.map(({ key, title, Component }) => (
            <PhoneFrame key={key} title={title} themeKey={themeKey}>
              <Component />
            </PhoneFrame>
          ))}
        </div>
      </div>
    </main>
  );
}

function GalleryHeader({
  themeKey,
  setThemeKey,
}: {
  themeKey: ThemeKey;
  setThemeKey: (k: ThemeKey) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 32,
        paddingBottom: 18,
        borderBottom: "1px solid rgba(244,230,196,.14)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        {/* Render the wordmark inside its own ThemeProvider so it picks up the
            current gallery theme accent. */}
        <ThemeProvider themeKey={themeKey}>
          <Wordmark size={28} />
        </ThemeProvider>
        <span style={{ width: 1, height: 16, background: "rgba(244,230,196,.2)" }} />
        <Eyebrow color="rgba(244,230,196,.6)" size={11}>
          HOST SURFACE · LAPTOP + PHONE
        </Eyebrow>
      </div>
      <select
        value={themeKey}
        onChange={(e) => setThemeKey(e.target.value as ThemeKey)}
        style={{
          padding: "10px 14px",
          borderRadius: 8,
          border: "1px solid rgba(244,230,196,.2)",
          background: "rgba(244,230,196,.05)",
          color: "#F4E6C4",
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {THEME_KEYS.map((k) => (
          <option
            key={k}
            value={k}
            style={{ background: "#0E0805", color: "#F4E6C4" }}
          >
            {TR1VIA_THEMES[k].name}
          </option>
        ))}
      </select>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <Eyebrow color="rgba(244,230,196,.6)" size={11}>
        {children}
      </Eyebrow>
    </div>
  );
}

// Laptop-shaped 1280×780 box. The component already renders its own macOS
// chrome (LaptopShell has chrome=true by default). We just give it a subtle
// outer frame so the laptop reads as a discrete artifact in the gallery.
function LaptopFrame({
  title,
  themeKey,
  children,
}: {
  title: string;
  themeKey: ThemeKey;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Eyebrow color="rgba(244,230,196,.6)" size={10}>
        {title}
      </Eyebrow>
      <div
        style={{
          width: 1280,
          height: 780,
          maxWidth: "100%",
          borderRadius: 14,
          background: "#0E0805",
          boxShadow:
            "0 30px 60px -20px rgba(0,0,0,.6), 0 0 0 1px rgba(0,0,0,.4) inset",
          overflow: "hidden",
        }}
      >
        <ThemeProvider themeKey={themeKey}>{children}</ThemeProvider>
      </div>
    </div>
  );
}

// iPhone-ish frame — 380×780 viewport with a subtle device chrome so each
// screen reads as a phone, not a card.
function PhoneFrame({
  title,
  themeKey,
  children,
}: {
  title: string;
  themeKey: ThemeKey;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Eyebrow color="rgba(244,230,196,.6)" size={10}>
        {title}
      </Eyebrow>
      <div
        style={{
          width: 380,
          height: 780,
          borderRadius: 44,
          background: "#0E0805",
          padding: 10,
          boxSizing: "border-box",
          border: "1px solid rgba(244,230,196,.16)",
          boxShadow:
            "0 30px 60px -20px rgba(0,0,0,.6), 0 0 0 1px rgba(0,0,0,.4) inset",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Notch */}
        <div
          style={{
            position: "absolute",
            top: 14,
            left: "50%",
            transform: "translateX(-50%)",
            width: 110,
            height: 26,
            borderRadius: 14,
            background: "#000",
            zIndex: 5,
          }}
          aria-hidden="true"
        />
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 36,
            overflow: "hidden",
            position: "relative",
          }}
        >
          <ThemeProvider themeKey={themeKey}>{children}</ThemeProvider>
        </div>
      </div>
    </div>
  );
}
