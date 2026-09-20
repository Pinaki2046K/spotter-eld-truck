"""Nominatim autocomplete proxy.

The frontend never calls Nominatim directly: the User-Agent, the 1 req/sec
ceiling and the cache all have to live on one server to be honoured at all.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass

from django.conf import settings

from trips.errors import ApiError, ErrorCode
from trips.models import GeocodeCache
from trips.services.http import get_json

# Nominatim's usage policy is roughly one request per second, per application.
_RATE_LIMIT_SECONDS = 1.0
_rate_lock = threading.Lock()
_last_request_at = 0.0

US_COUNTRY_CODES = {"us"}


@dataclass(frozen=True)
class Place:
    label: str
    lat: float
    lon: float

    def as_dict(self) -> dict:
        return {"label": self.label, "lat": self.lat, "lon": self.lon}


def _throttle() -> None:
    """Block just long enough to stay inside the published rate limit."""
    global _last_request_at
    with _rate_lock:
        wait = _RATE_LIMIT_SECONDS - (time.monotonic() - _last_request_at)
        if wait > 0:
            time.sleep(wait)
        _last_request_at = time.monotonic()


def search(query: str, limit: int = 6) -> list[Place]:
    """Autocomplete suggestions for a partial US address.

    Results are cached indefinitely -- place coordinates do not move.
    """
    normalised = " ".join(query.strip().lower().split())
    if len(normalised) < 3:
        return []

    cached = GeocodeCache.objects.filter(query=normalised).first()
    if cached is not None:
        return [Place(**row) for row in cached.results][:limit]

    _throttle()
    payload = get_json(
        f"{settings.NOMINATIM_BASE_URL}/search",
        params={
            "q": query,
            "format": "jsonv2",
            "addressdetails": 1,
            "countrycodes": "us",
            "limit": max(limit, 6),
        },
        headers={"User-Agent": settings.NOMINATIM_USER_AGENT, "Accept-Language": "en-US"},
    )

    places = [place for place in (_to_place(row) for row in payload) if place is not None]
    GeocodeCache.objects.update_or_create(
        query=normalised, defaults={"results": [place.as_dict() for place in places]}
    )
    return places[:limit]


def _to_place(row: dict) -> Place | None:
    address = row.get("address") or {}
    if address.get("country_code", "us").lower() not in US_COUNTRY_CODES:
        return None
    try:
        return Place(label=_short_label(row, address), lat=float(row["lat"]), lon=float(row["lon"]))
    except (KeyError, TypeError, ValueError):
        return None


#: Nominatim display names run to eight comma-separated parts. A driver wants
#: "Springfield, Illinois", not the county, ZIP and country as well.
_PLACE_KEYS = ("city", "town", "village", "hamlet", "municipality", "suburb", "county")


def _short_label(row: dict, address: dict) -> str:
    name = row.get("name") or next((address[key] for key in _PLACE_KEYS if address.get(key)), None)
    state = address.get("state")
    parts = [part for part in (name, state) if part]
    if not parts:
        return row.get("display_name", "")
    label = ", ".join(parts)
    #: Keep the street line when Nominatim resolved an exact address.
    road = address.get("road")
    if road and name and road != name and address.get("house_number"):
        label = f"{address['house_number']} {road}, {label}"
    return label


def resolve(label: str, field: str) -> Place:
    """Geocode a free-text location, for clients that skipped autocomplete."""
    results = search(label, limit=1)
    if not results:
        raise ApiError(
            ErrorCode.GEOCODE_NOT_FOUND,
            f"We could not find “{label}”. Try a city and state.",
            field=field,
        )
    return results[0]
