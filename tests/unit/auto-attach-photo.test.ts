import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneratedQuestion } from "@/lib/ai/generate-questions";
import type { PexelsPhoto } from "@/lib/pexels/search";

const searchPexels = vi.hoisted(() => vi.fn());

vi.mock("@/lib/pexels/search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pexels/search")>()),
  searchPexels,
}));

import { autoAttachPhoto } from "@/lib/ai/auto-attach-photo";

const question: GeneratedQuestion = {
  prompt: "Which television format debuted first?",
  options: ["A", "B", "C", "D"],
  correctIndex: 0,
  difficulty: 4,
  factBlurb: "A verified television fact.",
  photoQuery: "television studio",
};

function photo(id: number): PexelsPhoto {
  return {
    id,
    url: `https://pexels.example/photos/${id}`,
    src: {
      medium: `https://images.example/${id}-medium.jpg`,
      large: `https://images.example/${id}-large.jpg`,
      large2x: `https://images.example/${id}-large2x.jpg`,
      original: `https://images.example/${id}-original.jpg`,
    },
    photographer: `Photographer ${id}`,
    photographer_url: `https://pexels.example/@photographer-${id}`,
    alt: `Complete photo ${id}`,
  };
}

describe("autoAttachPhoto image exclusions", () => {
  beforeEach(() => {
    searchPexels.mockReset();
  });

  it("selects the first unused photo and omits excluded photos from alternatives", async () => {
    const excluded = photo(1);
    const selected = photo(2);
    searchPexels.mockResolvedValueOnce([excluded, selected]);

    await expect(
      autoAttachPhoto(question, {
        topic: "Television",
        excludeImageUrls: new Set([excluded.src.large2x]),
      }),
    ).resolves.toEqual({
      imageUrl: selected.src.large2x,
      attribution: "Photo by Photographer 2 on Pexels",
      alternatives: [],
      source: "primary",
    });
  });

  it("cascades to the topic when every primary result is excluded", async () => {
    const excluded = photo(1);
    const topicPhoto = photo(3);
    searchPexels
      .mockResolvedValueOnce([excluded])
      .mockResolvedValueOnce([topicPhoto]);

    const result = await autoAttachPhoto(question, {
      topic: "Television",
      excludeImageUrls: new Set([excluded.src.large2x]),
    });

    expect(result).toMatchObject({
      imageUrl: topicPhoto.src.large2x,
      source: "topic",
    });
    expect(searchPexels.mock.calls).toEqual([
      ["television studio", 12],
      ["Television", 12],
    ]);
  });

  it("does not repeat equivalent primary and topic searches", async () => {
    searchPexels.mockResolvedValue([]);

    await autoAttachPhoto(
      { ...question, photoQuery: " Television " },
      { topic: "Television" },
    );

    expect(searchPexels.mock.calls).toEqual([
      ["Television", 12],
      ["abstract texture", 12],
    ]);
  });

  it("returns no image when every fallback contains only excluded URLs", async () => {
    const excluded = photo(1);
    searchPexels.mockResolvedValue([excluded]);

    await expect(
      autoAttachPhoto(question, {
        topic: "Television",
        excludeImageUrls: new Set([excluded.src.large2x]),
      }),
    ).resolves.toEqual({
      imageUrl: null,
      attribution: null,
      alternatives: [],
    });
    expect(searchPexels).toHaveBeenCalledTimes(3);
  });
});
