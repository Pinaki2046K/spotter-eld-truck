"""Top-level entry point: route legs in, a complete Plan out."""

from __future__ import annotations

from datetime import datetime

from .config import DEFAULT_CONFIG, HOSConfig
from .logdays import build_log_days
from .planner import PlannerInput, build_events, build_stops
from .types import Compliance, DutyStatus, Event, Plan, RouteLeg, TripSummary


def plan_trip(
    legs: tuple[RouteLeg, ...],
    cycle_hours_used: float,
    start_datetime: datetime,
    config: HOSConfig = DEFAULT_CONFIG,
) -> Plan:
    request = PlannerInput(
        legs=tuple(legs),
        cycle_hours_used=cycle_hours_used,
        start_datetime=start_datetime,
        config=config,
    )
    events = build_events(request)
    stops = build_stops(events, legs[0].from_label)

    zone = start_datetime.tzinfo
    assert zone is not None  # guaranteed by PlannerInput.validate
    log_days = build_log_days(events, zone, cycle_hours_used, config)

    driving_minutes = sum(e.duration_minutes for e in events if e.status is DutyStatus.DRIVING)
    on_duty_minutes = driving_minutes + sum(
        e.duration_minutes for e in events if e.status is DutyStatus.ON_DUTY_NOT_DRIVING
    )
    off_duty_hours = sum(
        day.totals[DutyStatus.OFF_DUTY] + day.totals[DutyStatus.SLEEPER_BERTH] for day in log_days
    )

    summary = TripSummary(
        total_distance_miles=round(sum(leg.distance_miles for leg in legs), 1),
        total_driving_hours=round(driving_minutes / 60, 2),
        total_on_duty_hours=round(on_duty_minutes / 60, 2),
        total_off_duty_hours=round(off_duty_hours, 2),
        total_days=len(log_days),
        total_stops=len(stops),
        departure_datetime=start_datetime,
        arrival_datetime=events[-1].end,
        cycle_hours_used_at_start=round(cycle_hours_used, 2),
        cycle_hours_used_at_end=round(_cycle_used_at_end(events, cycle_hours_used, config), 2),
    )
    return Plan(
        summary=summary,
        events=events,
        stops=stops,
        log_days=log_days,
        compliance=_compliance(events, config, summary.cycle_hours_used_at_end),
    )


def _cycle_used_at_end(events, cycle_hours_used: float, config: HOSConfig) -> float:
    """Replay on-duty time, honouring any 34-hour restart that zeroes the cycle."""
    used_minutes = round(cycle_hours_used * 60)
    for event in events:
        if event.status in (DutyStatus.DRIVING, DutyStatus.ON_DUTY_NOT_DRIVING):
            used_minutes += event.duration_minutes
        elif (
            event.status is DutyStatus.OFF_DUTY
            and event.duration_minutes >= config.cycle_restart_min
        ):
            used_minutes = 0
    return used_minutes / 60


def _shifts(events: tuple[Event, ...], config: HOSConfig) -> list[list[Event]]:
    """Split the timeline into duty shifts, separated by 10+ hours off."""
    shifts: list[list[Event]] = [[]]
    for event in events:
        resets = (
            event.status in (DutyStatus.OFF_DUTY, DutyStatus.SLEEPER_BERTH)
            and event.duration_minutes >= config.daily_reset_min
        )
        if resets:
            if shifts[-1]:
                shifts.append([])
            continue
        shifts[-1].append(event)
    return [shift for shift in shifts if shift]


def _compliance(
    events: tuple[Event, ...], config: HOSConfig, cycle_hours_used: float
) -> Compliance:
    """Peak usage against each limit.

    Reported as the worst shift rather than a trip total, because the limits
    are per-shift.
    """
    shifts = _shifts(events, config)

    max_driving = 0.0
    max_window = 0.0
    for shift in shifts:
        driving = [e for e in shift if e.status is DutyStatus.DRIVING]
        max_driving = max(max_driving, sum(e.duration_hours for e in driving))
        on_duty = [
            e for e in shift if e.status in (DutyStatus.DRIVING, DutyStatus.ON_DUTY_NOT_DRIVING)
        ]
        if driving and on_duty:
            span = (driving[-1].end - on_duty[0].start).total_seconds() / 3600
            max_window = max(max_window, span)

    max_between_breaks = 0.0
    since_break = 0.0
    for event in events:
        if event.status is DutyStatus.DRIVING:
            since_break += event.duration_hours
            max_between_breaks = max(max_between_breaks, since_break)
        elif event.duration_hours >= config.BREAK_DURATION_HOURS:
            since_break = 0.0

    return Compliance(
        max_driving_hours_in_shift=round(max_driving, 2),
        driving_limit_hours=config.DRIVING_LIMIT_HOURS,
        max_window_hours=round(max_window, 2),
        window_limit_hours=config.DRIVING_WINDOW_HOURS,
        max_driving_hours_between_breaks=round(max_between_breaks, 2),
        break_required_after_hours=config.BREAK_REQUIRED_AFTER_HOURS,
        cycle_hours_used=round(cycle_hours_used, 2),
        cycle_hours_limit=config.CYCLE_HOURS,
        shifts=len(shifts),
    )
