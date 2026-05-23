interface MotifProps { size?: number; color?: string; }

export function Heart({ size = 8, color = "#FF4673" }: MotifProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" style={{ display: "block" }}>
      <path
        d="M6 10.5c-2.5-1.5-4.5-3.5-4.5-6 0-1.5 1-2.5 2.5-2.5 1 0 1.5.5 2 1.5.5-1 1-1.5 2-1.5 1.5 0 2.5 1 2.5 2.5 0 2.5-2 4.5-4.5 6z"
        fill={color}
      />
    </svg>
  );
}
