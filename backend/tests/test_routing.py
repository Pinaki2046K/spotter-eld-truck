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


@pytest.mark.django_db
@override_settings(ORS_API_KEY="test-key")
def test_an_ors_5xx_falls_back_rather_than_failing_the_request(calls):
    """The fallback exists for exactly this case: ORS down, OSRM healthy."""
    _, responses = calls
    from trips.errors import ErrorCode

    responses["heigit"] = ApiError(ErrorCode.UPSTREAM_TIMEOUT, "ORS is down", http_status=503)
    responses["project-osrm"] = OSRM_RESPONSE

    leg = routing.route(CHICAGO, ST_LOUIS)

    assert leg.provider == "osrm"


def _http_error(status: int, body: str) -> requests.HTTPError:
    """An HTTPError shaped like the one requests raises, response attached."""
    response = requests.Response()
    response.status_code = status
    response._content = body.encode()
    response.url = "https://api.heigit.org/openrouteservice/v2/directions/driving-hgv/geojson"
    return requests.HTTPError(f"{status} Client Error", response=response)


# The bodies ORS actually returns, captured from api.heigit.org.
REJECTED_KEY = _http_error(403, '{"error": "Access to this API has been disallowed"}')
MISSING_KEY = _http_error(401, '{"error": "Authorization field missing"}')


@pytest.mark.django_db
@override_settings(ORS_API_KEY="rejected-key")
@pytest.mark.parametrize("failure", [REJECTED_KEY, MISSING_KEY], ids=["403", "401"])
def test_a_rejected_key_falls_through_to_osrm_cleanly(calls, failure):
    recorded, responses = calls
    responses["heigit"] = failure
    responses["project-osrm"] = OSRM_RESPONSE

    leg = routing.route(CHICAGO, ST_LOUIS)

    assert leg.provider == "osrm"
    assert leg.distance_miles == pytest.approx(296.4, abs=0.1)
    assert len(recorded) == 2


@pytest.mark.django_db
@override_settings(ORS_API_KEY="rejected-key")
def test_the_fallback_logs_the_status_and_body_at_warning(calls, caplog):
    """A silent fallback is the failure mode: the log has to say why."""
    _, responses = calls
    responses["heigit"] = REJECTED_KEY
    responses["project-osrm"] = OSRM_RESPONSE

    with caplog.at_level("WARNING", logger="trips.services.routing"):
        routing.route(CHICAGO, ST_LOUIS)

    assert len(caplog.records) == 1
    message = caplog.records[0].getMessage()
    assert "falling back to OSRM" in message
    assert "HTTP 403" in message
    assert "Access to this API has been disallowed" in message


@pytest.mark.django_db
@override_settings(ORS_API_KEY="")
def test_no_key_configured_is_not_logged_as_a_failure(calls, caplog):
    _, responses = calls
    responses["project-osrm"] = OSRM_RESPONSE

    with caplog.at_level("WARNING", logger="trips.services.routing"):
        routing.route(CHICAGO, ST_LOUIS)

    assert caplog.records == [], "an unset key is configuration, not a failure"


def test_describe_upstream_failure_unwraps_the_cause_chain():
    """get_json re-raises as ApiError, so the response is on the cause."""
    try:
        try:
            raise REJECTED_KEY
        except requests.HTTPError as cause:
            raise ApiError("UPSTREAM_TIMEOUT", "wrapped") from cause
    except ApiError as wrapped:
        assert "HTTP 403" in routing.describe_upstream_failure(wrapped)


def test_describe_upstream_failure_handles_an_exception_with_no_response():
    reason = routing.describe_upstream_failure(requests.ConnectionError("DNS failure"))
    assert reason == "ConnectionError: DNS failure"
