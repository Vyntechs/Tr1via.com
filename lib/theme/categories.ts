// Six (plus three reserve) category colors. Held constant across all themes so
// players learn to recognize categories by color (per design memo: "Music is
// always purple; if it shifted by month, it would feel like a different thing
// in January vs. July").

export interface CategoryDef {
  name: string;
  color: string;
}

export const TR1VIA_CATEGORIES: CategoryDef[] = [
  { name: "Geography", color: "#4ECDC4" },
  { name: "Animals",   color: "#C8E25E" },
  { name: "Food",      color: "#F2A02D" },
  { name: "Movies",    color: "#E64A8C" },
  { name: "Music",     color: "#9B7BD8" },
  { name: "History",   color: "#FF6A3D" },
  { name: "Sports",    color: "#5AA8E0" },
  { name: "TV",        color: "#E8C46A" },
  { name: "Science",   color: "#7AC4A8" },
];

/**
 * Look up a category's color by name (case-insensitive). Falls back to a
 * sensible default so we never crash on an unknown category.
 */
export function categoryColor(name: string | undefined | null, fallback = "#FF6A3D"): string {
  const lookup = String(name ?? "").toLowerCase();
  return TR1VIA_CATEGORIES.find((c) => c.name.toLowerCase() === lookup)?.color ?? fallback;
}
