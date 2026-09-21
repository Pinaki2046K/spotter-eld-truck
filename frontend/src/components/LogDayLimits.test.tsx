import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { LogDay, Stop } from '../api/types'
import { DAY_ONE, TRIP } from '../test/fixtures'
import { LogDayLimits } from './LogDayLimits'

const TZ = -300

function withDriving(hours: number): LogDay {
  return { ...DAY_ONE, totals: { ...DAY_ONE.totals, driving: hours } }
}

describe('per-day binding limits', () => {
  it('names what bound the day', () => {
    render(<LogDayLimits day={DAY_ONE} stops={TRIP.stops} tzOffsetMinutes={TZ} />)
    expect(screen.getByText('10-hour reset')).toBeInTheDocument()
  })

  it('stays silent on a day nothing bound', () => {
    const { container } = render(
      <LogDayLimits day={DAY_ONE} stops={[] as Stop[]} tzOffsetMinutes={TZ} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('explains a driving total above 11 hours instead of leaving it looking illegal', () => {
    render(<LogDayLimits day={withDriving(12.5)} stops={TRIP.stops} tzOffsetMinutes={TZ} />)
    expect(screen.getByText(/12.50 h driving across this calendar day/)).toBeInTheDocument()
    expect(screen.getByText(/counts per shift, not per day/)).toBeInTheDocument()
  })

  it('adds no note when the day is inside the shift limit', () => {
    render(<LogDayLimits day={withDriving(11)} stops={TRIP.stops} tzOffsetMinutes={TZ} />)
    expect(screen.queryByText(/not an 11-hour breach/)).toBeNull()
  })
})
