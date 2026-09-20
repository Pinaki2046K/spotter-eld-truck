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

/**
 * The primary accuracy artefact. This list, not the map, is what a reader uses
 * to check the schedule -- and it is the non-visual equivalent of the map.
 */
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
              aria-label={`Stop ${stop.sequence}, ${STOP_LABELS[stop.stop_type]} at ${stop.location_label}, ${formatTime(stop.arrival_time, tzOffsetMinutes)}. ${stop.reason}. Show on map.`}
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
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[15px] font-semibold">
                    {stop.sequence}. {STOP_LABELS[stop.stop_type]}
                  </span>
                  <span className="shrink-0 text-[13px] tabular-nums text-[var(--color-ink-48)]">
                    {formatTime(stop.arrival_time, tzOffsetMinutes)}
                    {stop.duration_hours > 0
                      ? ` – ${formatTime(stop.departure_time, tzOffsetMinutes)}`
                      : ''}
                  </span>
                </span>
                <span className="block truncate text-[14px] text-[var(--color-ink-80)]">
                  {stop.location_label}
                </span>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-[var(--color-ink-48)]">
                  {stop.reason}
                </span>
                <span className="mt-1 block text-[11.5px] tabular-nums text-[var(--color-ink-48)]">
                  {formatMiles(stop.odometer_miles)}
                  {stop.duration_hours > 0 ? ` · ${formatDuration(stop.duration_hours)}` : ''}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
