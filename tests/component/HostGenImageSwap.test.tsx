// HostGenImageSwap — the photo picker rendered after the host taps
// "Swap image →" from the edit modal. Each tile delegates to StockImage,
// which renders an <img> only when `src` is a non-empty string. The bug
// these tests guard: the Pexels URL was being passed to the `seed` prop
// instead of `src`, so every tile fell back to the striped gradient and
// the host saw 12 placeholders instead of 12 real photos.

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import {
  HostGenImageSwap,
  type HostGenPhotoCandidate,
} from "@/components/host/gen/HostGenImageSwap";

afterEach(() => cleanup());

const REAL_PEXELS: HostGenPhotoCandidate[] = [
  { id: "pexels-1", url: "https://images.pexels.com/photos/1111/photo.jpeg" },
  { id: "pexels-2", url: "https://images.pexels.com/photos/2222/photo.jpeg" },
  { id: "pexels-3", url: "https://images.pexels.com/photos/3333/photo.jpeg" },
  { id: "pexels-4", url: "https://images.pexels.com/photos/4444/photo.jpeg" },
];

describe("HostGenImageSwap", () => {
  it("renders an <img> per candidate with the Pexels URL as src (not seed)", () => {
    const { container } = render(
      <HostGenImageSwap
        themeKey="house"
        topic="Test"
        prompt="What is the synchromesh?"
        pointValue={400}
        currentImageUrl={null}
        candidates={REAL_PEXELS}
      />,
    );

    // One <img> per candidate in the grid + one for the preview rail
    // (which falls back to the first candidate when nothing is selected).
    const imgs = Array.from(container.querySelectorAll("img"));
    const candidateSrcs = imgs.map((i) => i.getAttribute("src"));

    for (const c of REAL_PEXELS) {
      expect(
        candidateSrcs,
        `expected to find <img src="${c.url}"> for candidate ${c.id}`,
      ).toContain(c.url);
    }
  });

  it("preview rail renders an <img> with the selected/current/first-candidate URL", () => {
    const { container } = render(
      <HostGenImageSwap
        themeKey="house"
        topic="Test"
        prompt="What is the synchromesh?"
        pointValue={400}
        currentImageUrl="https://images.pexels.com/photos/9999/current.jpeg"
        candidates={REAL_PEXELS}
      />,
    );

    const srcs = Array.from(container.querySelectorAll("img"))
      .map((i) => i.getAttribute("src"))
      .filter((s): s is string => s !== null);

    // currentImageUrl wins for the preview rail when nothing is selected.
    expect(srcs).toContain("https://images.pexels.com/photos/9999/current.jpeg");
  });

  it("falls back to the seeded gradient when a candidate has an empty url (demo + broken-pexels case)", () => {
    const { container } = render(
      <HostGenImageSwap
        themeKey="house"
        topic="Test"
        prompt="demo"
        pointValue={100}
        currentImageUrl={null}
        candidates={[
          { id: "no-url-1", url: "" },
          { id: "no-url-2", url: "" },
        ]}
      />,
    );

    // Empty-url candidates must NOT produce <img> tags — they should be
    // rendered as the gradient placeholder so the host doesn't see broken
    // browser-icon placeholders.
    const imgs = Array.from(container.querySelectorAll("img"));
    const candidateSrcs = imgs.map((i) => i.getAttribute("src")).filter(Boolean);
    expect(candidateSrcs).toHaveLength(0);
  });
});
