interface MotifProps { size?: number; color?: string; }

export function Wheat({ size = 14, color = "#C25E22" }: MotifProps) {
  return (
    <svg width={size} height={size * 1.6} viewBox="0 0 10 16">
      <g fill={color}>
        <rect x="4.5" y="6" width="1" height="10" />
        <ellipse cx="3" cy="3" rx="1.4" ry="2.6" transform="rotate(-25 3 3)" />
        <ellipse cx="7" cy="3" rx="1.4" ry="2.6" transform="rotate(25 7 3)" />
        <ellipse cx="2.5" cy="6" rx="1.4" ry="2.4" transform="rotate(-25 2.5 6)" />
        <ellipse cx="7.5" cy="6" rx="1.4" ry="2.4" transform="rotate(25 7.5 6)" />
      </g>
    </svg>
  );
}
