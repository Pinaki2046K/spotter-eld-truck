"""One error shape for the whole API.

Every 4xx and 5xx is `{"error": {"code": ..., "message": ..., "field": ...}}`
so the frontend can map a code to a specific inline message instead of showing
a generic failure toast.
"""

from __future__ import annotations

import logging

from django.http import JsonResponse
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

logger = logging.getLogger(__name__)


class ErrorCode:
    GEOCODE_NOT_FOUND = "GEOCODE_NOT_FOUND"
    OUT_OF_COUNTRY = "OUT_OF_COUNTRY"
    NO_ROUTE = "NO_ROUTE"
    INVALID_CYCLE_HOURS = "INVALID_CYCLE_HOURS"
    UPSTREAM_TIMEOUT = "UPSTREAM_TIMEOUT"
    CYCLE_EXHAUSTED = "CYCLE_EXHAUSTED"
    INVALID_INPUT = "INVALID_INPUT"
    NOT_FOUND = "NOT_FOUND"
    INTERNAL = "INTERNAL"


class ApiError(Exception):
    """A failure the user can act on, carrying the code the frontend switches on."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        field: str | None = None,
        http_status: int = status.HTTP_400_BAD_REQUEST,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.field = field
        self.http_status = http_status

    def as_payload(self) -> dict:
        return error_payload(self.code, self.message, self.field)


def error_payload(code: str, message: str, field: str | None = None) -> dict:
    return {"error": {"code": code, "message": message, "field": field}}


def api_exception_handler(exc, context):
    """DRF hook: funnel everything through the single envelope."""
    if isinstance(exc, ApiError):
        return Response(exc.as_payload(), status=exc.http_status)

    response = drf_exception_handler(exc, context)
    if response is None:
        logger.exception("Unhandled error in %s", context.get("view"))
        return Response(
            error_payload(ErrorCode.INTERNAL, "Something went wrong on our side."),
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    if response.status_code == status.HTTP_404_NOT_FOUND:
        return Response(
            error_payload(ErrorCode.NOT_FOUND, "That trip does not exist."),
            status=response.status_code,
        )

    detail = response.data
    message, field = _flatten_validation_detail(detail)
    response.data = error_payload(ErrorCode.INVALID_INPUT, message, field)
    return response


def _flatten_validation_detail(detail) -> tuple[str, str | None]:
    """Turn DRF's nested validation dict into one message and one field name."""
    if isinstance(detail, dict):
        for key, value in detail.items():
            message, nested_field = _flatten_validation_detail(value)
            if key == "detail":
                return message, None
            return message, nested_field or str(key)
    if isinstance(detail, list) and detail:
        return _flatten_validation_detail(detail[0])
    return str(detail), None


def handler404(request, exception=None):  # noqa: ARG001
    return JsonResponse(error_payload(ErrorCode.NOT_FOUND, "No such endpoint."), status=404)


def handler500(request):  # noqa: ARG001
    return JsonResponse(
        error_payload(ErrorCode.INTERNAL, "Something went wrong on our side."), status=500
    )
