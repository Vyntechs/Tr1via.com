interface MotifProps { size?: number; color?: string; }

export function Firework({ size = 16, color = "#E63946" }: MotifProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16">
      <g stroke={color} strokeWidth="1.4" strokeLinecap="round">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angleDeg) => {
          const rad = (angleDeg * Math.PI) / 180;
          return (
            <line
              key={angleDeg}
              x1="8"
              y1="8"
              x2={8 + Math.cos(rad) * 5.5}
              y2={8 + Math.sin(rad) * 5.5}
            />
          );
        })}
        <circle cx="8" cy="8" r="1.4" fill={color} stroke="none" />
      </g>
    </svg>
  );
}
