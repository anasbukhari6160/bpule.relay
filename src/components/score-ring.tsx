export function ScoreRing({
  score,
  canonicalScore,
  size = 76,
  max,
  label,
  displayValue,
}: {
  /** Legacy 0-12 rubric score. Only used when canonicalScore is null. */
  score?: number | null
  /** Canonical 0-100 opportunity score (preferred). */
  canonicalScore?: number | null
  size?: number
  /** Max value for the ring. Auto-detected from score type if not provided. */
  max?: number
  /** Optional aria-label for accessibility (e.g. "Opportunity score 7/10") */
  label?: string
  /**
   * Qualification display score (0-10). When set, this is the number in the
   * ring. The arc still follows the canonical 0-100 total.
   */
  displayValue?: number | null
}) {
  const hasCanonical = canonicalScore != null
  const displayMax = max ?? (hasCanonical ? 100 : 12)
  const rawScore = hasCanonical ? canonicalScore : (score ?? 0)
  const pct = Math.min(Math.max(rawScore, 0) / displayMax, 1)
  const strokeWidth = Math.max(size * 0.07, 2)
  const r = (size - strokeWidth * 2) / 2
  const c = 2 * Math.PI * r
  const color =
    pct >= 0.7
      ? 'var(--status-success)'
      : pct >= 0.4
        ? 'var(--orange)'
        : 'var(--status-warning)'
  const fontSize = Math.max(size * 0.36, 11)

  // Canonical scores display as /10 (0-10 scale), legacy shows raw (0-12)
  const shown = displayValue != null ? displayValue : (hasCanonical ? Math.round(canonicalScore / 10) : rawScore)
  const ariaLabel = label ?? (hasCanonical || displayValue != null ? `Opportunity score ${shown}/10` : `Legacy score ${shown}/12`)

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={ariaLabel}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--line)"
          strokeWidth={strokeWidth}
          opacity={0.3}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className="text-mono-medium font-medium leading-none text-ink"
          style={{ fontSize }}
        >
          {shown}
        </span>
      </div>
    </div>
  )
}
