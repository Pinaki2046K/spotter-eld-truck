/**
 * All display formatting is pinned to the trip's own UTC offset, not the
 * viewer's. A log sheet is a legal record of the driver's local day; rendering
 * it in the viewer's timezone would shift every line.
 */

/** The instant shifted into the trip's own offset, so getUTC* reads as local. */
function shifted(iso: string, tzOffsetMinutes: number): Date {
  return new Date(new Date(iso).getTime() + tzOffsetMinutes * 60_000)
}

export function formatTime(iso: string, tzOffsetMinutes: number): string {
  const date = shifted(iso, tzOffsetMinutes)
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatDate(iso: string, tzOffsetMinutes: number): string {
  const date = shifted(iso, tzOffsetMinutes)
  return `${WEEKDAYS[date.getUTCDay()]} ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`
}

export function formatDateTime(iso: string, tzOffsetMinutes: number): string {
  return `${formatDate(iso, tzOffsetMinutes)}, ${formatTime(iso, tzOffsetMinutes)}`
}

/** The calendar date an instant falls on, in the trip's timezone. */
export function localDateIso(iso: string, tzOffsetMinutes: number): string {
  const date = new Date(new Date(iso).getTime() + tzOffsetMinutes * 60_000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** "2026-09-22" -> {month: "09", day: "22", year: "2026"} for the sheet header. */
export function splitLogDate(date: string): { month: string; day: string; year: string } {
  const [year, month, day] = date.split('-')
  return { month, day, year }
}

/** Fractional hours past midnight, in the trip's timezone. Used for the grid x-axis. */
export function hoursIntoDay(iso: string, tzOffsetMinutes: number): number {
  const date = shifted(iso, tzOffsetMinutes)
  return date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600
}

export function formatHours(value: number): string {
  return value.toFixed(2)
}

/** 9.87 -> "9h 52m". Durations read better than decimals outside the totals column. */
export function formatDuration(hours: number): string {
  const totalMinutes = Math.round(hours * 60)
  const wholeHours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (wholeHours === 0) return `${minutes}m`
  if (minutes === 0) return `${wholeHours}h`
  return `${wholeHours}h ${minutes}m`
}

export function formatMiles(miles: number): string {
  return `${Math.round(miles).toLocaleString('en-US')} mi`
}

/** A datetime-local value (no offset) plus an offset, as an ISO 8601 string. */
export function toIsoWithOffset(localValue: string, tzOffsetMinutes: number): string {
  const sign = tzOffsetMinutes < 0 ? '-' : '+'
  const absolute = Math.abs(tzOffsetMinutes)
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0')
  const minutes = String(absolute % 60).padStart(2, '0')
  const withSeconds = localValue.length === 16 ? `${localValue}:00` : localValue
  return `${withSeconds}${sign}${hours}:${minutes}`
}

/**
 * The browser's offset, in minutes east of UTC, *at* a local datetime-local
 * value -- not today's. Planning on Oct 30 for a Nov 3 departure must send
 * Chicago's -06:00, not the -05:00 in force when the form was filled in, or
 * every time on the sheets lands an hour off. A value without an offset
 * parses as local time, daylight saving included.
 */
export function localOffsetMinutesAt(localValue: string): number {
  const moment = new Date(localValue)
  return -(Number.isNaN(moment.getTime()) ? new Date() : moment).getTimezoneOffset()
}

/** A datetime-local value with the offset in force at that moment. */
export function localIsoWithOffset(localValue: string): string {
  return toIsoWithOffset(localValue, localOffsetMinutesAt(localValue))
}

/** The next 06:00 local, as a `datetime-local` input value. */
export function nextLocalSixAm(): string {
  const now = new Date()
  const next = new Date(now)
  next.setHours(6, 0, 0, 0)
  if (next <= now) next.setDate(next.getDate() + 1)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T06:00`
}

/**
 * The default departure as an ISO string with an explicit offset.
 *
 * Always sent, never left to the server to guess: the backend would fall back
 * to 06:00 UTC, and that offset is what the log sheets are drawn against.
 */
export function defaultStartDatetime(): string {
  return localIsoWithOffset(nextLocalSixAm())
}
