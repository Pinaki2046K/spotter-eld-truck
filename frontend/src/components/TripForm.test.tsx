import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { TripForm } from './TripForm'

function renderForm(props: Partial<Parameters<typeof TripForm>[0]> = {}) {
  const onSubmit = vi.fn()
  render(<TripForm onSubmit={onSubmit} pending={false} fieldError={null} {...props} />)
  return { onSubmit }
}

async function setCycleHours(value: string) {
  const user = userEvent.setup()
  const input = screen.getByLabelText(/Current cycle used/)
  await user.clear(input)
  await user.type(input, value)
}

describe('cycle hours', () => {
  it('warns that a restart is likely once the driver passes 66 hours', async () => {
    renderForm()
    await setCycleHours('68')
    expect(screen.getByText(/34-hour restart will likely be required/)).toBeInTheDocument()
  })

  it('says the trip will open with a restart at exactly 70', async () => {
    renderForm()
    await setCycleHours('70')
    expect(screen.getByText(/will open with a 34-hour restart/)).toBeInTheDocument()
  })

  it('stays quiet well inside the cycle', async () => {
    renderForm()
    await setCycleHours('20')
    expect(screen.getByText(/Of 70 hours in the current 8-day cycle/)).toBeInTheDocument()
  })
})

describe('submission', () => {
  it('refuses to submit without three resolved locations', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm()

    await user.click(screen.getByRole('button', { name: 'Plan trip' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getAllByText('Pick a location from the list.')).toHaveLength(3)
  })

  it('sends resolved coordinates and an explicit offset, never raw text', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderForm({
      initial: {
        current_location: { label: 'Chicago, Illinois', lat: 41.8781, lon: -87.6298 },
        pickup_location: { label: 'St. Louis, Missouri', lat: 38.627, lon: -90.1994 },
        dropoff_location: { label: 'Denver, Colorado', lat: 39.7392, lon: -104.9903 },
        cycle_hours_used: 20,
      },
    })

    await user.click(screen.getByRole('button', { name: 'Plan trip' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const payload = onSubmit.mock.calls[0][0]
    expect(payload.pickup_location).toEqual({
      label: 'St. Louis, Missouri',
      lat: 38.627,
      lon: -90.1994,
    })
    expect(payload.cycle_hours_used).toBe(20)
    expect(payload.start_datetime).toMatch(/[+-]\d{2}:\d{2}$/)
  })

  it('surfaces a server field error against the right input', () => {
    renderForm({
      fieldError: {
        field: 'pickup_location',
        message: 'That location is outside the United States.',
      },
    })
    expect(screen.getByText('That location is outside the United States.')).toBeInTheDocument()
  })

  it('fills the example trip in one click', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(screen.getByRole('button', { name: 'Load example trip' }))
    expect(screen.getByDisplayValue('Chicago, Illinois')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Denver, Colorado')).toBeInTheDocument()
  })
})
