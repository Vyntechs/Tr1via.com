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
// Query params (`?variant=long-image&theme=september&state=question`):
//   variant — short | long | image | long-image | long-category (default: short)
//   theme   — any ThemeKey                                    (default: house)
//   state   — question | locked                               (default: question)
//
// Not linked from anywhere — accessed directly from validation scripts and
// the dev gallery footer. Excluded from production builds via the `/dev`
// route group's existing convention.

"use client";

import { useSearchParams } from "next/navigation";
import { PlayerLocked, PlayerQuestion } from "@/components/player";
import { ThemeProvider } from "@/components/system";
import { THEME_KEYS, type ThemeKey } from "@/lib/theme/tokens";
import { Suspense } from "react";

const SAMPLE_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='72' viewBox='0 0 72 72'%3E%3Crect width='72' height='72' fill='%2372B8B0'/%3E%3Cpath d='M8 54 27 31l12 14 9-10 16 19Z' fill='%23F3E4C3'/%3E%3C/svg%3E";

// Same 163-char worst-case prompt the prod DB carries.
const LONG_PROMPT =
  "Which work boot company, still operating in Chippewa Falls, Wisconsin, is known for making custom boots to order for specific trades like firefighting and logging?";

const LONG_CATEGORY = "World History: Revolutions and Resistance";

function PreviewBody() {
  const params = useSearchParams();
  const variant = (params.get("variant") ?? "short").toLowerCase();
  const state = (params.get("state") ?? "question").toLowerCase();
  const themeKeyRaw = params.get("theme") ?? "house";
  const themeKey: ThemeKey = (THEME_KEYS as readonly string[]).includes(themeKeyRaw)
    ? (themeKeyRaw as ThemeKey)
    : "house";

  let prompt: string;
  let imageUrl: string | undefined;
  let category = "Geography";
  if (variant === "long" || variant === "long-image") {
    prompt = LONG_PROMPT;
    imageUrl = variant === "long-image" ? SAMPLE_IMAGE : undefined;
  } else if (variant === "image") {
    prompt = "Which U.S. state has the largest land area?";
    imageUrl = SAMPLE_IMAGE;
  } else if (variant === "long-category") {
    prompt = "Which revolution began in 1789?";
    category = LONG_CATEGORY;
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
        {state === "locked" ? (
          <PlayerLocked category={category} />
        ) : (
          <PlayerQuestion prompt={prompt} imageUrl={imageUrl} category={category} />
        )}
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
