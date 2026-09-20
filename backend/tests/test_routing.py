"""Routing client tests.

The failure mode this guards against is quiet: if the OpenRouteService URL is
wrong, the client swallows the error and falls back to OSRM, so routing keeps
working and nobody notices the primary provider is dead.
"""

from __future__ import annotations

import pytest
import requests
from django.test import override_settings

from hos.types import Coordinate
from trips.errors import ApiError
from trips.services import routing

CHICAGO = Coordinate(41.8781, -87.6298)
ST_LOUIS = Coordinate(38.6270, -90.1994)

ORS_RESPONSE = {
    "features": [
        {
            "properties": {"summary": {"distance": 477_000.0, "duration": 17_000.0}},
            "geometry": {"coordinates": [[-87.6298, 41.8781], [-90.1994, 38.6270]]},
        }
    ]
}

OSRM_RESPONSE = {
    "code": "Ok",
    "routes": [
        {
            "distance": 477_000.0,
            "duration": 17_000.0,
            "geometry": {"coordinates": [[-87.6298, 41.8781], [-90.1994, 38.6270]]},
        }
    ],
}


@pytest.fixture
def calls(monkeypatch):
    """Record every upstream URL, and serve whatever the test queued up."""
    recorded: list[str] = []
    responses: dict[str, object] = {}

    def fake_get_json(url, params=None, headers=None):
        recorded.append(url)
        for fragment, response in responses.items():
            if fragment in url:
                if isinstance(response, Exception):
                    raise response
                return response
        raise AssertionError(f"unexpected upstream call to {url}")

    monkeypatch.setattr(routing, "get_json", fake_get_json)
    return recorded, responses


@pytest.mark.django_db
@override_settings(ORS_API_KEY="test-key")
def test_ors_url_carries_the_openrouteservice_prefix(calls):
    """api.heigit.org needs /openrouteservice; a bare host 404s."""
    recorded, responses = calls
    responses["heigit"] = ORS_RESPONSE

    leg = routing.route(CHICAGO, ST_LOUIS)

    assert leg.provider == "openrouteservice"
    assert recorded == ["https://api.heigit.org/openrouteservice/v2/directions/driving-hgv/geojson"]


@pytest.mark.django_db
@override_settings(ORS_API_KEY="test-key")
def test_metres_become_miles_and_coordinates_are_reordered(calls):
    _, responses = calls
    responses["heigit"] = ORS_RESPONSE

    leg = routing.route(CHICAGO, ST_LOUIS)

    assert leg.distance_miles == pytest.approx(296.4, abs=0.1)
    # GeoJSON is [lon, lat]; Leaflet and the engine both want [lat, lon].
    assert leg.geometry[0] == Coordinate(41.8781, -87.6298)


@pytest.mark.django_db
@override_settings(ORS_API_KEY="test-key")
def test_an_unhealthy_ors_falls_back_to_osrm(calls):
    recorded, responses = calls
    responses["heigit"] = requests.HTTPError("503 from ORS")
    responses["osrm"] = OSRM_RESPONSE
    responses["project-osrm"] = OSRM_RESPONSE

    leg = routing.route(CHICAGO, ST_LOUIS)

    assert leg.provider == "osrm"
    assert len(recorded) == 2, "expected one ORS attempt then one OSRM attempt"


@pytest.mark.django_db
@override_settings(ORS_API_KEY="")
def test_without_a_key_osrm_is_used_directly(calls):
    recorded, responses = calls
    responses["project-osrm"] = OSRM_RESPONSE

    leg = routing.route(CHICAGO, ST_LOUIS)

    assert leg.provider == "osrm"
    assert "heigit" not in " ".join(recorded)


@pytest.mark.django_db
@override_settings(ORS_API_KEY="")
def test_osrm_reporting_no_route_is_a_typed_error(calls):
    _, responses = calls
    responses["project-osrm"] = {"code": "NoRoute", "routes": []}

    with pytest.raises(ApiError) as caught:
        routing.route(CHICAGO, ST_LOUIS)
    assert caught.value.code == "NO_ROUTE"


@pytest.mark.django_db
@override_settings(ORS_API_KEY="")
def test_a_second_identical_route_is_served_from_cache(calls):
    recorded, responses = calls
    responses["project-osrm"] = OSRM_RESPONSE

    first = routing.route(CHICAGO, ST_LOUIS)
    second = routing.route(CHICAGO, ST_LOUIS)

    assert len(recorded) == 1, "the 24-hour route cache should have served the second call"
    assert first == second
