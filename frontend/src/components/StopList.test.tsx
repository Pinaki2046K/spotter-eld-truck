import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { TRIP } from '../test/fixtures'
import { StopList } from './StopList'

function renderList(overrides: Partial<Parameters<typeof StopList>[0]> = {}) {
  const onHover = vi.fn()
  const onSelect = vi.fn()
  render(
    <StopList
      stops={TRIP.stops}
      tzOffsetMinutes={-300}
      highlighted={null}
      onHover={onHover}
      onSelect={onSelect}
      {...overrides}
    />,
  )
  return { onHover, onSelect }
}

describe('the stop list', () => {
  it('shows every stop with its reason', () => {
    renderList()
    expect(screen.getByText('1. Start')).toBeInTheDocument()
    expect(screen.getByText('2. Daily reset')).toBeInTheDocument()
    expect(screen.getByText('10-hour reset: 11-hour driving limit reached')).toBeInTheDocument()
  })

  it('prints arrival times in the home terminal timezone', () => {
    renderList()
    // 23:00Z is 18:00 Central.
    expect(screen.getByText('18:00 – 04:00')).toBeInTheDocument()
  })

  it('groups stops under the local calendar day', () => {
    renderList()
    expect(screen.getByText('Tue Sep 22')).toBeInTheDocument()
  })

  it('is the non-visual equivalent of the map', () => {
    renderList()
    const row = screen.getByRole('button', { name: /Stop 2, Daily reset at Topeka, KS/ })
    expect(row).toHaveAccessibleName(/Show on map/)
  })

  it('reports hover and selection so the map can follow', async () => {
    const user = userEvent.setup()
    const { onHover, onSelect } = renderList()
    const row = screen.getByRole('button', { name: /Stop 2/ })

    await user.hover(row)
    expect(onHover).toHaveBeenCalledWith(2)

    await user.click(row)
    expect(onSelect).toHaveBeenCalledWith(2)
  })
})

describe('the satisfied 30-minute break', () => {
  it('tags the stop that provided it, so the requirement is findable', () => {
    renderList()
    const pickup = screen.getByRole('button', { name: /Stop 3, Pickup/ })
    expect(pickup).toHaveTextContent('Also satisfies the 30-min break')
  })

  it('tags nothing else', () => {
    renderList()
    expect(screen.getAllByText(/Also satisfies the 30-min break/)).toHaveLength(1)
  })

  it('does not tell a rest-break stop that it also satisfies the break it is', () => {
    const restBreak = {
      ...TRIP.stops[2],
      sequence: 4,
      stop_type: 'REST_BREAK' as const,
      location_label: 'Gibbon, NE',
      reason: '30-minute break: 8 cumulative driving hours reached',
      satisfies_break: true,
    }
    renderList({ stops: [...TRIP.stops, restBreak] })
    const row = screen.getByRole('button', { name: /Stop 4/ })
    expect(row).not.toHaveTextContent('Also satisfies')
    expect(row).not.toHaveAccessibleName(/Also satisfies/)
    // The pickup still carries its credit.
    expect(screen.getAllByText(/Also satisfies the 30-min break/)).toHaveLength(1)
  })

  it('announces the credit to screen readers too', () => {
    renderList()
    expect(screen.getByRole('button', { name: /Stop 3, Pickup/ })).toHaveAccessibleName(
      /Also satisfies the 30-minute break/,
    )
  })
})

describe('row hierarchy', () => {
  it('leads with the stop type and location, not the clock', () => {
    renderList()
    const row = screen.getByRole('button', { name: /Stop 2, Daily reset/ })
    const text = row.textContent ?? ''
    // The type and place come before the time in reading order.
    expect(text.indexOf('2. Daily reset')).toBeLessThan(text.indexOf('18:00'))
    expect(text.indexOf('Topeka, KS')).toBeLessThan(text.indexOf('18:00'))
  })
})
