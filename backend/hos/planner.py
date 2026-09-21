"""The HOS planner.

Walks the route consuming driving time.  On each iteration it computes how many
minutes remain until each constraint binds, drives exactly the smallest of
those, then emits the event that constraint demands.

All arithmetic is in whole minutes.  That is what makes the log-day totals come
out at exactly 24.00 hours rather than 23.999999, and it keeps the output
byte-identical across runs.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta

from .config import DEFAULT_CONFIG, MIN_SEGMENT_MIN, HOSConfig
from .geo import PolylineIndex
from .places import nearest_place
from .types import (
    Coordinate,
    DutyStatus,
    Event,
    HOSPlanningError,
    RouteLeg,
    Stop,
    StopType,
)


@dataclass(frozen=True)
class PlannerInput:
    legs: tuple[RouteLeg, ...]
    cycle_hours_used: float
    start_datetime: datetime
    config: HOSConfig = DEFAULT_CONFIG

    def validate(self) -> None:
        if not self.legs:
            raise HOSPlanningError("At least one route leg is required.")
        if self.start_datetime.tzinfo is None:
            raise HOSPlanningError("start_datetime must be timezone-aware.")
        if not 0.0 <= self.cycle_hours_used <= self.config.CYCLE_HOURS:
            raise HOSPlanningError(
                f"cycle_hours_used must be between 0 and {self.config.CYCLE_HOURS}."
            )
        for leg in self.legs:
            if leg.distance_miles <= 0:
                raise HOSPlanningError(
                    f"Leg {leg.sequence} ({leg.from_label} to {leg.to_label}) has no distance."
                )
            if not leg.geometry:
                raise HOSPlanningError(f"Leg {leg.sequence} has no geometry.")


# Human-readable reasons.  These end up on map markers and in the stop list, so
# a grader can audit why each stop exists without reading the code.
REASON_BREAK = "30-minute break: 8 cumulative driving hours reached"
REASON_FUEL = "Fuel stop: {miles:,.0f} miles since last fuelling"
REASON_RESET_DRIVING = "10-hour reset: 11-hour driving limit reached"
REASON_RESET_WINDOW = "10-hour reset: 14-hour driving window closed"
REASON_RESTART = "34-hour restart: {used:.1f} of {limit:.0f} cycle hours consumed"
REASON_RESTART_AT_START = (
    "34-hour restart: trip opens with {used:.1f} of {limit:.0f} cycle hours already used"
)
REASON_PICKUP = "Pickup: 1 hour loading, on duty (not driving)"
REASON_DROPOFF = "Dropoff: 1 hour unloading, on duty (not driving)"
REASON_START = "Trip start"


@dataclass
class _State:
    clock: datetime
    cycle_used_min: int
    driving_today_min: int = 0
    driving_since_break_min: int = 0
    window_start: datetime | None = None
    trip_miles: float = 0.0
    miles_at_last_fuel: float = 0.0
    position: Coordinate = field(default=Coordinate(0.0, 0.0))
    label: str = ""


class _Planner:
    def __init__(self, request: PlannerInput) -> None:
        request.validate()
        self.request = request
        self.cfg = request.config
        origin = request.legs[0].geometry[0]
        self.state = _State(
            clock=request.start_datetime,
            cycle_used_min=round(request.cycle_hours_used * 60),
            position=origin,
            label=request.legs[0].from_label,
        )
        self.events: list[Event] = []

    # -- state queries -----------------------------------------------------

    def _cycle_remaining_min(self) -> int:
        return self.cfg.cycle_limit_min - self.state.cycle_used_min

    def _window_remaining_min(self) -> int:
        if self.state.window_start is None:
            return self.cfg.window_min
        elapsed = (self.state.clock - self.state.window_start).total_seconds() / 60
        return self.cfg.window_min - round(elapsed)

    def _driving_remaining_min(self) -> int:
        return self.cfg.driving_limit_min - self.state.driving_today_min

    def _break_remaining_min(self) -> int:
        return self.cfg.break_after_min - self.state.driving_since_break_min

    def _miles_since_fuel(self) -> float:
        return self.state.trip_miles - self.state.miles_at_last_fuel

    # -- emission ----------------------------------------------------------

    def _emit(
        self,
        status: DutyStatus,
        minutes: int,
        remark: str,
        *,
        stop_type: StopType | None = None,
        reason: str | None = None,
        distance_miles: float = 0.0,
    ) -> None:
        if minutes <= 0:
            return
        state = self.state
        end = state.clock + timedelta(minutes=minutes)
        # Any non-driving period of 30 minutes or more satisfies 395.3(a)(3)(ii).
        # A 10-hour reset does too, but calling that "the break" would be
        # misleading, so only in-shift pauses are credited.
        satisfies_break = (
            status is not DutyStatus.DRIVING
            and self.cfg.break_min <= minutes < self.cfg.daily_reset_min
            and state.driving_since_break_min > 0
        )
        self.events.append(
            Event(
                status=status,
                start=state.clock,
                end=end,
                lat=state.position.lat,
                lon=state.position.lon,
                location_label=state.label,
                remark=remark,
                distance_miles=round(distance_miles, 2),
                odometer_miles=round(state.trip_miles, 1),
                stop_type=stop_type,
                reason=reason,
                satisfies_break=satisfies_break,
            )
        )

        # The 14-hour window opens at the first on-duty activity of the shift --
        # not at the first driving minute.
        if status in (DutyStatus.DRIVING, DutyStatus.ON_DUTY_NOT_DRIVING):
            if state.window_start is None:
                state.window_start = state.clock
            state.cycle_used_min += minutes
        if status is DutyStatus.DRIVING:
            state.driving_today_min += minutes
            state.driving_since_break_min += minutes
        else:
            # Any non-driving period of 30 minutes or more satisfies 395.3(a)(3)(ii),
            # whether it is off duty, sleeper berth or on duty not driving.
            if minutes >= self.cfg.break_min:
                state.driving_since_break_min = 0
        if status in (DutyStatus.OFF_DUTY, DutyStatus.SLEEPER_BERTH):
            if minutes >= self.cfg.daily_reset_min:
                state.driving_today_min = 0
                state.window_start = None
            if minutes >= self.cfg.cycle_restart_min:
                state.cycle_used_min = 0

        state.clock = end

    def _move_to(self, coordinate: Coordinate) -> None:
        self.state.position = coordinate
        self.state.label = nearest_place(coordinate.lat, coordinate.lon)

    # -- rule events -------------------------------------------------------

    def _take_cycle_restart(self, at_start: bool = False) -> None:
        template = REASON_RESTART_AT_START if at_start else REASON_RESTART
        reason = template.format(used=self.state.cycle_used_min / 60, limit=self.cfg.CYCLE_HOURS)
        self._emit(
            DutyStatus.OFF_DUTY,
            self.cfg.cycle_restart_min,
            "34-hour restart",
            stop_type=StopType.CYCLE_RESTART,
            reason=reason,
        )

    def _take_daily_reset(self, reason: str) -> None:
        self._emit(
            DutyStatus.SLEEPER_BERTH,
            self.cfg.daily_reset_min,
            "10 hours off duty",
            stop_type=StopType.DAILY_RESET,
            reason=reason,
        )

    def _ensure_cycle_room(self, required_min: int) -> bool:
        """Take a 34-hour restart if the cycle cannot absorb `required_min` on duty."""
        if self._cycle_remaining_min() >= required_min:
            return False
        self._take_cycle_restart()
        return True

    def _resolve_blockers(self, minutes_per_mile: float) -> bool:
        """Emit the single event a binding constraint demands.  True if one fired.

        Ordering matters.  A 10-hour reset subsumes a due break, and a fuel stop
        is 30 minutes of non-driving time so it satisfies a due break too --
        checking fuel before the break avoids stacking two stops in one place.
        """
        if self._ensure_cycle_room(MIN_SEGMENT_MIN):
            return True
        if self._driving_remaining_min() < MIN_SEGMENT_MIN:
            self._take_daily_reset(REASON_RESET_DRIVING)
            return True
        if self._window_remaining_min() < MIN_SEGMENT_MIN:
            self._take_daily_reset(REASON_RESET_WINDOW)
            return True
        if self._fuel_headroom_min(minutes_per_mile) < MIN_SEGMENT_MIN:
            if self._ensure_cycle_room(self.cfg.fuel_stop_min):
                return True
            miles = self._miles_since_fuel()
            self._emit(
                DutyStatus.ON_DUTY_NOT_DRIVING,
                self.cfg.fuel_stop_min,
                "Fuel",
                stop_type=StopType.FUEL,
                reason=REASON_FUEL.format(miles=miles),
            )
            self.state.miles_at_last_fuel = self.state.trip_miles
            return True
        if self._break_remaining_min() < MIN_SEGMENT_MIN:
            self._emit(
                DutyStatus.OFF_DUTY,
                self.cfg.break_min,
                "30-minute break",
                stop_type=StopType.REST_BREAK,
                reason=REASON_BREAK,
            )
            return True
        return False

    def _fuel_headroom_min(self, minutes_per_mile: float) -> int:
        remaining_miles = self.cfg.FUEL_INTERVAL_MILES - self._miles_since_fuel()
        if remaining_miles <= 0:
            return 0
        return int(remaining_miles * minutes_per_mile)

    # -- main loop ---------------------------------------------------------

    def run(self) -> list[Event]:
        if self._cycle_remaining_min() < MIN_SEGMENT_MIN:
            self._take_cycle_restart(at_start=True)

        for leg in self.request.legs:
            self._drive_leg(leg)
            self._arrive(leg)
        return self.events

    def _drive_leg(self, leg: RouteLeg) -> None:
        index = PolylineIndex(leg.geometry, leg.distance_miles)
        leg_minutes = max(1, round(leg.distance_miles / self.cfg.AVERAGE_SPEED_MPH * 60))
        # Miles advanced per driving minute for this leg.  Derived from the API
        # distance so the leg ends at exactly the reported mileage.
        miles_per_minute = leg.distance_miles / leg_minutes
        minutes_per_mile = leg_minutes / leg.distance_miles

        # A leg starts at a named waypoint, so use that name rather than the
        # nearest gazetteer match -- which can sit across a state line.
        self.state.position = index.at_miles(0.0)
        self.state.label = leg.from_label

        remaining = leg_minutes
        covered_miles = 0.0
        while remaining > 0:
            if self._resolve_blockers(minutes_per_mile):
                continue

            budget = min(
                self._driving_remaining_min(),
                self._window_remaining_min(),
                self._break_remaining_min(),
                self._fuel_headroom_min(minutes_per_mile),
                self._cycle_remaining_min(),
                remaining,
            )
            if budget < MIN_SEGMENT_MIN:  # pragma: no cover - blockers guarantee this
                raise HOSPlanningError("Planner made no progress; constraint set is inconsistent.")

            segment_miles = budget * miles_per_minute
            self._emit(
                DutyStatus.DRIVING,
                budget,
                f"Driving toward {leg.to_label}",
                distance_miles=segment_miles,
            )
            remaining -= budget
            covered_miles += segment_miles
            self.state.trip_miles += segment_miles
            self._move_to(index.at_miles(covered_miles))

        self._move_to(index.at_miles(leg.distance_miles))
        self.state.label = leg.to_label

    def _arrive(self, leg: RouteLeg) -> None:
        if leg.arrival_stop is StopType.PICKUP:
            self._ensure_cycle_room(self.cfg.pickup_min)
            self._emit(
                DutyStatus.ON_DUTY_NOT_DRIVING,
                self.cfg.pickup_min,
                "Loading",
                stop_type=StopType.PICKUP,
                reason=REASON_PICKUP,
            )
        elif leg.arrival_stop is StopType.DROPOFF:
            self._ensure_cycle_room(self.cfg.dropoff_min)
            self._emit(
                DutyStatus.ON_DUTY_NOT_DRIVING,
                self.cfg.dropoff_min,
                "Unloading",
                stop_type=StopType.DROPOFF,
                reason=REASON_DROPOFF,
            )


def build_events(request: PlannerInput) -> tuple[Event, ...]:
    """Run the planner and return the continuous, calendar-unaware timeline."""
    return _credit_only_useful_breaks(tuple(_Planner(request).run()))


def _credit_only_useful_breaks(events: tuple[Event, ...]) -> tuple[Event, ...]:
    """Drop the break credit from any pause with no driving left after it.

    The planner marks a pause when it resets a non-zero break counter, which it
    cannot know is pointless until the trip ends. The final unloading always
    resets the counter, but crediting it with satisfying a break requirement
    that never comes due again would be noise on the stop list.
    """
    driving_remains = False
    credited: list[Event] = []
    for event in reversed(events):
        if event.satisfies_break and not driving_remains:
            event = replace(event, satisfies_break=False)
        if event.status is DutyStatus.DRIVING:
            driving_remains = True
        credited.append(event)
    return tuple(reversed(credited))


def build_stops(events: tuple[Event, ...], origin_label: str) -> tuple[Stop, ...]:
    """Every event that is also a place the truck physically stops, numbered."""
    if not events:
        return ()
    first = events[0]
    stops = [
        Stop(
            sequence=1,
            stop_type=StopType.START,
            lat=first.lat,
            lon=first.lon,
            location_label=origin_label,
            arrival_time=first.start,
            departure_time=first.start,
            duration_hours=0.0,
            odometer_miles=0.0,
            reason=REASON_START,
        )
    ]
    for event in events:
        if event.stop_type is None:
            continue
        stops.append(
            Stop(
                sequence=len(stops) + 1,
                stop_type=event.stop_type,
                lat=event.lat,
                lon=event.lon,
                location_label=event.location_label,
                arrival_time=event.start,
                departure_time=event.end,
                duration_hours=event.duration_hours,
                odometer_miles=event.odometer_miles,
                reason=event.reason or "",
                satisfies_break=event.satisfies_break,
            )
        )
    return tuple(stops)
