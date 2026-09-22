import type { Stop } from '../api/types'
import { STOP_COLORS, STOP_ICON_PATHS, STOP_LABELS } from '../lib/duty'
import { formatDate, formatDuration, formatMiles, formatTime } from '../lib/format'

interface StopListProps {
  stops: Stop[]
  tzOffsetMinutes: number
  highlighted: number | null
  onHover: (sequence: number | null) => void
  onSelect: (sequence: number) => void
}

/** Every stop with its time and reason; also the accessible alternative to the map. */
export function StopList({
  stops,
  tzOffsetMinutes,
  highlighted,
  onHover,
  onSelect,
}: StopListProps) {
  // Date headings are decided up front: deriving them while mapping would mean
  // carrying a mutable variable across renders.
  const rows = stops.map((stop, index) => {
    const date = formatDate(stop.arrival_time, tzOffsetMinutes)
    const previous = index === 0 ? null : formatDate(stops[index - 1].arrival_time, tzOffsetMinutes)
    return { stop, date, showDate: date !== previous }
  })

  return (
    <ol className="divide-y divide-[var(--color-divider)]" aria-label="Scheduled stops">
      {rows.map(({ stop, date, showDate }) => {
        // satisfies_break marks the stop that served as the 30-minute break.
        // On a rest-break stop that is the stop's whole purpose, not an "also".
        const alsoBreak = stop.satisfies_break && stop.stop_type !== 'REST_BREAK'
        return (
          <li key={stop.sequence}>
            {showDate ? (
              <p className="bg-[var(--color-parchment)] px-4 py-1.5 text-xs font-semibold tracking-wide text-[var(--color-ink-48)] uppercase">
                {date}
              </p>
            ) : null}
            <button
              type="button"
              onMouseEnter={() => onHover(stop.sequence)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(stop.sequence)}
              onBlur={() => onHover(null)}
              onClick={() => onSelect(stop.sequence)}
              aria-label={`Stop ${stop.sequence}, ${STOP_LABELS[stop.stop_type]} at ${stop.location_label}, ${formatTime(stop.arrival_time, tzOffsetMinutes)}. ${stop.reason}.${alsoBreak ? ' Also satisfies the 30-minute break.' : ''} Show on map.`}
              className={`flex w-full gap-3 px-4 py-3 text-left transition-colors ${
                highlighted === stop.sequence
                  ? 'bg-[var(--color-accent-soft)]'
                  : 'hover:bg-[var(--color-pearl)]'
              }`}
            >
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                style={{ background: STOP_COLORS[stop.stop_type] }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={STOP_ICON_PATHS[stop.stop_type]} />
                </svg>
              </span>

              <span className="min-w-0 flex-1">
                {/* Type and place lead; the clock is supporting detail. */}
                <span className="block text-[15px] leading-snug font-semibold">
                  {stop.sequence}. {STOP_LABELS[stop.stop_type]}
                </span>
                <span className="block truncate text-[14px] text-[var(--color-ink-80)]">
                  {stop.location_label}
                </span>

                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] tabular-nums text-[var(--color-ink-48)]">
                  <span>
                    {formatTime(stop.arrival_time, tzOffsetMinutes)}
                    {stop.duration_hours > 0
                      ? ` \u2013 ${formatTime(stop.departure_time, tzOffsetMinutes)}`
                      : ''}
                  </span>
                  <span aria-hidden="true">&middot;</span>
                  <span>{formatMiles(stop.odometer_miles)}</span>
                  {stop.duration_hours > 0 ? (
                    <>
                      <span aria-hidden="true">&middot;</span>
                      <span>{formatDuration(stop.duration_hours)}</span>
                    </>
                  ) : null}
                </span>

                <span className="mt-1 block text-[12.5px] leading-snug text-[var(--color-ink-48)]">
                  {stop.reason}
                </span>

                {/* Why a compliant trip can show no separate break stop. */}
                {alsoBreak ? (
                  <span className="mt-1.5 inline-flex items-center gap-1 rounded-[var(--radius-pill)] border border-[var(--color-hairline)] bg-[var(--color-pearl)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-duty-off)]">
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 12 12"
                      aria-hidden="true"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M2 6.5 4.6 9 10 3.5" />
                    </svg>
                    Also satisfies the 30-min break
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
