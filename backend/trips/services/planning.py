"""Orchestration: geocode -> route -> plan -> persist.

The HOS engine stays pure; this is the only place where the network, the
database and the planner meet.
"""

from __future__ import annotations

import uuid
from dataclasses import asdict
from datetime import datetime

from django.db import transaction

from hos import DEFAULT_CONFIG, DutyStatus, StopType, plan_trip
from hos import RouteLeg as EngineLeg
from hos.types import Coordinate, HOSPlanningError
from trips.errors import ApiError, ErrorCode
from trips.models import DutyEntry, LogDay, RouteLeg, Stop, Trip
from trips.services import routing
from trips.services.geocoding import Place

#: Generous bounding box over the 50 states; enough to reject a European address
#: without rejecting Alaska or Hawaii.
US_BOUNDS = (18.0, -179.9, 72.0, -66.0)


def assert_in_us(place: Place, field: str) -> None:
    min_lat, min_lon, max_lat, max_lon = US_BOUNDS
    if not (min_lat <= place.lat <= max_lat and min_lon <= place.lon <= max_lon):
        raise ApiError(
            ErrorCode.OUT_OF_COUNTRY,
            f"“{place.label}” is outside the United States. "
            "This planner covers US interstate trips only.",
            field=field,
        )


def create_trip(
    *,
    current: Place,
    pickup: Place,
    dropoff: Place,
    cycle_hours_used: float,
    start_datetime: datetime,
    trip_id: uuid.UUID | None = None,
) -> Trip:
    for place, field in (
        (current, "current_location"),
        (pickup, "pickup_location"),
        (dropoff, "dropoff_location"),
    ):
        assert_in_us(place, field)

    if (round(pickup.lat, 4), round(pickup.lon, 4)) == (
        round(dropoff.lat, 4),
        round(dropoff.lon, 4),
    ):
        raise ApiError(
            ErrorCode.NO_ROUTE,
            "Pickup and dropoff are the same place. Choose two different locations.",
            field="dropoff_location",
        )

    to_pickup = routing.route(
        Coordinate(current.lat, current.lon), Coordinate(pickup.lat, pickup.lon)
    )
    to_dropoff = routing.route(
        Coordinate(pickup.lat, pickup.lon), Coordinate(dropoff.lat, dropoff.lon)
    )

    engine_legs = (
        EngineLeg(
            sequence=1,
            from_label=current.label,
            to_label=pickup.label,
            distance_miles=to_pickup.distance_miles,
            geometry=to_pickup.geometry,
            arrival_stop=StopType.PICKUP,
        ),
        EngineLeg(
            sequence=2,
            from_label=pickup.label,
            to_label=dropoff.label,
            distance_miles=to_dropoff.distance_miles,
            geometry=to_dropoff.geometry,
            arrival_stop=StopType.DROPOFF,
        ),
    )

    try:
        plan = plan_trip(engine_legs, cycle_hours_used, start_datetime, DEFAULT_CONFIG)
    except HOSPlanningError as exc:
        raise ApiError(ErrorCode.NO_ROUTE, str(exc)) from exc

    return _persist(
        plan=plan,
        current=current,
        pickup=pickup,
        dropoff=dropoff,
        cycle_hours_used=cycle_hours_used,
        start_datetime=start_datetime,
        routed=(to_pickup, to_dropoff),
        engine_legs=engine_legs,
        trip_id=trip_id,
    )


@transaction.atomic
def _persist(
    *,
    plan,
    current,
    pickup,
    dropoff,
    cycle_hours_used,
    start_datetime,
    routed,
    engine_legs,
    trip_id=None,
) -> Trip:
    summary = plan.summary
    if trip_id is not None:
        # Re-seeding replaces the previous fixture rather than colliding on the PK.
        Trip.objects.filter(pk=trip_id).delete()
    trip = Trip.objects.create(
        **({"id": trip_id} if trip_id is not None else {}),
        current_location=current.label,
        current_lat=current.lat,
        current_lon=current.lon,
        pickup_location=pickup.label,
        pickup_lat=pickup.lat,
        pickup_lon=pickup.lon,
        dropoff_location=dropoff.label,
        dropoff_lat=dropoff.lat,
        dropoff_lon=dropoff.lon,
        cycle_hours_used=cycle_hours_used,
        start_datetime=start_datetime,
        arrival_datetime=summary.arrival_datetime,
        home_timezone_offset_minutes=int(start_datetime.utcoffset().total_seconds() // 60),
        total_distance_miles=summary.total_distance_miles,
        total_driving_hours=summary.total_driving_hours,
        total_on_duty_hours=summary.total_on_duty_hours,
        total_off_duty_hours=summary.total_off_duty_hours,
        routing_provider=routed[0].provider,
        compliance=asdict(plan.compliance) if plan.compliance else {},
    )

    RouteLeg.objects.bulk_create(
        RouteLeg(
            trip=trip,
            sequence=engine_leg.sequence,
            from_label=engine_leg.from_label,
            to_label=engine_leg.to_label,
            distance_miles=engine_leg.distance_miles,
            duration_hours=round(engine_leg.distance_miles / DEFAULT_CONFIG.AVERAGE_SPEED_MPH, 2),
            geometry=[[point.lat, point.lon] for point in engine_leg.geometry],
        )
        for engine_leg in engine_legs
    )

    Stop.objects.bulk_create(
        Stop(
            trip=trip,
            sequence=stop.sequence,
            stop_type=stop.stop_type.value,
            latitude=stop.lat,
            longitude=stop.lon,
            location_label=stop.location_label,
            arrival_time=stop.arrival_time,
            departure_time=stop.departure_time,
            duration_hours=stop.duration_hours,
            odometer_miles=stop.odometer_miles,
            reason=stop.reason,
            satisfies_break=stop.satisfies_break,
        )
        for stop in plan.stops
    )

    entries: list[DutyEntry] = []
    for day in plan.log_days:
        log_day = LogDay.objects.create(
            trip=trip,
            day_number=day.day_number,
            date=day.date,
            total_miles=day.total_miles,
            total_off_duty=day.totals[DutyStatus.OFF_DUTY],
            total_sleeper=day.totals[DutyStatus.SLEEPER_BERTH],
            total_driving=day.totals[DutyStatus.DRIVING],
            total_on_duty=day.totals[DutyStatus.ON_DUTY_NOT_DRIVING],
        )
        entries.extend(
            DutyEntry(
                log_day=log_day,
                sequence=entry.sequence,
                status=entry.status.value,
                start_time=entry.start_time,
                end_time=entry.end_time,
                duration_hours=entry.duration_hours,
                distance_miles=entry.distance_miles,
                location_label=entry.location_label,
                remark=entry.remark,
            )
            for entry in day.entries
        )
    DutyEntry.objects.bulk_create(entries)
    return trip
