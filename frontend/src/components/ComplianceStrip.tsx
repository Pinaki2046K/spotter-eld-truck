import type { Compliance } from '../api/types'

/**
 * The four binding HOS limits, with what this trip actually used against each.
 *
 * The schedule is only trustworthy if it can be checked, and checking it by
 * reading a stop list is slow. Per-shift limits are shown as the worst shift on
 * the trip: if the hardest shift stayed inside 11 hours, every shift did.
 */

interface Limit {
  label: string
  used: number
  limit: number
  cfr: string
  note: string
  /** The cycle counts *down*, so its bar fills as hours remain, not as used. */
  invert?: boolean
}

function buildLimits(compliance: Compliance): Limit[] {
  return [
    {
      label: 'Driving',
      used: compliance.max_driving_hours_in_shift,
      limit: compliance.driving_limit_hours,
      cfr: '395.3(a)(3)',
      note: `worst of ${compliance.shifts} ${compliance.shifts === 1 ? 'shift' : 'shifts'}`,
    },
    {
      label: 'Duty window',
      used: compliance.max_window_hours,
      limit: compliance.window_limit_hours,
      cfr: '395.3(a)(2)',
      note: 'from first on-duty',
    },
    {
      label: 'Since break',
      used: compliance.max_driving_hours_between_breaks,
      limit: compliance.break_required_after_hours,
      cfr: '395.3(a)(3)(ii)',
      note: 'cumulative driving',
    },
    {
      label: 'Cycle left',
      used: compliance.cycle_hours_remaining,
      limit: compliance.cycle_hours_limit,
      cfr: '395.3(b)',
      note: `${compliance.cycle_hours_used.toFixed(2)} h used of 70`,
      invert: true,
    },
  ]
}

function Gauge({ limit }: { limit: Limit }) {
  const ratio = limit.limit === 0 ? 0 : Math.min(1, limit.used / limit.limit)
  // At the limit is legal, not a violation, so "at" reads as full rather than red.
  const atLimit = !limit.invert && limit.used >= limit.limit - 0.005
  const percent = `${(ratio * 100).toFixed(1)}%`

  return (
    <div className="min-w-0">
      {/* The label owns its own row. Sharing one with the CFR citation left
          "Duty window" and "Since break" clipped in a narrow column. */}
      <p className="truncate text-[12px] font-semibold tracking-wide text-[var(--color-ink-48)] uppercase">
        {limit.label}
      </p>

      <p className="mt-0.5 text-[17px] leading-tight font-semibold tabular-nums">
        {limit.used.toFixed(2)}
        <span className="text-[13px] font-normal text-[var(--color-ink-48)]">
          {' '}
          / {limit.limit.toFixed(0)} h
        </span>
      </p>

      <div
        className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--color-divider)]"
        role="img"
        aria-label={`${limit.used.toFixed(2)} of ${limit.limit} hours`}
      >
        <div
          className="h-full rounded-full bg-[var(--color-accent)]"
          style={{ width: percent, opacity: atLimit ? 1 : 0.65 }}
        />
      </div>

      <p className="mt-1 text-[11.5px] leading-snug text-[var(--color-ink-48)]">
        {limit.note}
        <span className="block tabular-nums opacity-80">&sect;{limit.cfr}</span>
      </p>
    </div>
  )
}

export function ComplianceStrip({ compliance }: { compliance: Compliance }) {
  if (!compliance || !compliance.driving_limit_hours) return null
  const limits = buildLimits(compliance)

  return (
    <section
      aria-label="Hours of Service compliance"
      className="@container rounded-[var(--radius-card)] border border-[var(--color-hairline)] bg-white px-4 py-3.5"
    >
      {/* Container query, not a viewport one: at desktop this strip sits in a
          356px column, where a viewport-keyed `sm:grid-cols-4` gave four 66px
          cells and clipped every label. */}
      <div className="grid grid-cols-2 gap-x-5 gap-y-4 @xl:grid-cols-4">
        {limits.map((limit) => (
          <Gauge key={limit.label} limit={limit} />
        ))}
      </div>
      <p className="mt-3 border-t border-[var(--color-divider)] pt-2.5 text-[11.5px] leading-snug text-[var(--color-ink-48)]">
        Per-shift limits show the worst shift on this trip, so every other shift is inside them too.
        Nothing here exceeds its limit.
      </p>
    </section>
  )
}
