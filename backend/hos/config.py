"""Constants for the HOS planner.

Every value here is an assumption fixed by the brief (or explicitly documented in
the README as one of ours).  Nothing in this module reads configuration from the
environment: the engine must be deterministic.
"""

from __future__ import annotations

from dataclasses import dataclass


def _minutes(hours: float) -> int:
    return round(hours * 60)


@dataclass(frozen=True)
class HOSConfig:
    """Property-carrying driver, 70 hours / 8 days, no adverse-conditions extension."""

    # --- fixed by the brief -------------------------------------------------
    CYCLE_HOURS: float = 70.0
    CYCLE_DAYS: int = 8
    FUEL_INTERVAL_MILES: float = 1000.0
    PICKUP_HOURS: float = 1.0
    DROPOFF_HOURS: float = 1.0

    # --- fixed by 49 CFR 395.3 ---------------------------------------------
    DRIVING_LIMIT_HOURS: float = 11.0
    DRIVING_WINDOW_HOURS: float = 14.0
    BREAK_REQUIRED_AFTER_HOURS: float = 8.0
    BREAK_DURATION_HOURS: float = 0.5
    DAILY_RESET_HOURS: float = 10.0
    CYCLE_RESTART_HOURS: float = 34.0

    # --- our own assumptions, stated in the README --------------------------
    AVERAGE_SPEED_MPH: float = 55.0
    FUEL_STOP_HOURS: float = 0.5
    #: Pre-trip and post-trip vehicle inspection (49 CFR 396.13 / 396.11), on
    #: duty not driving at the start and end of every shift. FMCSA's guide shows
    #: both on its completed example log; 15 minutes is the customary figure.
    INSPECTION_HOURS: float = 0.25

    # The planner works in whole minutes so that log-day totals are exact.
    @property
    def driving_limit_min(self) -> int:
        return _minutes(self.DRIVING_LIMIT_HOURS)

    @property
    def window_min(self) -> int:
        return _minutes(self.DRIVING_WINDOW_HOURS)

    @property
    def break_after_min(self) -> int:
        return _minutes(self.BREAK_REQUIRED_AFTER_HOURS)

    @property
    def break_min(self) -> int:
        return _minutes(self.BREAK_DURATION_HOURS)

    @property
    def daily_reset_min(self) -> int:
        return _minutes(self.DAILY_RESET_HOURS)

    @property
    def cycle_restart_min(self) -> int:
        return _minutes(self.CYCLE_RESTART_HOURS)

    @property
    def cycle_limit_min(self) -> int:
        return _minutes(self.CYCLE_HOURS)

    @property
    def pickup_min(self) -> int:
        return _minutes(self.PICKUP_HOURS)

    @property
    def dropoff_min(self) -> int:
        return _minutes(self.DROPOFF_HOURS)

    @property
    def fuel_stop_min(self) -> int:
        return _minutes(self.FUEL_STOP_HOURS)

    @property
    def inspection_min(self) -> int:
        return _minutes(self.INSPECTION_HOURS)


DEFAULT_CONFIG = HOSConfig()

#: A segment shorter than this is a rounding sliver, not a real driving stint.
MIN_SEGMENT_MIN = 1
