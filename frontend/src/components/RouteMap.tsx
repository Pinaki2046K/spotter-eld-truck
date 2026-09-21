import 'leaflet/dist/leaflet.css'

import L from 'leaflet'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'

import type { RouteLeg, Stop } from '../api/types'
import { STOP_COLORS, STOP_ICON_PATHS, STOP_LABELS } from '../lib/duty'
import { formatDateTime, formatDuration, formatMiles } from '../lib/format'

interface RouteMapProps {
  legs: RouteLeg[]
  stops: Stop[]
  tzOffsetMinutes: number
  /** Sequence of the stop the stop list is hovering, if any. */
  highlighted: number | null
  /** Sequence of the stop to fly to; bumped by clicking a stop list row. */
  focused: { sequence: number; nonce: number } | null
}

/** A numbered pin carrying the stop's glyph. Colour never carries meaning alone. */
function pinIcon(stop: Stop, highlighted: boolean): L.DivIcon {
  const color = STOP_COLORS[stop.stop_type]
  const scale = highlighted ? 1.18 : 1
  const html = `
    <svg width="${34 * scale}" height="${42 * scale}" viewBox="0 0 34 42" aria-hidden="true">
      <path d="M17 41C17 41 32 25.5 32 16A15 15 0 1 0 2 16c0 9.5 15 25 15 25z"
            fill="${color}" stroke="#ffffff" stroke-width="${highlighted ? 3 : 2}" />
      <g transform="translate(7 6) scale(1)" fill="none" stroke="#ffffff"
         stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <path d="${STOP_ICON_PATHS[stop.stop_type]}" transform="scale(1)" />
      </g>
      <circle cx="27" cy="7" r="7.5" fill="#ffffff" stroke="${color}" stroke-width="1.5" />
      <text x="27" y="10.4" font-size="9" font-weight="700" text-anchor="middle"
            fill="${color}" font-family="system-ui, sans-serif">${stop.sequence}</text>
    </svg>`
  return L.divIcon({
    html,
    className: 'stop-marker-icon',
    iconSize: [34 * scale, 42 * scale],
    iconAnchor: [17 * scale, 41 * scale],
    popupAnchor: [0, -36 * scale],
  })
}

function FitBounds({ legs }: { legs: RouteLeg[] }) {
  const map = useMap()
  useEffect(() => {
    const points = legs.flatMap((leg) => leg.geometry)
    if (points.length === 0) return
    map.fitBounds(L.latLngBounds(points as [number, number][]), { padding: [36, 36] })
  }, [legs, map])
  return null
}

/**
 * On touch devices Leaflet sets `touch-action: none`, so a one-finger drag
 * inside the map pans the map instead of scrolling the page. On a phone, where
 * the map spans the full width, that traps the scroll: there is no margin left
 * to swipe past it.
 *
 * The map therefore starts inert on coarse pointers and activates on a tap,
 * which is the pattern embedded maps have settled on. Pointer devices are
 * untouched.
 */
function TouchDragGuard({ onActiveChange }: { onActiveChange: (active: boolean) => void }) {
  const map = useMap()

  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)').matches
    if (!coarse) {
      onActiveChange(true)
      return
    }

    const container = map.getContainer()
    const activate = () => {
      map.dragging.enable()
      map.touchZoom.enable()
      onActiveChange(true)
    }
    const deactivate = () => {
      map.dragging.disable()
      map.touchZoom.disable()
      onActiveChange(false)
    }

    deactivate()
    container.addEventListener('click', activate)
    container.addEventListener('touchstart', activate, { passive: true })
    document.addEventListener('touchstart', (event) => {
      if (!container.contains(event.target as Node)) deactivate()
    })

    return () => {
      container.removeEventListener('click', activate)
      container.removeEventListener('touchstart', activate)
    }
  }, [map, onActiveChange])

  return null
}

function FlyToStop({ focused, stops }: { focused: RouteMapProps['focused']; stops: Stop[] }) {
  const map = useMap()
  useEffect(() => {
    if (!focused) return
    const stop = stops.find((candidate) => candidate.sequence === focused.sequence)
    if (!stop) return
    map.flyTo([stop.lat, stop.lon], Math.max(map.getZoom(), 8), { duration: 0.7 })
  }, [focused, map, stops])
  return null
}

export function RouteMap({ legs, stops, tzOffsetMinutes, highlighted, focused }: RouteMapProps) {
  const [dragActive, setDragActive] = useState(true)
  const centre = useMemo<[number, number]>(() => {
    const first = legs[0]?.geometry[0]
    return first ? [first[0], first[1]] : [39.5, -98.35]
  }, [legs])
  const onActiveChange = useCallback((active: boolean) => setDragActive(active), [])

  return (
    <div className="relative h-full w-full">
      {!dragActive ? (
        <p className="pointer-events-none absolute inset-x-0 bottom-3 z-[500] mx-auto w-max rounded-[var(--radius-pill)] border border-[var(--color-hairline)] bg-white/90 px-3 py-1.5 text-[12px] text-[var(--color-ink-80)] backdrop-blur">
          Tap the map to pan and zoom
        </p>
      ) : null}
      <MapContainer
        center={centre}
        zoom={5}
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
        attributionControl
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxZoom={19}
        />

        {/* Deadhead leg dashed, loaded leg solid, so the empty miles read at a glance. */}
        {legs.map((leg) => (
          <Polyline
            key={leg.sequence}
            positions={leg.geometry as [number, number][]}
            pathOptions={{
              color: 'var(--color-accent)',
              weight: 4,
              opacity: leg.sequence === 1 ? 0.75 : 1,
              dashArray: leg.sequence === 1 ? '10 8' : undefined,
              lineCap: 'round',
            }}
          />
        ))}

        {stops.map((stop) => (
          <Marker
            key={stop.sequence}
            position={[stop.lat, stop.lon]}
            icon={pinIcon(stop, highlighted === stop.sequence)}
            alt={`Stop ${stop.sequence}: ${STOP_LABELS[stop.stop_type]} at ${stop.location_label}`}
            keyboard
          >
            <Popup>
              <strong>
                {stop.sequence}. {STOP_LABELS[stop.stop_type]}
              </strong>
              <br />
              {stop.location_label}
              <br />
              {formatDateTime(stop.arrival_time, tzOffsetMinutes)}
              {stop.duration_hours > 0 ? ` · ${formatDuration(stop.duration_hours)}` : ''}
              <br />
              <span style={{ color: '#6e6e73' }}>
                Mile {formatMiles(stop.odometer_miles)} &middot; {stop.reason}
              </span>
            </Popup>
          </Marker>
        ))}

        <FitBounds legs={legs} />
        <FlyToStop focused={focused} stops={stops} />
        <TouchDragGuard onActiveChange={onActiveChange} />
      </MapContainer>
    </div>
  )
}
