# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The input-preparation module: the loop-side half of query readiness.

The architecture assigns preparation to the agent application layer: "the
agent application layer prepares every query … The port requires prepared
English queries and never calls vLLM." This package is that layer — a
plain injectable component (no HTTP surface, no loop coupling, no agent
runtime needed): configs B/C import and call it standalone.

The dependency arrow is one-way: this package imports the capability
contract's types (:class:`~capabilities.contract.PreparedQuery`,
:class:`~capabilities.contract.QueryPreparationStatus`); the port package
(``capabilities/``) never imports preparation, and nothing in it calls
vLLM — the translation endpoint is preparation's business, which is WHY
the module lives outside the port package.

Behavior is frozen to the recorded preparation contract
(``docs/baselines/v02-opea-query-path-contract.md``); the structure is
free (clean-slate — no ``comps`` import, no OPEA service call,
no shared library with the overlay). What the record freezes: the order of
operations, the ``query_translation_status`` vocabulary (the contract's
``QueryPreparationStatus``), the bounds, the three failure classes with
their distinct outcomes, and the locale coverage shape.

Answer translation stays BFF-owned: this module never translates the
answer and never decides the answer's language. The BFF's
``language_refused`` case cannot reach the module (the BFF answers 400
``UNSUPPORTED_LANGUAGE`` first) and is documented — not built — in
``detection.py``.

Public surface:

    PreparationConfig          the frozen env-knob surface
    QueryPreparer              the entry: one ``prepare()`` for initial and
                               refined queries identically
    PreparationResult          status, the PreparedQuery when prepared, the
                               history text, the resolved language
    TranslationClient          the translation seam (also usable directly)
    LanguageRegistry           the vendored registry reader
    TranslationInputTooLongError  the typed refusal (the abstention class)
    TranslationFailedError / TranslationTimeoutError  the degraded classes
    PreparedQuery, QueryPreparationStatus, PreparedStatus  re-exported
"""

from capabilities.contract import PreparedQuery, PreparedStatus, QueryPreparationStatus

from .bounds import (
    USER_MSG_PATTERN,
    derived_char_budget,
    extract_query,
    flatten_history,
    select_history_within_budget,
)
from .config import HISTORY_TRANSLATION_TARGET, PreparationConfig
from .detection import detect_language, resolve_named_language
from .prepare import PreparationResult, QueryPreparer
from .registry import LanguageRegistry
from .translation import (
    TranslationClient,
    TranslationFailedError,
    TranslationInputTooLongError,
    TranslationTimeoutError,
)

__all__ = [
    "HISTORY_TRANSLATION_TARGET",
    "USER_MSG_PATTERN",
    "PreparationConfig",
    "PreparationResult",
    "PreparedQuery",
    "PreparedStatus",
    "QueryPreparationStatus",
    "QueryPreparer",
    "TranslationClient",
    "TranslationFailedError",
    "TranslationInputTooLongError",
    "TranslationTimeoutError",
    "LanguageRegistry",
    "derived_char_budget",
    "detect_language",
    "extract_query",
    "flatten_history",
    "resolve_named_language",
    "select_history_within_budget",
]
