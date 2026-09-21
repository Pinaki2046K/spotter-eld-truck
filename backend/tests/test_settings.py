"""Production-safety defaults in config/settings.py.

Each case imports the real settings module in a fresh interpreter, because
settings are read once at import and the test process has already loaded its
own (config.settings_test).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent

_DUMP = (
    "import json, config.settings as s; print(json.dumps({"
    "'DEBUG': s.DEBUG, 'ALLOWED_HOSTS': s.ALLOWED_HOSTS,"
    "'CORS_ALLOW_ALL_ORIGINS': s.CORS_ALLOW_ALL_ORIGINS,"
    "'CORS_ALLOWED_ORIGINS': s.CORS_ALLOWED_ORIGINS,"
    "'CORS_ALLOWED_ORIGIN_REGEXES': getattr(s, 'CORS_ALLOWED_ORIGIN_REGEXES', [])}))"
)

_CONTROLLED = (
    "SECRET_KEY",
    "DEBUG",
    "ALLOWED_HOSTS",
    "CORS_ALLOWED_ORIGINS",
    "RENDER",
    "RENDER_EXTERNAL_HOSTNAME",
    "RAILWAY_PUBLIC_DOMAIN",
    "FLY_APP_NAME",
)


def _import_settings(**env: str) -> subprocess.CompletedProcess:
    clean = {key: value for key, value in os.environ.items() if key not in _CONTROLLED}
    return subprocess.run(
        [sys.executable, "-c", _DUMP],
        cwd=BACKEND,
        env={**clean, **env},
        capture_output=True,
        text=True,
        timeout=60,
    )


def _settings(**env: str) -> dict:
    result = _import_settings(**env)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_a_missing_secret_key_stops_the_process():
    result = _import_settings(DEBUG="True")

    assert result.returncode != 0
    assert "ImproperlyConfigured" in result.stderr
    assert "SECRET_KEY is not set" in result.stderr


def test_debug_is_off_unless_asked_for():
    loaded = _settings(SECRET_KEY="x")

    assert loaded["DEBUG"] is False
    assert loaded["ALLOWED_HOSTS"] == []
    assert loaded["CORS_ALLOW_ALL_ORIGINS"] is False


def test_cors_admits_only_the_configured_origin():
    origin = "https://spotter-eld-planner-phi.vercel.app"
    loaded = _settings(SECRET_KEY="x", CORS_ALLOWED_ORIGINS=origin)

    assert loaded["CORS_ALLOWED_ORIGINS"] == [origin]
    assert loaded["CORS_ALLOWED_ORIGIN_REGEXES"] == []
    assert loaded["CORS_ALLOW_ALL_ORIGINS"] is False
