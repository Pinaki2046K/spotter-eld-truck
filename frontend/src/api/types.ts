export type DutyStatus = 'OFF_DUTY' | 'SLEEPER_BERTH' | 'DRIVING' | 'ON_DUTY_NOT_DRIVING'

export type StopType =
  'START' | 'PICKUP' | 'FUEL' | 'REST_BREAK' | 'DAILY_RESET' | 'CYCLE_RESTART' | 'DROPOFF'

export type ErrorCode =
  | 'GEOCODE_NOT_FOUND'
  | 'OUT_OF_COUNTRY'
  | 'NO_ROUTE'
  | 'INVALID_CYCLE_HOURS'
  | 'UPSTREAM_TIMEOUT'
  | 'CYCLE_EXHAUSTED'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'INTERNAL'

export interface Place {
  label: string
  lat: number
  lon: number
}

export interface TripRequest {
  current_location: Place
  pickup_location: Place
  dropoff_location: Place
  cycle_hours_used: number
  start_datetime?: string | null
}

export interface TripSummary {
  total_distance_miles: number
  total_driving_hours: number
  total_on_duty_hours: number
  total_off_duty_hours: number
  total_days: number
  total_stops: number
  required_stops: number
  departure_datetime: string
  arrival_datetime: string
  cycle_hours_used_at_start: number
  routing_provider: string
}

export interface RouteLeg {
  sequence: number
  from_label: string
  to_label: string
  distance_miles: number
  duration_hours: number
  /** [lat, lon] pairs. */
  geometry: [number, number][]
}

export interface Stop {
  sequence: number
  stop_type: StopType
  lat: number
  lon: number
  location_label: string
  arrival_time: string
  departure_time: string
  duration_hours: number
  odometer_miles: number
  reason: string
  /** This stop provided the 30-minute break required after 8 driving hours. */
  satisfies_break: boolean
}

export interface DutyEntry {
  sequence: number
  status: DutyStatus
  start_time: string
  end_time: string
  duration_hours: number
  distance_miles: number
  location_label: string
  remark: string
}

export interface LogDay {
  day_number: number
  date: string
  total_miles: number
  totals: {
    off_duty: number
    sleeper: number
    driving: number
    on_duty: number
    total: number
  }
  entries: DutyEntry[]
}

export interface Compliance {
  max_driving_hours_in_shift: number
  driving_limit_hours: number
  max_window_hours: number
  window_limit_hours: number
  max_driving_hours_between_breaks: number
  break_required_after_hours: number
  cycle_hours_used: number
  cycle_hours_limit: number
  cycle_hours_remaining: number
  shifts: number
}

export interface Assumptions {
  driver_type: string
  cycle_hours: number
  adverse_conditions: boolean
  average_speed_mph: number
  fuel_interval_miles: number
  fuel_stop_hours: number
  pickup_hours: number
  dropoff_hours: number
}

export interface Trip {
  id: string
  created_at: string
  inputs: {
    current_location: Place
    pickup_location: Place
    dropoff_location: Place
    cycle_hours_used: number
    start_datetime: string
    /** Minutes east of UTC for the home terminal. Log days are midnight to
     *  midnight in this offset; every displayed time is shifted into it. */
    home_timezone_offset_minutes: number
  }
  summary: TripSummary
  route: { legs: RouteLeg[] }
  stops: Stop[]
  log_days: LogDay[]
  compliance: Compliance
  assumptions: Assumptions
}
