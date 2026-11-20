# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The okf-server concept adapter: the exact-join concept read.

The adapter calls okf-server's serving read
``GET /api/okf/repos/:repo_id/concepts/:concept_id`` — the route that
resolves the concept through the exact ``(repo_id, concept_id)`` join on
``okf_concepts_meta`` and applies the per-repo fence and the publication
gate inside its handler. Going through the route, rather than reading the
collection directly, is what keeps a draft/retracted repo and a restricted
twin unreachable from the port. The caller's bearer rides along: the fence
decides on the caller's own scopes.

A 404 and a 403 collapse to "does not resolve" — okf-server's own
anti-enumeration posture, and the fail-closed direction: no content from an
ambiguous answer. Every other non-200 answer, and every transport failure,
is a transient failure.
"""

import asyncio
from typing import Any
from urllib.parse import quote

from capabilities.adapters.http import RequestsTransport, TransportError
from capabilities.contract import OperationName, TransientError


class OkfAdapter:
    """Reads one concept card, or ``None`` when it does not resolve."""

    def __init__(self, base_url: str, transport=None, timeout_s: float = 10.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._transport = transport if transport is not None else RequestsTransport()
        self._timeout_s = timeout_s

    async def fetch_concept(self, repo_id: str, concept_id: str, bearer: str | None) -> dict[str, Any] | None:
        """The concept card (identity, content), ``None`` when it does not resolve."""
        url = f"{self._base_url}/api/okf/repos/{quote(repo_id, safe='')}/concepts/{quote(concept_id, safe='')}"
        try:
            status, body = await asyncio.to_thread(self._transport.get_json, url, bearer, self._timeout_s)
        except TransportError as error:
            raise TransientError(
                f"okf-server concept read failed: {error}", operation=OperationName.READ_SOURCE
            ) from error
        if status == 200 and isinstance(body, dict):
            return body
        if status in (403, 404):
            return None
        raise TransientError(
            f"okf-server concept read failed with status {status}", operation=OperationName.READ_SOURCE
        )
