# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The TEI embedding adapter: embeds the query, honoring the instruction contract.

The recorded contract: the chat path sends the PREFIXED text to the embedder and the RAW
text to the retriever, so the BM25 leg tokenizes the bare query. This adapter
is the embedder side — it applies ``get_query_instruction`` to the query text
and posts the prefixed text to the TEI endpoint. The raw text stays with the
caller for the BM25 leg.
"""

import logging
from dataclasses import dataclass

import httpx

from .query_instruction import get_query_instruction, resolve_embed_model

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EmbeddedQuery:
    """The prefixed query, its embedding, and the raw text the BM25 leg needs."""

    raw_text: str
    prefixed_text: str
    embedding: list[float]


class TeiEmbeddingAdapter:
    """Embeds prepared queries through the TEI endpoint (``POST {endpoint}``).

    The endpoint is the recorded ``TEI_EMBEDDING_ENDPOINT`` value — the full
    embed URL the deployment serves (it ends in ``/embed``). The request body
    is TEI's native shape: ``{"inputs": [<one string>]}``. The adapter sends
    the PREFIXED text per the model-specific instruction contract. The
    Authorization header rides only when the deployment carries a credential
    for the TEI endpoint (the GPU-gateway venues auth it with the same
    bearer the model calls use; an internal TEI carries none and no header
    is sent).
    """

    def __init__(
        self,
        endpoint: str,
        connect_timeout_seconds: float = 30.0,
        total_timeout_seconds: float = 300.0,
        transport: httpx.AsyncBaseTransport | None = None,
        tls_verify: bool = True,
        bearer: str = "",
    ):
        self._endpoint = endpoint
        self._connect_timeout = connect_timeout_seconds
        self._total_timeout = total_timeout_seconds
        # Injectable for the tests (httpx.MockTransport); production uses
        # the default connection pool.
        self._transport = transport
        # Both knobs ride the deployment's conventions — see the
        # ModelEndpointConfig docstring (env_config.py) for the full story.
        self._tls_verify = tls_verify
        self._bearer = bearer

    def query_instruction(self, model_id: str | None = None) -> str | None:
        """Resolve the query-instruction prefix for the active embedding model."""
        return get_query_instruction(model_id if model_id is not None else resolve_embed_model())

    async def embed(self, text: str) -> EmbeddedQuery:
        """Embed one prepared query with the model-specific prefix applied.

        The prefix applies to the QUERY only (the caller embeds nothing else);
        ``raw_text`` is echoed for the BM25 leg, which must tokenize the bare
        query. A transport error or an unexpected response raises — the caller
        maps it onto the contract's transient failure (the recorded chat path
        fails the turn when the embedding stage fails; it never abstains on
        an embedding error).
        """
        instruction = self.query_instruction()
        prefixed = f"{instruction}{text}" if instruction else text
        embedding = await self._request_embedding(prefixed)
        return EmbeddedQuery(raw_text=text, prefixed_text=prefixed, embedding=embedding)

    async def _request_embedding(self, prefixed_text: str) -> list[float]:
        body = {"inputs": [prefixed_text]}
        headers = {"Authorization": f"Bearer {self._bearer}"} if self._bearer else {}
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(self._total_timeout, connect=self._connect_timeout),
            transport=self._transport,
            verify=self._tls_verify,
        ) as client:
            response = await client.post(self._endpoint, json=body, headers=headers)
        if response.status_code != 200:
            raise RuntimeError(
                f"TEI embedding call failed: HTTP {response.status_code} from {self._endpoint}. "
                f"Response: {response.text[:500]}"
            )
        decoded = response.json()
        # TEI returns [[floats...]] for one input. A misshaped body is a
        # failed call, not an empty embedding.
        if (
            not isinstance(decoded, list)
            or len(decoded) != 1
            or not isinstance(decoded[0], list)
            or not decoded[0]
            or not all(isinstance(v, (int, float)) for v in decoded[0])
        ):
            raise RuntimeError(
                f"TEI embedding returned an unexpected response shape "
                f"(expected [[floats]] for one input) from {self._endpoint}: {str(decoded)[:200]}"
            )
        return [float(v) for v in decoded[0]]
