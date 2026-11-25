# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The depth-aware credential redaction every recorded artifact writes through.

ONE rule for the whole protocol: the run manifest (:mod:`manifest`) records
its resolved-env snapshots, its model ids and its prompt digests through
:func:`redact_deep`, and the comparison reports (:mod:`e01`, :mod:`e02`)
apply it on every path they write — the per-case rows, the M-5 values, the
M-1 aggregate, the recorded label scopes, the capture stamp and the
manifests' prompt/model maps. A credential-named key reaches neither the
committed manifest nor a derived report, and a marker added to the shared
vocabulary reaches both surfaces at once — they cannot drift on what names a
credential.

The rule keeps the measurement names the judge needs (``chunk_key``, the
token counts) and drops the credential names explicitly — including the
auth-word spellings (``authHeader``, ``authorized``) a bare substring list
alone would miss. The documented safe side: an env key named after the
deployment's authorized-graph scope (``AGENT_AUTHORIZED_GRAPHS``) is read as
a credential and drops from every recorded artifact.
"""

from __future__ import annotations

import re

# The credential vocabulary — ONE list, the single home every redacting
# surface reads. Both the manifest and the reports derive their rule from
# these names, so a marker added here reaches both.
SECRET_KEY_MARKERS = ("PASSWORD", "SECRET", "TOKEN", "KEY", "BEARER", "CREDENTIAL")

# The credential-named keys the redaction drops, at ANY depth. This rule is
# the measurement-aware form: it keeps the names the judge needs
# (:data:`MEASUREMENT_KEY_NAMES`) and drops the credential names explicitly.
CREDENTIAL_MARKERS = (
    tuple(marker.lower() for marker in SECRET_KEY_MARKERS)
    # The names the base list does not carry but a config map can.
    + ("authorization", "session")
)

# "auth" names a credential in EVERY spelling — the joined and camelCase ones
# ("authHeader", "authheader") a word-boundary match alone would let through.
# The rule is applied PER WORD: a word that is one of the AUTHOR stems is
# evidence (an author is not a secret), while any OTHER auth-bearing word is
# a credential — so "author_auth_header" is a credential (its "auth" word) and
# "doc_authors" is evidence (its author word).
#
# The stems are matched EXACTLY: a permission word that merely starts with
# "author" ("authorisation", "authorizer", "authorized") is a credential, and
# a word that only CONTAINS a stem ("authorname") is redacted rather than
# kept — losing an evidence key is the safe side of that trade.
_AUTH_MARKER = "auth"
_AUTHOR_WORDS = frozenset(
    {
        "author",
        "authors",
        "authored",
        "authoring",
        "authorship",
        "coauthor",
        "coauthors",
    }
)

MEASUREMENT_KEY_NAMES = frozenset(
    {
        "chunk_key",
        "content_hash",
        "prompt_tokens",
        "completion_tokens",
        "total_tokens",
        "input_tokens",
        "output_tokens",
        "prompt_tokens_details",
        "completion_tokens_details",
        "token_count",
        "tokens",
        # The anchor's own evidence counters — "…_keys" matches the KEY
        # marker, and the counter is evidence, not a credential.
        "n_unmapped_chunk_keys",
    }
)


# A token COUNT is a measurement; a token CREDENTIAL is not. The suffix rule
# covers the counts the allowlist cannot enumerate (the names inside the
# usage detail sub-dicts: cached_tokens, reasoning_tokens), and the qualifier
# list keeps the credential names out of it.
_TOKEN_COUNT_SUFFIXES = ("_tokens", "_token_count")
_CREDENTIAL_QUALIFIERS = ("access", "refresh", "auth", "bearer", "api", "secret", "session", "id_token")


def _key_words(key: str) -> list[str]:
    """The key's words: the separators (snake, kebab, dot, slash, space) and
    the camelCase humps. The RAW key is split — lowercasing first would
    flatten the humps and hide the camelCase spelling."""
    spaced = re.sub(r"[._\-/\s]+", " ", str(key))
    spaced = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", spaced)
    return [word for word in spaced.split() if word]


def is_credential_key(key) -> bool:
    """True when the key names a credential. The measurement names are the
    explicit exceptions — they are values the judge needs, not secrets."""
    raw = str(key)
    name = raw.lower()
    if name in MEASUREMENT_KEY_NAMES:
        return False
    if name.endswith(_TOKEN_COUNT_SUFFIXES):
        if any(qualifier in name for qualifier in _CREDENTIAL_QUALIFIERS):
            return True
        # A count — but only if the name carries no OTHER credential marker
        # ("password_tokens" is not a count). The TOKEN marker itself is the
        # suffix, so it does not count here.
        return any(marker in name for marker in CREDENTIAL_MARKERS if marker != "token")
    if _AUTH_MARKER in name:
        # The marker is applied PER WORD: an author-bearing word is evidence
        # ("doc_authors", "authorName"), any other "auth" word is a credential
        # ("auth_header", "authorAuthHeader"). The word split is computed here
        # only — most keys never carry the marker.
        for word in _key_words(raw):
            word = word.lower()
            if word in _AUTHOR_WORDS:
                continue
            if _AUTH_MARKER in word:
                return True
    return any(marker in name for marker in CREDENTIAL_MARKERS)


def redact_deep(value):
    """Drop every credential-named key at ANY depth.

    The manifest records maps of maps (a provider block's ``api_key`` inside
    ``model_ids``) and the reports record whole rows — a top-level scan would
    let a nested credential reach a committed artifact. The measurement names
    in :data:`MEASUREMENT_KEY_NAMES` are the explicit exceptions: values the
    judge needs, not secrets.
    """
    if isinstance(value, dict):
        return {key: redact_deep(item) for key, item in value.items() if not is_credential_key(key)}
    if isinstance(value, list):
        return [redact_deep(item) for item in value]
    return value
