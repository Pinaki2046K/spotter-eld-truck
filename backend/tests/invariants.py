"""The eight engine invariants, as reusable assertions.

Every scenario test runs the whole set.  A single failure here catches nearly
any scheduling bug, which is why these are helpers rather than one-off tests.
"""

from __future__ import annotations

import itertools
from datetime import timedelta

from hos import DEFAULT_CONFIG, DutyStatus, Plan, StopType

CFG = DEFAULT_CONFIG
TOLERANCE = 1e-6


def _hours(delta: timedelta) -> float:
    return delta.total_seconds() / 3600


def _shifts(events) -> list[list]:
    """Partition the timeline into duty shifts, separated by 10+ hours off."""
    shifts: list[list] = [[]]
    for event in events:
        is_reset = (
            event.status in (DutyStatus.OFF_DUTY, DutyStatus.SLEEPER_BERTH)
            and event.duration_hours >= CFG.DAILY_RESET_HOURS - TOLERANCE
        )
        if is_reset:
            if shifts[-1]:
                shifts.append([])
            continue
        shifts[-1].append(event)
    return [shift for shift in shifts if shift]


def assert_log_days_sum_to_24(plan: Plan) -> None:
    """Invariant 1."""
    for day in plan.log_days:
        total = round(sum(day.totals.values()), 2)
        assert total == 24.00, f"day {day.day_number} ({day.date}) totals {total}, not 24.00"


def assert_driving_limit(plan: Plan) -> None:
    """Invariant 2: no shift contains more than 11.0 driving hours."""
    for index, shift in enumerate(_shifts(plan.events), start=1):
        driving = sum(e.duration_hours for e in shift if e.status is DutyStatus.DRIVING)
        assert (
            driving <= CFG.DRIVING_LIMIT_HOURS + TOLERANCE
        ), f"shift {index} drives {driving:.3f}h, over the 11-hour limit"


def assert_driving_window(plan: Plan) -> None:
    """Invariant 3: at most 14.0 hours from first on-duty to last driving minute."""
    for index, shift in enumerate(_shifts(plan.events), start=1):
        on_duty = [
            e for e in shift if e.status in (DutyStatus.DRIVING, DutyStatus.ON_DUTY_NOT_DRIVING)
        ]
        driving = [e for e in shift if e.status is DutyStatus.DRIVING]
        if not driving:
            continue
        window = _hours(driving[-1].end - on_duty[0].start)
        assert (
            window <= CFG.DRIVING_WINDOW_HOURS + TOLERANCE
        ), f"shift {index} drives {window:.3f}h after coming on duty, over the 14-hour window"


def assert_break_rule(plan: Plan) -> None:
    """Invariant 4: never 8 cumulative driving hours without a 30-minute break."""
    since_break = 0.0
    for event in plan.events:
        if event.status is DutyStatus.DRIVING:
            since_break += event.duration_hours
            assert since_break <= CFG.BREAK_REQUIRED_AFTER_HOURS + TOLERANCE, (
                f"drove {since_break:.3f}h cumulatively without a 30-minute break "
                f"(segment ending {event.end.isoformat()})"
            )
        elif event.duration_hours >= CFG.BREAK_DURATION_HOURS - TOLERANCE:
            since_break = 0.0


def assert_cycle_limit(plan: Plan, cycle_hours_used: float) -> None:
    """Invariant 5: on-duty hours never exceed the 70-hour cycle without a restart."""
    used = cycle_hours_used
    for event in plan.events:
        if event.status in (DutyStatus.DRIVING, DutyStatus.ON_DUTY_NOT_DRIVING):
            used += event.duration_hours
            assert used <= CFG.CYCLE_HOURS + TOLERANCE, (
                f"cycle reached {used:.3f}h without a 34-hour restart "
                f"(segment ending {event.end.isoformat()})"
            )
        elif (
            event.status is DutyStatus.OFF_DUTY
            and event.duration_hours >= CFG.CYCLE_RESTART_HOURS - TOLERANCE
        ):
            used = 0.0


def assert_fuel_interval(plan: Plan) -> None:
    """Invariant 6: never more than 1,000 miles between fuel stops."""
    last_fuel_miles = 0.0
    for stop in plan.stops:
        if stop.stop_type is not StopType.FUEL:
            continue
        gap = stop.odometer_miles - last_fuel_miles
        assert (
            gap <= CFG.FUEL_INTERVAL_MILES + 1.0
        ), f"{gap:.1f} miles between fuel stops at mile {stop.odometer_miles:.1f}"
        last_fuel_miles = stop.odometer_miles


def assert_waypoint_durations(plan: Plan) -> None:
    """Invariant 7: pickup and dropoff are exactly one on-duty hour each."""
    for stop in plan.stops:
        if stop.stop_type is StopType.PICKUP:
            assert stop.duration_hours == CFG.PICKUP_HOURS, stop
        if stop.stop_type is StopType.DROPOFF:
            assert stop.duration_hours == CFG.DROPOFF_HOURS, stop


def assert_contiguous(plan: Plan) -> None:
    """Invariant 8: duty entries tile the trip with no gaps and no overlaps."""
    entries = [entry for day in plan.log_days for entry in day.entries]
    for previous, current in itertools.pairwise(entries):
        assert previous.end_time == current.start_time, (
            f"gap or overlap between {previous.end_time.isoformat()} "
            f"and {current.start_time.isoformat()}"
        )
    # The planner's own timeline must be contiguous too, before any splitting.
    for previous, current in zip(plan.events, plan.events[1:], strict=False):
        assert previous.end == current.start, f"planner emitted a gap at {previous.end.isoformat()}"


def assert_all_invariants(plan: Plan, cycle_hours_used: float) -> None:
    assert_log_days_sum_to_24(plan)
    assert_driving_limit(plan)
    assert_driving_window(plan)
    assert_break_rule(plan)
    assert_cycle_limit(plan, cycle_hours_used)
    assert_fuel_interval(plan)
    assert_waypoint_durations(plan)
    assert_contiguous(plan)
