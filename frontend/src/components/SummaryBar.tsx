import type { Assumptions, TripSummary } from '../api/types'
import { formatDateTime, formatDuration } from '../lib/format'

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] font-semibold tracking-wide text-[var(--color-ink-48)] uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-[20px] leading-tight font-semibold tabular-nums">{value}</dd>
      {sub ? <dd className="text-[12.5px] text-[var(--color-ink-48)]">{sub}</dd> : null}
    </div>
  )
}

export function SummaryBar({
  summary,
  assumptions,
  tzOffsetMinutes,
}: {
  summary: TripSummary
  assumptions: Assumptions
  tzOffsetMinutes: number
}) {
  return (
    <section
      aria-label="Trip summary"
      className="rounded-[var(--radius-card)] border border-[var(--color-hairline)] bg-white px-5 py-4"
    >
      <dl className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
        <Metric
          label="Distance"
          value={`${Math.round(summary.total_distance_miles).toLocaleString('en-US')} mi`}
        />
        <Metric label="Driving" value={formatDuration(summary.total_driving_hours)} />
        <Metric
          label="On duty"
          value={formatDuration(summary.total_on_duty_hours)}
          sub={`${summary.cycle_hours_used_at_start} h already used`}
        />
        <Metric label="Log days" value={String(summary.total_days)} />
        <Metric
          label="Required stops"
          value={String(summary.required_stops)}
          sub="breaks, fuel, resets"
        />
        <Metric label="Arrives" value={formatDateTime(summary.arrival_datetime, tzOffsetMinutes)} />
      </dl>

      <p className="mt-4 border-t border-[var(--color-divider)] pt-3 text-[12.5px] leading-relaxed text-[var(--color-ink-48)]">
        Planned for a property-carrying driver on the {assumptions.cycle_hours}-hour / 8-day cycle,
        no adverse-conditions extension. Driving time is distance &divide;{' '}
        {assumptions.average_speed_mph} mph; fuelling at least every{' '}
        {assumptions.fuel_interval_miles.toLocaleString('en-US')} miles (
        {formatDuration(assumptions.fuel_stop_hours)}); {formatDuration(assumptions.pickup_hours)}{' '}
        to load and {formatDuration(assumptions.dropoff_hours)} to unload; a{' '}
        {formatDuration(assumptions.inspection_hours)} vehicle inspection opens and closes every
        shift. Route via {summary.routing_provider === 'osrm' ? 'OSRM' : 'OpenRouteService'}.
      </p>
    </section>
  )
}
