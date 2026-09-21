import { useEffect, useState } from 'react'

import { ApiError } from '../api/client'
import { US_OUTLINE_PATH, US_OUTLINE_VIEWBOX } from '../lib/usOutline'

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
    <div className="relative flex min-h-[420px] flex-col items-center justify-center overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-hairline)] bg-white px-6 py-14 text-center">
      {/* A muted United States sitting behind the copy: the shape says what the
          tool is about before a word is read. Decorative, so hidden from AT. */}
      <svg
        viewBox={US_OUTLINE_VIEWBOX}
        aria-hidden="true"
        focusable="false"
        className="pointer-events-none absolute inset-0 m-auto h-full w-full max-w-[560px] opacity-[0.07]"
        preserveAspectRatio="xMidYMid meet"
      >
        <path d={US_OUTLINE_PATH} fill="var(--color-ink)" />
      </svg>

      <div className="relative">
        <h2 className="text-[26px] leading-tight">Plan a trip, get the log sheets</h2>
        <p className="mx-auto mt-2 max-w-md text-[15px] text-[var(--color-ink-48)]">
          Three US locations and the hours already used this cycle. You get a routed map, every stop
          the Hours of Service rules force you to make, and one FMCSA log sheet per day.
        </p>
        <button
          type="button"
          onClick={onLoadExample}
          className="mt-7 min-h-[48px] rounded-[var(--radius-pill)] bg-[var(--color-accent)] px-7 py-3 text-[16px] font-semibold text-white transition-transform active:scale-[0.98]"
        >
          Load example trip
        </button>
        <p className="mt-3 text-[12.5px] text-[var(--color-ink-48)]">
          Chicago &rarr; St.&nbsp;Louis &rarr; Denver, 20 of 70 cycle hours used
        </p>
      </div>
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
