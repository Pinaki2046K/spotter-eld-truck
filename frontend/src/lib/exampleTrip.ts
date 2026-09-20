import type { TripRequest } from '../api/types'

/**
 * Chicago -> St. Louis -> Denver with 20 cycle hours used: a correct multi-day
 * result in one click, with no typing and no geocoding round trip.
 */
export const EXAMPLE_TRIP: TripRequest = {
  current_location: { label: 'Chicago, Illinois', lat: 41.8781, lon: -87.6298 },
  pickup_location: { label: 'St. Louis, Missouri', lat: 38.627, lon: -90.1994 },
  dropoff_location: { label: 'Denver, Colorado', lat: 39.7392, lon: -104.9903 },
  cycle_hours_used: 20,
}
