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

  it('writes remarks at each duty change, using the location at that moment', () => {
    const container = renderSheet()
    const remarks = [...container.querySelectorAll('text[transform^="rotate"]')].map(
      (n) => n.textContent,
    )
    expect(remarks).toContain('St. Louis, Missouri')
    expect(remarks).toContain('Topeka, KS')
  })
})

describe("the header's From and To", () => {
  it('describe the day, not the whole trip', () => {
    const container = renderSheet()
    // Day 1 runs Chicago to the overnight stop, not Chicago to the dropoff.
    expect(headerValue(container, 'From')).toBe('Chicago, Illinois')
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
    expect(headerValue(container, 'To')).toBe('Denver, Colorado')
  })
})

describe('remarks crowding', () => {
  function remarkLabels(container: HTMLElement) {
    return [...container.querySelectorAll('text[transform^="rotate"]')].map((n) => n.textContent)
  }

  it('drops a repeated location rather than printing it twice', () => {
    const labels = remarkLabels(renderSheet())
    // Chicago appears on both the opening off-duty run and the first driving
    // run; going on duty where you already are is not a new remark.
    expect(labels.filter((l) => l === 'Chicago, Illinois')).toHaveLength(1)
  })

  it('keeps a midnight remark inside the box while its leader marks true midnight', () => {
    // DAY_ONE opens at 05:00Z, which is 00:00 Central: x lands on the border.
    const container = renderSheet()
    const label = [...container.querySelectorAll('text[transform^="rotate"]')].find(
      (n) => n.textContent === 'Chicago, Illinois',
    )!
    const leader = label.previousElementSibling!
    expect(Number(leader.getAttribute('x1'))).toBeCloseTo(GRID_LEFT, 6)
    expect(Number(label.getAttribute('x'))).toBeGreaterThanOrEqual(GRID_LEFT + 3)
  })

  it('staggers labels that fall within 45 minutes instead of dropping one', () => {
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
    const container = renderSheet(crowded)

    // Nothing is discarded...
    expect(remarkLabels(container)).toEqual(['Alpha, IL', 'Bravo, MO', 'Charlie, MO', 'Delta, MO'])
    // ...and the three crowded ones sit at different depths.
    const depths = [...container.querySelectorAll('text[transform^="rotate"]')].map((n) =>
      Number(n.getAttribute('y')),
    )
    expect(new Set(depths.slice(1)).size).toBe(3)
    expect(depths[0]).toBe(depths[1]) // an uncrowded label stays in lane 0
  })
})
