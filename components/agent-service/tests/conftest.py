# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Shared test doubles for the adapter suites.

The whole transport surface the HTTP adapters use: one GET, one tuple back.
Imported by the adapter test suites so a change to the fake's surface — say,
recording headers — lands once for every adapter.

The preparation suites share their own doubles here too: the async POST
transport seam (``PreparationFakeTransport``), the model-entry helper, the
V02 locale samples and the detector-seeding fixture — one home, so a
surface or policy change lands once.
"""

from pathlib import Path

import pytest
from langdetect import DetectorFactory

from capabilities.adapters.http import TransportError


class FakeTransport:
    def __init__(self, status=200, body=None, error=None):
        self.status = status
        self.body = body if body is not None else {}
        self.error = error
        self.calls = []

    def get_json(self, url, bearer, timeout_s):
        self.calls.append({"url": url, "bearer": bearer, "timeout_s": timeout_s})
        if self.error is not None:
            raise TransportError(str(self.error))
        return self.status, self.body


class PreparationFakeTransport:
    """The preparation transport seam: canned (status, body) per URL prefix,
    recorded calls WITH their headers (the bearer contracts are asserted on
    the recorded headers, not taken on faith)."""

    def __init__(self, responses=None, error=None):
        self.responses = responses or {}
        self.error = error
        self.calls = []

    def _answer(self, url, headers=None, payload=None):
        self.calls.append({"url": url, "headers": headers, "payload": payload})
        if self.error is not None:
            raise self.error
        for prefix, answer in self.responses.items():
            if url.startswith(prefix):
                status, body = answer
                if callable(body) and payload is not None:
                    body = body(payload)
                return status, body
        raise AssertionError(f"no canned answer for {url}")

    async def get_json(self, url, headers, timeout_s):
        return self._answer(url, headers)

    async def post_json(self, url, headers, payload, timeout_s):
        return self._answer(url, headers, payload)


def preparation_model_entry(max_model_len=8192, model_id="test-model"):
    """A canned ``/v1/models`` answer shaped the way vLLM serves it."""
    return (
        200,
        {"data": [{"id": model_id, "max_model_len": max_model_len}]},
    )


# The vendored registry's path, resolved once for the suites that point a
# registry at it (the reader-contract and parity suites compute their own
# backend-source path locally).
VENDORED_REGISTRY_PATH = str(Path(__file__).resolve().parents[1] / "preparation" / "language-registry.json")


# The V02 §5.6 sample family (shape reference, not exact wording — the
# detector is non-deterministic and the model sampled).
FRENCH_SAMPLE = (
    "Bonjour, comment la ville de Geneve gere-t-elle les services de "
    "transport public pour les habitants et les visiteurs ?"
)
ARABIC_SAMPLE = "كيف تدير مدينة دبي خدمات النقل العام للسكان والزوار خلال موسم الصيف؟"


@pytest.fixture
def seeded_langdetect():
    """Deterministic detection for the suites that exercise it; production
    stays unseeded (the AST check in the detection suite pins that)."""
    DetectorFactory.seed = 0
    yield
