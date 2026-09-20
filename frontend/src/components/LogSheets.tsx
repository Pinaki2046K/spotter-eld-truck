import { useState } from 'react'

import type { Trip } from '../api/types'
import { formatDate } from '../lib/format'
import { LogSheet } from './LogSheet'

/** Above this many days a plain stack is unwieldy, so a sticky selector appears. */
const STICKY_SELECTOR_THRESHOLD = 3

export function LogSheets({ trip, tzOffsetMinutes }: { trip: Trip; tzOffsetMinutes: number }) {
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const showSelector = trip.log_days.length > STICKY_SELECTOR_THRESHOLD

  async function downloadPdf() {
    setExporting(true)
    setExportError(null)
    try {
      // jsPDF and its dependencies are ~380 kB; they stay out of the initial
      // bundle and load only when someone actually exports.
      const { exportLogSheetsToPdf } = await import('../lib/exportPdf')
      await exportLogSheetsToPdf(
        trip.log_days.map((day) => day.day_number),
        `eld-logs-${trip.log_days[0]?.date ?? 'trip'}.pdf`,
      )
    } catch {
      setExportError('Could not build the PDF. The sheets above are still accurate.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <section aria-labelledby="log-sheets-heading" className="mt-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="log-sheets-heading" className="text-[28px]">
            Daily log sheets
          </h2>
          <p className="mt-1 text-[14px] text-[var(--color-ink-48)]">
            One sheet per calendar day, midnight to midnight in the home terminal timezone.
          </p>
        </div>
        <button
          type="button"
          onClick={downloadPdf}
          disabled={exporting}
          className="rounded-[var(--radius-pill)] border border-[var(--color-hairline)] bg-white px-5 py-2.5 text-[14px] font-semibold text-[var(--color-accent)] transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          {exporting ? 'Building PDF…' : 'Download PDF'}
        </button>
      </div>

      {exportError ? (
        <p role="alert" className="mb-3 text-[13px] text-[#b00020]">
          {exportError}
        </p>
      ) : null}

      {showSelector ? (
        <nav
          aria-label="Jump to log day"
          className="sticky top-0 z-20 -mx-4 mb-4 flex gap-2 overflow-x-auto border-b border-[var(--color-hairline)] bg-[var(--color-parchment)]/90 px-4 py-2.5 backdrop-blur"
        >
          {trip.log_days.map((day) => (
            <a
              key={day.day_number}
              href={`#log-day-${day.day_number}`}
              className="shrink-0 rounded-[var(--radius-pill)] border border-[var(--color-hairline)] bg-white px-3.5 py-1.5 text-[13px] whitespace-nowrap"
            >
              Day {day.day_number}
              <span className="ml-1.5 text-[var(--color-ink-48)]">
                {formatDate(`${day.date}T12:00:00Z`, 0).slice(4)}
              </span>
            </a>
          ))}
        </nav>
      ) : null}

      <div className="flex flex-col gap-6">
        {trip.log_days.map((day) => (
          <article
            key={day.day_number}
            id={`log-day-${day.day_number}`}
            className="scroll-mt-16 overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-hairline)] bg-white"
          >
            <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-divider)] px-5 py-3">
              <h3 className="text-[17px] font-semibold">
                Day {day.day_number}
                <span className="ml-2 font-normal text-[var(--color-ink-48)]">
                  {formatDate(`${day.date}T12:00:00Z`, 0)}, {day.date.slice(0, 4)}
                </span>
              </h3>
              <p className="text-[13px] tabular-nums text-[var(--color-ink-48)]">
                {Math.round(day.total_miles).toLocaleString('en-US')} miles &middot;{' '}
                {day.totals.driving.toFixed(2)} h driving &middot; totals{' '}
                {day.totals.total.toFixed(2)} h
              </p>
            </header>
            {/* Below 768px the sheet scrolls horizontally rather than squashing the grid. */}
            <div className="overflow-x-auto px-3 py-3">
              {/* From and To come from the day's own entries, not the trip. */}
              <LogSheet day={day} tzOffsetMinutes={tzOffsetMinutes} />
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
