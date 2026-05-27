// Full-viewport preview of a single PlayerQuestion variant. Unlike the
// /dev/player gallery — which renders inside a fixed 380×780 phone frame —
// this route fills the actual browser viewport so a device-emulation tool
// (Playwright with viewport={iPhone SE 375×667}) sees exactly what the
// player sees on their phone.
//
// Why this exists: validating that the question text fits without
// truncation on iPhone SE requires rendering inside an *actual* 667px-tall
// viewport, not a 780px gallery frame. Without this route we'd be testing
// the wrong layout.
//
// Query params (`?variant=long&theme=storm`):
//   variant — short | long | image       (default: short)
//   theme   — any ThemeKey                (default: house)
//
// Not linked from anywhere — accessed directly from validation scripts and
// the dev gallery footer. Excluded from production builds via the `/dev`
// route group's existing convention.

"use client";

import { useSearchParams } from "next/navigation";
import { PlayerQuestion } from "@/components/player";
import { ThemeProvider } from "@/components/system";
import { THEME_KEYS, type ThemeKey } from "@/lib/theme/tokens";
import { Suspense } from "react";

const SAMPLE_IMAGE =
  "https://images.pexels.com/photos/1366630/pexels-photo-1366630.jpeg?auto=compress&cs=tinysrgb&w=200";

// Same 163-char worst-case prompt the prod DB carries.
const LONG_PROMPT =
  "Which work boot company, still operating in Chippewa Falls, Wisconsin, is known for making custom boots to order for specific trades like firefighting and logging?";

function PreviewBody() {
  const params = useSearchParams();
  const variant = (params.get("variant") ?? "short").toLowerCase();
  const themeKeyRaw = params.get("theme") ?? "house";
  const themeKey: ThemeKey = (THEME_KEYS as readonly string[]).includes(themeKeyRaw)
    ? (themeKeyRaw as ThemeKey)
    : "house";

  let prompt: string;
  let imageUrl: string | undefined;
  if (variant === "long") {
    prompt = LONG_PROMPT;
  } else if (variant === "image") {
    prompt = "Which U.S. state has the largest land area?";
    imageUrl = SAMPLE_IMAGE;
  } else {
    prompt = "Which U.S. state has the largest land area?";
  }

  return (
    <ThemeProvider themeKey={themeKey}>
      <div
        style={{
          // Match the real player layout exactly — 100dvh on the device
          // viewport, no gallery chrome.
          width: "100vw",
          height: "100dvh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <PlayerQuestion prompt={prompt} imageUrl={imageUrl} />
      </div>
    </ThemeProvider>
  );
}

export default function PlayerQuestionPreview() {
  return (
    <Suspense fallback={null}>
      <PreviewBody />
    </Suspense>
  );
}
