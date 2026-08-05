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
// Query params (`?variant=long&theme=storm&options=long`):
//   variant — short | long | image       (default: short)
//   theme   — any ThemeKey                (default: house)
//   options — short | long                (default: short)
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

// Worst-case answer options — long enough to wrap to 3 lines on a 360px
// phone, which is what pushed the 4th answer off the bottom of an Android
// screen during the 7/29 show (issue #171). Any layout that keeps all four
// of these reachable keeps the real prod distribution reachable too.
const LONG_OPTIONS: [string, string, string, string] = [
  "Red Wing Shoe Company, founded in Red Wing, Minnesota in 1905",
  "The Chippewa Boot Company, still hand-lasting boots in Wisconsin",
  "Danner Boots of Portland, Oregon, known for wildland firefighting",
  "Thorogood, made by the Weinbrenner Shoe Company since 1892",
];

function PreviewBody() {
  const params = useSearchParams();
  const variant = (params.get("variant") ?? "short").toLowerCase();
  const themeKeyRaw = params.get("theme") ?? "house";
  const themeKey: ThemeKey = (THEME_KEYS as readonly string[]).includes(themeKeyRaw)
    ? (themeKeyRaw as ThemeKey)
    : "house";

  const options =
    (params.get("options") ?? "short").toLowerCase() === "long" ? LONG_OPTIONS : undefined;

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
        <PlayerQuestion prompt={prompt} imageUrl={imageUrl} options={options} />
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
