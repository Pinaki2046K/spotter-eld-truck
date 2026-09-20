import { useState } from 'react'

import type { Place, TripRequest } from '../api/types'
import { EXAMPLE_TRIP } from '../lib/exampleTrip'
import { localOffsetMinutes, nextLocalSixAm, toIsoWithOffset } from '../lib/format'
import { LocationField } from './LocationField'

const CYCLE_LIMIT = 70
/** Above this, a restart is all but certain; warn before the driver submits. */
const CYCLE_WARNING_THRESHOLD = 66

export interface TripFormInitialValues {
  current_location: Place
  pickup_location: Place
  dropoff_location: Place
  cycle_hours_used: number
}

interface TripFormProps {
  onSubmit: (payload: TripRequest) => void
  pending: boolean
  fieldError: { field: string | null; message: string } | null
  /** Prefilled when a shared trip URL is opened, so the inputs can be edited. */
  initial?: TripFormInitialValues | null
}

export function TripForm({ onSubmit, pending, fieldError, initial }: TripFormProps) {
  const [current, setCurrent] = useState<Place | null>(initial?.current_location ?? null)
  const [pickup, setPickup] = useState<Place | null>(initial?.pickup_location ?? null)
  const [dropoff, setDropoff] = useState<Place | null>(initial?.dropoff_location ?? null)
  const [cycleHours, setCycleHours] = useState(String(initial?.cycle_hours_used ?? 0))
  const [startLocal, setStartLocal] = useState(nextLocalSixAm)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [touched, setTouched] = useState(false)

  const cycleValue = Number(cycleHours)
  const cycleInvalid =
    cycleHours === '' || Number.isNaN(cycleValue) || cycleValue < 0 || cycleValue > CYCLE_LIMIT
  const missing = !current || !pickup || !dropoff

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (missing || cycleInvalid || !current || !pickup || !dropoff) return

    onSubmit({
      current_location: current,
      pickup_location: pickup,
      dropoff_location: dropoff,
      cycle_hours_used: Math.round(cycleValue * 10) / 10,
      start_datetime: toIsoWithOffset(startLocal, localOffsetMinutes()),
    })
  }

  function loadExample() {
    setCurrent(EXAMPLE_TRIP.current_location)
    setPickup(EXAMPLE_TRIP.pickup_location)
    setDropoff(EXAMPLE_TRIP.dropoff_location)
    setCycleHours(String(EXAMPLE_TRIP.cycle_hours_used))
    // The brief asks for a correct multi-day result in one click, so this
    // plans straight away rather than only filling the fields in. The payload
    // comes from the constant, not from the state set above, which React has
    // not applied yet.
    onSubmit({
      ...EXAMPLE_TRIP,
      start_datetime: toIsoWithOffset(startLocal, localOffsetMinutes()),
    })
  }

  const errorFor = (field: string) => (fieldError?.field === field ? fieldError.message : undefined)

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      <LocationField
        label="Current location"
        required
        value={current}
        onChange={setCurrent}
        error={
          errorFor('current_location') ??
          (touched && !current ? 'Pick a location from the list.' : undefined)
        }
      />
      <LocationField
        label="Pickup location"
        required
        value={pickup}
        onChange={setPickup}
        error={
          errorFor('pickup_location') ??
          (touched && !pickup ? 'Pick a location from the list.' : undefined)
        }
      />
      <LocationField
        label="Dropoff location"
        required
        value={dropoff}
        onChange={setDropoff}
        error={
          errorFor('dropoff_location') ??
          (touched && !dropoff ? 'Pick a location from the list.' : undefined)
        }
      />

      <div>
        <label
          htmlFor="cycle-hours"
          className="block text-[13px] font-semibold text-[var(--color-ink-80)]"
        >
          Current cycle used <span className="font-normal text-[var(--color-ink-48)]">(hours)</span>
        </label>
        <input
          id="cycle-hours"
          type="number"
          inputMode="decimal"
          min={0}
          max={CYCLE_LIMIT}
          step={0.5}
          value={cycleHours}
          onChange={(event) => setCycleHours(event.target.value)}
          aria-invalid={touched && cycleInvalid}
          aria-describedby="cycle-hours-hint"
          className={`mt-1.5 w-full rounded-xl border bg-white px-3.5 py-2.5 text-[15px] tabular-nums outline-none transition-colors ${
            touched && cycleInvalid
              ? 'border-[#b00020]'
              : 'border-[var(--color-hairline)] focus:border-[var(--color-accent)]'
          }`}
        />
        <p id="cycle-hours-hint" className="mt-1 text-[12.5px] text-[var(--color-ink-48)]">
          {touched && cycleInvalid
            ? `Enter a value between 0 and ${CYCLE_LIMIT}.`
            : cycleValue >= CYCLE_LIMIT
              ? 'At the limit. The trip will open with a 34-hour restart.'
              : cycleValue > CYCLE_WARNING_THRESHOLD
                ? 'Close to the limit. A 34-hour restart will likely be required before driving.'
                : `Of ${CYCLE_LIMIT} hours in the current 8-day cycle.`}
        </p>
      </div>

      <div className="border-t border-[var(--color-divider)] pt-3">
        <button
          type="button"
          onClick={() => setDetailsOpen((open) => !open)}
          aria-expanded={detailsOpen}
          className="flex w-full items-center justify-between text-[13px] font-semibold text-[var(--color-ink-80)]"
        >
          Trip details
          <span aria-hidden="true" className="text-[var(--color-ink-48)]">
            {detailsOpen ? '−' : '+'}
          </span>
        </button>
        {detailsOpen ? (
          <div className="mt-3">
            <label
              htmlFor="start-datetime"
              className="block text-[13px] text-[var(--color-ink-48)]"
            >
              Departure (your local time)
            </label>
            <input
              id="start-datetime"
              type="datetime-local"
              value={startLocal}
              onChange={(event) => setStartLocal(event.target.value)}
              className="mt-1.5 w-full rounded-xl border border-[var(--color-hairline)] bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-[var(--color-accent)]"
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2.5">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-pill)] bg-[var(--color-accent)] px-6 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          {pending ? 'Planning…' : 'Plan trip'}
        </button>
        <button
          type="button"
          onClick={loadExample}
          className="rounded-[var(--radius-pill)] border border-[var(--color-hairline)] bg-[var(--color-pearl)] px-6 py-3 text-[15px] text-[var(--color-ink-80)] transition-transform active:scale-[0.98]"
        >
          Load example trip
        </button>
      </div>
    </form>
  )
}
