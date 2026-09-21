"""Shared upstream HTTP behaviour: one timeout, one retry, typed failures."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable

import requests
from django.conf import settings

from trips.errors import ApiError, ErrorCode

logger = logging.getLogger(__name__)

RETRY_BACKOFF_SECONDS = 0.4


def get_json(
    url: str,
    *,
    params: dict | None = None,
    headers: dict | None = None,
    before_attempt: Callable[[], None] | None = None,
) -> dict | list:
    """GET with an 8-second ceiling and a single backed-off retry.

    A timeout surfaces as UPSTREAM_TIMEOUT rather than a stack trace, which is
    what lets the frontend say something specific instead of "failed".

    `before_attempt` runs before every attempt, the retry included, so a
    rate-limited upstream can throttle each request rather than only the first.
    """
    timeout = settings.UPSTREAM_TIMEOUT_SECONDS
    last_error: Exception | None = None

    for attempt in (1, 2):
        if before_attempt is not None:
            before_attempt()
        try:
            response = requests.get(url, params=params, headers=headers, timeout=timeout)
        except requests.Timeout as exc:
            last_error = exc
        except requests.RequestException as exc:
            last_error = exc
        else:
            if response.status_code < 500:
                response.raise_for_status()
                return response.json()
            # Attach the response: the status and body are what make a
            # fallback diagnosable rather than just "something failed".
            last_error = requests.HTTPError(f"{response.status_code} from {url}", response=response)

        logger.warning("Upstream call to %s failed (attempt %s): %s", url, attempt, last_error)
        if attempt == 1:
            time.sleep(RETRY_BACKOFF_SECONDS)

    raise ApiError(
        ErrorCode.UPSTREAM_TIMEOUT,
        "A mapping service did not respond in time. Please try again.",
        http_status=503,
    ) from last_error
