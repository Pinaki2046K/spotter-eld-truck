import { describe, expect, it } from 'vitest'

import type { DutyEntry } from '../api/types'
import { activityFor } from './remarks'

function entry(status: DutyEntry['status'], remark: string): DutyEntry {
  return {
    sequence: 1,
    status,
    start_time: '2026-09-22T11:00:00Z',
    end_time: '2026-09-22T12:00:00Z',
    duration_hours: 1,
    distance_miles: 0,
    location_label: 'Chicago, Illinois',
    remark,
  }
}

describe('activityFor', () => {
  it.each([
    ['DRIVING', 'Driving toward Denver, Colorado', 'Driving'],
    ['ON_DUTY_NOT_DRIVING', 'Pre-trip inspection', 'Pre-trip inspection'],
    ['ON_DUTY_NOT_DRIVING', 'Post-trip inspection', 'Post-trip inspection'],
    ['ON_DUTY_NOT_DRIVING', 'Loading', 'Loading'],
    ['ON_DUTY_NOT_DRIVING', 'Unloading', 'Unloading'],
    ['ON_DUTY_NOT_DRIVING', 'Fuel', 'Fueling'],
    ['OFF_DUTY', '30-minute break', '30-min break'],
    ['SLEEPER_BERTH', '10 hours off duty', '10-hr rest (sleeper)'],
    ['OFF_DUTY', '34-hour restart', '34-hr restart'],
    ['OFF_DUTY', 'Off duty -- trip complete', 'Off duty'],
  ] as const)('%s "%s" reads as "%s"', (status, remark, expected) => {
    expect(activityFor(entry(status, remark))).toBe(expected)
  })
})
