"""Pure-Python Hours of Service planning engine.

No Django imports, no network, no wall-clock reads: given the same legs, cycle
hours and start time this package returns byte-identical output every run.
"""

from .config import DEFAULT_CONFIG, HOSConfig
from .service import plan_trip
from .types import (
    LOG_ROW_ORDER,
    Coordinate,
    DutyEntry,
    DutyStatus,
    Event,
    HOSPlanningError,
    LogDay,
    Plan,
    RouteLeg,
    Stop,
    StopType,
    TripSummary,
)

__all__ = [
    "DEFAULT_CONFIG",
    "LOG_ROW_ORDER",
    "Coordinate",
    "DutyEntry",
    "DutyStatus",
    "Event",
    "HOSConfig",
    "HOSPlanningError",
    "LogDay",
    "Plan",
    "RouteLeg",
    "Stop",
    "StopType",
    "TripSummary",
    "plan_trip",
]
