import type { LogDay } from '../api/types'
import { ACCENT, DANGER, HAIRLINE, INK, INK_MUTED, ROW_TINT, SVG_FONT_STACK } from '../lib/colors'
import { DUTY_LABELS, DUTY_ROWS } from '../lib/duty'
import { formatHours, hoursIntoDay, splitLogDate } from '../lib/format'
import { shortPlace } from '../lib/places'
import { buildRemarks, type Remark } from '../lib/remarks'

/**
 * One FMCSA driver's daily log, drawn as inline SVG.
 *
 * Every coordinate below is computed from the grid constants rather than
 * eyeballed against the blank-paper-log raster, so the sheet stays sharp at any
 * zoom and exports to vector PDF without a headless browser.
 */

const WIDTH = 1000

const GRID_LEFT = 150
const GRID_RIGHT = 900
const GRID_TOP = 284
const ROW_HEIGHT = 32
const GRID_WIDTH = GRID_RIGHT - GRID_LEFT
const HOUR_WIDTH = GRID_WIDTH / 24
const GRID_BOTTOM = GRID_TOP + ROW_HEIGHT * DUTY_ROWS.length
const TOTALS_LEFT = GRID_RIGHT
const REMARKS_TOP = GRID_BOTTOM + 8

/*
 * Remarks. Every change of duty status gets a numbered marker on a leader
 * dropped from the grid at that minute, and the same number in a list below
 * with the time, the place (city, state) and the activity. Rotated labels
 * could not carry the activity: at 9px, "Post-trip inspection" alone is taller
 * than the box, and a 15-minute inspection sits 8px from the next change.
 */
const MARKER_RADIUS = 7
const MARKER_LANES = 3
const MARKER_LANE_DEPTH = 16
/** Markers closer than this horizontally would touch, so they stagger down. */
const MARKER_MIN_GAP = MARKER_RADIUS * 2 + 3
const MARKER_BAND = 14 + (MARKER_LANES - 1) * MARKER_LANE_DEPTH + MARKER_RADIUS + 4
const REMARK_COLUMNS = 3
const REMARK_ROW_HEIGHT = 13
const REMARK_COLUMN_WIDTH = (GRID_WIDTH - 20) / REMARK_COLUMNS
const RECAP_HEIGHT = 112

/** Where each section sits, given how many remarks the day has. */
function layoutFor(remarkCount: number) {
  const rows = Math.max(3, Math.ceil(remarkCount / REMARK_COLUMNS))
  const remarksHeight = MARKER_BAND + 10 + rows * REMARK_ROW_HEIGHT + 6
  const instructionY = REMARKS_TOP + remarksHeight + 16
  const footerY = instructionY + 40
  const recapTop = footerY + 36
  return {
    rows,
    remarksHeight,
    instructionY,
    footerY,
    recapTop,
    height: recapTop + RECAP_HEIGHT,
  }
}

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
  const fromLabel = from ?? shortPlace(day.entries[0]?.location_label ?? '')
  const toLabel = to ?? (shortPlace(day.entries.at(-1)?.location_label ?? '') || fromLabel)

  // The duty line is one polyline: a horizontal run on each status's row, with
  // the vertical connector falling out of consecutive points sharing an x.
  const points = day.entries.flatMap((entry) => {
    const y = rowCentre(entry.status)
    const start = xForHour(hoursIntoDay(entry.start_time, tzOffsetMinutes))
    const end = xForHour(endHour(entry.end_time, tzOffsetMinutes))
    return [`${start.toFixed(2)},${y}`, `${end.toFixed(2)},${y}`]
  })

  const remarks = buildRemarks(day.entries, tzOffsetMinutes, (iso) =>
    hoursIntoDay(iso, tzOffsetMinutes),
  )
  const layout = layoutFor(remarks.length)
  const onDutyToday = day.totals.driving + day.totals.on_duty

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
      viewBox={`0 0 ${WIDTH} ${layout.height}`}
      width="100%"
      role="img"
      aria-label={`Driver's daily log for ${day.date}: ${formatHours(day.totals.driving)} hours driving, ${formatHours(day.totals.on_duty)} hours on duty not driving, ${day.total_miles} miles.`}
      style={{ display: 'block', background: '#ffffff', minWidth: 760 }}
      fontFamily={SVG_FONT_STACK}
    >
      <rect x="0" y="0" width={WIDTH} height={layout.height} fill="#ffffff" />

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

      <Remarks remarks={remarks} layout={layout} />

      <Footer y={layout.footerY} />

      <Recap
        top={layout.recapTop}
        onDutyToday={onDutyToday}
        cycleHoursUsed={day.cycle_hours_used_end ?? null}
      />
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

      <FilledLine x={24} y={122} width={300} label="From" value={from} />
      <FilledLine x={352} y={122} width={300} label="To" value={to} />
      {/* Driving miles are ours to fill. Total mileage is the odometer's figure for the
          day, which can include non-CMV movement the app cannot know, so it is left
          for the driver like the other unknown fields. */}
      <FilledLine
        x={680}
        y={122}
        width={140}
        label="Total miles driving today"
        value={String(Math.round(totalMiles))}
      />
      <FilledLine
        x={840}
        y={122}
        width={136}
        label="Total mileage today"
        hint="to be completed by the driver"
      />

      <FilledLine
        x={24}
        y={176}
        width={468}
        label="Name of carrier or carriers"
        value={carrier}
        hint="to be completed by the carrier"
      />
      <FilledLine
        x={520}
        y={176}
        width={456}
        label="Main office address"
        value={officeAddress}
        hint="to be completed by the carrier"
      />

      <FilledLine
        x={24}
        y={224}
        width={468}
        label="Truck/tractor and trailer numbers or license plate(s)/state (show each unit)"
        hint="to be completed by the driver"
      />
      <FilledLine
        x={520}
        y={224}
        width={456}
        label="Home terminal address"
        hint="to be completed by the carrier"
      />
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

