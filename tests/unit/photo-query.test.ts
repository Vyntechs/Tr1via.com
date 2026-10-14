import { describe, expect, it } from "vitest";
import { choosePhotoQuery, fallbackPhotoQuery } from "@/lib/pexels/photo-query";

const PROMPT = "Which saint is the patron of animals?";

describe("choosePhotoQuery (library photos on the swap screen)", () => {
  it("uses the search words stored with an unedited question", () => {
    expect(
      choosePhotoQuery({ photo_query: "st francis of assisi animals", prompt: PROMPT, source: "ai" }),
    ).toEqual({ query: "st francis of assisi animals", fromStored: true });
  });

  it("uses the question's current words once the host has edited it", () => {
    // The stored words were written for the question before her edit.
    expect(
      choosePhotoQuery({
        photo_query: "st francis of assisi animals",
        prompt: "Which saint is the patron of sailors?",
        source: "host-edit",
      }),
    ).toEqual({ query: "saint patron sailors", fromStored: false });
  });

  it("falls back to words from the question when nothing is stored", () => {
    expect(choosePhotoQuery({ photo_query: null, prompt: PROMPT, source: "ai" }).query).toBe(
      "saint patron animals",
    );
    expect(choosePhotoQuery({ photo_query: "   ", prompt: PROMPT, source: "ai" }).query).toBe(
      "saint patron animals",
    );
    expect(choosePhotoQuery({ prompt: "Which city is home to the Vatican?" })).toEqual({
      query: "city home Vatican",
      fromStored: false,
    });
  });
});

describe("fallbackPhotoQuery (second try when the stored words find nothing)", () => {
  it("offers the question's own words", () => {
    expect(fallbackPhotoQuery({ prompt: PROMPT }, "obscure relic close up")).toBe(
      "saint patron animals",
    );
  });

  it("does not repeat the same search", () => {
    expect(fallbackPhotoQuery({ prompt: PROMPT }, "Saint Patron Animals")).toBeNull();
  });
});
