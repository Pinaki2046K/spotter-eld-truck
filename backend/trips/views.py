from __future__ import annotations

from urllib.parse import urlparse

from django.conf import settings
from django.db.models import Prefetch
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.generics import RetrieveAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from trips.errors import ApiError, ErrorCode
from trips.models import LogDay, Trip
from trips.serializers import TripCreateSerializer, TripSerializer
from trips.services import geocoding
from trips.services.planning import create_trip


def _trip_queryset():
    return Trip.objects.prefetch_related(
        "legs",
        "stops",
        Prefetch("log_days", queryset=LogDay.objects.prefetch_related("entries")),
    )


class TripCreateView(APIView):
    def post(self, request):
        serializer = TripCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        current, pickup, dropoff = serializer.places()

        trip = create_trip(
            current=current,
            pickup=pickup,
            dropoff=dropoff,
            cycle_hours_used=serializer.validated_data["cycle_hours_used"],
            start_datetime=serializer.resolved_start(),
        )
        trip = _trip_queryset().get(pk=trip.pk)
        return Response(TripSerializer(trip).data, status=status.HTTP_201_CREATED)


class TripDetailView(RetrieveAPIView):
    """Shareable trip URLs: render a persisted plan without recomputing it."""

    serializer_class = TripSerializer
    lookup_field = "id"

    def get_queryset(self):
        return _trip_queryset()


@api_view(["GET"])
def geocode(request):
    query = request.query_params.get("q", "")
    if not query.strip():
        raise ApiError(ErrorCode.INVALID_INPUT, "Provide a search term as ?q=", field="q")
    results = geocoding.search(query)
    return Response({"results": [place.as_dict() for place in results]})


@api_view(["GET"])
def health(request):  # noqa: ARG001
    """Liveness probe, and the answer to "which router is actually live?".

    Routing falls back to OSRM silently by design, so without this the only way
    to know which provider a deployment is using is to create a trip and read
    `routing_provider` off the response. Reports the configured host, never the
    key.
    """
    return Response(
        {
            "status": "ok",
            "routing": {
                "primary": "openrouteservice" if settings.ORS_API_KEY else "osrm",
                "ors_key_configured": bool(settings.ORS_API_KEY),
                "ors_host": urlparse(settings.ORS_BASE_URL).netloc,
                "fallback": "osrm",
            },
        }
    )
