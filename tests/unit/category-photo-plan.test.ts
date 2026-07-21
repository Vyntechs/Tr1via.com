import { describe, expect, it } from "vitest";
import {
  recordCategoryImageUrl,
  seedCategoryImageUrls,
} from "@/lib/ai/category-photo-plan";

describe("category photo URL plan", () => {
  it("starts with existing category images excluded", () => {
    expect(
      seedCategoryImageUrls([
        "https://images.example/existing.jpg",
        null,
        "",
      ]),
    ).toEqual(new Set(["https://images.example/existing.jpg"]));
  });

  it("excludes each newly attached image from later questions", () => {
    const excluded = seedCategoryImageUrls([
      "https://images.example/existing.jpg",
    ]);

    recordCategoryImageUrl(excluded, "https://images.example/new.jpg");
    recordCategoryImageUrl(excluded, null);

    expect(excluded).toEqual(
      new Set([
        "https://images.example/existing.jpg",
        "https://images.example/new.jpg",
      ]),
    );
  });
});