/** A ruled header line, left blank where there is no data. */
function FilledLine({
  x,
  y,
  width,
  label,
  value,
  hint,
}: {
  x: number
  y: number
  width: number
  label: string
  value?: string
  /** Shown in place of a value for a field the driver fills in by hand. */
  hint?: string
}) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {!value && hint ? (
        <text x="4" y="-6" fontSize="11" fill="#b9b9bd" fontStyle="italic">
          {hint}
        </text>
      ) : null}
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

/** Hours per duty status; the column always totals 24. */
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

function Remarks({ remarks, layout }: { remarks: Remark[]; layout: ReturnType<typeof layoutFor> }) {
  // Stagger markers that would touch: a 15-minute inspection sits ~8px from
  // the change that follows it.
  const markers: { remark: Remark; x: number; cx: number; lane: number }[] = []
  for (const remark of remarks) {
    const x = xForHour(remark.hour)
    const previous = markers.at(-1)
    const crowded = previous !== undefined && x - previous.x < MARKER_MIN_GAP
    markers.push({
      remark,
      x,
      // Held inside the box at midnight; the leader still starts at the true x.
      cx: Math.min(Math.max(x, GRID_LEFT + MARKER_RADIUS + 2), GRID_RIGHT - MARKER_RADIUS - 2),
      lane: crowded ? (previous.lane + 1) % MARKER_LANES : 0,
    })
  }

  const listTop = REMARKS_TOP + MARKER_BAND + 10
  return (
    <g>
      <rect
        x={GRID_LEFT}
        y={REMARKS_TOP}
        width={GRID_WIDTH}
        height={layout.remarksHeight}
        fill="#ffffff"
        stroke={RULE}
        strokeWidth="1"
      />
      <text x={GRID_LEFT - 10} y={REMARKS_TOP + 16} fontSize="11" textAnchor="end" fill={RULE}>
        Remarks
      </text>
      <line
        x1={GRID_LEFT}
        y1={REMARKS_TOP + MARKER_BAND}
        x2={GRID_RIGHT}
        y2={REMARKS_TOP + MARKER_BAND}
        stroke={HAIRLINE}
        strokeWidth="0.6"
      />

      {markers.map(({ remark, x, cx, lane }) => {
        const cy = REMARKS_TOP + 14 + lane * MARKER_LANE_DEPTH
        return (
          <g key={`marker-${remark.number}`} data-testid="remark-marker">
            <line
              x1={x}
              y1={REMARKS_TOP}
              x2={cx}
              y2={cy - MARKER_RADIUS}
              stroke={RULE}
              strokeWidth="0.8"
            />
            <circle
              cx={cx}
              cy={cy}
              r={MARKER_RADIUS}
              fill="#ffffff"
              stroke={RULE}
              strokeWidth="0.8"
            />
            <text x={cx} y={cy + 3} fontSize="8" fontWeight="700" textAnchor="middle" fill={RULE}>
              {remark.number}
            </text>
          </g>
        )
      })}

      {remarks.map((remark, index) => {
        const column = Math.floor(index / layout.rows)
        const row = index % layout.rows
        const x = GRID_LEFT + 10 + column * REMARK_COLUMN_WIDTH
        const y = listTop + row * REMARK_ROW_HEIGHT + 9
        return (
          <g key={`remark-${remark.number}`} data-testid="remark">
            <text x={x + 10} y={y} fontSize="8" fontWeight="700" textAnchor="end" fill={RULE}>
              {remark.number}
            </text>
            {/* Separate elements at fixed x, one plain string each: svg2pdf.js
                collapses whitespace between a text node and a <tspan>. */}
            <text x={x + 16} y={y} fontSize="9" fill={RULE}>
              {remark.time}
            </text>
            <text x={x + 46} y={y} fontSize="9" fill={RULE}>
              {`${remark.place} — ${remark.activity}`}
            </text>
          </g>
        )
      })}

      <text x={GRID_LEFT} y={layout.instructionY} fontSize="9.5" fill={INK_MUTED}>
        Enter name of place you reported and where released from work and when and where each change
        of duty occurred. Use time standard of home terminal.
      </text>
    </g>
  )
}

