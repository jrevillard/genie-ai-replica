# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The doc-repo metadata adapter: how a legacy ``file_id`` resolves.

``GET /api/files/:fileId`` is the one legacy resolution surface that exists
(the V04 map, §2.3): it authenticates the caller and authorizes nothing
beyond that — which is exactly why the executor, not this adapter, is the
authority for a legacy target. The adapter only reports what the service
answered: 200 unwraps to the file record (every envelope shape the fleet
ships), 404 means the file does not resolve, and any other answer — or a
transport failure — is a transient failure, never a silent pass.
"""

import asyncio
from typing import Any
from urllib.parse import quote

from capabilities.adapters.http import HttpTransport, RequestsTransport, TransportError
from capabilities.contract import OperationName, TransientError


def _file_of(body: Any) -> dict[str, Any]:
    """Unwrap the metadata envelope ({file} | {data: {file}} | {data} | raw)."""
    data = body if isinstance(body, dict) else {}
    file = data.get("file")
    if isinstance(file, dict):
        return file
    inner = data.get("data")
    if isinstance(inner, dict):
        file = inner.get("file")
        if isinstance(file, dict):
            return file
        return inner
    return data


class DocRepoAdapter:
    """Resolves a legacy file id to its metadata record, or ``None``."""

    def __init__(self, base_url: str, transport: HttpTransport | None = None, timeout_s: float = 10.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._transport: HttpTransport = transport if transport is not None else RequestsTransport()
        self._timeout_s = timeout_s

    async def fetch_metadata(self, file_id: str, bearer: str | None) -> dict[str, Any] | None:
        """The file's metadata record, ``None`` when the file does not resolve."""
        url = f"{self._base_url}/api/files/{quote(file_id, safe='')}"
        try:
            status, body = await asyncio.to_thread(self._transport.get_json, url, bearer, self._timeout_s)
        except TransportError as error:
            raise TransientError(
                f"doc-repo metadata read failed: {error}", operation=OperationName.READ_SOURCE
            ) from error
        if status == 200:
            if isinstance(body, dict):
                return _file_of(body)
            # A 200 whose payload is not an object (an HTML error page from a
            # proxy) is a payload defect, named as such — the same diagnostic
            # principle as the okf adapter: the status succeeded, the payload
            # is what is wrong.
            raise TransientError(
                "doc-repo metadata read served a non-object body on status 200",
                operation=OperationName.READ_SOURCE,
            )
        if status == 404:
            return None
        raise TransientError(f"doc-repo metadata read failed with status {status}", operation=OperationName.READ_SOURCE)
