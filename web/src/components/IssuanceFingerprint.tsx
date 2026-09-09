export function IssuanceFingerprint({ values }: { values?: number[] }) {
  if (!values || values.length === 0) return null;
  const max = Math.max(...values, 1);
  const points: string[] = [];
  values.forEach((value, index) => {
    const x0 = (index / values.length) * 100;
    const x1 = ((index + 1) / values.length) * 100;
    const y = 92 - (value / max) * 76;
    if (index === 0) points.push(`${x0},${y}`);
    points.push(`${x1},${y}`);
    if (index < values.length - 1) {
      const nextY = 92 - (values[index + 1] / max) * 76;
      points.push(`${x1},${nextY}`);
    }
  });

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full text-teal-700 opacity-[0.075]"
    >
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
