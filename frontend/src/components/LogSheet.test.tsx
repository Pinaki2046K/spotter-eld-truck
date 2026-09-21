import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DAY_ONE } from '../test/fixtures'
import { LogSheet } from './LogSheet'

/** Mirrors the constants in LogSheet.tsx; a change to either must be deliberate. */
const GRID_LEFT = 150
const GRID_RIGHT = 900
const HOUR_WIDTH = (GRID_RIGHT - GRID_LEFT) / 24
const GRID_TOP = 284
const ROW_HEIGHT = 32
const ROW_Y = {
  OFF_DUTY: GRID_TOP + ROW_HEIGHT / 2,
  SLEEPER_BERTH: GRID_TOP + ROW_HEIGHT * 1.5,
  DRIVING: GRID_TOP + ROW_HEIGHT * 2.5,
  ON_DUTY_NOT_DRIVING: GRID_TOP + ROW_HEIGHT * 3.5,
}

function renderSheet(day = DAY_ONE) {
  const { container } = render(<LogSheet day={day} tzOffsetMinutes={-300} />)
  return container
}

function headerValue(container: HTMLElement, label: string): string {
  const caption = [...container.querySelectorAll('text')].find((n) => n.textContent === label)
  // FilledLine draws the value, then the rule, then the caption, in one <g>.
  const group = caption?.parentElement
  return group?.querySelector('text')?.textContent ?? ''
}

function dutyPoints(container: HTMLElement): [number, number][] {
  const polyline = container.querySelector('polyline')
  expect(polyline).not.toBeNull()
  return polyline!
    .getAttribute('points')!
    .trim()
    .split(' ')
    .map((pair) => pair.split(',').map(Number) as [number, number])
}

describe('the duty line', () => {
  it('spans the full 24 hours, edge to edge', () => {
    const points = dutyPoints(renderSheet())
    expect(points[0][0]).toBeCloseTo(GRID_LEFT, 2)
    expect(points.at(-1)![0]).toBeCloseTo(GRID_RIGHT, 2)
  })

  it('places each run on its regulation row', () => {
    const points = dutyPoints(renderSheet())
    // One pair of points per entry, in order.
    expect(points).toHaveLength(DAY_ONE.entries.length * 2)
    const rows = DAY_ONE.entries.map((entry) => ROW_Y[entry.status])
    points.forEach(([, y], index) => {
      expect(y).toBeCloseTo(rows[Math.floor(index / 2)], 2)
    })
  })

  it('is continuous: every run starts where the previous one ended', () => {
    const points = dutyPoints(renderSheet())
    for (let index = 1; index < points.length - 1; index += 2) {
      expect(points[index][0]).toBeCloseTo(points[index + 1][0], 6)
    }
  })

  it('puts the pickup hour at 11:24 local, not at the UTC instant', () => {
    const points = dutyPoints(renderSheet())
    const pickupStart = points[4][0]
    expect(pickupStart).toBeCloseTo(GRID_LEFT + 11.4 * HOUR_WIDTH, 2)
    expect(points[4][1]).toBeCloseTo(ROW_Y.ON_DUTY_NOT_DRIVING, 2)
  })
})

