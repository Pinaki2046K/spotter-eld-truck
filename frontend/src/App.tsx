import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'

import { ApiError, createTrip, getTrip, pingHealth } from './api/client'
import type { Trip, TripRequest } from './api/types'
import { LogSheets } from './components/LogSheets'
import { StopList } from './components/StopList'
import { ComplianceStrip } from './components/ComplianceStrip'
import { SummaryBar } from './components/SummaryBar'
import { TripForm } from './components/TripForm'
import { TripSummaryCard } from './components/TripSummaryCard'
import { EmptyState, ErrorNotice, ResultSkeleton } from './components/states'
import { EXAMPLE_TRIP } from './lib/exampleTrip'
import { defaultStartDatetime } from './lib/format'

/** Leaflet only matters once there is a route to draw. */
const RouteMap = lazy(() =>
  import('./components/RouteMap').then((module) => ({ default: module.RouteMap })),
)

/** A trip id in the URL makes a planned trip shareable and reloadable. */
function tripIdFromUrl(): string | null {
  const id = new URLSearchParams(window.location.search).get('trip')
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null
}

export default function App() {
  const [trip, setTrip] = useState<Trip | null>(null)
  // Initialised from the URL so the effect below never sets state synchronously.
  const [pending, setPending] = useState(() => tripIdFromUrl() !== null)
  const [error, setError] = useState<ApiError | null>(null)
  const [highlighted, setHighlighted] = useState<number | null>(null)
  const [focused, setFocused] = useState<{ sequence: number; nonce: number } | null>(null)
  const [lastRequest, setLastRequest] = useState<TripRequest | null>(null)
  const [editing, setEditing] = useState(false)

  const resultsRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Warm the dyno while the user is still typing.
    pingHealth()

    const id = tripIdFromUrl()
    if (!id) return
    getTrip(id)
      .then(setTrip)
      .catch((cause) =>
        setError(
          cause instanceof ApiError ? cause : new ApiError('INTERNAL', 'Could not load that trip.'),
        ),
      )
      .finally(() => setPending(false))
  }, [])

  const submit = useCallback(async (payload: TripRequest) => {
    setPending(true)
    setError(null)
    setLastRequest(payload)
    try {
      const result = await createTrip(payload)
      setTrip(result)
      setEditing(false)
      const url = new URL(window.location.href)
      url.searchParams.set('trip', result.id)
      window.history.replaceState({}, '', url)
      window.requestAnimationFrame(() =>
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      )
    } catch (cause) {
      setTrip(null)
      setError(
        cause instanceof ApiError ? cause : new ApiError('INTERNAL', 'Could not plan that trip.'),
      )
    } finally {
      setPending(false)
    }
  }, [])

  /**
   * Back to the empty state. The trip lives only in the ?trip= URL (that is
   * what makes it shareable), so dropping the query string is the whole reset;
   * the trip itself stays retrievable at its old link. replaceState, not
   * pushState: nothing listens for popstate, so Back would restore the old URL
   * over an empty page.
   */
  const reset = useCallback(() => {
    setTrip(null)
    setError(null)
    setLastRequest(null)
    setHighlighted(null)
    setFocused(null)
    setEditing(false)
    window.history.replaceState({}, '', window.location.pathname)
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0 })
      // The button that had focus is gone; land keyboard users on the form.
      formRef.current?.querySelector<HTMLElement>('h2')?.focus()
    })
  }, [])

  const tz = trip?.inputs.home_timezone_offset_minutes ?? 0
  const fieldError = error?.field ? { field: error.field, message: error.message } : null

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--color-hairline)] bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-baseline justify-between gap-4 px-4 py-4 sm:px-6">
          <h1 className="text-[21px] font-semibold tracking-tight">Trip Planner &amp; ELD Logs</h1>
          <p className="hidden text-[13px] text-[var(--color-ink-48)] sm:block">
            Property-carrying &middot; 70 hrs / 8 days &middot; FMCSA &sect;395.3
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 pb-24 sm:px-6">
        <div className="grid gap-6 py-6 lg:grid-cols-3">
          <div ref={formRef} className="lg:col-span-1">
            <div className="rounded-[var(--radius-card)] border border-[var(--color-hairline)] bg-white p-5 lg:sticky lg:top-6">
              {trip && !editing && !pending ? (
                <TripSummaryCard
                  inputs={trip.inputs}
                  onEdit={() => setEditing(true)}
                  onReset={reset}
                />
              ) : (
                <>
                  <h2 tabIndex={-1} className="text-[19px] outline-none">
                    Trip
                  </h2>
                  <p className="mt-1 mb-5 text-[13.5px] text-[var(--color-ink-48)]">
                    Three US locations and the hours already used this cycle.
                  </p>
                  <TripForm
                    key={trip?.id ?? 'new'}
                    onSubmit={submit}
                    pending={pending}
                    fieldError={fieldError}
                    initial={trip?.inputs ?? null}
                  />
                </>
              )}
            </div>
          </div>

          <div ref={resultsRef} className="flex flex-col gap-5 lg:col-span-2">
            {error && !fieldError ? (
              <ErrorNotice
                error={error}
                onRetry={lastRequest ? () => void submit(lastRequest) : undefined}
              />
            ) : null}

            {pending ? <ResultSkeleton /> : null}

            {!pending && !trip ? (
              <EmptyState
                onLoadExample={() =>
                  void submit({ ...EXAMPLE_TRIP, start_datetime: defaultStartDatetime() })
                }
              />
            ) : null}

            {!pending && trip ? (
              <>
                <SummaryBar
                  summary={trip.summary}
                  assumptions={trip.assumptions}
                  tzOffsetMinutes={tz}
                />

                <div className="grid gap-5 xl:grid-cols-5">
                  <div className="order-2 flex flex-col gap-5 xl:order-1 xl:col-span-2">
                    <ComplianceStrip compliance={trip.compliance} />
                    <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-hairline)] bg-white">
                      <h2 className="border-b border-[var(--color-divider)] px-4 py-3 text-[17px] font-semibold">
                        Stops
                        <span className="ml-2 font-normal text-[var(--color-ink-48)]">
                          {trip.stops.length}
                        </span>
                      </h2>
                      <div className="max-h-[520px] overflow-y-auto">
                        <StopList
                          stops={trip.stops}
                          tzOffsetMinutes={tz}
                          highlighted={highlighted}
                          onHover={setHighlighted}
                          onSelect={(sequence) => setFocused({ sequence, nonce: Date.now() })}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="order-1 h-[420px] max-h-[72svh] overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-hairline)] bg-white xl:order-2 xl:col-span-3 xl:h-[520px] xl:max-h-none">
                    <Suspense fallback={<div className="skeleton h-full w-full" />}>
                      <RouteMap
                        legs={trip.route.legs}
                        stops={trip.stops}
                        tzOffsetMinutes={tz}
                        highlighted={highlighted}
                        focused={focused}
                      />
                    </Suspense>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>

        {!pending && trip ? <LogSheets trip={trip} tzOffsetMinutes={tz} /> : null}
      </main>

      <footer className="border-t border-[var(--color-hairline)] bg-white">
        <div className="mx-auto max-w-[1440px] px-4 py-6 text-[12.5px] leading-relaxed text-[var(--color-ink-48)] sm:px-6">
          Schedules follow 49 CFR &sect;395.3 for property-carrying drivers: 11 hours driving, a
          14-hour window from the first on-duty minute, a 30-minute break after 8 cumulative driving
          hours, and 70 on-duty hours in 8 days. Split sleeper-berth pairings, short-haul and
          adverse-conditions exceptions are out of scope. Map data &copy; OpenStreetMap
          contributors.
        </div>
      </footer>
    </div>
  )
}
