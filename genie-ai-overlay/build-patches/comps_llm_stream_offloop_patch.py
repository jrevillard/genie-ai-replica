# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
#
# OVERRIDE build-patches.comps_llm_stream_offloop_patch | disposition: still-needed | reason: comps v1.5 orchestrator runs the streaming LLM POST synchronously on the uvicorn event loop, pinning it until vLLM returns first headers (60-90 s on a shared GPU), so /health cannot answer and the HTTP liveness probe killed the pod mid-stream (exit 137, measured 2026-10-25) | test: tests/test_comps_llm_stream_offloop_patch.py  # noqa: E501

"""comps_llm_stream_offloop_patch.py — take the streaming LLM POST off the
event loop in the vendored comps orchestrator.

THE DEFECT (measured 2026-10-25, k8s dev cluster; reproduced 2026-10-30)
------------------------------------------------------------------------
comps v1.5 ``cores/mega/orchestrator.py`` — ``ServiceOrchestrator.execute()``,
streaming branch — calls ``requests.post(..., stream=True, timeout=2000)``
synchronously, on the event loop thread. Until the LLM returns its first
response headers (60-90 s on the shared GPU), the loop cannot read any
socket: ``/health`` — registered by comps' ``HttpService`` as ``async def`` —
cannot run, and the HTTP liveness probe killed the pod mid-stream (exit 137).
The chart moved liveness to an exec probe (``kill -0 1``) as a stopgap, which
never punishes a busy loop but also never catches a python-level deadlock.

Reproduced with a three-arm uvicorn harness (loop pinned by a black-hole
upstream): ``/health`` times out with an ``async def`` handler AND with a
threadpool ``def`` handler — with the loop thread pinned, no handler
placement helps, because the loop never reads the request bytes. Only moving
the blocking call itself off the loop (``await asyncio.to_thread``) restored
availability: ``/health`` answered in 0.00-0.04 s throughout the block.

WHY THE CALL SITES, NOT THE HANDLER
-----------------------------------
The two ``response = requests.post(`` sites (``if access_token`` / ``else``)
are the only unbounded on-loop blocks in the chatqna query path: retrieval,
reranking and the non-streaming LLM branch are aiohttp-async; generation
already streams through ``StreamingResponse``'s threadpool; the tokenize and
model-discovery probes are bounded by their own 10 s budget. The two
``res = requests.post(`` sites inside the ``generate()`` generator already
run off-loop (sync generator iterated by the threadpool) and MUST stay sync —
the patch anchors on ``response = `` precisely so it cannot touch them.

A module-level helper (``await asyncio.to_thread(requests.post, ...)``) keeps
the edit shape-preserving: each call site keeps its argument list and closing
paren, so the substitution is two one-line replacements plus the helper.

THREE OUTCOMES, NEVER A SILENT NO-OP
------------------------------------
1. unpatched  -> insert helper, wrap both sites, then RE-READ and verify the
   on-disk post-state
2. already wrapped -> idempotent no-op, exit 0
3. neither     -> ``SystemExit`` so the IMAGE BUILD FAILS LOUDLY rather than
   shipping an image with the loop still pinned

An upstream restructure (the call renamed, one site removed, ``import
asyncio`` dropped) trips the guard: the helper needs ``asyncio``, and a
one-site wrap would leave the other on the loop.
"""

import re
import sys
from pathlib import Path

# The exact call-site shape in the vendored v1.5 orchestrator: both streaming
# branches open identically (20-space indent, ``response = requests.post(``).
# Matching on CONTENT while preserving the file's own indentation is
# reflow-tolerant; anchoring on ``response = `` (not bare ``requests.post``)
# keeps the sync generator's ``res = requests.post(`` sites untouched.
UNPATCHED_SITE = "response = requests.post("
WRAPPED_SITE = "response = await _llm_post_offloop("

# The helper is inserted after the last import of the module's import block,
# so both names it needs (asyncio, requests) are bound before any call site
# can reference it — and the function does not split the import block.
IMPORT_LINE = re.compile(r"^(?:import|from)[ \t]+\S")

# Structural anchors, not substrings: a mention of the helper's name in a
# comment (or a commented-out `import asyncio`) must neither suppress the
# insertion nor pass the import guard — a substring check would ship an image
# that builds green and dies with NameError on the first streaming query.
HELPER_DEF = re.compile(r"^async def _llm_post_offloop\(", re.MULTILINE)
REQUIRED_IMPORT_RE = re.compile(r"^import asyncio\b", re.MULTILINE)

