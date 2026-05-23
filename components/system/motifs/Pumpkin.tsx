interface MotifProps { size?: number; color?: string; }

export function Pumpkin({ size = 14, color = "#F08C2A" }: MotifProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16">
      <g fill={color}>
        <ellipse cx="8" cy="9" rx="6" ry="5" />
        <ellipse cx="4.5" cy="9" rx="2.5" ry="5" />
        <ellipse cx="11.5" cy="9" rx="2.5" ry="5" />
      </g>
      <rect x="7.5" y="3" width="1" height="2" fill="#3A2A18" />
    </svg>
  );
}
