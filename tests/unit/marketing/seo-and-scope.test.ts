// Marketing SEO regression guard.
//
// NOTE: This file also used to hold a "Heather-safe scope guard" that failed if
// any host/player/TV/API/lib/component file changed (measured vs the
// `marketing-base` git tag, or the working tree when the tag was absent). That
// guard existed only to keep the *marketing pass* from touching Heather's live
// runtime surface. The marketing pass has since merged, and follow-up work now
// intentionally edits the host surface (e.g. the host-flow mobile-responsive
// pass), so the deny-list guard was retired — it flagged exactly the work it
// was no longer meant to police (see lesson
// `marketing-scope-guard-tag-blocks-backend-work`). The SEO checks below are
// the durable part and stay.

import { describe, it, expect } from "vitest";

describe("marketing pass · SEO must not regress", () => {
  it("the hub keeps its canonical URL, title, description, and keyword targeting", async () => {
    const { metadata } = await import("@/app/(marketing)/trivia-night/page");
    expect(metadata.alternates?.canonical).toBe("https://tr1via.com/trivia-night");
    expect(metadata.title).toBe("Host a live trivia night — free");
    expect((metadata.description as string)).toMatch(/nobody can cheat/i);
    expect(metadata.keywords).toContain("free trivia night software");
    expect((metadata.openGraph as { url?: string })?.url).toBe("https://tr1via.com/trivia-night");
  });

  it("/pricing keeps its own canonical + FAQ-friendly metadata", async () => {
    const { metadata } = await import("@/app/(marketing)/pricing/page");
    expect(metadata.alternates?.canonical).toBe("https://tr1via.com/pricing");
    expect((metadata.description as string)).toMatch(/\$4\.99/);
  });
});
