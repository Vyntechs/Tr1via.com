import { describe, expect, it } from "vitest";
import { choosePhotoQuery } from "@/lib/pexels/photo-query";

describe("choosePhotoQuery (library photos on the swap screen)", () => {
  it("uses the search words stored with the question", () => {
    expect(
      choosePhotoQuery("st francis of assisi animals", "Which saint is the patron of animals?"),
    ).toBe("st francis of assisi animals");
  });

  it("falls back to words from the question when nothing is stored", () => {
    expect(choosePhotoQuery(null, "Which saint is the patron of animals?")).toBe(
      "saint patron animals",
    );
    expect(choosePhotoQuery("   ", "Which saint is the patron of animals?")).toBe(
      "saint patron animals",
    );
    expect(choosePhotoQuery(undefined, "Which city is home to the Vatican?")).toBe(
      "city home Vatican",
    );
  });
});
