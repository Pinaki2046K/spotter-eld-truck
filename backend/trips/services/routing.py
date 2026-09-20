"""Routing: OSRM, with OpenRouteService as an optional alternative.

OSRM's public demo server needs no key and no account, and it is what this
project actually routes with -- locally and in the deployment. That is what
lets a clone run with nothing to sign up for.

OpenRouteService is kept behind ORS_API_KEY and is currently unused. Setting
that key promotes it to primary, with OSRM still catching any failure, so two
independent providers sit behind one interface if a commercial SLA is ever
wanted. Unset -- the default -- and OSRM serves every route.

The fallback is quiet by design, and quiet failure is its own hazard: every
fall-through logs at WARNING with the upstream status and body, /api/health/
reports which provider is live, and each trip records the provider that
actually served it.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from hos.types import Coordinate
from trips.errors import ApiError, ErrorCode
from trips.models import RouteCache
from trips.services.http import get_json

logger = logging.getLogger(__name__)

METRES_PER_MILE = 1609.344
CACHE_TTL = timedelta(hours=24)
#: Full geometries run to thousands of points; this is plenty for a map line.
MAX_GEOMETRY_POINTS = 400


@dataclass(frozen=True)
class RoutedLeg:
    distance_miles: float
    duration_hours: float
    geometry: tuple[Coordinate, ...]
    provider: str


def route(origin: Coordinate, destination: Coordinate) -> RoutedLeg:
    key = _cache_key(origin, destination)
    cached = RouteCache.objects.filter(key=key, created_at__gte=timezone.now() - CACHE_TTL).first()
    if cached is not None:
        return _from_payload(cached.payload)

    leg = _route_uncached(origin, destination)
    RouteCache.objects.update_or_create(key=key, defaults={"payload": _to_payload(leg)})
    return leg


def describe_upstream_failure(exc: BaseException) -> str:
    """A one-line reason carrying the status and body where there is one.

    get_json raises `ApiError(...) from last_error`, so the HTTPError holding
    the response is the cause rather than the exception itself.
    """
    cause: BaseException | None = exc
    seen: set[int] = set()
    while cause is not None and id(cause) not in seen:
        seen.add(id(cause))
        response = getattr(cause, "response", None)
        if response is not None:
            body = " ".join(response.text.split())[:200]
            return f"HTTP {response.status_code}: {body}"
        cause = cause.__cause__
    return f"{type(exc).__name__}: {exc}"


def _route_uncached(origin: Coordinate, destination: Coordinate) -> RoutedLeg:
    if not settings.ORS_API_KEY:
        logger.info("ORS_API_KEY is not set; routing via OSRM.")
        return _route_via_osrm(origin, destination)

    try:
        return _route_via_ors(origin, destination)
    except Exception as exc:
        # Everything falls through, including the ApiError that get_json raises
        # for a 5xx or a timeout. Re-raising those defeated the fallback in
        # precisely the case it exists for. A NO_ROUTE from ORS falls through
        # too: OSRM gets a chance, and if it also finds nothing the user still
        # gets NO_ROUTE, just from the second provider.
        logger.warning(
            "OpenRouteService failed, falling back to OSRM. Reason: %s",
            describe_upstream_failure(exc),
        )

    return _route_via_osrm(origin, destination)


def _route_via_ors(origin: Coordinate, destination: Coordinate) -> RoutedLeg:
    payload = get_json(
        f"{settings.ORS_BASE_URL}/v2/directions/driving-hgv/geojson",
        params={
            "api_key": settings.ORS_API_KEY,
            "start": f"{origin.lon},{origin.lat}",
            "end": f"{destination.lon},{destination.lat}",
        },
        headers={"Accept": "application/geo+json"},
    )
    features = payload.get("features") or []
    if not features:
        raise ApiError(ErrorCode.NO_ROUTE, "No drivable route between those points.")

    feature = features[0]
    summary = feature["properties"]["summary"]
    coordinates = feature["geometry"]["coordinates"]  # GeoJSON is [lon, lat]
    return RoutedLeg(
        distance_miles=round(summary["distance"] / METRES_PER_MILE, 1),
        duration_hours=round(summary["duration"] / 3600, 2),
        geometry=_simplify(tuple(Coordinate(lat, lon) for lon, lat in coordinates)),
        provider="openrouteservice",
    )


def _route_via_osrm(origin: Coordinate, destination: Coordinate) -> RoutedLeg:
    payload = get_json(
        f"{settings.OSRM_BASE_URL}/route/v1/driving/"
        f"{origin.lon},{origin.lat};{destination.lon},{destination.lat}",
        params={"overview": "full", "geometries": "geojson"},
    )
    if payload.get("code") != "Ok" or not payload.get("routes"):
        raise ApiError(ErrorCode.NO_ROUTE, "No drivable route between those points.")

    best = payload["routes"][0]
    coordinates = best["geometry"]["coordinates"]
    return RoutedLeg(
        distance_miles=round(best["distance"] / METRES_PER_MILE, 1),
        duration_hours=round(best["duration"] / 3600, 2),
        geometry=_simplify(tuple(Coordinate(lat, lon) for lon, lat in coordinates)),
        provider="osrm",
    )


def _simplify(points: tuple[Coordinate, ...]) -> tuple[Coordinate, ...]:
    """Evenly thin the geometry, always keeping both endpoints."""
    if len(points) <= MAX_GEOMETRY_POINTS:
        return points
    step = len(points) / (MAX_GEOMETRY_POINTS - 1)
    thinned = [points[int(index * step)] for index in range(MAX_GEOMETRY_POINTS - 1)]
    thinned.append(points[-1])
    return tuple(thinned)


def _cache_key(origin: Coordinate, destination: Coordinate) -> str:
    #: Round to ~100 m so near-identical requests share a cache entry.
    raw = json.dumps(
        [
            round(origin.lat, 3),
            round(origin.lon, 3),
            round(destination.lat, 3),
            round(destination.lon, 3),
        ]
    )
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def _to_payload(leg: RoutedLeg) -> dict:
    return {
        "distance_miles": leg.distance_miles,
        "duration_hours": leg.duration_hours,
        "geometry": [[point.lat, point.lon] for point in leg.geometry],
        "provider": leg.provider,
    }


def _from_payload(payload: dict) -> RoutedLeg:
    return RoutedLeg(
        distance_miles=payload["distance_miles"],
        duration_hours=payload["duration_hours"],
        geometry=tuple(Coordinate(lat, lon) for lat, lon in payload["geometry"]),
        provider=payload["provider"],
    )
