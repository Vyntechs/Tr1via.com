function expandHex(color: string): string {
  const normalized = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(normalized)) return normalized.slice(1);
  if (/^#[0-9a-f]{3}$/i.test(normalized)) {
    return normalized
      .slice(1)
      .split("")
      .map((digit) => `${digit}${digit}`)
      .join("");
  }
  throw new Error(`Unsupported color format: ${color}`);
}

function relativeLuminance(color: string): number {
  const hex = expandHex(color);
  const channels = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

/** Chooses the higher-contrast neutral for a solid themed action background. */
export function readableForeground(background: string): "#000000" | "#FFFFFF" {
  return contrastRatio("#000000", background) >= contrastRatio("#FFFFFF", background)
    ? "#000000"
    : "#FFFFFF";
}
