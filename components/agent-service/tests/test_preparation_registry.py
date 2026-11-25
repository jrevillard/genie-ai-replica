# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The vendored language registry: the byte parity pin and the reader contract.

The vendored copy is a DEFENSE, not a fork: a runtime divergence between the
backend's registry and the agent service's copy would make the two runtimes
list different languages. The first test pins the byte equality of the copy
against the backend source — a moved, edited or deleted source fails loudly,
never silently.
"""

import json
from pathlib import Path

import pytest
from conftest import VENDORED_REGISTRY_PATH

from preparation.registry import LanguageRegistry

VENDORED = Path(VENDORED_REGISTRY_PATH)
BACKEND_SOURCE = (
    Path(__file__).resolve().parents[2]
    / "gov-chat-backend"
    / "services"
    / "translation"
    / "language-maps"
    / "language-registry.json"
)


def test_the_vendored_copy_is_byte_identical_to_the_backend_source():
    """A static repository check: both files must exist and be identical.

    A moved or edited source fails loudly here — the copy is re-vendored on
    purpose, never drifted into.
    """
    assert VENDORED.is_file(), f"the vendored registry is missing: {VENDORED}"
    assert BACKEND_SOURCE.is_file(), f"the backend registry source is missing: {BACKEND_SOURCE}"
    assert VENDORED.read_bytes() == BACKEND_SOURCE.read_bytes()


def test_the_reader_fills_both_projections_from_the_vendored_copy():
    registry = LanguageRegistry(str(VENDORED))
    codes = registry.language_codes()
    scripts = registry.language_scripts()

    # The recorded registry: 41 language codes.
    assert len(codes) == 41
    assert codes["en"] == "English"
    assert codes["fr"] == "French"
    assert codes["ar"] == "Arabic"
    assert scripts["ar"] == "Arab"
    assert scripts["zh"] == "Hans"
    assert scripts["st"] == "Latn"


def test_the_maps_are_copies_of_the_cache():
    """A caller that mutated the map it got back must not rewrite the
    whitelist for the whole process."""
    registry = LanguageRegistry(str(VENDORED))
    codes = registry.language_codes()
    codes["en"] = "MUTATED"
    scripts = registry.language_scripts()
    scripts["ar"] = "MUTATED"

    assert registry.language_codes()["en"] == "English"
    assert registry.language_scripts()["ar"] == "Arab"


def _write_registry(path: Path, payload) -> Path:
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_a_missing_file_reads_as_empty_maps_and_never_crashes(tmp_path):
    registry = LanguageRegistry(str(tmp_path / "absent.json"))
    assert registry.language_codes() == {}
    assert registry.language_scripts() == {}


def test_a_malformed_registry_reads_as_empty(tmp_path):
    # A list of two-letter strings is not a registry: every entry must carry
    # a non-empty name and a non-empty script.
    bad = _write_registry(tmp_path / "bad.json", {"languages": {"en": {}, "fr": {"name": "French"}}})
    registry = LanguageRegistry(str(bad))
    assert registry.language_codes() == {}
    assert registry.language_scripts() == {}


def test_an_empty_registry_is_unreadable(tmp_path):
    empty = _write_registry(tmp_path / "empty.json", {"languages": {}})
    registry = LanguageRegistry(str(empty))
    assert registry.language_codes() == {}


def test_a_failed_read_is_retried_after_the_retry_window(tmp_path, monkeypatch):
    """A transient read failure must not disable translation forever, but it
    must not re-read the file on every call either."""
    target = tmp_path / "late.json"
    registry = LanguageRegistry(str(target))

    clock = {"now": 1000.0}
    monkeypatch.setattr("preparation.registry.time.monotonic", lambda: clock["now"])

    # The file does not exist yet: empty maps, failure stamped.
    assert registry.language_codes() == {}
    # The file appears, but the retry window (60 s) has not elapsed: the
    # failure is remembered, the file is not re-read.
    _write_registry(target, {"languages": {"en": {"name": "English", "script": "Latn"}}})
    clock["now"] = 1005.0
    assert registry.language_codes() == {}
    # Past the window: the read retries and succeeds.
    clock["now"] = 1061.0
    assert registry.language_codes()["en"] == "English"
    # A successful read is cached for the process lifetime (no re-read).
    target.unlink()
    assert registry.language_codes()["en"] == "English"


@pytest.mark.parametrize("payload", [None, [], {"languages": "nope"}, "string"])
def test_shapes_that_are_not_a_registry_read_as_empty(tmp_path, payload):
    path = tmp_path / "shape.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    registry = LanguageRegistry(str(path))
    assert registry.language_codes() == {}
    assert registry.language_scripts() == {}
