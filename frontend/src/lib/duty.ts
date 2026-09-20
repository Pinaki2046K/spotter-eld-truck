import type { DutyStatus, StopType } from '../api/types'

/** Row order on the FMCSA grid -- regulation order, not alphabetical. */
export const DUTY_ROWS: DutyStatus[] = [
  'OFF_DUTY',
  'SLEEPER_BERTH',
  'DRIVING',
  'ON_DUTY_NOT_DRIVING',
]

export const DUTY_LABELS: Record<DutyStatus, string> = {
  OFF_DUTY: 'Off Duty',
  SLEEPER_BERTH: 'Sleeper Berth',
  DRIVING: 'Driving',
  ON_DUTY_NOT_DRIVING: 'On Duty (Not Driving)',
}

/** Short form for the totals column and the mobile stop list. */
export const DUTY_SHORT: Record<DutyStatus, string> = {
  OFF_DUTY: 'Off duty',
  SLEEPER_BERTH: 'Sleeper',
  DRIVING: 'Driving',
  ON_DUTY_NOT_DRIVING: 'On duty',
}

export const DUTY_COLORS: Record<DutyStatus, string> = {
  OFF_DUTY: 'var(--color-duty-off)',
  SLEEPER_BERTH: 'var(--color-duty-sleeper)',
  DRIVING: 'var(--color-duty-driving)',
  ON_DUTY_NOT_DRIVING: 'var(--color-duty-onduty)',
}

export const STOP_LABELS: Record<StopType, string> = {
  START: 'Start',
  PICKUP: 'Pickup',
  FUEL: 'Fuel',
  REST_BREAK: 'Rest break',
  DAILY_RESET: 'Daily reset',
  CYCLE_RESTART: 'Cycle restart',
  DROPOFF: 'Dropoff',
}

export const STOP_COLORS: Record<StopType, string> = {
  START: 'var(--color-accent)',
  PICKUP: 'var(--color-accent)',
  FUEL: 'var(--color-duty-onduty)',
  REST_BREAK: 'var(--color-duty-off)',
  DAILY_RESET: 'var(--color-duty-sleeper)',
  CYCLE_RESTART: 'var(--color-ink)',
  DROPOFF: 'var(--color-accent)',
}

/**
 * 20x20 icon paths, one per stop type. Colour alone never carries the meaning:
 * every marker also has a glyph, a number and an aria-label.
 */
export const STOP_ICON_PATHS: Record<StopType, string> = {
  START: 'M5 2v16M5 3h9l-2 3.5L14 10H5',
  PICKUP: 'M3 6.5 10 3l7 3.5v7L10 17l-7-3.5zM3 6.5 10 10m0 0 7-3.5M10 10v7',
  FUEL: 'M4 17V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v13M3 17h10M5 8h6M14 7l2 2v5a1.5 1.5 0 0 0 3 0V9l-2.5-3',
  REST_BREAK: 'M3 8h11v4a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM14 9h2a2 2 0 0 1 0 4h-2M4 5V3M7 5V3M10 5V3',
  DAILY_RESET: 'M16.5 12.2A7 7 0 0 1 7.8 3.5a7 7 0 1 0 8.7 8.7',
  CYCLE_RESTART: 'M10 5v5l3 2M17 10a7 7 0 1 1-2.6-5.4M17 3v3.2h-3.2',
  DROPOFF: 'M4 2v16M4 3h4v3H4zm4 0h4v3H8zm4 0h4v3h-4zM4 6h4v3H4zm4 0h4v3H8zm4 0h4v3h-4z',
}
