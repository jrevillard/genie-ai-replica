"""Scope catalog + endpoint -> required-scope mapping.

Phase 2a — kept deliberately small. Federation callers (GENIE-AI /
OPEA, mobile apps) request a subset of these at token-issuance time
and the gateway enforces "endpoint scope must be in token scopes".

Adding a new scope:
  1. add the constant
  2. map endpoint(s) -> scope in ENDPOINT_SCOPE
  3. update the README admin token-issue example
"""
from __future__ import annotations

from typing import Dict, FrozenSet


# ── Defined scopes ───────────────────────────────────────────────────

CHAT      = "amina:chat"
TRANSLATE = "amina:translate"
OBS_READ  = "amina:observatory:read"

ALL_SCOPES: FrozenSet[str] = frozenset({CHAT, TRANSLATE, OBS_READ})


# ── Endpoint -> required scope ───────────────────────────────────────
# Endpoints not in this map are unauthenticated (public). Add an entry
# here whenever a new public endpoint should require a token.

ENDPOINT_SCOPE: Dict[str, str] = {
    "/api/v1/public/chat":      CHAT,
    "/api/v1/public/translate": TRANSLATE,
}


def required_scope_for(path: str) -> str | None:
    """Return the scope required for ``path``, or None if path is public.

    Exact-match only. For future query-string / parameter routes we'd
    add a longest-prefix match, but every Phase 2a endpoint is fixed.
    """
    return ENDPOINT_SCOPE.get(path)


def validate_scopes(requested: list[str] | None) -> list[str]:
    """Return only the requested scopes that are recognised. Drops
    unknown scopes silently — the audit log records what was requested
    vs what was granted, so a typo or stale documented scope doesn't
    issue a privileged token by accident."""
    if not requested:
        return []
    return [s for s in requested if s in ALL_SCOPES]
