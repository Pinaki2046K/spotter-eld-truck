"""Settings for the test suite: production settings plus a throwaway key.

The real settings refuse to start without SECRET_KEY. The fallback lives here,
in a module production never imports, rather than in config/settings.py.
"""

import os

os.environ.setdefault("SECRET_KEY", "test-only-not-a-secret")

from config.settings import *  # noqa: F403
