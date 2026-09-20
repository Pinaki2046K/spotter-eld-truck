import type { LogDay } from '../api/types'
import { ACCENT, DANGER, HAIRLINE, INK, INK_MUTED, ROW_TINT, SVG_FONT_STACK } from '../lib/colors'
import { DUTY_LABELS, DUTY_ROWS } from '../lib/duty'
import { formatHours, hoursIntoDay, splitLogDate } from '../lib/format'

/**
 * One FMCSA driver's daily log, drawn as inline SVG.
 *
 * Every coordinate below is computed from the grid constants rather than
 * eyeballed against the blank-paper-log raster, so the sheet stays sharp at any
 * zoom and exports to vector PDF without a headless browser.
 */

const WIDTH = 1000
const HEIGHT = 680

const GRID_LEFT = 150
const GRID_RIGHT = 900
const GRID_TOP = 284
const ROW_HEIGHT = 32
const GRID_WIDTH = GRID_RIGHT - GRID_LEFT
const HOUR_WIDTH = GRID_WIDTH / 24
const GRID_BOTTOM = GRID_TOP + ROW_HEIGHT * DUTY_ROWS.length
const TOTALS_LEFT = GRID_RIGHT
const REMARKS_TOP = GRID_BOTTOM + 8
const REMARKS_HEIGHT = 120
/** Duty changes closer together than this share the row, so they stagger. */
const REMARK_STAGGER_MINUTES = 45
const REMARK_STAGGER_WIDTH = (REMARK_STAGGER_MINUTES / 60) * HOUR_WIDTH
const REMARK_LANES = 3
const REMARK_LANE_DEPTH = 26

const RULE = INK
// Text weights here are 400/700 only: jsPDF has no 600-weight Helvetica, and a
// 600 would export as an unstyled fallback with a console warning.

const HOUR_LABELS = Array.from({ length: 25 }, (_, hour) => {
  if (hour === 0 || hour === 24) return ['Mid-', 'night']
  if (hour === 12) return ['Noon']
  return [String(hour % 24)]
})

function xForHour(hour: number): number {
  return GRID_LEFT + hour * HOUR_WIDTH
}

function rowCentre(status: string): number {
  return GRID_TOP + DUTY_ROWS.indexOf(status as never) * ROW_HEIGHT + ROW_HEIGHT / 2
}

/** Hours past local midnight, with 24:00 (not 00:00) for an end-of-day boundary. */
function endHour(iso: string, tz: number): number {
  const value = hoursIntoDay(iso, tz)
  return value === 0 ? 24 : value
}

interface LogSheetProps {
  day: LogDay
  tzOffsetMinutes: number
  /** Overrides the day's own first/last location. Used only by tests. */
  from?: string
  to?: string
  /** Rendered into the header; the real form has a line for it. */
  carrier?: string
  officeAddress?: string
}

