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

function renderSheet() {
  const { container } = render(
    <LogSheet
      day={DAY_ONE}
      tzOffsetMinutes={-300}
      from="Chicago, Illinois"
      to="Denver, Colorado"
    />,
  )
  return container
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

  it('writes remarks at each duty change, using the location at that moment', () => {
    const container = renderSheet()
    const remarks = [...container.querySelectorAll('text[transform^="rotate"]')].map(
      (n) => n.textContent,
    )
    expect(remarks).toContain('St. Louis, Missouri')
    expect(remarks).toContain('Topeka, KS')
  })
})
