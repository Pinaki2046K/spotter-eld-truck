"""API contract tests.

Upstream calls are stubbed: the suite must pass offline and in CI, and the
point of these tests is the contract, not Nominatim's uptime.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from django.urls import reverse

from hos.types import Coordinate
from trips.services import geocoding, routing
from trips.services.geocoding import Place

CHICAGO = {"label": "Chicago, Illinois", "lat": 41.8781, "lon": -87.6298}
ST_LOUIS = {"label": "St. Louis, Missouri", "lat": 38.6270, "lon": -90.1994}
DENVER = {"label": "Denver, Colorado", "lat": 39.7392, "lon": -104.9903}
LONDON = {"label": "London", "lat": 51.5072, "lon": -0.1276}


@pytest.fixture(autouse=True)
def stub_routing(monkeypatch):
    """Straight-line legs with plausible interstate mileage."""

    def fake_route(origin: Coordinate, destination: Coordinate) -> routing.RoutedLeg:
        miles = {
            (41.8781, 38.6270): 296.4,
            (38.6270, 39.7392): 857.0,
        }.get((round(origin.lat, 4), round(destination.lat, 4)), 250.0)
        return routing.RoutedLeg(
            distance_miles=miles,
            duration_hours=round(miles / 62, 2),
            geometry=(origin, destination),
            provider="stub",
        )

    monkeypatch.setattr(routing, "route", fake_route)
    return fake_route


def post_trip(client, **overrides):
    payload = {
        "current_location": CHICAGO,
        "pickup_location": ST_LOUIS,
        "dropoff_location": DENVER,
        "cycle_hours_used": 20.0,
        "start_datetime": "2026-09-22T06:00:00-05:00",
    }
    payload.update(overrides)
    return client.post(reverse("trip-create"), payload, content_type="application/json")


@pytest.mark.django_db
def test_create_trip_returns_the_full_plan(client):
    response = post_trip(client)
    assert response.status_code == 201, response.json()

    body = response.json()
    assert body["summary"]["total_distance_miles"] == pytest.approx(1153.4, abs=0.1)
    assert body["summary"]["total_days"] >= 2
    assert len(body["route"]["legs"]) == 2
    assert body["stops"][0]["stop_type"] == "START"
    assert body["stops"][-1]["stop_type"] == "DROPOFF"
    assert all(stop["reason"] for stop in body["stops"])

    for day in body["log_days"]:
        assert day["totals"]["total"] == 24.0
        assert day["entries"], "a log day with no entries cannot be drawn"


@pytest.mark.django_db
def test_created_trip_is_retrievable_by_uuid(client):
    created = post_trip(client).json()
    response = client.get(reverse("trip-detail", args=[created["id"]]))

    assert response.status_code == 200
    assert response.json()["summary"] == created["summary"]


@pytest.mark.django_db
def test_unknown_trip_returns_the_error_envelope(client):
    response = client.get(reverse("trip-detail", args=["00000000-0000-4000-8000-000000000000"]))
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


@pytest.mark.django_db
def test_out_of_country_pickup_is_rejected(client):
    response = post_trip(client, pickup_location=LONDON)
    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "OUT_OF_COUNTRY"
    assert error["field"] == "pickup_location"


@pytest.mark.django_db
def test_identical_pickup_and_dropoff_is_rejected(client):
    response = post_trip(client, dropoff_location=ST_LOUIS)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "NO_ROUTE"


@pytest.mark.django_db
@pytest.mark.parametrize("hours", [-1, 70.5, 100])
def test_cycle_hours_outside_the_legal_range_are_rejected(client, hours):
    response = post_trip(client, cycle_hours_used=hours)
    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "INVALID_INPUT"
    assert error["field"] == "cycle_hours_used"


@pytest.mark.django_db
def test_trip_at_the_cycle_limit_plans_rather_than_failing(client):
    response = post_trip(client, cycle_hours_used=70)
    assert response.status_code == 201
    assert response.json()["stops"][1]["stop_type"] == "CYCLE_RESTART"


@pytest.mark.django_db
def test_start_datetime_defaults_to_the_next_0600(client):
    response = post_trip(client, start_datetime=None)
    assert response.status_code == 201
    assert response.json()["summary"]["departure_datetime"].endswith("06:00:00Z")


@pytest.mark.django_db
def test_naive_start_datetime_is_rejected(client):
    response = post_trip(client, start_datetime="2026-09-22T06:00:00")
    assert response.status_code == 400
    assert response.json()["error"]["field"] == "start_datetime"


@pytest.mark.django_db
def test_health_reports_which_router_is_live(client, settings):
    """The fallback is silent by design, so the probe has to name the provider."""
    settings.ORS_API_KEY = "a-real-key"
    settings.ORS_BASE_URL = "https://api.heigit.org/openrouteservice"

    body = client.get(reverse("health")).json()

    assert body["status"] == "ok"
    assert body["routing"] == {
        "primary": "openrouteservice",
        "ors_key_configured": True,
        "ors_host": "api.heigit.org",
        "fallback": "osrm",
    }


@pytest.mark.django_db
def test_health_says_osrm_when_no_key_is_configured(client, settings):
    settings.ORS_API_KEY = ""
    body = client.get(reverse("health")).json()

    assert body["routing"]["primary"] == "osrm"
    assert body["routing"]["ors_key_configured"] is False


@pytest.mark.django_db
def test_health_never_leaks_the_api_key(client, settings):
    settings.ORS_API_KEY = "super-secret-key-value"
    assert "super-secret-key-value" not in client.get(reverse("health")).content.decode()


@pytest.mark.django_db
def test_geocode_proxies_and_caches(client, monkeypatch):
    calls = []

    def fake_search(query, limit=6):
        calls.append(query)
        return [Place("Chicago, Illinois", 41.8781, -87.6298)]

    monkeypatch.setattr(geocoding, "search", fake_search)
    response = client.get(reverse("geocode"), {"q": "chicago"})

    assert response.status_code == 200
    assert response.json()["results"][0]["label"] == "Chicago, Illinois"
    assert calls == ["chicago"]


@pytest.mark.django_db
def test_geocode_requires_a_query(client):
    response = client.get(reverse("geocode"))
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_INPUT"


@pytest.mark.django_db
def test_geocode_results_are_cached_after_the_first_lookup(client, monkeypatch):
    payload = [
        {
            "name": "Chicago",
            "lat": "41.8781",
            "lon": "-87.6298",
            "address": {"city": "Chicago", "state": "Illinois", "country_code": "us"},
        }
    ]
    calls = []

    def fake_get_json(url, params=None, headers=None):
        calls.append(url)
        return payload

    monkeypatch.setattr(geocoding, "get_json", fake_get_json)
    monkeypatch.setattr(geocoding, "_throttle", lambda: None)

    first = geocoding.search("Chicago")
    second = geocoding.search("  chicago  ")

    assert len(calls) == 1, "second lookup should have been served from GeocodeCache"
    assert first == second
    assert first[0].label == "Chicago, Illinois"


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("offset", "expected_minutes"),
    [("-05:00", -300), ("+05:30", 330), ("-08:00", -480), ("Z", 0)],
    ids=["chicago", "india", "pacific", "utc"],
)
def test_the_submitted_offset_survives_to_the_log_sheets(client, offset, expected_minutes):
    """DRF normalises aware datetimes to UTC, which would silently redraw every
    sheet in the wrong timezone and split the days at the wrong midnight."""
    suffix = "Z" if offset == "Z" else offset
    response = post_trip(client, start_datetime=f"2026-09-22T06:00:00{suffix}")

    assert response.status_code == 201, response.json()
    body = response.json()
    assert body["inputs"]["home_timezone_offset_minutes"] == expected_minutes

    # Day one opens at local midnight, whatever that is in UTC.
    first_entry = body["log_days"][0]["entries"][0]["start_time"]
    opened = datetime.fromisoformat(first_entry.replace("Z", "+00:00"))
    local_open = opened + timedelta(minutes=expected_minutes)
    assert (local_open.hour, local_open.minute) == (0, 0)


@pytest.mark.django_db
def test_a_departure_is_drawn_at_the_hour_it_was_booked(client):
    """06:00 in the home terminal must read as 06:00 on the sheet, not as the
    UTC instant it happens to correspond to."""
    response = post_trip(client, start_datetime="2026-09-22T06:00:00+05:30")
    body = response.json()

    offset = body["inputs"]["home_timezone_offset_minutes"]
    start = datetime.fromisoformat(body["summary"]["departure_datetime"].replace("Z", "+00:00"))
    local = start + timedelta(minutes=offset)

    assert (local.hour, local.minute) == (6, 0)


@pytest.mark.django_db
def test_the_nominatim_throttle_waits_on_a_request_made_by_another_worker(monkeypatch):
    """The timestamp is read from the shared row, not process memory, so a
    request another Gunicorn worker made a moment ago still forces a wait."""
    from django.utils import timezone

    from trips.models import NominatimThrottle

    NominatimThrottle.objects.create(pk=1, last_request_at=timezone.now())
    sleeps: list[float] = []
    monkeypatch.setattr(geocoding.time, "sleep", sleeps.append)

    geocoding._throttle()

    assert len(sleeps) == 1
    assert 0.9 < sleeps[0] <= 1.0


@pytest.mark.django_db
def test_the_nominatim_throttle_does_not_wait_once_a_second_has_passed(monkeypatch):
    from django.utils import timezone

    from trips.models import NominatimThrottle

    stale = timezone.now() - timedelta(seconds=2)
    NominatimThrottle.objects.create(pk=1, last_request_at=stale)
    sleeps: list[float] = []
    monkeypatch.setattr(geocoding.time, "sleep", sleeps.append)

    geocoding._throttle()

    assert sleeps == []
    assert NominatimThrottle.objects.get(pk=1).last_request_at > stale