function Footer({ y }: { y: number }) {
  return (
    <g>
      <FilledLine
        x={24}
        y={y}
        width={220}
        label="Shipping document number(s)"
        hint="bill of lading or manifest no."
      />
      <FilledLine
        x={268}
        y={y}
        width={220}
        label="Shipper & commodity"
        hint="to be completed by the driver"
      />
      <FilledLine
        x={512}
        y={y}
        width={220}
        label="Driver's signature in full"
        hint="sign on printing"
      />
      <FilledLine
        x={756}
        y={y}
        width={220}
        label="Co-driver's name (if any)"
        hint="none — single driver"
      />
    </g>
  )
}

/**
 * The form's 70-hour/8-day recap. The brief takes prior cycle hours as a single
 * total, so how they fell across the last eight days is unknown; A and C are
 * both the running cycle total since the last 34-hour restart, which is the
 * conservative reading the planner itself uses (see the README's assumptions).
 */
function Recap({
  top,
  onDutyToday,
  cycleHoursUsed,
}: {
  top: number
  onDutyToday: number
  cycleHoursUsed: number | null
}) {
  const known = cycleHoursUsed !== null
  const cells: [string, string, string][] = [
    ['On-duty hours today', 'total of lines 3 & 4', formatHours(onDutyToday)],
    ['A. On duty last 7 days', 'including today', known ? formatHours(cycleHoursUsed) : '—'],
    [
      'B. Available tomorrow',
      '70 hr. minus A*',
      known ? formatHours(Math.max(0, 70 - cycleHoursUsed)) : '—',
    ],
    ['C. On duty last 8 days', 'including today', known ? formatHours(cycleHoursUsed) : '—'],
  ]
  return (
    <g data-testid="recap">
      <line x1="24" y1={top} x2="976" y2={top} stroke={RULE} strokeWidth="1" />
      <text x="24" y={top + 22} fontSize="12" fontWeight="700" fill={RULE}>
        Recap
      </text>
      <text x="24" y={top + 36} fontSize="9" fill={INK_MUTED}>
        complete at end of day
      </text>
      <text x="24" y={top + 50} fontSize="9" fill={INK_MUTED}>
        70 hour / 8 day drivers
      </text>

      {cells.map(([label, caption, value], index) => {
        const x = 150 + index * 207
        return (
          <g key={label} transform={`translate(${x}, ${top + 12})`}>
            <text x="4" y="20" fontSize="15" fontWeight="700" fill={RULE}>
              {value}
            </text>
            <line x1="0" y1="27" x2="190" y2="27" stroke={RULE} strokeWidth="1" />
            <text x="0" y="40" fontSize="9.5" fill={RULE}>
              {label}
            </text>
            <text x="0" y="52" fontSize="9" fill={INK_MUTED}>
              {caption}
            </text>
          </g>
        )
      })}

      <text x="150" y={top + 84} fontSize="8.5" fill={INK_MUTED}>
        *If you took 34 consecutive hours off duty you have 70 hours available. Prior cycle hours
        are entered as one total,
      </text>
      <text x="150" y={top + 96} fontSize="8.5" fill={INK_MUTED}>
        so A and C both show the cycle total since the last 34-hour restart. The 60-hour/7-day
        columns do not apply to this driver.
      </text>
    </g>
  )
}
