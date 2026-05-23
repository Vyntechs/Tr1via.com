interface MotifProps { size?: number; color?: string; rotate?: number; }

export function Leaf({ size = 12, color = "#C25E22", rotate = 0 }: MotifProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ transform: `rotate(${rotate}deg)` }}>
      <path d="M7 1c3 1 5 4 5 7-3 0-5-2-7-4-1 1-1 3-3 4 0-3 2-6 5-7z" fill={color} />
    </svg>
  );
}
