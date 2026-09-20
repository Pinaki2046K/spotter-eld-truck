"""Offline nearest-place lookup for stop labels.

Reverse-geocoding every inserted stop through Nominatim would cost one network
round trip per stop against a 1 req/sec limit -- easily blowing the 10-second
budget for POST /api/trips/.  Instead a gzipped gazetteer of ~30k US
incorporated places ships with the engine and the nearest one is chosen.

This keeps the planner deterministic and offline, which is also what lets the
whole engine be unit-tested without mocking the network.
"""

from __future__ import annotations

import bisect
import csv
import gzip
import threading
from math import cos, radians
from pathlib import Path

DATA_FILE = Path(__file__).with_name("data") / "us_cities.csv.gz"

_lock = threading.Lock()
_lons: list[float] = []
_lats: list[float] = []
_names: list[str] = []


def _load() -> None:
    """Load the gazetteer once, lazily.  Rows are pre-sorted by longitude."""
    global _lons, _lats, _names
    if _names:
        return
    with _lock:
        if _names:
            return
        lons: list[float] = []
        lats: list[float] = []
        names: list[str] = []
        with gzip.open(DATA_FILE, "rt", encoding="utf-8", newline="") as handle:
            for row in csv.DictReader(handle):
                lons.append(float(row["lon"]))
                lats.append(float(row["lat"]))
                names.append(f"{row['city']}, {row['state']}")
        _lons, _lats, _names = lons, lats, names


def nearest_place(lat: float, lon: float) -> str:
    """The nearest known US place to a coordinate, as "City, ST".

    Falls back to a formatted coordinate if the point is far from anywhere in
    the gazetteer (offshore, or outside the US).
    """
    _load()
    if not _names:
        return _format_coordinate(lat, lon)

    # Longitude degrees shrink with latitude; widen the scan window to compensate.
    scale = max(0.2, cos(radians(lat)))
    for window in (1.0, 3.0, 8.0, 30.0):
        span = window / scale
        low = bisect.bisect_left(_lons, lon - span)
        high = bisect.bisect_right(_lons, lon + span)
        best_index, best_score = -1, float("inf")
        for index in range(low, high):
            dlat = _lats[index] - lat
            dlon = (_lons[index] - lon) * scale
            score = dlat * dlat + dlon * dlon
            if score < best_score:
                best_index, best_score = index, score
        # ~1 degree of latitude is 69 miles; reject absurdly distant matches.
        if best_index >= 0 and best_score**0.5 <= window:
            return _names[best_index]
    return _format_coordinate(lat, lon)


def _format_coordinate(lat: float, lon: float) -> str:
    return f"{abs(lat):.2f}°{'N' if lat >= 0 else 'S'} {abs(lon):.2f}°{'E' if lon >= 0 else 'W'}"
