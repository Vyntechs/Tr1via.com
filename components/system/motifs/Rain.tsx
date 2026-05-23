interface MotifProps { size?: number; color?: string; }

export function Rain({ size = 10, color = "#7A4FCC" }: MotifProps) {
  return (
    <svg width={size} height={size * 2} viewBox="0 0 4 12">
      <line
        x1="2"
        y1="0"
        x2="2"
        y2="10"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.8"
      />
    </svg>
  );
}
