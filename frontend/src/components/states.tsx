import { useEffect, useState } from 'react'

import { ApiError } from '../api/client'

/** The staged progress line, not a spinner: the wait has real phases. */
const STAGES = ['Geocoding…', 'Routing…', 'Planning hours…', 'Drawing log sheets…']
const STAGE_MS = 1400

export function ResultSkeleton() {
  const [stage, setStage] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(
      () => setStage((current) => Math.min(current + 1, STAGES.length - 1)),
      STAGE_MS,
    )
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div aria-live="polite" aria-busy="true" className="flex flex-col gap-4">
      <p className="text-[15px] text-[var(--color-ink-80)]">{STAGES[stage]}</p>
      <div className="h-[92px] skeleton rounded-[var(--radius-card)]" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="h-[420px] skeleton rounded-[var(--radius-card)]" />
        <div className="h-[420px] skeleton rounded-[var(--radius-card)] lg:col-span-2" />
      </div>
      <div className="h-[320px] skeleton rounded-[var(--radius-card)]" />
      <span className="sr-only">{STAGES[stage]}</span>
    </div>
  )
}

export function EmptyState({ onLoadExample }: { onLoadExample: () => void }) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center rounded-[var(--radius-card)] border border-[var(--color-hairline)] bg-white px-8 py-16 text-center">
      <svg
        width="120"
        height="76"
        viewBox="0 0 120 76"
        aria-hidden="true"
        fill="none"
        stroke="var(--color-hairline)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 20 40 8l40 12 36-12v48l-36 12-40-12L4 68z" />
        <path d="M40 8v48M80 20v48" />
        <path
          d="M26 44c0-6 5-11 11-11s11 5 11 11c0 8-11 18-11 18S26 52 26 44z"
          stroke="var(--color-accent)"
        />
        <circle cx="37" cy="43" r="3.5" stroke="var(--color-accent)" />
      </svg>
      <h2 className="mt-6 text-[24px]">Plan a trip to see its log sheets</h2>
      <p className="mt-2 max-w-md text-[15px] text-[var(--color-ink-48)]">
        Enter three US locations and the hours already used in the current 8-day cycle. You get a
        routed map, every required stop, and one FMCSA log sheet per day.
      </p>
      <button
        type="button"
        onClick={onLoadExample}
        className="mt-6 rounded-[var(--radius-pill)] bg-[var(--color-accent)] px-6 py-3 text-[15px] font-semibold text-white transition-transform active:scale-[0.98]"
      >
        Load example trip
      </button>
    </div>
  )
}

/** Distinct copy per error code, rather than one generic failure toast. */
const ERROR_TITLES: Record<string, string> = {
  GEOCODE_NOT_FOUND: 'We could not find that address',
  OUT_OF_COUNTRY: 'That location is outside the United States',
  NO_ROUTE: 'No drivable route',
  INVALID_CYCLE_HOURS: 'Cycle hours are out of range',
  INVALID_INPUT: 'Check the highlighted field',
  UPSTREAM_TIMEOUT: 'The mapping service is slow right now',
  CYCLE_EXHAUSTED: 'This driver is out of cycle hours',
  NOT_FOUND: 'That trip no longer exists',
  INTERNAL: 'Something went wrong',
}

const ERROR_HINTS: Record<string, string> = {
  UPSTREAM_TIMEOUT: 'Try again in a moment — the request is retried automatically once.',
  OUT_OF_COUNTRY: 'This planner covers US interstate trips only.',
  NO_ROUTE: 'Check that both places are on the road network and not the same point.',
}

export function ErrorNotice({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  const title = ERROR_TITLES[error.code] ?? 'Something went wrong'
  const hint = ERROR_HINTS[error.code]

  return (
    <div
      role="alert"
      className="rounded-[var(--radius-card)] border border-[#f0d0d6] bg-[#fdf6f7] px-5 py-4"
    >
      <p className="text-[15px] font-semibold text-[#b00020]">{title}</p>
      <p className="mt-1 text-[14px] text-[var(--color-ink-80)]">{error.message}</p>
      {hint ? <p className="mt-1 text-[13px] text-[var(--color-ink-48)]">{hint}</p> : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-[var(--radius-pill)] border border-[var(--color-hairline)] bg-white px-4 py-2 text-[14px] font-semibold text-[var(--color-accent)]"
        >
          Try again
        </button>
      ) : null}
    </div>
  )
}