export function LogSheet({
  day,
  tzOffsetMinutes,
  from,
  to,
  carrier,
  officeAddress,
}: LogSheetProps) {
  const { month, day: dayOfMonth, year } = splitLogDate(day.date)

  // The form's From and To describe *this day's* run, not the whole trip. Day 2
  // of a Chicago-to-Denver haul starts wherever the driver shut down, which is
  // the middle of Kansas, not Chicago.
  const fromLabel = from ?? day.entries[0]?.location_label ?? ''
  const toLabel = to ?? day.entries.at(-1)?.location_label ?? fromLabel

  // The duty line is one polyline: a horizontal run on each status's row, with
  // the vertical connector falling out of consecutive points sharing an x.
  const points = day.entries.flatMap((entry) => {
    const y = rowCentre(entry.status)
    const start = xForHour(hoursIntoDay(entry.start_time, tzOffsetMinutes))
    const end = xForHour(endHour(entry.end_time, tzOffsetMinutes))
    return [`${start.toFixed(2)},${y}`, `${end.toFixed(2)},${y}`]
  })

  // Remarks: city and state at each duty change.
  //
  // Two things crowd this row. A status change that does not move the truck --
  // arriving somewhere and going on duty there -- repeats the location, so
  // consecutive duplicates are dropped. And changes close together in time
  // print on top of each other, so anything within REMARK_STAGGER_MINUTES of
  // its neighbour drops to a deeper lane rather than being discarded: in a busy
  // stretch the crowded label is often the one a reader most wants.
  const remarks: { x: number; label: string; lane: number }[] = []
  for (const entry of day.entries) {
    if (!entry.location_label) continue
    const previous = remarks.at(-1)
    if (previous && previous.label === entry.location_label) continue

    const x = xForHour(hoursIntoDay(entry.start_time, tzOffsetMinutes))
    const crowded = previous !== undefined && x - previous.x < REMARK_STAGGER_WIDTH
    remarks.push({
      x,
      label: entry.location_label,
      lane: crowded ? (previous.lane + 1) % REMARK_LANES : 0,
    })
  }

  const totals: [string, number][] = [
    ['OFF_DUTY', day.totals.off_duty],
    ['SLEEPER_BERTH', day.totals.sleeper],
    ['DRIVING', day.totals.driving],
    ['ON_DUTY_NOT_DRIVING', day.totals.on_duty],
  ]

  return (
    <svg
      id={`log-sheet-${day.day_number}`}
      data-testid={`log-sheet-${day.day_number}`}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width="100%"
      role="img"
      aria-label={`Driver's daily log for ${day.date}: ${formatHours(day.totals.driving)} hours driving, ${formatHours(day.totals.on_duty)} hours on duty not driving, ${day.total_miles} miles.`}
      style={{ display: 'block', background: '#ffffff', minWidth: 760 }}
      fontFamily={SVG_FONT_STACK}
    >
      <rect x="0" y="0" width={WIDTH} height={HEIGHT} fill="#ffffff" />

      <Header
        month={month}
        dayOfMonth={dayOfMonth}
        year={year}
        from={fromLabel}
        to={toLabel}
        totalMiles={day.total_miles}
        carrier={carrier}
        officeAddress={officeAddress}
      />

      <Grid />

      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={ACCENT}
        strokeWidth="2.5"
        strokeLinejoin="miter"
        strokeLinecap="butt"
      />

      <TotalsColumn totals={totals} grandTotal={day.totals.total} />

      <Remarks remarks={remarks} />

      <Footer totalMiles={day.total_miles} />
    </svg>
  )
}

function Header({
  month,
  dayOfMonth,
  year,
  from,
  to,
  totalMiles,
  carrier,
  officeAddress,
}: {
  month: string
  dayOfMonth: string
  year: string
  from: string
  to: string
  totalMiles: number
  carrier?: string
  officeAddress?: string
}) {
  return (
    <g>
      <text x="24" y="42" fontSize="22" fontWeight="700" fill={RULE}>
        Driver&rsquo;s Daily Log
      </text>
      <text x="24" y="62" fontSize="11" fill={INK_MUTED}>
        (24 hours) &mdash; One calendar day
      </text>

      {/* Date, as month / day / year over ruled lines, matching the form. */}
      <g data-testid="log-date" transform="translate(300, 30)">
        <DateCell x={0} value={month} caption="(month)" />
        <text x={72} y="16" fontSize="16" fill={RULE}>
          /
        </text>
        <DateCell x={88} value={dayOfMonth} caption="(day)" />
        <text x={160} y="16" fontSize="16" fill={RULE}>
          /
        </text>
        <DateCell x={176} value={year} caption="(year)" />
      </g>

      <g transform="translate(560, 24)" fontSize="10" fill={INK_MUTED}>
        <text x="0" y="10">
          Original &mdash; File at home terminal.
        </text>
        <text x="0" y="26">
          Duplicate &mdash; Driver retains in his/her possession for eight days.
        </text>
      </g>

      <FilledLine x={24} y={122} width={330} label="From" value={from} />
      <FilledLine x={382} y={122} width={330} label="To" value={to} />
      <FilledLine
        x={740}
        y={122}
        width={236}
        label="Total miles driving today"
        value={String(Math.round(totalMiles))}
      />

      <FilledLine x={24} y={176} width={468} label="Name of carrier or carriers" value={carrier} />
      <FilledLine x={520} y={176} width={456} label="Main office address" value={officeAddress} />

      <FilledLine x={24} y={224} width={468} label="Truck / tractor and trailer numbers" />
      <FilledLine x={520} y={224} width={456} label="Vehicle odometer / VIN" />
    </g>
  )
}

