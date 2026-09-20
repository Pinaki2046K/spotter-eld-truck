import type { Trip } from '../api/types'

/**
 * Once a trip is planned the form collapses to this, so the result gets the
 * screen but the inputs stay one click away and nothing is lost on a re-plan.
 */
export function TripSummaryCard({
  inputs,
  onEdit,
}: {
  inputs: Trip['inputs']
  onEdit: () => void
}) {
  const legs = [
    { label: 'From', value: inputs.current_location.label },
    { label: 'Pickup', value: inputs.pickup_location.label },
    { label: 'Dropoff', value: inputs.dropoff_location.label },
  ]

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[19px]">Trip</h2>
        <button
          type="button"
          onClick={onEdit}
          className="rounded-[var(--radius-pill)] border border-[var(--color-hairline)] bg-[var(--color-pearl)] px-4 py-1.5 text-[13px] font-semibold text-[var(--color-accent)] transition-transform active:scale-[0.98]"
        >
          Edit
        </button>
      </div>

      <ol className="mt-4 flex flex-col gap-3">
        {legs.map((leg, index) => (
          <li key={leg.label} className="flex gap-3">
            <span aria-hidden="true" className="flex flex-col items-center pt-1.5">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  index === 1 ? 'bg-[var(--color-accent)]' : 'border-2 border-[var(--color-accent)]'
                }`}
              />
              {index < legs.length - 1 ? (
                <span className="mt-1 h-7 w-px bg-[var(--color-hairline)]" />
              ) : null}
            </span>
            <span className="min-w-0">
              <span className="block text-[11.5px] font-semibold tracking-wide text-[var(--color-ink-48)] uppercase">
                {leg.label}
              </span>
              <span className="block text-[15px] leading-snug">{leg.value}</span>
            </span>
          </li>
        ))}
      </ol>

      <p className="mt-4 border-t border-[var(--color-divider)] pt-3 text-[13px] text-[var(--color-ink-48)]">
        <span className="font-semibold text-[var(--color-ink-80)]">
          {inputs.cycle_hours_used} h
        </span>{' '}
        already used of 70 in the current 8-day cycle.
      </p>
    </div>
  )
}
