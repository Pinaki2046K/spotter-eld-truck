import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TRIP } from './test/fixtures'

vi.mock('./api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api/client')>()),
  getTrip: vi.fn(async () => TRIP),
  pingHealth: vi.fn(),
}))

// Leaflet needs a real layout engine; the map is not what is under test.
vi.mock('./components/RouteMap', () => ({ RouteMap: () => <div data-testid="route-map" /> }))

const { default: App } = await import('./App')

describe('reset', () => {
  beforeEach(() => window.history.replaceState({}, '', `/?trip=${TRIP.id}`))
  afterEach(() => window.history.replaceState({}, '', '/'))

  it('returns a loaded trip to the empty state and drops the trip from the URL', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('button', { name: /^Reset/ })
    expect(await screen.findByTestId('route-map')).toBeInTheDocument()
    expect(document.querySelector('article[id^="log-day"]')).not.toBeNull()

    await user.click(screen.getByRole('button', { name: /^Reset/ }))

    expect(window.location.search).toBe('')
    expect(window.location.pathname).toBe('/')
    expect(screen.queryByTestId('route-map')).toBeNull()
    expect(document.querySelector('article[id^="log-day"]')).toBeNull()
    // The empty state is back (its example-trip call to action is one of these).
    expect(screen.getAllByRole('button', { name: /Load example trip/ }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Plan trip' })).toBeInTheDocument()
    // The form is back, and empty rather than prefilled with the old trip.
    expect(screen.queryByText(TRIP.inputs.pickup_location.label)).toBeNull()
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Trip'))
  })

  it('leaves the shareable link working: a reload with ?trip= still loads the trip', async () => {
    render(<App />)
    expect(await screen.findByRole('button', { name: /^Reset/ })).toBeInTheDocument()
  })
})
