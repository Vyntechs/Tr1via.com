interface MotifProps { size?: number; color?: string; }

export function Snowflake({ size = 8, color = "#fff" }: MotifProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" style={{ display: "block" }}>
      <g stroke={color} strokeWidth="1" strokeLinecap="round">
        <line x1="6" y1="1" x2="6" y2="11" />
        <line x1="1" y1="6" x2="11" y2="6" />
        <line x1="2.5" y1="2.5" x2="9.5" y2="9.5" />
        <line x1="9.5" y1="2.5" x2="2.5" y2="9.5" />
      </g>
    </svg>
  );
}
