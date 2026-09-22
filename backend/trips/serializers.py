"""DRF serializers.

The response is read-only and deeply nested, so input and output are separate
classes.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta

from django.utils import timezone
from rest_framework import serializers

from hos import DEFAULT_CONFIG
from trips.models import DutyEntry, LogDay, RouteLeg, Stop, Trip
from trips.services.geocoding import Place

#: Trailing "Z" or "+HH:MM" / "-HHMM".
_HAS_UTC_OFFSET = re.compile(r"(Z|[+-]\d{2}:?\d{2})$")


class LocationInputSerializer(serializers.Serializer):
    """A place the user picked from autocomplete: label plus resolved coordinates.

    Sending coordinates rather than raw text is what removes the "which
    Springfield?" ambiguity -- the backend never has to guess.
    """

    label = serializers.CharField(max_length=255)
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lon = serializers.FloatField(min_value=-180, max_value=180)

    def to_place(self) -> Place:
        return Place(**self.validated_data)


class HomeTerminalDateTimeField(serializers.DateTimeField):
    """A DateTimeField that keeps the offset the driver submitted.

    DRF normalises every aware datetime to the current timezone, which is UTC
    here, discarding the original offset. The offset matters because log sheets
    run midnight to midnight in the *home terminal*
    timezone, so losing it splits the days at the wrong boundary and renders
    every time in UTC. A 06:00 departure in Chicago would be drawn as 11:00,
    and in India as 00:30 the previous night.
    """

    def enforce_timezone(self, value):
        return value


class TripCreateSerializer(serializers.Serializer):
    current_location = LocationInputSerializer()
    pickup_location = LocationInputSerializer()
    dropoff_location = LocationInputSerializer()
    cycle_hours_used = serializers.FloatField(min_value=0.0, max_value=DEFAULT_CONFIG.CYCLE_HOURS)
    start_datetime = HomeTerminalDateTimeField(required=False, allow_null=True)

    def validate_cycle_hours_used(self, value: float) -> float:
        return round(value, 1)

    def validate(self, attrs: dict) -> dict:
        """Require an explicit offset on start_datetime.

        DRF would happily read a naive string as UTC, which silently shifts a
        Chicago driver's midnight by five hours -- and midnight is exactly where
        one log sheet ends and the next begins.
        """
        raw = self.initial_data.get("start_datetime") if hasattr(self, "initial_data") else None
        if isinstance(raw, str) and raw.strip() and not _HAS_UTC_OFFSET.search(raw):
            raise serializers.ValidationError(
                {"start_datetime": "Include a UTC offset, e.g. 2026-09-22T06:00:00-05:00."}
            )
        return attrs

    def resolved_start(self) -> datetime:
        """Default to the next 06:00 UTC, so sheets carry a real date."""
        given = self.validated_data.get("start_datetime")
        if given is not None:
            return given
        now = timezone.now()
        candidate = now.replace(hour=6, minute=0, second=0, microsecond=0)
        if candidate <= now:
            candidate += timedelta(days=1)
        return candidate

    def places(self) -> tuple[Place, Place, Place]:
        return tuple(
            Place(**self.validated_data[field])
            for field in ("current_location", "pickup_location", "dropoff_location")
        )


# --- output ----------------------------------------------------------------


class RouteLegSerializer(serializers.ModelSerializer):
    class Meta:
        model = RouteLeg
        fields = (
            "sequence",
            "from_label",
            "to_label",
            "distance_miles",
            "duration_hours",
            "geometry",
        )


class StopSerializer(serializers.ModelSerializer):
    lat = serializers.FloatField(source="latitude")
    lon = serializers.FloatField(source="longitude")

    class Meta:
        model = Stop
        fields = (
            "sequence",
            "stop_type",
            "lat",
            "lon",
            "location_label",
            "arrival_time",
            "departure_time",
            "duration_hours",
            "odometer_miles",
            "reason",
            "satisfies_break",
        )


class DutyEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = DutyEntry
        fields = (
            "sequence",
            "status",
            "start_time",
            "end_time",
            "duration_hours",
            "distance_miles",
            "location_label",
            "remark",
        )


class LogDaySerializer(serializers.ModelSerializer):
    entries = DutyEntrySerializer(many=True, read_only=True)
    totals = serializers.SerializerMethodField()

    class Meta:
        model = LogDay
        fields = ("day_number", "date", "total_miles", "totals", "cycle_hours_used_end", "entries")

    def get_totals(self, day: LogDay) -> dict:
        return {
            "off_duty": day.total_off_duty,
            "sleeper": day.total_sleeper,
            "driving": day.total_driving,
            "on_duty": day.total_on_duty,
            "total": day.total_hours,
        }


class TripSerializer(serializers.ModelSerializer):
    summary = serializers.SerializerMethodField()
    route = serializers.SerializerMethodField()
    inputs = serializers.SerializerMethodField()
    stops = StopSerializer(many=True, read_only=True)
    log_days = LogDaySerializer(many=True, read_only=True)
    compliance = serializers.SerializerMethodField()
    assumptions = serializers.SerializerMethodField()

    class Meta:
        model = Trip
        fields = (
            "id",
            "created_at",
            "inputs",
            "summary",
            "route",
            "stops",
            "log_days",
            "compliance",
            "assumptions",
        )

    def get_compliance(self, trip: Trip) -> dict:
        """Peak usage against each limit, plus the cycle hours still available."""
        data = dict(trip.compliance or {})
        if data:
            # Floored: unloading may legally take the cycle past 70.
            data["cycle_hours_remaining"] = round(
                max(0.0, data["cycle_hours_limit"] - data["cycle_hours_used"]), 2
            )
        return data

    def get_inputs(self, trip: Trip) -> dict:
        return {
            "current_location": {
                "label": trip.current_location,
                "lat": trip.current_lat,
                "lon": trip.current_lon,
            },
            "pickup_location": {
                "label": trip.pickup_location,
                "lat": trip.pickup_lat,
                "lon": trip.pickup_lon,
            },
            "dropoff_location": {
                "label": trip.dropoff_location,
                "lat": trip.dropoff_lat,
                "lon": trip.dropoff_lon,
            },
            "cycle_hours_used": trip.cycle_hours_used,
            "start_datetime": trip.start_datetime,
            "home_timezone_offset_minutes": trip.home_timezone_offset_minutes,
        }

    def get_summary(self, trip: Trip) -> dict:
        stops = list(trip.stops.all())
        return {
            "total_distance_miles": trip.total_distance_miles,
            "total_driving_hours": trip.total_driving_hours,
            "total_on_duty_hours": trip.total_on_duty_hours,
            "total_off_duty_hours": trip.total_off_duty_hours,
            "total_days": trip.log_days.count(),
            "total_stops": len(stops),
            "required_stops": sum(
                1 for stop in stops if stop.stop_type not in ("START", "PICKUP", "DROPOFF")
            ),
            "departure_datetime": trip.start_datetime,
            "arrival_datetime": trip.arrival_datetime,
            "cycle_hours_used_at_start": trip.cycle_hours_used,
            "routing_provider": trip.routing_provider,
        }

    def get_route(self, trip: Trip) -> dict:
        return {"legs": RouteLegSerializer(trip.legs.all(), many=True).data}

    def get_assumptions(self, trip: Trip) -> dict:  # noqa: ARG002
        """Echoed so the UI can surface that the fixed assumptions were honoured."""
        config = DEFAULT_CONFIG
        return {
            "driver_type": "Property-carrying, 70 hours / 8 days",
            "cycle_hours": config.CYCLE_HOURS,
            "adverse_conditions": False,
            "average_speed_mph": config.AVERAGE_SPEED_MPH,
            "fuel_interval_miles": config.FUEL_INTERVAL_MILES,
            "fuel_stop_hours": config.FUEL_STOP_HOURS,
            "pickup_hours": config.PICKUP_HOURS,
            "dropoff_hours": config.DROPOFF_HOURS,
            "inspection_hours": config.INSPECTION_HOURS,
        }
