import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  formatDate,
  formatDuration,
  formatHours,
  formatMiles,
  formatTime,
  hoursIntoDay,
  splitLogDate,
  localIsoWithOffset,
  toIsoWithOffset,
} from './format'

const CENTRAL = -300

describe('display times follow the trip timezone, not the viewer', () => {
  it('shifts a UTC instant into the home terminal offset', () => {
    expect(formatTime('2026-09-22T11:00:00Z', CENTRAL)).toBe('06:00')
    expect(formatTime('2026-09-22T11:00:00Z', 0)).toBe('11:00')
  })

  it('rolls the date back when the offset crosses midnight', () => {
    expect(formatDate('2026-09-23T04:30:00Z', CENTRAL)).toBe('Tue Sep 22')
    expect(formatDate('2026-09-23T04:30:00Z', 0)).toBe('Wed Sep 23')
  })

  it('reports hours past local midnight for the grid x-axis', () => {
    expect(hoursIntoDay('2026-09-22T05:00:00Z', CENTRAL)).toBe(0)
    expect(hoursIntoDay('2026-09-22T16:24:00Z', CENTRAL)).toBeCloseTo(11.4, 5)
  })
})

describe('duration and distance formatting', () => {
  it.each([
    [0.5, '30m'],
    [1, '1h'],
    [9.87, '9h 52m'],
    [34, '34h'],
  ])('formats %s hours as %s', (hours, expected) => {
    expect(formatDuration(hours)).toBe(expected)
  })

  it('keeps totals at two decimals so they read as log-sheet values', () => {
    expect(formatHours(11)).toBe('11.00')
    expect(formatHours(8.575)).toBe('8.57')
  })

  it('formats miles with a thousands separator', () => {
    expect(formatMiles(1150.4)).toBe('1,150 mi')
  })
})

describe('form input conversion', () => {
  it('splits a log date for the three header cells', () => {
    expect(splitLogDate('2026-09-22')).toEqual({ month: '09', day: '22', year: '2026' })
  })

  it('attaches an explicit offset so the backend never has to guess', () => {
    expect(toIsoWithOffset('2026-09-22T06:00', -300)).toBe('2026-09-22T06:00:00-05:00')
    expect(toIsoWithOffset('2026-09-22T06:00', 330)).toBe('2026-09-22T06:00:00+05:30')
  })
})

describe('the departure offset', () => {
  // vi.stubEnv sets process.env.TZ, which Node applies to Date immediately.
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is the offset on the departure date, not today, across a DST change', () => {
    vi.stubEnv('TZ', 'America/Chicago')
    // Chicago leaves daylight saving on Nov 1, 2026.
    expect(localIsoWithOffset('2026-10-30T06:00')).toBe('2026-10-30T06:00:00-05:00')
    expect(localIsoWithOffset('2026-11-03T06:00')).toBe('2026-11-03T06:00:00-06:00')
  })

  it('keeps a fixed offset where there is no daylight saving', () => {
    vi.stubEnv('TZ', 'Asia/Kolkata')
    expect(localIsoWithOffset('2026-11-03T06:00')).toBe('2026-11-03T06:00:00+05:30')
  })
})
