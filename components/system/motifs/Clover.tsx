interface MotifProps { size?: number; color?: string; }

export function Clover({ size = 10, color = "#3FAE56" }: MotifProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12">
      <g fill={color}>
        <circle cx="6" cy="3" r="2.2" />
        <circle cx="3" cy="6" r="2.2" />
        <circle cx="9" cy="6" r="2.2" />
        <circle cx="6" cy="9" r="2.2" />
        <rect x="5.6" y="6" width="0.8" height="4" rx="0.4" />
      </g>
    </svg>
  );
}