function DateCell({ x, value, caption }: { x: number; value: string; caption: string }) {
  return (
    <g transform={`translate(${x}, 0)`}>
      <text x="32" y="14" fontSize="17" fontWeight="700" textAnchor="middle" fill={RULE}>
        {value}
      </text>
      <line x1="0" y1="20" x2="64" y2="20" stroke={RULE} strokeWidth="1" />
      <text x="32" y="32" fontSize="9" textAnchor="middle" fill={INK_MUTED}>
        {caption}
      </text>
    </g>
  )
}

/**
 * A ruled header line. Populated where we have data, left blank where we do
 * not -- placeholder text on a legal form would be worse than an empty line.
 */
function FilledLine({
  x,
  y,
  width,
  label,
  value,
}: {
  x: number
  y: number
  width: number
  label: string
  value?: string
}) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {value ? (
        <text x="4" y="-6" fontSize="13" fill={RULE}>
          {value.length > Math.floor(width / 7)
            ? `${value.slice(0, Math.floor(width / 7))}…`
            : value}
        </text>
      ) : null}
      <line x1="0" y1="0" x2={width} y2="0" stroke={RULE} strokeWidth="1" />
      <text x="0" y="14" fontSize="9.5" fill={INK_MUTED}>
        {label}
      </text>
    </g>
  )
}

function Grid() {
  const hours = Array.from({ length: 25 }, (_, hour) => hour)

  return (
    <g>
      {/* Hour labels across the top. */}
      {hours.map((hour) => (
        <g key={hour}>
          {HOUR_LABELS[hour].map((line, index) => (
            <text
              key={line}
              x={xForHour(hour)}
              y={GRID_TOP - 22 + index * 10}
              fontSize="9"
              textAnchor="middle"
              fill={RULE}
            >
              {line}
            </text>
          ))}
        </g>
      ))}

      {/* Row bands and their labels. */}
      {DUTY_ROWS.map((status, index) => {
        const top = GRID_TOP + index * ROW_HEIGHT
        return (
          <g key={status}>
            <rect
              x={GRID_LEFT}
              y={top}
              width={GRID_WIDTH}
              height={ROW_HEIGHT}
              fill={index % 2 === 0 ? '#ffffff' : ROW_TINT}
            />
            <text
              x={GRID_LEFT - 10}
              y={top + ROW_HEIGHT / 2 + 4}
              fontSize="11"
              textAnchor="end"
              fill={RULE}
            >
              {DUTY_LABELS[status]}
            </text>
            <text
              x="24"
              y={top + ROW_HEIGHT / 2 + 4}
              fontSize="12"
              fontWeight="700"
              fill={INK_MUTED}
            >
              {index + 1}
            </text>
          </g>
        )
      })}

      {/* Quarter-hour ticks, drawn per row from the top edge like the paper form. */}
      {DUTY_ROWS.map((status, rowIndex) => {
        const top = GRID_TOP + rowIndex * ROW_HEIGHT
        return (
          <g key={`ticks-${status}`} stroke={HAIRLINE} strokeWidth="0.6">
            {hours.slice(0, 24).flatMap((hour) =>
              [1, 2, 3].map((quarter) => {
                const x = xForHour(hour + quarter / 4)
                const length = quarter === 2 ? ROW_HEIGHT * 0.42 : ROW_HEIGHT * 0.22
                return <line key={`${hour}-${quarter}`} x1={x} y1={top} x2={x} y2={top + length} />
              }),
            )}
          </g>
        )
      })}

      {/* Hour boundaries. */}
      {hours.map((hour) => (
        <line
          key={`hour-${hour}`}
          x1={xForHour(hour)}
          y1={GRID_TOP}
          x2={xForHour(hour)}
          y2={GRID_BOTTOM}
          stroke={hour % 6 === 0 ? RULE : HAIRLINE}
          strokeWidth={hour % 6 === 0 ? 1 : 0.6}
        />
      ))}

      {/* Row separators, plus the outer frame. */}
      {DUTY_ROWS.map((status, index) => (
        <line
          key={`row-${status}`}
          x1={GRID_LEFT}
          y1={GRID_TOP + index * ROW_HEIGHT}
          x2={TOTALS_LEFT + 96}
          y2={GRID_TOP + index * ROW_HEIGHT}
          stroke={RULE}
          strokeWidth="1"
        />
      ))}
      <line
        x1={GRID_LEFT}
        y1={GRID_BOTTOM}
        x2={TOTALS_LEFT + 96}
        y2={GRID_BOTTOM}
        stroke={RULE}
        strokeWidth="1"
      />
      <line
        x1={TOTALS_LEFT}
        y1={GRID_TOP}
        x2={TOTALS_LEFT}
        y2={GRID_BOTTOM}
        stroke={RULE}
        strokeWidth="1"
      />
      <line
        x1={TOTALS_LEFT + 96}
        y1={GRID_TOP}
        x2={TOTALS_LEFT + 96}
        y2={GRID_BOTTOM}
        stroke={RULE}
        strokeWidth="1"
      />
    </g>
  )
}