HELPER = """

async def _llm_post_offloop(*args, **kwargs):
    # GENIE OVERRIDE: the streaming LLM POST blocks until the model returns
    # its first response headers. Run it off the event loop so /health and
    # every other request stay servable during a query.
    return await asyncio.to_thread(requests.post, *args, **kwargs)
"""


def orchestrator_path() -> Path:
    """Resolve the vendored orchestrator inside the image layout.

    /home/user/comps is the copy Python actually imports (PYTHONPATH puts
    /home/user ahead of the editable-install path). argv[1] overrides it for
    tests.
    """
    if len(sys.argv) > 1:
        return Path(sys.argv[1])
    return Path("/home/user/comps/cores/mega/orchestrator.py")


def _read(path: Path) -> str:
    """Read WITHOUT newline translation (see unstructured_html_pi_patch.py)."""
    with path.open("r", encoding="utf-8", newline="") as handle:
        return handle.read()


def _write(path: Path, text: str) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        handle.write(text)


def _rewrap_line(line: str) -> str | None:
    """Rewrap one call-site opening line, preserving indent and line ending."""
    stripped = line.lstrip(" \t")
    if not stripped.startswith(UNPATCHED_SITE):
        return None
    indent = line[: len(line) - len(stripped)]
    eol = stripped[len(UNPATCHED_SITE) :]
    return f"{indent}{WRAPPED_SITE}{eol}"


def apply_patch(path: Path) -> str:
    """Patch, verify idempotently, or fail loudly. Returns a short outcome label."""
    if not path.is_file():
        raise SystemExit(f"ASSERT-ON-PATCH GUARD FAILED: {path} does not exist")

    original = _read(path)

    sites = [i for i, line in enumerate(original.splitlines(keepends=True)) if UNPATCHED_SITE in line]
    if not sites:
        if WRAPPED_SITE in original and helper_present(original):
            return "already-patched"
        raise SystemExit(
            f"ASSERT-ON-PATCH GUARD FAILED: {path} carries neither the expected unpatched streaming "
            f"call ({UNPATCHED_SITE!r}) nor the wrapped form — upstream restructured the comps "
            "orchestrator; re-derive the patch and update genie-ai-overlay/OVERRIDES.yaml."
        )
    if len(sites) != 2:
        raise SystemExit(
            f"ASSERT-ON-PATCH GUARD FAILED: expected exactly 2 streaming call sites in {path}, "
            f"found {len(sites)} — wrapping a different number would leave a call on the loop or "
            "touch something the anchor was never meant to match; re-derive the patch."
        )
    if not REQUIRED_IMPORT_RE.search(original):
        raise SystemExit(
            f"ASSERT-ON-PATCH GUARD FAILED: {path} has no column-0 'import asyncio' — the off-loop "
            "helper awaits asyncio.to_thread and the image would die at import time; re-derive the patch."
        )

    lines = original.splitlines(keepends=True)
    for i in sites:
        rewrapped = _rewrap_line(lines[i])
        if rewrapped is None:
            raise SystemExit(
                f"ASSERT-ON-PATCH GUARD FAILED: line {i + 1} of {path} matches the streaming-call "
                f"anchor but is not a plain call site (commented out, or inside a string) — the patch "
                "cannot rewrap it safely; re-derive the patch."
            )
        lines[i] = rewrapped

    # Insert the helper after the module's import block. If no import line
    # matches, the module changed too much to guess — the asyncio guard above
    # covers the missing-dependency case, this one covers the mangled layout.
    import_lines = [i for i, line in enumerate(lines) if IMPORT_LINE.match(line)]
    if not import_lines:
        raise SystemExit(
            f"ASSERT-ON-PATCH GUARD FAILED: {path} has no import block — cannot place the off-loop "
            "helper; re-derive the patch."
        )
    if not HELPER_DEF.search(original):
        lines.insert(import_lines[-1] + 1, HELPER)

    patched = "".join(lines)

    # Compile the edited source BEFORE writing it, so a botched edit can
    # never reach disk.
    compile(patched, str(path), "exec")
    _write(path, patched)

    # Re-read: the file on disk is the artefact that ships, so verify THAT.
    post = _read(path)
    if WRAPPED_SITE not in post or UNPATCHED_SITE in post or not helper_present(post):
        raise SystemExit(f"ASSERT-ON-PATCH GUARD FAILED: post-write verification failed for {path}")
    return "patched"


def helper_present(body: str) -> bool:
    """Whether the file defines the helper — structurally, by its def line.

    A substring check would count any mention of the name (a comment, the
    wrapped call sites themselves) and let a helper-less wrap ship.
    """
    return bool(HELPER_DEF.search(body))


def main() -> int:
    path = orchestrator_path()
    outcome = apply_patch(path)
    print(f"comps_llm_stream_offloop_patch: {outcome} {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
