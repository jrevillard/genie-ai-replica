"""Parity test: ensure the Python OTel redaction patterns cover the same
sensitive-key surface as the Node.js backend redaction.

Both sides are the security boundary between user content and the log /
trace store — a drift between them is a security finding. The Node side
defines its patterns in `components/gov-chat-backend/tracing-pii.js`
(`SENSITIVE_KEY_PATTERNS`); the Python side defines its patterns in
`genie-ai-overlay/tracing.py` (`_PII_KEY_PATTERNS`) and re-uses them from
`tracing_pii.py`.

This test loads BOTH sets and asserts:
- All 6 patterns documented in the Node side
  (password / token / secret / authorization / credential / api[_-]?key)
  are also covered by the Python side (canonical parity).
- The shared key set classifies the same key the same way on both
  sides (no drift on the documented shared surface).

KNOWN ASYMMETRY (deliberate, documented):
    The Python side carries additional patterns NOT present on the Node
    side — `session_id`, `user_id`, `conversation_id`, `email`,
    `user_query`, `llm_response`, `document_text`, `private_key`,
    `cookie`. These are OPEA-specific shapes the Node backend doesn't
    emit (the backend stores these in its own DB, not as OTel
    attributes), so the Node side never needed to redact them. The
    asymmetry is one-directional (Python-only extensions) — no Node-only
    extensions exist. If a new sensitive key shape is added to EITHER
    side, the other side must be updated to keep parity on the canonical
    shared surface.

This test asserts parity on the 6 canonical shapes only — Python-only
extensions are documented but not enforced on the Node side.
"""

import re
import sys
from pathlib import Path

import pytest

# Make `genie-ai-overlay/` importable so `import tracing` resolves whether
# the test is invoked from a worktree (cwd) or from the package dir.
OVERLAY_DIR = Path(__file__).resolve().parent.parent
if str(OVERLAY_DIR) not in sys.path:
    sys.path.insert(0, str(OVERLAY_DIR))

# `tracing.py` must be imported for `_PII_KEY_PATTERNS` to be defined.
import tracing  # noqa: E402

# Path to the Node.js tracing-pii.js — relative to the OPEA overlay dir.
# The repo structure is `<repo>/genie-ai-overlay/` and
# `<repo>/components/gov-chat-backend/tracing-pii.js`, so the relative
# path is `../components/gov-chat-backend/tracing-pii.js`.
REPO_ROOT = OVERLAY_DIR.parent
NODE_PII_PATH = REPO_ROOT / "components" / "gov-chat-backend" / "tracing-pii.js"


def _load_node_patterns():
    """Load the Node-side `SENSITIVE_KEY_PATTERNS` literal by string
    parsing — no JS runtime required.

    Node file declares them as:
        const SENSITIVE_KEY_PATTERNS = [/password/i, /token/i, ..., /api[_-]?key/i];

    We extract the regex source strings between `/.../` and compile them
    with `re.IGNORECASE` (Node regexes carry their own `i` flag, which
    Python ignores on `re.compile` — apply IGNORECASE explicitly to
    match Node behaviour).

    The naive `re.findall(r"/([^/]+)/", raw)` breaks on character classes
    like `[_-]` (the `]` looks like an array terminator to the outer
    regex). A hand-rolled scanner tracks `[...]` depth to find the
    closing `/` correctly.
    """
    text = NODE_PII_PATH.read_text(encoding="utf-8")
    match = re.search(r"SENSITIVE_KEY_PATTERNS\s*=\s*\[(.+?)\];", text, re.DOTALL)
    assert match is not None, "could not locate SENSITIVE_KEY_PATTERNS in tracing-pii.js"
    raw = match.group(1)
    sources = _scan_js_regex_literals(raw)
    assert len(sources) >= 6, f"expected at least 6 patterns, found {len(sources)}: {sources}"
    return [re.compile(s, re.IGNORECASE) for s in sources]


def _scan_js_regex_literals(raw):
    """Extract regex source strings from a JS array literal.

    Walks `raw` looking for `/` at character-class depth 0 (so `/`
    inside `[...]` is treated as literal). Returns the list of source
    strings — flags are read but only used to decide case-insensitivity
    (Python's `re.IGNORECASE` is applied unconditionally by the caller).
    """
    sources = []
    i = 0
    n = len(raw)
    while i < n:
        if raw[i] != "/":
            i += 1
            continue
        start = i + 1
        i += 1  # advance past the opening `/` BEFORE the inner scan
        depth = 0
        while i < n:
            ch = raw[i]
            if ch == "[":
                depth += 1
            elif ch == "]":
                if depth > 0:
                    depth -= 1
            elif ch == "\\" and i + 1 < n:
                # Skip escaped char (so \[ doesn't count)
                i += 1
            elif ch == "/" and depth == 0:
                # Closing `/` of the regex literal
                break
            i += 1
        # `raw[i]` is the closing `/` (depth == 0)
        source = raw[start:i]
        i += 1  # consume closing `/`
        # Consume flags
        while i < n and raw[i] in "gimsuy":
            i += 1
        sources.append(source)
    return sources