/** The visible proof of the 24-hour invariant. */
function TotalsColumn({ totals, grandTotal }: { totals: [string, number][]; grandTotal: number }) {
  return (
    <g>
      <text x={TOTALS_LEFT + 48} y={GRID_TOP - 14} fontSize="9.5" textAnchor="middle" fill={RULE}>
        Total hours
      </text>
      {totals.map(([status, hours], index) => (
        <text
          key={status}
          x={TOTALS_LEFT + 48}
          y={GRID_TOP + index * ROW_HEIGHT + ROW_HEIGHT / 2 + 5}
          fontSize="14"
          fontWeight="700"
          textAnchor="middle"
          fill={RULE}
        >
          {formatHours(hours)}
        </text>
      ))}
      <text
        x={TOTALS_LEFT + 48}
        y={GRID_BOTTOM + 20}
        fontSize="14"
        fontWeight="700"
        textAnchor="middle"
        fill={grandTotal === 24 ? ACCENT : DANGER}
      >
        = {formatHours(grandTotal)}
      </text>
    </g>
  )
}

function Remarks({ remarks }: { remarks: { x: number; label: string; lane: number }[] }) {
  return (
    <g>
      <rect
        x={GRID_LEFT}
        y={REMARKS_TOP}
        width={GRID_WIDTH}
        height={REMARKS_HEIGHT}
        fill="#ffffff"
        stroke={RULE}
        strokeWidth="1"
      />
      <text x={GRID_LEFT - 10} y={REMARKS_TOP + 16} fontSize="11" textAnchor="end" fill={RULE}>
        Remarks
      </text>

      {remarks.map(({ x, label, lane }) => {
        // A deeper lane means a longer leader line, so a staggered label still
        // points unambiguously at its own moment on the grid.
        const leaderEnd = REMARKS_TOP + 14 + lane * REMARK_LANE_DEPTH
        return (
          <g key={`${x}-${label}`}>
            <line x1={x} y1={REMARKS_TOP} x2={x} y2={leaderEnd} stroke={RULE} strokeWidth="0.8" />
            <text
              x={x}
              y={leaderEnd + 4}
              fontSize="9"
              fill={RULE}
              transform={`rotate(90 ${x} ${leaderEnd + 4})`}
            >
              {label.length > 22 ? `${label.slice(0, 22)}…` : label}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function Footer({ totalMiles }: { totalMiles: number }) {
  const y = REMARKS_TOP + REMARKS_HEIGHT + 34
  return (
    <g>
      <FilledLine x={24} y={y} width={300} label="Shipping document number(s)" />
      <FilledLine x={352} y={y} width={300} label="Driver's signature in full" />
      <FilledLine x={680} y={y} width={296} label="Co-driver's name (if any)" />
      <text x={24} y={y + 42} fontSize="9.5" fill={INK_MUTED}>
        {Math.round(totalMiles).toLocaleString('en-US')} miles driven today. Times shown in the home
        terminal timezone.
      </text>
    </g>
  )
}
