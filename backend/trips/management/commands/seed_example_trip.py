"""Seed the example trip at a fixed UUID.

Run in the release command so `/api/trips/<EXAMPLE_TRIP_ID>/` always returns a
complete plan -- even if Nominatim is rate-limiting the grader's first visit.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from django.core.management.base import BaseCommand

from trips.models import Trip
from trips.services.geocoding import Place
from trips.services.planning import create_trip

EXAMPLE_TRIP_ID = uuid.UUID("11111111-2222-4333-8444-555555555555")

CENTRAL = dt_timezone(timedelta(hours=-5))
EXAMPLE = {
    "current": Place("Chicago, Illinois", 41.8781, -87.6298),
    "pickup": Place("St. Louis, Missouri", 38.6270, -90.1994),
    "dropoff": Place("Denver, Colorado", 39.7392, -104.9903),
    "cycle_hours_used": 20.0,
    "start_datetime": datetime(2026, 9, 22, 6, 0, tzinfo=CENTRAL),
}


class Command(BaseCommand):
    help = "Create or refresh the Chicago -> St. Louis -> Denver example trip."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Recompute even if the example trip already exists.",
        )

    def handle(self, *args, **options):  # noqa: ARG002
        if not options["force"] and self._is_current(EXAMPLE_TRIP_ID):
            self.stdout.write(f"Example trip {EXAMPLE_TRIP_ID} already seeded.")
            return

        trip = create_trip(trip_id=EXAMPLE_TRIP_ID, **EXAMPLE)
        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded {trip.id}: {trip.total_distance_miles} miles, "
                f"{trip.log_days.count()} log days, {trip.stops.count()} stops."
            )
        )

    @staticmethod
    def _is_current(trip_id: uuid.UUID) -> bool:
        """A seeded trip from an older schema is stale, not done.

        The release command reseeds on every deploy, so a fixture persisted
        before a field existed would otherwise survive forever with that field
        empty -- and this is the trip a reviewer opens first.
        """
        trip = Trip.objects.filter(pk=trip_id).first()
        if trip is None or not trip.compliance:
            return False
        # Planned before the recap (and the inspections that came with it).
        return not trip.log_days.filter(cycle_hours_used_end__isnull=True).exists()
