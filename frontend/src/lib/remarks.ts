import type { DutyEntry } from '../api/types'
import { formatTime } from './format'
import { shortPlace } from './places'

/**
 * The log's Remarks: one entry at every change of duty status, giving the
 * place (city and state) and what the driver was doing, as FMCSA's guide
 * requires. The engine's remark strings are written for the timeline; these
 * are the short forms a driver would write on the paper log.
 */
const SHORT_FORMS: Record<string, string> = {
  Fuel: 'Fueling',
  '30-minute break': '30-min break',
  '34-hour restart': '34-hr restart',
}

/** Place names are shortened to fit one list column beside the activity. */
const PLACE_LENGTH = 20

export function activityFor(entry: DutyEntry): string {
  if (entry.status === 'DRIVING') return 'Driving'
  const remark = entry.remark
  if (remark.startsWith('Off duty')) return 'Off duty'
  if (remark === '10 hours off duty') {
    return entry.status === 'SLEEPER_BERTH' ? '10-hr rest (sleeper)' : '10-hr rest'
  }
  return SHORT_FORMS[remark] ?? remark
}

export interface Remark {
  number: number
  /** Hours past local midnight, where the change sits on the grid. */
  hour: number
  time: string
  place: string
  activity: string
}

export function buildRemarks(
  entries: DutyEntry[],
  tzOffsetMinutes: number,
  hourOf: (iso: string) => number,
): Remark[] {
  return entries.map((entry, index) => ({
    number: index + 1,
    hour: hourOf(entry.start_time),
    time: formatTime(entry.start_time, tzOffsetMinutes),
    place: shortPlace(entry.location_label, PLACE_LENGTH),
    activity: activityFor(entry),
  }))
}
