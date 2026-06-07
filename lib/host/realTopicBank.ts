// Curated bank of realistic trivia topics for the founder "Build a full game"
// tool. Each entry is { name, topic }: `name` is the board column label,
// `topic` is the Claude generation prompt. Intentionally broad + venue-real.

export interface RealTopic {
  name: string;
  topic: string;
}

export const REAL_TOPIC_BANK: readonly RealTopic[] = [
  { name: "90s Movies", topic: "popular movies from the 1990s" },
  { name: "World Capitals", topic: "capital cities of countries around the world" },
  { name: "Classic Rock", topic: "classic rock bands and songs of the 60s 70s and 80s" },
  { name: "Famous Scientists", topic: "famous scientists and their discoveries" },
  { name: "Pixar & Disney", topic: "Pixar and Disney animated films" },
  { name: "US Presidents", topic: "United States presidents and history" },
  { name: "2000s Pop", topic: "pop music hits of the 2000s" },
  { name: "Space & Astronomy", topic: "space exploration and astronomy" },
  { name: "Famous Authors", topic: "famous authors and their books" },
  { name: "Geography", topic: "world geography landmarks and rivers" },
  { name: "Sports Legends", topic: "legendary athletes across major sports" },
  { name: "Food & Cooking", topic: "world cuisine, cooking, and famous dishes" },
  { name: "TV Sitcoms", topic: "classic and modern television sitcoms" },
  { name: "Ancient History", topic: "ancient civilizations and history" },
  { name: "Animal Kingdom", topic: "animals, wildlife, and the natural world" },
  { name: "Superheroes", topic: "comic book superheroes and their movies" },
  { name: "Broadway", topic: "broadway shows and musical theatre" },
  { name: "Inventions", topic: "famous inventions and inventors" },
  { name: "Video Games", topic: "classic and modern video games" },
  { name: "Mythology", topic: "Greek, Roman, and Norse mythology" },
  { name: "Famous Paintings", topic: "famous paintings and the artists who made them" },
  { name: "Cars & Racing", topic: "automobiles and motorsport" },
  { name: "Ocean Life", topic: "oceans, marine life, and sea creatures" },
  { name: "80s Nostalgia", topic: "1980s pop culture and trends" },
] as const;

// FNV-1a 32-bit hash → deterministic numeric seed from a string (e.g. night id).
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32 — tiny deterministic PRNG. Avoids Math.random so builds are
// reproducible and unit-testable from a seed.
function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick `count` distinct realistic topics, deterministically shuffled from
 * `seed`. Same seed → same topics; different seeds vary the selection.
 */
export function pickRealTopics(seed: string, count: number): RealTopic[] {
  if (count > REAL_TOPIC_BANK.length) {
    throw new Error(
      `pickRealTopics: count ${count} exceeds bank size ${REAL_TOPIC_BANK.length}`,
    );
  }
  const rng = mulberry32(hashSeed(seed));
  const arr = [...REAL_TOPIC_BANK];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, count);
}
