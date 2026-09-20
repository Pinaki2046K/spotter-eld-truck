import type { ErrorCode, Place, Trip, TripRequest } from './types'

/** Empty in dev: Vite proxies /api to the local Django server. */
const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  readonly code: ErrorCode
  readonly field: string | null

  constructor(code: ErrorCode, message: string, field: string | null = null) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.field = field
  }
}

const FALLBACK_MESSAGES: Record<string, string> = {
  UPSTREAM_TIMEOUT: 'The mapping service is slow right now. Please try again.',
  INTERNAL: 'Something went wrong on our side. Please try again.',
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch {
    throw new ApiError('UPSTREAM_TIMEOUT', 'Could not reach the planner. Check your connection.')
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const error = body?.error
    const code: ErrorCode = error?.code ?? 'INTERNAL'
    throw new ApiError(
      code,
      error?.message ?? FALLBACK_MESSAGES[code] ?? 'Request failed.',
      error?.field ?? null,
    )
  }

  return response.json() as Promise<T>
}

export function createTrip(payload: TripRequest, signal?: AbortSignal): Promise<Trip> {
  return request<Trip>('/api/trips/', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
}

export function getTrip(id: string): Promise<Trip> {
  return request<Trip>(`/api/trips/${id}/`)
}

export async function geocode(query: string, signal?: AbortSignal): Promise<Place[]> {
  const { results } = await request<{ results: Place[] }>(
    `/api/geocode/?q=${encodeURIComponent(query)}`,
    { signal },
  )
  return results
}

/** Fired on page load so the backend is warm by the time a trip is submitted. */
export function pingHealth(): void {
  void fetch(`${BASE_URL}/api/health/`).catch(() => undefined)
}
