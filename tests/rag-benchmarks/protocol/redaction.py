# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The depth-aware credential redaction the comparison reports write through.

The manifest's own redaction is TOP-LEVEL only: a nested credential (a row's
``metadata`` carrying an api key) survives it, and the comparison reports
record whole rows. The reports therefore apply THIS rule on every path they
write — the per-case rows, the M-5 values, the M-1 aggregate, the recorded
label scopes, the capture stamp and the manifests' prompt/model maps.

The rule is deliberately NARROWER than the manifest's: the report records
measurement fields the judge needs (``chunk_key``, the token counts), so it
keeps those and drops the credential names explicitly. The two rules diverge
ON PURPOSE, and the reports apply this one on every path they write — they
never state two different things about the same datum.

One home for the rule: the E01 report (story 4.3) and the E02 report (story
4.5) both write rows, and a rule with two copies is a rule with two answers.
"""

from __future__ import annotations

import re

from .manifest import SECRET_KEY_MARKERS

# The credential-named keys the reports drop, at ANY depth. The marker set is
# the manifest's, plus the names that carry the marker as a substring. This
# rule is the REPORTS' own and it is deliberately narrower than the manifest's
# (which drops every marker-named key, measurement names included): the
# reports record measurement fields the judge needs, so they keep those and
# drop the credential names explicitly.
CREDENTIAL_MARKERS = (
    tuple(marker.lower() for marker in SECRET_KEY_MARKERS)
    # The names the manifest's list does not carry but a config map can.
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

    The manifest's redaction is top-level only — a nested credential (a row's
    ``metadata`` carrying an api key) would survive it, and the comparison
    reports record whole rows. Depth-aware redaction here; the rule is the
    reports' own (see :data:`MEASUREMENT_KEY_NAMES` for the measurement names
    it keeps).
    """
    if isinstance(value, dict):
        return {key: redact_deep(item) for key, item in value.items() if not is_credential_key(key)}
    if isinstance(value, list):
        return [redact_deep(item) for item in value]
    return value
