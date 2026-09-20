import { useEffect, useId, useRef, useState } from 'react'

import { geocode } from '../api/client'
import type { Place } from '../api/types'

const DEBOUNCE_MS = 400

interface LocationFieldProps {
  label: string
  hint?: string
  value: Place | null
  onChange: (place: Place | null) => void
  error?: string
  required?: boolean
}

/**
 * Autocomplete over the server-side Nominatim proxy. The form submits the
 * resolved lat/lon, never the raw text, so the backend never has to guess which
 * Springfield the driver meant.
 */
export function LocationField({
  label,
  hint,
  value,
  onChange,
  error,
  required,
}: LocationFieldProps) {
  const inputId = useId()
  const listId = `${inputId}-listbox`
  const [query, setQuery] = useState(value?.label ?? '')
  const [results, setResults] = useState<Place[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [settled, setSettled] = useState('')
  const blurTimer = useRef<number | undefined>(undefined)

  // React's documented "adjust state when a prop changes" pattern: doing this
  // during render rather than in an effect avoids a second render pass.
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    setQuery(value?.label ?? '')
  }

  // A resolved selection is not a new search term, and two characters is not a
  // query worth spending a Nominatim request on.
  const shouldSearch = open && query.trim().length >= 3 && query !== value?.label
  const visibleResults = shouldSearch ? results : []
  const searching = shouldSearch && settled !== query

  useEffect(() => {
    if (!shouldSearch) return

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      geocode(query, controller.signal)
        .then((places) => {
          setResults(places)
          setActiveIndex(places.length ? 0 : -1)
        })
        .catch(() => setResults([]))
        .finally(() => setSettled(query))
    }, DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query, shouldSearch])

  useEffect(() => () => window.clearTimeout(blurTimer.current), [])

  function select(place: Place) {
    onChange(place)
    setQuery(place.label)
    setOpen(false)
    setResults([])
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (visibleResults.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % visibleResults.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (index - 1 + visibleResults.length) % visibleResults.length)
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault()
      select(visibleResults[activeIndex])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="relative">
      <label
        htmlFor={inputId}
        className="block text-[13px] font-semibold text-[var(--color-ink-80)]"
      >
        {label}
        {required ? <span className="text-[var(--color-ink-48)]"> *</span> : null}
      </label>

      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={visibleResults.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
        autoComplete="off"
        placeholder="City and state"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
          if (value && event.target.value !== value.label) onChange(null)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          blurTimer.current = window.setTimeout(() => setOpen(false), 150)
        }}
        onKeyDown={onKeyDown}
        className={`mt-1.5 w-full rounded-xl border bg-white px-3.5 py-2.5 text-[15px] outline-none transition-colors ${
          error
            ? 'border-[#b00020]'
            : 'border-[var(--color-hairline)] focus:border-[var(--color-accent)]'
        }`}
      />

      {error ? (
        <p id={`${inputId}-error`} role="alert" className="mt-1 text-[12.5px] text-[#b00020]">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1 text-[12.5px] text-[var(--color-ink-48)]">
          {hint}
        </p>
      ) : null}

      {shouldSearch && (visibleResults.length > 0 || searching) ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="absolute z-[1000] mt-1 max-h-64 w-full overflow-auto rounded-xl border border-[var(--color-hairline)] bg-white py-1"
        >
          {searching && visibleResults.length === 0 ? (
            <li className="px-3.5 py-2 text-[14px] text-[var(--color-ink-48)]">
              Searching&hellip;
            </li>
          ) : null}
          {visibleResults.map((place, index) => (
            <li
              key={`${place.lat},${place.lon},${place.label}`}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
            >
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(place)}
                onMouseEnter={() => setActiveIndex(index)}
                className={`block w-full px-3.5 py-2 text-left text-[14px] ${
                  index === activeIndex ? 'bg-[var(--color-accent-soft)]' : ''
                }`}
              >
                {place.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