def _load_python_patterns():
    """Pull the Python `_PII_KEY_PATTERNS` from the imported `tracing`
    module. They're already compiled regex objects."""
    return list(tracing._PII_KEY_PATTERNS)


def _matches_any(patterns, key):
    return any(p.search(key) for p in patterns)


# The 6 patterns documented in the Node side, by their regex source
# string. Used as the canonical "must be present on both sides" set.
CANONICAL_NODE_SOURCES = {
    "password",
    "token",
    "secret",
    "authorization",
    "credential",
    "api[_-]?key",
}


def test_node_pii_file_exists():
    """Sanity guard — if the Node file moves, the relative path here
    needs updating."""
    assert NODE_PII_PATH.is_file(), f"missing Node PII source at {NODE_PII_PATH}"


def test_node_patterns_cover_canonical_set():
    """All 6 canonical sensitive-key shapes must be covered by the Node
    SENSITIVE_KEY_PATTERNS list."""
    node_patterns = _load_node_patterns()
    for source in CANONICAL_NODE_SOURCES:
        compiled = re.compile(source, re.IGNORECASE)
        found = any(p.pattern == compiled.pattern for p in node_patterns)
        assert found, f"Node side missing canonical pattern /{source}/i"


def test_python_patterns_cover_canonical_set():
    """All 6 canonical sensitive-key shapes must also be covered by the
    Python `_PII_KEY_PATTERNS`. Catches a drift where the Python side
    silently drops one of the 6 documented patterns."""
    py_patterns = _load_python_patterns()
    for source in CANONICAL_NODE_SOURCES:
        compiled = re.compile(source, re.IGNORECASE)
        found = any(p.pattern == compiled.pattern for p in py_patterns)
        assert found, f"Python side missing canonical pattern /{source}/i"


# Keys derived ONLY from the 6 canonical shared patterns. Any key in this
# list must classify the same way on both sides. Python-only extensions
# (session_id / user_id / email / etc.) are deliberately excluded — see
# the KNOWN ASYMMETRY note at the top of this file.
@pytest.mark.parametrize(
    "key",
    [
        # password
        "password",
        "PASSWORD",
        "db_password",
        "x-password",
        # token
        "token",
        "auth_token",
        "access_token",
        "Bearer_Token",
        # secret
        "secret",
        "client_secret",
        "secret_value",
        # authorization
        "authorization",
        "Authorization",
        "x-authorization",
        "authorization_header",
        # credential
        "credential",
        "credential_id",
        "client_credential",
        # api[_-]?key
        "api_key",
        "api-key",
        "apiKey",
        "openai_api_key",
        "anthropic_api_key",
    ],
)
def test_parity_both_sides_agree_on_canonical_sensitive_keys(key):
    """The two sides MUST classify the same key the same way on the
    documented canonical shared surface (6 patterns). Drift here would
    mean one side scrubs a key the other passes through — a security
    bug caught here BEFORE divergence reaches production."""
    node_patterns = _load_node_patterns()
    py_patterns = _load_python_patterns()
    assert _matches_any(node_patterns, key) == _matches_any(py_patterns, key), (
        f"Parity drift on key {key!r}: "
        f"node_sensitive={_matches_any(node_patterns, key)}, "
        f"python_sensitive={_matches_any(py_patterns, key)}"
    )


@pytest.mark.parametrize(
    "key",
    [
        "service",
        "service.name",
        "trace_id",
        "span_id",
        "duration_ms",
        "http.method",
        "http.target",
        "http.route",
        "db.system",
        "level",
        "deployment.environment",
        "service.namespace",
        "operation.name",
    ],
)
def test_parity_both_sides_agree_on_benign_keys(key):
    """Reverse parity: keys that are clearly non-sensitive must pass
    through BOTH sides (otherwise legitimate observability attributes
    would be silently dropped from VictoriaLogs/VictoriaTraces)."""
    node_patterns = _load_node_patterns()
    py_patterns = _load_python_patterns()
    assert not _matches_any(node_patterns, key), f"Node side false-positive on {key!r}"
    assert not _matches_any(py_patterns, key), f"Python side false-positive on {key!r}"


def test_python_has_documented_python_only_extensions():
    """Documented asymmetry: the Python side carries additional patterns
    beyond the 6 canonical shared ones (session_id, user_id, etc.). This
    is INTENTIONAL — those shapes are OPEA-specific attributes that
    never reach the Node backend. If this test fails, someone removed
    a Python-only extension without updating this assertion; either
    re-add the pattern (preferred) or update the documented asymmetry
    list at the top of this file."""
    py_patterns = _load_python_patterns()
    sources = {p.pattern for p in py_patterns}
    python_only_extensions = {
        "session[_-]?id",
        "user[_-]?id",
        "conversation[_-]?id",
        "email",
        "user[_-]?query",
        "llm[_-]?response",
        "document[_-]?text",
        "cookie",
        "private[_-]?key",
    }
    missing = python_only_extensions - sources
    assert not missing, (
        f"Python side lost a documented extension: {missing}. "
        "Either re-add the pattern to tracing._PII_KEY_PATTERNS or "
        "update the KNOWN ASYMMETRY list at the top of this test file."
    )
