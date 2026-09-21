import type { LogDay, Stop } from '../api/types'
import { localDateIso } from '../lib/format'

/**
 * What bound a given log day, and why its driving total can exceed 11 hours.
 *
 * A calendar day is not a duty shift. When a 10-hour reset lands mid-afternoon
 * the day holds the tail of one shift and the start of the next, so the sheet
 * can legitimately total more than the 11-hour driving limit. Without a note
 * saying so, that reads as a violation.
 */

const DRIVING_LIMIT_HOURS = 11

const BINDING_LABELS: Partial<Record<Stop['stop_type'], string>> = {
  DAILY_RESET: '10-hour reset',
  CYCLE_RESTART: '34-hour restart',
  REST_BREAK: '30-minute break',
  FUEL: 'Fuel stop',
}

function stopsOnDay(stops: Stop[], day: LogDay, tzOffsetMinutes: number): Stop[] {
  return stops.filter((stop) => localDateIso(stop.arrival_time, tzOffsetMinutes) === day.date)
}

/** "a 10-hour reset", "a 34-hour restart", or "2 resets" -- named for what actually happened. */
function resetPhrase(resets: Stop[]): string {
  if (resets.length !== 1) return `${resets.length} resets`
  return `a ${BINDING_LABELS[resets[0].stop_type]}`
}

export function LogDayLimits({
  day,
  stops,
  tzOffsetMinutes,
}: {
  day: LogDay
  stops: Stop[]
  tzOffsetMinutes: number
}) {
  const onDay = stopsOnDay(stops, day, tzOffsetMinutes)
  const resets = onDay.filter(
    (stop) => stop.stop_type === 'DAILY_RESET' || stop.stop_type === 'CYCLE_RESTART',
  )

  const binding: string[] = []
  for (const stop of onDay) {
    const label = BINDING_LABELS[stop.stop_type]
    if (label && !binding.includes(label)) binding.push(label)
  }

  const exceedsShiftLimit = day.totals.driving > DRIVING_LIMIT_HOURS + 0.005

  if (binding.length === 0 && !exceedsShiftLimit) return null

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {binding.map((label) => (
        <span
          key={label}
          className="rounded-[var(--radius-pill)] border border-[var(--color-hairline)] bg-[var(--color-pearl)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-ink-48)]"
        >
          {label}
        </span>
      ))}

      {exceedsShiftLimit ? (
        <span className="text-[11.5px] leading-snug text-[var(--color-ink-48)]">
          {day.totals.driving.toFixed(2)} h driving across this calendar day is not an 11-hour
          breach: {resetPhrase(resets)} fell inside it, and the driving limit counts per shift, not
          per day.
        </span>
      ) : null}
    </div>
  )
}
