"""Value types shared by the planner, the log-day splitter and the Django layer.

Plain dataclasses and enums only -- no Django, no I/O.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from enum import Enum


class DutyStatus(str, Enum):
    """The four rows of the FMCSA driver's daily log, in regulation order."""

    OFF_DUTY = "OFF_DUTY"
    SLEEPER_BERTH = "SLEEPER_BERTH"
    DRIVING = "DRIVING"
    ON_DUTY_NOT_DRIVING = "ON_DUTY_NOT_DRIVING"


#: Row order on the printed grid.  Used by the SVG renderer and the totals column.
LOG_ROW_ORDER: tuple[DutyStatus, ...] = (
    DutyStatus.OFF_DUTY,
    DutyStatus.SLEEPER_BERTH,
    DutyStatus.DRIVING,
    DutyStatus.ON_DUTY_NOT_DRIVING,
)

ON_DUTY_STATUSES = frozenset({DutyStatus.DRIVING, DutyStatus.ON_DUTY_NOT_DRIVING})
NON_DRIVING_STATUSES = frozenset(
    {DutyStatus.OFF_DUTY, DutyStatus.SLEEPER_BERTH, DutyStatus.ON_DUTY_NOT_DRIVING}
)


class StopType(str, Enum):
    START = "START"
    PICKUP = "PICKUP"
    FUEL = "FUEL"
    REST_BREAK = "REST_BREAK"
    DAILY_RESET = "DAILY_RESET"
    CYCLE_RESTART = "CYCLE_RESTART"
    DROPOFF = "DROPOFF"


@dataclass(frozen=True)
class Coordinate:
    lat: float
    lon: float

    def as_pair(self) -> tuple[float, float]:
        return (self.lat, self.lon)


@dataclass(frozen=True)
class RouteLeg:
    """One routed leg: current -> pickup, then pickup -> dropoff."""

    sequence: int
    from_label: str
    to_label: str
    distance_miles: float
    geometry: tuple[Coordinate, ...]
    #: What the driver does on arrival.  None for the final leg of a bare route.
    arrival_stop: StopType | None = None


@dataclass(frozen=True)
class Event:
    """One contiguous run at a single duty status.

    `stop_type` is set when the event is also a numbered stop on the map; a
    plain driving stint between two stops carries None.
    """

    status: DutyStatus
    start: datetime
    end: datetime
    lat: float
    lon: float
    location_label: str
    remark: str
    distance_miles: float = 0.0
    odometer_miles: float = 0.0
    stop_type: StopType | None = None
    reason: str | None = None

    @property
    def duration_minutes(self) -> int:
        return round((self.end - self.start).total_seconds() / 60)

    @property
    def duration_hours(self) -> float:
        return self.duration_minutes / 60.0


@dataclass(frozen=True)
class Stop:
    sequence: int
    stop_type: StopType
    lat: float
    lon: float
    location_label: str
    arrival_time: datetime
    departure_time: datetime
    duration_hours: float
    odometer_miles: float
    reason: str


@dataclass(frozen=True)
class DutyEntry:
    """An Event after the midnight split -- belongs to exactly one LogDay."""

    sequence: int
    status: DutyStatus
    start_time: datetime
    end_time: datetime
    duration_hours: float
    location_label: str
    remark: str
    distance_miles: float = 0.0


@dataclass(frozen=True)
class LogDay:
    day_number: int
    date: date
    total_miles: float
    totals: dict[DutyStatus, float]
    entries: tuple[DutyEntry, ...]

    @property
    def total_hours(self) -> float:
        return round(sum(self.totals.values()), 2)


@dataclass(frozen=True)
class TripSummary:
    total_distance_miles: float
    total_driving_hours: float
    total_on_duty_hours: float
    total_off_duty_hours: float
    total_days: int
    total_stops: int
    departure_datetime: datetime
    arrival_datetime: datetime
    cycle_hours_used_at_start: float
    cycle_hours_used_at_end: float


@dataclass(frozen=True)
class Plan:
    summary: TripSummary
    events: tuple[Event, ...]
    stops: tuple[Stop, ...]
    log_days: tuple[LogDay, ...] = field(default=())


class HOSPlanningError(Exception):
    """Raised when the trip cannot be planned at all (bad input, not a rule hit)."""
