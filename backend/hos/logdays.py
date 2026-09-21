"""Split the continuous timeline into midnight-to-midnight log days.

The planner deliberately ignores calendar boundaries.  Log sheets do not: each
one covers exactly 00:00 to 24:00 in the home terminal timezone.  This pass
pads the first and last days out to full days, cuts every event that crosses a
midnight, and groups the result.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, tzinfo

from .config import DEFAULT_CONFIG, HOSConfig
from .types import LOG_ROW_ORDER, DutyEntry, DutyStatus, Event, LogDay

MINUTES_PER_DAY = 24 * 60


def _next_midnight(moment: datetime, zone: tzinfo) -> datetime:
    local = moment.astimezone(zone)
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight + timedelta(days=1)


def _midnight_of(moment: datetime, zone: tzinfo) -> datetime:
    local = moment.astimezone(zone)
    return local.replace(hour=0, minute=0, second=0, microsecond=0)


def _pad(status_from: Event, start: datetime, end: datetime, remark: str) -> Event:
    return Event(
        status=DutyStatus.OFF_DUTY,
        start=start,
        end=end,
        lat=status_from.lat,
        lon=status_from.lon,
        location_label=status_from.location_label,
        remark=remark,
        odometer_miles=status_from.odometer_miles,
    )


def pad_to_whole_days(events: tuple[Event, ...], zone: tzinfo) -> tuple[Event, ...]:
    """Bookend the timeline with off-duty time so day 1 and the final day are full.

    Without this the first sheet would start mid-morning and the last would stop
    at the dropoff, leaving gaps that break the 24-hour invariant.
    """
    if not events:
        return events
    padded = list(events)

    day_start = _midnight_of(events[0].start, zone)
    if events[0].start > day_start:
        padded.insert(0, _pad(events[0], day_start, events[0].start, "Off duty"))

    last = events[-1]
    day_end = _next_midnight(last.end, zone)
    if last.end < day_end:
        tail = _pad(last, last.end, day_end, "Off duty -- trip complete")
        padded.append(tail)
    return tuple(padded)


def split_at_midnight(events: tuple[Event, ...], zone: tzinfo) -> tuple[Event, ...]:
    """Cut any event spanning local midnight into one piece per calendar day."""
    pieces: list[Event] = []
    for event in events:
        cursor = event.start
        while cursor < event.end:
            boundary = min(_next_midnight(cursor, zone), event.end)
            fraction = (boundary - cursor) / (event.end - event.start)
            pieces.append(
                Event(
                    status=event.status,
                    start=cursor,
                    end=boundary,
                    lat=event.lat,
                    lon=event.lon,
                    location_label=event.location_label,
                    remark=event.remark,
                    distance_miles=round(event.distance_miles * fraction, 2),
                    odometer_miles=event.odometer_miles,
                    stop_type=event.stop_type if cursor == event.start else None,
                    reason=event.reason if cursor == event.start else None,
                )
            )
            cursor = boundary
    return tuple(pieces)


def _totals_summing_to_24(minutes_by_status: dict[DutyStatus, int]) -> dict[DutyStatus, float]:
    """Round the four totals to 2dp such that they still add up to exactly 24.00.

    Naive rounding can land on 23.99.  The residual is pushed onto the largest
    bucket, where a hundredth of an hour is invisible.
    """
    total_minutes = sum(minutes_by_status.values())
    rounded = {status: round(minutes / 60, 2) for status, minutes in minutes_by_status.items()}
    target = round(total_minutes / 60, 2)
    residual = round(target - sum(rounded.values()), 2)
    if residual:
        largest = max(minutes_by_status, key=lambda status: minutes_by_status[status])
        rounded[largest] = round(rounded[largest] + residual, 2)
    return rounded


def cycle_minutes_at(
    events: tuple[Event, ...], moment: datetime, cycle_hours_used: float, config: HOSConfig
) -> int:
    """On-duty minutes in the cycle at `moment`, replaying the planner's model.

    A 34-hour restart zeroes the cycle when it completes, not when it begins,
    so one still in progress at `moment` has not reset anything yet.
    """
    used = round(cycle_hours_used * 60)
    for event in events:
        if event.start >= moment:
            break
        if event.status in (DutyStatus.DRIVING, DutyStatus.ON_DUTY_NOT_DRIVING):
            portion_end = min(event.end, moment)
            used += round((portion_end - event.start).total_seconds() / 60)
        elif event.duration_minutes >= config.cycle_restart_min and event.end <= moment:
            used = 0
    return used


def build_log_days(
    events: tuple[Event, ...],
    zone: tzinfo,
    cycle_hours_used: float = 0.0,
    config: HOSConfig = DEFAULT_CONFIG,
) -> tuple[LogDay, ...]:
    if not events:
        return ()
    pieces = split_at_midnight(pad_to_whole_days(events, zone), zone)

    grouped: dict[date, list[Event]] = {}
    for piece in pieces:
        grouped.setdefault(piece.start.astimezone(zone).date(), []).append(piece)

    log_days: list[LogDay] = []
    for day_number, day in enumerate(sorted(grouped), start=1):
        day_events = grouped[day]
        minutes_by_status = dict.fromkeys(LOG_ROW_ORDER, 0)
        entries: list[DutyEntry] = []
        for sequence, event in enumerate(day_events, start=1):
            minutes_by_status[event.status] += event.duration_minutes
            entries.append(
                DutyEntry(
                    sequence=sequence,
                    status=event.status,
                    start_time=event.start,
                    end_time=event.end,
                    duration_hours=round(event.duration_minutes / 60, 4),
                    location_label=event.location_label,
                    remark=event.remark,
                    distance_miles=event.distance_miles,
                )
            )
        log_days.append(
            LogDay(
                day_number=day_number,
                date=day,
                total_miles=round(sum(e.distance_miles for e in day_events), 1),
                totals=_totals_summing_to_24(minutes_by_status),
                entries=tuple(entries),
                cycle_hours_used_end=round(
                    cycle_minutes_at(events, day_events[-1].end, cycle_hours_used, config) / 60,
                    2,
                ),
            )
        )
    return tuple(log_days)
