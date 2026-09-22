"""Scenario tests from the PRD's acceptance table, plus edge cases."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from hos import DutyStatus, HOSPlanningError, StopType, plan_trip
from tests.conftest import CENTRAL, two_leg_route
from tests.invariants import assert_all_invariants


def stop_types(plan) -> list[StopType]:
    return [stop.stop_type for stop in plan.stops]


def count(plan, stop_type: StopType) -> int:
    return sum(1 for stop in plan.stops if stop.stop_type is stop_type)


# --- the PRD scenario table ------------------------------------------------


def test_short_trip_fits_in_one_day(short_route, start):
    plan = plan_trip(short_route, cycle_hours_used=0.0, start_datetime=start)

    assert_all_invariants(plan, 0.0)
    assert plan.summary.total_days == 1
    assert count(plan, StopType.DAILY_RESET) == 0
    assert count(plan, StopType.FUEL) == 0
    assert stop_types(plan) == [StopType.START, StopType.PICKUP, StopType.DROPOFF]


def test_standard_multi_day_trip(standard_route, start):
    plan = plan_trip(standard_route, cycle_hours_used=20.0, start_datetime=start)

    assert_all_invariants(plan, 20.0)
    assert plan.summary.total_days >= 2
    assert count(plan, StopType.DAILY_RESET) >= 1
    assert count(plan, StopType.FUEL) >= 1
    assert plan.summary.total_distance_miles == pytest.approx(1153.4, abs=0.1)


def test_long_haul_needs_several_fuel_stops(long_haul_route, start):
    plan = plan_trip(long_haul_route, cycle_hours_used=0.0, start_datetime=start)

    assert_all_invariants(plan, 0.0)
    assert count(plan, StopType.FUEL) >= 3
    assert plan.summary.total_days >= 5
    # 3,444 miles at 55 mph is 62.6 driving hours; with 3.5 hours of loading,
    # unloading and fuelling that is 66.1 on duty -- just inside the 70-hour cycle.
    assert plan.summary.total_on_duty_hours < 70.0
    assert count(plan, StopType.CYCLE_RESTART) == 0


def test_long_haul_with_hours_already_used_needs_a_restart(long_haul_route, start):
    plan = plan_trip(long_haul_route, cycle_hours_used=20.0, start_datetime=start)

    assert_all_invariants(plan, 20.0)
    assert count(plan, StopType.CYCLE_RESTART) >= 1
    restart = next(s for s in plan.stops if s.stop_type is StopType.CYCLE_RESTART)
    assert restart.duration_hours == 34.0


def test_near_cycle_limit_inserts_restart_early(standard_route, start):
    plan = plan_trip(standard_route, cycle_hours_used=68.0, start_datetime=start)

    assert_all_invariants(plan, 68.0)
    restarts = [s for s in plan.stops if s.stop_type is StopType.CYCLE_RESTART]
    assert restarts, "expected a 34-hour restart with only 2 cycle hours left"
    # Two on-duty hours (a 15-minute pre-trip, then driving) exhaust the cycle;
    # the post-trip inspection follows, then the restart.
    assert restarts[0].arrival_time - start <= timedelta(hours=2, minutes=15)


def test_at_cycle_limit_opens_with_a_restart(standard_route, start):
    plan = plan_trip(standard_route, cycle_hours_used=70.0, start_datetime=start)

    assert_all_invariants(plan, 70.0)
    first = plan.events[0]
    assert first.stop_type is StopType.CYCLE_RESTART
    assert first.start == start
    assert first.duration_hours == 34.0
    assert first.status is DutyStatus.OFF_DUTY


def test_midnight_boundary_split(standard_route):
    late = datetime(2026, 9, 22, 22, 0, tzinfo=CENTRAL)
    plan = plan_trip(standard_route, cycle_hours_used=0.0, start_datetime=late)

    assert_all_invariants(plan, 0.0)
    first_day = plan.log_days[0]
    assert first_day.date.isoformat() == "2026-09-22"
    assert first_day.entries[-1].end_time.astimezone(CENTRAL).hour == 0
    assert first_day.entries[-1].end_time.astimezone(CENTRAL).day == 23
    # 22 hours off duty before departure, then two hours of work before midnight.
    assert first_day.totals[DutyStatus.OFF_DUTY] == pytest.approx(22.0)


def test_identical_pickup_and_dropoff_is_rejected():
    legs = two_leg_route(120.0, 0.0)
    with pytest.raises(HOSPlanningError, match="no distance"):
        plan_trip(legs, 0.0, datetime(2026, 9, 22, 6, 0, tzinfo=CENTRAL))


# --- engine behaviour ------------------------------------------------------


def test_window_starts_at_first_on_duty_not_first_driving_minute(start):
    """A shift that opens with an hour of loading loses that hour of window."""
    legs = two_leg_route(1.0, 900.0)
    plan = plan_trip(legs, 0.0, start)

    assert_all_invariants(plan, 0.0)
    first_shift_driving = [
        e
        for e in plan.events
        if e.status is DutyStatus.DRIVING and e.start - start < timedelta(hours=14)
    ]
    last_drive_end = first_shift_driving[-1].end
    assert last_drive_end - start <= timedelta(hours=14)


def test_break_is_cumulative_not_consecutive(start):
    """Driving 4h, resting 15 min, driving 4h must still trigger the break."""
    legs = two_leg_route(550.0, 550.0)  # 10h driving each leg
    plan = plan_trip(legs, 0.0, start)

    assert_all_invariants(plan, 0.0)
    assert count(plan, StopType.REST_BREAK) >= 1


def test_one_hour_loading_satisfies_a_due_break(start):
    """The pickup is 60 minutes of non-driving time, so no separate break is needed."""
    legs = two_leg_route(440.0, 165.0)  # 8h then 3h
    plan = plan_trip(legs, 0.0, start)

    assert_all_invariants(plan, 0.0)
    pickup = next(s for s in plan.stops if s.stop_type is StopType.PICKUP)
    after_pickup = [s for s in plan.stops if s.arrival_time > pickup.departure_time]
    assert not any(s.stop_type is StopType.REST_BREAK for s in after_pickup)


def test_fuel_stop_counts_as_the_required_break(start):
    """A 30-minute fuel stop is non-driving time, so it clears the break counter."""
    legs = two_leg_route(50.0, 1200.0)
    plan = plan_trip(legs, 0.0, start)

    assert_all_invariants(plan, 0.0)
    assert count(plan, StopType.FUEL) >= 1


def test_every_stop_carries_a_reason(standard_route, start):
    plan = plan_trip(standard_route, 20.0, start)
    for stop in plan.stops:
        assert stop.reason, f"stop {stop.sequence} ({stop.stop_type}) has no reason string"


def test_stops_are_sequentially_numbered_and_ordered(standard_route, start):
    plan = plan_trip(standard_route, 20.0, start)
    assert [s.sequence for s in plan.stops] == list(range(1, len(plan.stops) + 1))
    times = [s.arrival_time for s in plan.stops]
    assert times == sorted(times)


def test_planner_is_deterministic(standard_route, start):
    first = plan_trip(standard_route, 20.0, start)
    second = plan_trip(standard_route, 20.0, start)
    assert first.events == second.events
    assert first.stops == second.stops
    assert first.log_days == second.log_days


def test_naive_start_datetime_is_rejected(standard_route):
    with pytest.raises(HOSPlanningError, match="timezone-aware"):
        plan_trip(standard_route, 0.0, datetime(2026, 9, 22, 6, 0))


@pytest.mark.parametrize("cycle_hours", [-1.0, 70.1, 99.0])
def test_out_of_range_cycle_hours_is_rejected(standard_route, start, cycle_hours):
    with pytest.raises(HOSPlanningError, match="cycle_hours_used"):
        plan_trip(standard_route, cycle_hours, start)


@pytest.mark.parametrize("cycle_hours", [0.0, 12.5, 40.0, 60.0, 68.0, 69.9, 70.0])
@pytest.mark.parametrize("hour", [0, 6, 13, 22, 23])
def test_invariants_hold_across_the_input_space(standard_route, cycle_hours, hour):
    """The real regression net: every invariant, over a grid of starting states."""
    start = datetime(2026, 9, 22, hour, 0, tzinfo=CENTRAL)
    plan = plan_trip(standard_route, cycle_hours, start)
    assert_all_invariants(plan, cycle_hours)


@pytest.mark.parametrize("zone_offset", [-5, -8, 0])
def test_log_days_respect_the_home_terminal_timezone(standard_route, zone_offset):
    zone = timezone(timedelta(hours=zone_offset))
    start = datetime(2026, 9, 22, 23, 30, tzinfo=zone)
    plan = plan_trip(standard_route, 0.0, start)

    assert_all_invariants(plan, 0.0)
    for day in plan.log_days:
        first = day.entries[0].start_time.astimezone(zone)
        assert (first.hour, first.minute) == (0, 0)


# --- compliance evidence ---------------------------------------------------


def test_compliance_reports_the_worst_shift_not_the_trip_total(standard_route, start):
    """A trip total of 20 driving hours proves nothing; the worst shift does."""
    plan = plan_trip(standard_route, 20.0, start)
    compliance = plan.compliance

    assert compliance is not None
    assert compliance.shifts >= 2
    assert compliance.max_driving_hours_in_shift <= compliance.driving_limit_hours
    assert compliance.max_window_hours <= compliance.window_limit_hours
    assert compliance.max_driving_hours_between_breaks <= compliance.break_required_after_hours
    # The trip drives far more than one shift's limit.
    assert plan.summary.total_driving_hours > compliance.max_driving_hours_in_shift


def test_compliance_tracks_the_cycle_from_the_hours_already_used(standard_route, start):
    plan = plan_trip(standard_route, 20.0, start)

    assert plan.compliance.cycle_hours_used > 20.0
    assert plan.compliance.cycle_hours_remaining == pytest.approx(
        70.0 - plan.compliance.cycle_hours_used, abs=0.01
    )


def test_a_restart_returns_the_full_cycle(standard_route, start):
    plan = plan_trip(standard_route, 70.0, start)
    assert plan.compliance.cycle_hours_used < 70.0


def test_loading_and_fuelling_are_credited_with_the_required_break(standard_route, start):
    """No separate break stop appears because these already satisfy it."""
    plan = plan_trip(standard_route, 20.0, start)
    crediting = [s for s in plan.stops if s.satisfies_break]

    assert {s.stop_type for s in crediting} == {StopType.PICKUP, StopType.FUEL}
    assert all(s.duration_hours >= 0.5 for s in crediting)


def test_a_pause_with_no_driving_after_it_is_not_credited(standard_route, start):
    """The final unloading resets the counter but no break was ever due again."""
    plan = plan_trip(standard_route, 20.0, start)
    dropoff = next(s for s in plan.stops if s.stop_type is StopType.DROPOFF)
    assert dropoff.satisfies_break is False


def test_a_ten_hour_reset_is_not_described_as_the_break(standard_route, start):
    plan = plan_trip(standard_route, 20.0, start)
    resets = [s for s in plan.stops if s.stop_type is StopType.DAILY_RESET]
    assert resets and all(not s.satisfies_break for s in resets)


# --- 395.3(b) limits driving, not on-duty work ----------------------------------


def test_unloading_does_not_wait_for_a_restart_when_the_cycle_ends_on_arrival(start):
    """Arriving at the dropoff with exactly 70 cycle hours used is not a reason
    to sit for 34 hours: unloading is on duty *not driving*, which 395.3(b)
    allows past 70."""
    # 0.25 pre-trip + 1 h drive + 1 h loading + 8 h drive = 10.25 on-duty hours.
    route = two_leg_route(pickup_miles=55.0, dropoff_miles=440.0)
    plan = plan_trip(route, cycle_hours_used=59.75, start_datetime=start)

    assert_all_invariants(plan, 59.75)
    assert count(plan, StopType.CYCLE_RESTART) == 0
    assert plan.summary.total_days == 1
    dropoff = next(s for s in plan.stops if s.stop_type is StopType.DROPOFF)
    last_driving = [e for e in plan.events if e.status is DutyStatus.DRIVING][-1]
    assert dropoff.arrival_time == last_driving.end
    # The cycle legitimately ends above 70; the gauge floors "left" at zero.
    assert plan.compliance.cycle_hours_used == 71.25
    assert plan.compliance.cycle_hours_remaining == 0.0


def test_a_restart_still_precedes_driving_past_70(start):
    # A little more driving than the case above: the cycle reaches 70 with the
    # dropoff still ahead, so a restart must come before the remaining miles.
    route = two_leg_route(pickup_miles=55.0, dropoff_miles=450.0)
    plan = plan_trip(route, cycle_hours_used=59.75, start_datetime=start)

    assert_all_invariants(plan, 59.75)
    assert count(plan, StopType.CYCLE_RESTART) == 1
    restart = next(s for s in plan.stops if s.stop_type is StopType.CYCLE_RESTART)
    dropoff = next(s for s in plan.stops if s.stop_type is StopType.DROPOFF)
    assert restart.arrival_time < dropoff.arrival_time


# --- inspections -----------------------------------------------------------------


def _shift_bounds(plan):
    """First and last event of each shift (runs of work between 10+ hours off)."""
    shifts, current = [], []
    for event in plan.events:
        rest = (
            event.status in (DutyStatus.OFF_DUTY, DutyStatus.SLEEPER_BERTH)
            and event.duration_hours >= 10
        )
        if rest:
            if current:
                shifts.append(current)
            current = []
        else:
            current.append(event)
    if current:
        shifts.append(current)
    return shifts


def test_every_shift_opens_and_closes_with_a_15_minute_inspection(long_haul_route, start):
    plan = plan_trip(long_haul_route, cycle_hours_used=0.0, start_datetime=start)

    assert_all_invariants(plan, 0.0)
    shifts = _shift_bounds(plan)
    assert len(shifts) > 3
    for shift in shifts:
        first, last = shift[0], shift[-1]
        assert first.remark == "Pre-trip inspection", first
        assert last.remark == "Post-trip inspection", last
        for event in (first, last):
            assert event.status is DutyStatus.ON_DUTY_NOT_DRIVING
            assert event.duration_minutes == 15


def test_the_pre_trip_inspection_opens_the_14_hour_window(short_route, start):
    plan = plan_trip(short_route, cycle_hours_used=0.0, start_datetime=start)
    assert plan.events[0].remark == "Pre-trip inspection"
    assert plan.events[0].start == start
    assert plan.events[1].status is DutyStatus.DRIVING
    assert plan.events[1].start == start + timedelta(minutes=15)


# --- the 70-hour/8-day recap --------------------------------------------------------


def _on_duty(day) -> float:
    return day.totals[DutyStatus.DRIVING] + day.totals[DutyStatus.ON_DUTY_NOT_DRIVING]


def test_recap_cycle_totals_accumulate_day_by_day(long_haul_route, start):
    plan = plan_trip(long_haul_route, cycle_hours_used=0.0, start_datetime=start)
    assert count(plan, StopType.CYCLE_RESTART) == 0  # precondition: no reset to model

    previous = 0.0
    for day in plan.log_days:
        assert day.cycle_hours_used_end == pytest.approx(previous + _on_duty(day), abs=0.011)
        previous = day.cycle_hours_used_end
    assert plan.log_days[-1].cycle_hours_used_end == plan.summary.cycle_hours_used_at_end


def test_recap_cycle_total_resets_once_a_34_hour_restart_completes(standard_route, start):
    plan = plan_trip(standard_route, cycle_hours_used=68.0, start_datetime=start)
    restart = next(s for s in plan.stops if s.stop_type is StopType.CYCLE_RESTART)
    restart_end_day = restart.departure_time.astimezone(start.tzinfo).date()
    day = next(d for d in plan.log_days if d.date == restart_end_day)

    # Only the on-duty time after the restart ends counts on that day. The
    # day's entries are already cut at midnight, so they are the right units.
    after = sum(
        e.duration_hours
        for e in day.entries
        if e.start_time >= restart.departure_time
        and e.status in (DutyStatus.DRIVING, DutyStatus.ON_DUTY_NOT_DRIVING)
    )
    assert day.cycle_hours_used_end == pytest.approx(after, abs=0.011)
    assert plan.log_days[-1].cycle_hours_used_end == plan.summary.cycle_hours_used_at_end
