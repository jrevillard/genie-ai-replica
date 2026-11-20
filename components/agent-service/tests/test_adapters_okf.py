# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The okf-server concept adapter (story 1.7): the exact-join concept read.

The adapter calls okf-server's serving read
``GET /api/okf/repos/:repo_id/concepts/:concept_id`` — the route whose
handler resolves the concept through the exact ``(repo_id, concept_id)``
join on ``okf_concepts_meta`` and applies the per-repo fence and the
publication gate. The caller's bearer rides along: the fence decides on the
caller's own scopes. A 404 and a 403 collapse to "does not resolve"
(okf-server's own anti-enumeration posture) — fail-closed, never a wider
corpus.
"""

import asyncio
import urllib.parse

import pytest

from capabilities.adapters.http import TransportError
from capabilities.adapters.okf import OkfAdapter
from capabilities.contract import TransientError


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


def adapter(transport):
    return OkfAdapter(base_url="http://okf-server:3002", transport=transport)


CARD = {
    "repo_id": "r-1",
    "concept_id": "entities/google",
    "graph_name": "OKF_acme_v2",
    "bundle_version": 3,
    "title": "Google",
    "body": "the body",
}


def test_concept_get_hits_the_serving_route_with_the_bearer_forwarded():
    transport = FakeTransport(status=200, body=CARD)
    concept = asyncio.run(adapter(transport).fetch_concept("r-1", "entities/google", bearer="tok-1"))
    assert concept == CARD
    expected = "http://okf-server:3002/api/okf/repos/r-1/concepts/" + urllib.parse.quote("entities/google", safe="")
    assert transport.calls[0]["url"] == expected
    assert transport.calls[0]["bearer"] == "tok-1"


@pytest.mark.parametrize("status", [404, 403])
def test_absent_and_fenced_collapse_to_none(status):
    transport = FakeTransport(status=status, body={"error": "CONCEPT_NOT_FOUND"})
    assert asyncio.run(adapter(transport).fetch_concept("r-1", "c", bearer=None)) is None


@pytest.mark.parametrize("status", [401, 500, 503])
def test_other_refusals_are_transient(status):
    transport = FakeTransport(status=status, body={})
    with pytest.raises(TransientError):
        asyncio.run(adapter(transport).fetch_concept("r-1", "c", bearer=None))


def test_transport_error_is_transient():
    transport = FakeTransport(error=TimeoutError("upstream"))
    with pytest.raises(TransientError):
        asyncio.run(adapter(transport).fetch_concept("r-1", "c", bearer=None))
