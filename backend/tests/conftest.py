"""Shared fixtures for the engine tests.

Everything here is synthetic: the engine never touches the network, so the test
suite does not either.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from hos import Coordinate, RouteLeg, StopType

CENTRAL = timezone(timedelta(hours=-5))


def leg(
    sequence: int,
    from_label: str,
    to_label: str,
    miles: float,
    start: tuple[float, float],
    end: tuple[float, float],
    arrival: StopType | None,
) -> RouteLeg:
    """A two-point leg.  Geometry detail does not affect the schedule, only the
    latitude/longitude the planner reports for inserted stops."""
    return RouteLeg(
        sequence=sequence,
        from_label=from_label,
        to_label=to_label,
        distance_miles=miles,
        geometry=(Coordinate(*start), Coordinate(*end)),
        arrival_stop=arrival,
    )


def two_leg_route(pickup_miles: float, dropoff_miles: float) -> tuple[RouteLeg, ...]:
    return (
        leg(
            1,
            "Origin",
            "Pickup",
            pickup_miles,
            (41.8781, -87.6298),
            (38.6270, -90.1994),
            StopType.PICKUP,
        ),
        leg(
            2,
            "Pickup",
            "Dropoff",
            dropoff_miles,
            (38.6270, -90.1994),
            (39.7392, -104.9903),
            StopType.DROPOFF,
        ),
    )


@pytest.fixture
def start() -> datetime:
    return datetime(2026, 9, 22, 6, 0, tzinfo=CENTRAL)


@pytest.fixture
def short_route() -> tuple[RouteLeg, ...]:
    """Chicago -> Milwaukee -> Madison: comfortably inside one duty day."""
    return (
        leg(
            1,
            "Chicago, IL",
            "Milwaukee, WI",
            92.0,
            (41.8781, -87.6298),
            (43.0389, -87.9065),
            StopType.PICKUP,
        ),
        leg(
            2,
            "Milwaukee, WI",
            "Madison, WI",
            79.0,
            (43.0389, -87.9065),
            (43.0731, -89.4012),
            StopType.DROPOFF,
        ),
    )


@pytest.fixture
def standard_route() -> tuple[RouteLeg, ...]:
    """Chicago -> St. Louis -> Denver."""
    return (
        leg(
            1,
            "Chicago, IL",
            "St. Louis, MO",
            296.4,
            (41.8781, -87.6298),
            (38.6270, -90.1994),
            StopType.PICKUP,
        ),
        leg(
            2,
            "St. Louis, MO",
            "Denver, CO",
            857.0,
            (38.6270, -90.1994),
            (39.7392, -104.9903),
            StopType.DROPOFF,
        ),
    )


@pytest.fixture
def long_haul_route() -> tuple[RouteLeg, ...]:
    """Seattle -> Portland -> Miami: several fuel stops, many log days."""
    return (
        leg(
            1,
            "Seattle, WA",
            "Portland, OR",
            174.0,
            (47.6062, -122.3321),
            (45.5152, -122.6784),
            StopType.PICKUP,
        ),
        leg(
            2,
            "Portland, OR",
            "Miami, FL",
            3270.0,
            (45.5152, -122.6784),
            (25.7617, -80.1918),
            StopType.DROPOFF,
        ),
    )
