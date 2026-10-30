# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""
Tests for build-patches/comps_llm_stream_offloop_patch.py.

The patch exists because the vendored comps v1.5 orchestrator runs the
streaming LLM POST synchronously on the uvicorn event loop
(``cores/mega/orchestrator.py``, ``execute()``, streaming branch): until the
LLM returns its first response headers the loop thread is pinned, uvicorn
cannot read any socket, and ``/health`` — served by comps as ``async def`` —
cannot run. Measured 2026-10-25 on the k8s dev cluster: the HTTP liveness
probe killed the pod mid-stream (exit 137). Re-produced 2026-10-30 with a
three-arm uvicorn repro: with the loop pinned, ``/health`` times out whether
its handler is ``async def`` or a threadpool ``def`` — only moving the
blocking call off the loop restores availability.

NON-VACUITY. The guard tests below are the load-bearing ones: they prove the
build FAILS when the patch cannot be applied, rather than shipping an image
with the loop still pinned. A patcher that silently no-ops is worse than no
patcher, because the image builds and the bug ships.
"""

import ast
import importlib.util
import sys
from pathlib import Path

import pytest

PATCHER = Path(__file__).resolve().parents[1] / "build-patches" / "comps_llm_stream_offloop_patch.py"


def _load_module():
    """Load the patcher by path — it lives outside the package tree."""
    spec = importlib.util.spec_from_file_location("comps_llm_stream_offloop_patch", PATCHER)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


mod = _load_module()

UNPATCHED_CALL = "response = requests.post(\n"

# A minimal but SYNTACTICALLY VALID stand-in for the real orchestrator module.
# Shapes mirror the vendored comps v1.5 file exactly: ``import asyncio`` and
# ``import requests`` at column 0, the two on-loop call sites at 20-space
# indent inside ``execute()``'s streaming branch, and the two ``res =
# requests.post(`` sites at 40-space indent inside the ``generate()``
# generator — those run in StreamingResponse's threadpool and MUST stay sync.
FAKE_ORCHESTRATOR = (
    "import asyncio\n"
    "import json\n"
    "import aiohttp\n"
    "import requests\n"
    "\n"
    "\n"
    "async def execute(self, session, cur_node, inputs, stream=True):\n"
    "    if stream:\n"
    "        if True:\n"
    "                    response = requests.post(\n"
    "                        url=endpoint,\n"
    "                        data=json.dumps(inputs),\n"
    "                        headers={'Content-type': 'application/json'},\n"
    "                        proxies={'http': None},\n"
    "                        stream=True,\n"
    "                        timeout=2000,\n"
    "                    )\n"
    "        else:\n"
    "                    response = requests.post(\n"
    "                        url=endpoint,\n"
    "                        data=json.dumps(inputs),\n"
    "                        headers={'Content-type': 'application/json'},\n"
    "                        proxies={'http': None},\n"
    "                        stream=True,\n"
    "                        timeout=2000,\n"
    "                    )\n"
    "\n"
    "        def generate():\n"
    "            for chunk in response.iter_content(chunk_size=None):\n"
    "                if chunk:\n"
    "                    res = requests.post(\n"
    "                        url=downstream,\n"
    "                        data=json.dumps({'text': chunk}),\n"
    "                        timeout=2000,\n"
    "                    )\n"
    "                    yield res.json()\n"
    "        return generate()\n"
    "    return None\n"
)


def helper_present(body: str) -> bool:
    """Assert the off-loop helper exists and awaits to_thread(requests.post).

    Checking for the helper's name alone would pass if the name landed
    anywhere; parsing the module and inspecting the function makes the
    structural claim real: an ASYNC function whose body awaits to_thread with
    requests.post as the called callable.
    """
    tree = ast.parse(body)
    for node in ast.walk(tree):
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "_llm_post_offloop":
            for child in ast.walk(node):
                if (
                    isinstance(child, ast.Await)
                    and isinstance(child.value, ast.Call)
                    and isinstance(child.value.func, ast.Attribute)
                    and child.value.func.attr == "to_thread"
                    and child.value.args
                    and isinstance(child.value.args[0], ast.Attribute)
                    and child.value.args[0].attr == "post"
                ):
                    return True
    return False


def on_loop_call_count(body: str) -> int:
    """Count the streaming-branch call sites still calling requests.post directly."""
    return sum(1 for line in body.splitlines() if line.strip().startswith("response = requests.post("))


def wrapped_call_count(body: str) -> int:
    return sum(1 for line in body.splitlines() if line.strip().startswith("response = await _llm_post_offloop("))


@pytest.fixture
def unpatched_file(tmp_path):
    p = tmp_path / "orchestrator.py"
    # newline="" so the fixture is LF regardless of host OS.
    with p.open("w", encoding="utf-8", newline="") as handle:
        handle.write(FAKE_ORCHESTRATOR)
    return p


def test_patches_both_on_loop_calls(unpatched_file):
    assert mod.apply_patch(unpatched_file) == "patched"
    body = unpatched_file.read_text(encoding="utf-8")
    assert wrapped_call_count(body) == 2, "both streaming call sites must be wrapped"
    assert on_loop_call_count(body) == 0, "no streaming call site may stay on the loop"


def test_helper_awaits_to_thread_of_requests_post(unpatched_file):
    mod.apply_patch(unpatched_file)
    body = unpatched_file.read_text(encoding="utf-8")
    assert helper_present(body), "the helper must be an async def awaiting to_thread(requests.post, ...)"


def test_generator_call_sites_stay_sync(unpatched_file):
    """The res = requests.post( sites inside generate() run off-loop already.

    Wrapping them would be pointless (they execute in StreamingResponse's
    threadpool) — and a patcher loose enough to touch them proves it anchors
    on the wrong shape.
    """
    mod.apply_patch(unpatched_file)
    body = unpatched_file.read_text(encoding="utf-8")
    assert "res = requests.post(" in body, "generator call sites must stay untouched"
    assert "res = await" not in body, "generate() is a sync generator; it cannot await"


def _normalize(lines):
    """Strip the patch's additions and undo the rewrap, line by line.

    Drops blank lines, comment lines and the inserted helper (its def line and
    its return line); rewraps the call sites back to the upstream shape. What
    remains must equal the original — proving nothing else changed.
    """
    out = []
    for line in lines:
        stripped = line.strip()
        if stripped == "" or stripped.startswith("#"):
            continue
        if stripped.startswith("async def _llm_post_offloop") or stripped.startswith("return await asyncio.to_thread("):
            continue
        out.append(stripped.replace("response = await _llm_post_offloop(", "response = requests.post("))
    return out


def test_patch_preserves_surrounding_source(unpatched_file):
    """Only the two call-site lines and the helper insertion may change."""
    before = unpatched_file.read_text(encoding="utf-8")
    mod.apply_patch(unpatched_file)
    after = unpatched_file.read_text(encoding="utf-8")
    assert _normalize(before.splitlines()) == _normalize(after.splitlines())


def test_is_idempotent(unpatched_file):
    mod.apply_patch(unpatched_file)
    assert mod.apply_patch(unpatched_file) == "already-patched"
    body = unpatched_file.read_text(encoding="utf-8")
    assert wrapped_call_count(body) == 2


def test_guard_fails_when_only_one_site_matches(tmp_path):
    """An upstream file with one call site restructured is not guessable."""
    p = tmp_path / "orchestrator.py"
    body = FAKE_ORCHESTRATOR.replace(
        "        else:\n                    response = requests.post(",
        "        else:\n                    response = _upstream_wrapped_post(",
    )
    p.write_text(body, encoding="utf-8")
    with pytest.raises(SystemExit, match="ASSERT-ON-PATCH GUARD FAILED"):
        mod.apply_patch(p)


def test_guard_fails_when_upstream_restructures(tmp_path):
    """THE LOAD-BEARING TEST.

    An orchestrator.py whose streaming call we do not recognise must abort
    the BUILD. Without this, the patcher would no-op and ship an image with
    the loop still pinned.
    """
    p = tmp_path / "orchestrator.py"
    p.write_text(FAKE_ORCHESTRATOR.replace("response = requests.post(", "response = session_post("), encoding="utf-8")
    with pytest.raises(SystemExit, match="ASSERT-ON-PATCH GUARD FAILED"):
        mod.apply_patch(p)


def test_guard_fails_without_asyncio_import(tmp_path):
    """The helper awaits asyncio.to_thread; a module without the import would
    ship an image that dies at import time — refuse to patch instead."""
    p = tmp_path / "orchestrator.py"
    p.write_text(FAKE_ORCHESTRATOR.replace("import asyncio\n", ""), encoding="utf-8")
    with pytest.raises(SystemExit, match="ASSERT-ON-PATCH GUARD FAILED"):
        mod.apply_patch(p)


def test_guard_fails_on_missing_file(tmp_path):
    with pytest.raises(SystemExit, match="ASSERT-ON-PATCH GUARD FAILED"):
        mod.apply_patch(tmp_path / "nope.py")


def test_patched_output_is_valid_python(unpatched_file):
    mod.apply_patch(unpatched_file)
    compile(unpatched_file.read_text(encoding="utf-8"), str(unpatched_file), "exec")


def test_patch_preserves_line_endings(tmp_path):
    """A multi-line patch must not rewrite the file's line endings.

    The real orchestrator.py is LF in the v1.5 tag, but the guard must stay
    ending-agnostic: newline="" passes bytes through, so a CRLF file stays
    CRLF apart from the wrapped lines (which keep their own original
    terminator).
    """
    p = tmp_path / "orchestrator.py"
    original = FAKE_ORCHESTRATOR.replace("\n", "\r\n").encode("utf-8")
    p.write_bytes(original)
    assert mod.apply_patch(p) == "patched"
    raw = p.read_bytes()
    assert b"\r\n" in raw, "fixture should be CRLF"
    assert b"response = await _llm_post_offloop(" in raw, "the patch must have been applied"
    undone = raw.replace(b"response = await _llm_post_offloop(", b"response = requests.post(")
    assert _normalize(undone.decode("utf-8").splitlines()) == _normalize(original.decode("utf-8").splitlines()), (
        "only the call-site lines may change; endings stay CRLF"
    )
