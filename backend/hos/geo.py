"""Great-circle helpers and polyline interpolation.

Used to turn "the driver has covered 412.8 miles of this leg" into a latitude
and longitude on the route line, so every inserted stop lands on the road
rather than on a straight line between endpoints.
"""

from __future__ import annotations

import bisect
from math import asin, cos, radians, sin, sqrt

from .types import Coordinate

EARTH_RADIUS_MILES = 3958.7613


def haversine_miles(a: Coordinate, b: Coordinate) -> float:
    lat1, lon1, lat2, lon2 = map(radians, (a.lat, a.lon, b.lat, b.lon))
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_MILES * asin(sqrt(min(1.0, h)))


class PolylineIndex:
    """Cumulative-distance index over a route geometry.

    The API's reported leg distance is authoritative, so the raw vertex
    distances are rescaled to sum to it.  `at_miles` is then exact at both ends.
    """

    def __init__(self, geometry: tuple[Coordinate, ...], total_miles: float) -> None:
        if not geometry:
            raise ValueError("geometry must contain at least one point")
        self.points = tuple(geometry)
        self.total_miles = float(total_miles)

        cumulative = [0.0]
        for previous, current in zip(self.points, self.points[1:], strict=False):
            cumulative.append(cumulative[-1] + haversine_miles(previous, current))

        raw_total = cumulative[-1]
        if raw_total > 0 and self.total_miles > 0:
            scale = self.total_miles / raw_total
            cumulative = [d * scale for d in cumulative]
        self.cumulative = cumulative

    def at_miles(self, miles: float) -> Coordinate:
        """The coordinate `miles` along this leg, clamped to the endpoints."""
        if len(self.points) == 1:
            return self.points[0]
        miles = max(0.0, min(miles, self.cumulative[-1]))

        index = bisect.bisect_left(self.cumulative, miles)
        if index <= 0:
            return self.points[0]
        if index >= len(self.points):
            return self.points[-1]

        start_distance = self.cumulative[index - 1]
        span = self.cumulative[index] - start_distance
        fraction = 0.0 if span <= 0 else (miles - start_distance) / span
        start, end = self.points[index - 1], self.points[index]
        return Coordinate(
            lat=start.lat + (end.lat - start.lat) * fraction,
            lon=start.lon + (end.lon - start.lon) * fraction,
        )


def bounding_box(points: list[Coordinate]) -> tuple[float, float, float, float]:
    """(min_lat, min_lon, max_lat, max_lon) -- used by the map's fit-bounds."""
    lats = [p.lat for p in points]
    lons = [p.lon for p in points]
    return (min(lats), min(lons), max(lats), max(lons))