describe('the sheet as a document', () => {
  it('renders the totals column and the 24-hour proof', () => {
    renderSheet()
    expect(screen.getByText('= 24.00')).toBeInTheDocument()
    expect(screen.getByText('11.00')).toBeInTheDocument()
  })

  it('splits the date into month, day and year cells', () => {
    const container = renderSheet()
    // Scoped to the date block: "22" also appears as an hour label on the grid.
    const cells = [...container.querySelectorAll('[data-testid="log-date"] text')].map(
      (node) => node.textContent,
    )
    expect(cells).toEqual(['09', '(month)', '/', '22', '(day)', '/', '2026', '(year)'])
  })

  it('labels the four rows in regulation order', () => {
    const container = renderSheet()
    const labels = [...container.querySelectorAll('text')]
      .map((node) => node.textContent)
      .filter(
        (text) =>
          text && ['Off Duty', 'Sleeper Berth', 'Driving', 'On Duty (Not Driving)'].includes(text),
      )
    expect(labels).toEqual(['Off Duty', 'Sleeper Berth', 'Driving', 'On Duty (Not Driving)'])
  })

  it('carries an accessible description for screen readers', () => {
    renderSheet()
    expect(screen.getByRole('img')).toHaveAccessibleName(/11.00 hours driving/)
  })

  it('leaves unknown header fields as blank ruled lines rather than placeholders', () => {
    renderSheet()
    expect(screen.getByText('Name of carrier or carriers')).toBeInTheDocument()
    expect(screen.queryByText(/N\/A|TBD|Lorem/i)).toBeNull()
  })

  it('renders placeholder hints as real characters, not escape sequences', () => {
    // JSX attribute strings are not JS literals: hint="a \u2014 b" prints the
    // backslash sequence verbatim. Entities or {'...'} expressions are decoded.
    const container = renderSheet()
    expect(screen.getByText('none \u2014 single driver')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/\\u[0-9a-f]{4}/i)
  })

  it('writes a remark at every duty change: time, city and state, and the activity', () => {
    const container = renderSheet()
    // The number and the line are separate <text> elements; join them as read.
    const rows = [...container.querySelectorAll('[data-testid="remark"]')].map((row) =>
      [...row.querySelectorAll(':scope > text')]
        .map((node) => node.textContent)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    expect(rows).toEqual([
      '1 00:00 Chicago, IL — Off duty',
      '2 06:00 Chicago, IL — Driving',
      '3 11:24 St. Louis, MO — Loading',
      '4 12:24 St. Louis, MO — Driving',
      '5 18:00 Topeka, KS — 10-hr rest (sleeper)',
    ])
  })

  it('matches the paper form: both mileage boxes, home terminal, no odometer line', () => {
    const container = renderSheet()
    expect(headerValue(container, 'Total miles driving today')).toBe('605')
    expect(headerValue(container, 'Total mileage today')).toBe('605')
    expect(screen.getByText('Home terminal address')).toBeInTheDocument()
    expect(screen.getByText('Shipper & commodity')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Truck/tractor and trailer numbers or license plate(s)/state (show each unit)',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/odometer/i)).toBeNull()
  })

  it('fills the 70-hour/8-day recap from the day and the cycle total', () => {
    const container = renderSheet()
    const text = container.querySelector('[data-testid="recap"]')!.textContent ?? ''
    // On duty today: 11 driving + 1 loading. Cycle at midnight: 32 of 70.
    expect(text).toContain('12.00On-duty hours today')
    expect(text).toContain('32.00A. On duty last 7 days')
    expect(text).toContain('38.00B. Available tomorrow')
    expect(text).toContain('32.00C. On duty last 8 days')
  })

  it('leaves the recap cycle cells blank for a trip planned before they existed', () => {
    const container = renderSheet({ ...DAY_ONE, cycle_hours_used_end: null })
    const text = container.querySelector('[data-testid="recap"]')!.textContent ?? ''
    expect(text).toContain('12.00On-duty hours today')
    expect(text).toContain('—A. On duty last 7 days')
    expect(text).not.toContain('NaN')
  })
})

describe("the header's From and To", () => {
  it('describe the day, not the whole trip', () => {
    const container = renderSheet()
    // Day 1 runs Chicago to the overnight stop, not Chicago to the dropoff.
    expect(headerValue(container, 'From')).toBe('Chicago, IL')
    expect(headerValue(container, 'To')).toBe('Topeka, KS')
  })

  it('start a later day where the driver actually shut down', () => {
    const dayTwo = {
      ...DAY_ONE,
      day_number: 2,
      date: '2026-09-23',
      entries: [
        { ...DAY_ONE.entries[0], location_label: 'Topeka, KS', status: 'SLEEPER_BERTH' as const },
        { ...DAY_ONE.entries[4], location_label: 'Denver, Colorado' },
      ],
    }
    const container = renderSheet(dayTwo)
    expect(headerValue(container, 'From')).toBe('Topeka, KS')
    expect(headerValue(container, 'To')).toBe('Denver, CO')
  })
})

describe('remark markers', () => {
  function markers(container: HTMLElement) {
    return [...container.querySelectorAll('[data-testid="remark-marker"]')].map((group) => {
      const leader = group.querySelector('line')!
      const circle = group.querySelector('circle')!
      return {
        number: group.querySelector('text')!.textContent,
        leaderX: Number(leader.getAttribute('x1')),
        cx: Number(circle.getAttribute('cx')),
        cy: Number(circle.getAttribute('cy')),
      }
    })
  }

  it('marks every change on the grid, numbered like the list', () => {
    const found = markers(renderSheet())
    expect(found.map((m) => m.number)).toEqual(['1', '2', '3', '4', '5'])
    expect(found[2].leaderX).toBeCloseTo(GRID_LEFT + 11.4 * HOUR_WIDTH, 2)
  })

  it('does not drop a change that happens where the truck already is', () => {
    // Resuming driving at the pickup city is a change of duty status too.
    const container = renderSheet()
    const rows = [...container.querySelectorAll('[data-testid="remark"]')].map((r) => r.textContent)
    expect(rows.filter((r) => r?.includes('St. Louis, MO'))).toHaveLength(2)
  })

  it('keeps a midnight marker inside the box while its leader marks true midnight', () => {
    const [first] = markers(renderSheet())
    expect(first.leaderX).toBeCloseTo(GRID_LEFT, 6)
    expect(first.cx).toBeGreaterThan(GRID_LEFT + 7)
  })

  it('staggers markers that would touch instead of dropping one', () => {
    const base = DAY_ONE.entries[0]
    const crowded = {
      ...DAY_ONE,
      entries: [
        { ...base, start_time: '2026-09-22T05:00:00Z', location_label: 'Alpha, IL' },
        { ...base, start_time: '2026-09-22T12:00:00Z', location_label: 'Bravo, MO' },
        { ...base, start_time: '2026-09-22T12:15:00Z', location_label: 'Charlie, MO' },
        { ...base, start_time: '2026-09-22T12:30:00Z', location_label: 'Delta, MO' },
      ],
    }
    const found = markers(renderSheet(crowded))
    expect(found).toHaveLength(4)
    expect(new Set(found.slice(1).map((m) => m.cy)).size).toBe(3)
    expect(found[0].cy).toBe(found[1].cy) // an uncrowded marker stays in lane 0
  })
})
