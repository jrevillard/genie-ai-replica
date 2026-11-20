# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The language registry: the single source of the supported languages.

The registry data is vendored at ``preparation/language-registry.json`` — a
byte-identical copy of the backend's
``components/gov-chat-backend/services/translation/language-maps/language-registry.json``
(the agent-service build context is the component directory, so a COPY from
the backend tree is impossible). A test pins the byte parity of the copy.
``LANGUAGE_REGISTRY_FILEPATH`` overrides the path for deployments that ship
their own registry, exactly as deployed.

Reader behavior is ported from the deployed module
(``genieai_chatqna.py:1241-1303``): the file is read once and cached; a
registry that could not be read is remembered only for the retry window
(60 s) — a transient read failure must not disable translation for the
lifetime of the process, but it must not re-read (and re-log) the file on
every request either. An unreadable registry fills both maps as EMPTY — an
empty map means every language is unknown, never None.
"""

import json
import logging
import time

from .config import REGISTRY_RETRY_SECONDS

logger = logging.getLogger(__name__)


def _read_registry(filepath: str) -> dict:
    """Read the languages of the registry from disk. An unreadable registry
    reads as empty.

    The registry is a whitelist of language codes, so a file that holds
    something else is not a registry: a file whose entries do not each carry
    a non-empty name and a non-empty script is treated as unreadable. An
    empty registry is unreadable too: it refuses every language without
    saying why. (The ``modelCodes`` half of the file belongs to the backend's
    per-model code maps and is not read here.)
    """
    try:
        with open(filepath, encoding="utf-8") as file:
            loaded = json.load(file)
    except Exception as e:
        logger.error(f"Error loading the language registry from {filepath}: {e}")
        return {}
    languages = loaded.get("languages") if isinstance(loaded, dict) else None
    if not isinstance(languages, dict) or not all(
        isinstance(code, str)
        and isinstance(entry, dict)
        and isinstance(entry.get("name"), str)
        and entry["name"]
        and isinstance(entry.get("script"), str)
        and entry["script"]
        for code, entry in languages.items()
    ):
        logger.error(f"The language registry file {filepath} is not a map of named, scripted languages — ignoring it.")
        return {}
    if not languages:
        logger.error(f"The language registry file {filepath} is empty — ignoring it.")
        return {}
    return languages


class LanguageRegistry:
    """The code→name and code→script tables, read once and cached.

    The instance (not module globals) carries the cache, so a test can build
    an isolated registry and a caller can point several at different paths
    without them sharing state.
    """

    def __init__(self, path: str, retry_seconds: float = REGISTRY_RETRY_SECONDS):
        self._path = path
        self._retry_seconds = retry_seconds
        self._codes: dict | None = None
        self._scripts: dict | None = None
        self._failed_at: float | None = None

    def _load(self) -> None:
        """Fill the two projections, at most once per retry window."""
        # The success cache is guarded by TRUTHINESS, not None-ness (deployed
        # `if _LANGUAGE_REGISTRY_CACHE: return`): an empty result means the
        # registry is unreadable, and the retry window below — not the cache —
        # decides when the file is read again.
        if self._codes:
            return
        now = time.monotonic()
        if self._failed_at is not None and now - self._failed_at < self._retry_seconds:
            # The last read failed and the retry window has not elapsed yet.
            return
        loaded = _read_registry(self._path)
        # The projections are published before the failure timestamp that
        # sends readers away: a reader that takes the retry-window early
        # return must never still see them unset.
        self._codes = {code: language["name"] for code, language in loaded.items()}
        self._scripts = {code: language["script"] for code, language in loaded.items()}
        if not loaded:
            self._failed_at = now
        else:
            self._failed_at = None

    def language_codes(self) -> dict:
        """The language map (code → name), read once and cached.

        The map is never None: an unreadable registry is an empty map, and an
        empty map means every language is unknown. The returned map is a
        copy: the cache is the whitelist every request is checked against,
        and a caller that mutated the map it got back would rewrite that
        whitelist.
        """
        self._load()
        return dict(self._codes)

    def language_scripts(self) -> dict:
        """The code → script table, read once and cached.

        The table decides which alphabet the translation prompt asks for. It
        is never None: an unreadable registry is an empty table, and an empty
        table means the prompt carries no script clause rather than a wrong
        one. The returned table is a copy, like the language map.
        """
        self._load()
        return dict(self._scripts)
