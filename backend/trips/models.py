"""Persistence for a planned trip.

Everything the engine produces is stored, so a trip is shareable by URL and can
be re-rendered without recomputing (or re-hitting any upstream API).
"""

from __future__ import annotations

import uuid

from django.db import models

from hos.types import DutyStatus, StopType


class Trip(models.Model):
    """A UUID primary key keeps hosted trip URLs unguessable and unenumerable."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    current_location = models.CharField(max_length=255)
    current_lat = models.FloatField()
    current_lon = models.FloatField()

    pickup_location = models.CharField(max_length=255)
    pickup_lat = models.FloatField()
    pickup_lon = models.FloatField()

    dropoff_location = models.CharField(max_length=255)
    dropoff_lat = models.FloatField()
    dropoff_lon = models.FloatField()

    cycle_hours_used = models.FloatField()
    start_datetime = models.DateTimeField()
    arrival_datetime = models.DateTimeField()

    total_distance_miles = models.FloatField()
    total_driving_hours = models.FloatField()
    total_on_duty_hours = models.FloatField()
    total_off_duty_hours = models.FloatField()

    routing_provider = models.CharField(max_length=32, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"{self.current_location} to {self.dropoff_location} via {self.pickup_location}"


class RouteLeg(models.Model):
    trip = models.ForeignKey(Trip, related_name="legs", on_delete=models.CASCADE)
    sequence = models.PositiveSmallIntegerField()
    from_label = models.CharField(max_length=255)
    to_label = models.CharField(max_length=255)
    distance_miles = models.FloatField()
    duration_hours = models.FloatField()
    #: JSON array of [lat, lon] pairs.  Plain floats, no PostGIS -- see README.
    geometry = models.JSONField(default=list)

    class Meta:
        ordering = ("sequence",)
        constraints = [
            models.UniqueConstraint(fields=("trip", "sequence"), name="unique_leg_sequence")
        ]


class Stop(models.Model):
    STOP_TYPE_CHOICES = [(item.value, item.value.replace("_", " ").title()) for item in StopType]

    trip = models.ForeignKey(Trip, related_name="stops", on_delete=models.CASCADE)
    sequence = models.PositiveSmallIntegerField()
    stop_type = models.CharField(max_length=20, choices=STOP_TYPE_CHOICES)
    latitude = models.FloatField()
    longitude = models.FloatField()
    location_label = models.CharField(max_length=255)
    arrival_time = models.DateTimeField()
    departure_time = models.DateTimeField()
    duration_hours = models.FloatField()
    odometer_miles = models.FloatField(default=0.0)
    reason = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ("sequence",)
        constraints = [
            models.UniqueConstraint(fields=("trip", "sequence"), name="unique_stop_sequence")
        ]


class LogDay(models.Model):
    trip = models.ForeignKey(Trip, related_name="log_days", on_delete=models.CASCADE)
    day_number = models.PositiveSmallIntegerField()
    date = models.DateField()
    total_miles = models.FloatField(default=0.0)
    total_off_duty = models.FloatField(default=0.0)
    total_sleeper = models.FloatField(default=0.0)
    total_driving = models.FloatField(default=0.0)
    total_on_duty = models.FloatField(default=0.0)

    class Meta:
        ordering = ("day_number",)
        constraints = [
            models.UniqueConstraint(fields=("trip", "day_number"), name="unique_log_day")
        ]

    @property
    def total_hours(self) -> float:
        return round(
            self.total_off_duty + self.total_sleeper + self.total_driving + self.total_on_duty, 2
        )


class DutyEntry(models.Model):
    """The record the log sheet renders from.

    Entries belong to exactly one LogDay, which is what makes the midnight split
    a persistence concern rather than a rendering hack.
    """

    STATUS_CHOICES = [(item.value, item.value.replace("_", " ").title()) for item in DutyStatus]

    log_day = models.ForeignKey(LogDay, related_name="entries", on_delete=models.CASCADE)
    sequence = models.PositiveSmallIntegerField()
    status = models.CharField(max_length=24, choices=STATUS_CHOICES)
    start_time = models.DateTimeField()
    end_time = models.DateTimeField()
    duration_hours = models.FloatField()
    distance_miles = models.FloatField(default=0.0)
    location_label = models.CharField(max_length=255, blank=True)
    remark = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ("sequence",)
        constraints = [
            models.UniqueConstraint(fields=("log_day", "sequence"), name="unique_duty_sequence")
        ]


class GeocodeCache(models.Model):
    """Nominatim allows roughly 1 request/second.  This cache is a functional
    requirement for autocomplete, not an optimisation."""

    query = models.CharField(max_length=255, unique=True)
    #: The raw Nominatim result list, already trimmed to the fields we use.
    results = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=("query",))]

    def __str__(self) -> str:
        return self.query


class RouteCache(models.Model):
    """Routes keyed by rounded origin/destination pair, valid for 24 hours."""

    key = models.CharField(max_length=128, unique=True)
    payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=("key",))]
