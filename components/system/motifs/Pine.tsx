interface MotifProps { size?: number; color?: string; }

export function Pine({ size = 12, color = "#1F5A36" }: MotifProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 14">
      <path d="M6 1L2 6h2L1 10h3L0 14h12L8 10h3L8 6h2L6 1z" fill={color} />
    </svg>
  );
}
