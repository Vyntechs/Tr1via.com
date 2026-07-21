export function seedCategoryImageUrls(
  imageUrls: Iterable<string | null | undefined>,
): Set<string> {
  const used = new Set<string>();
  for (const imageUrl of imageUrls) {
    const normalized = imageUrl?.trim();
    if (normalized) used.add(normalized);
  }
  return used;
}

export function recordCategoryImageUrl(
  used: Set<string>,
  imageUrl: string | null | undefined,
): void {
  const normalized = imageUrl?.trim();
  if (normalized) used.add(normalized);
}
