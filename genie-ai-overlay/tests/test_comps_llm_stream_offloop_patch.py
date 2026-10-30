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


@pytest.fixture
def unpatched_file(tmp_path):
    p = tmp_path / "orchestrator.py"
    # newline="" so the fixture is LF regardless of host OS.
    with p.open("w", encoding="utf-8", newline="") as handle:
        handle.write(FAKE_ORCHESTRATOR)
    return p


def _undo(raw: bytes) -> bytes:
    """Byte-exact inverse of the patch: remove the helper, rewind the rewrap.

    Any other change — a re-indent, a dropped line, a rewritten ending —
    breaks the equality with the original.
    """
    return raw.replace(mod.HELPER.encode("utf-8"), b"").replace(
        mod.WRAPPED_SITE.encode("utf-8"), b"response = requests.post("
    )


def test_patches_both_on_loop_calls(unpatched_file):
    assert mod.apply_patch(unpatched_file) == "patched"
    body = unpatched_file.read_text(encoding="utf-8")
    assert body.count(mod.WRAPPED_SITE) == 2, "both streaming call sites must be wrapped"
    assert mod.UNPATCHED_SITE not in body, "no streaming call site may stay on the loop"


def test_helper_awaits_to_thread_of_requests_post(unpatched_file):
    mod.apply_patch(unpatched_file)
    body = unpatched_file.read_text(encoding="utf-8")
    assert "return await asyncio.to_thread(requests.post" in body, (
        "the helper must dispatch requests.post through asyncio.to_thread"
    )


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


def test_patch_preserves_surrounding_source(unpatched_file):
    """Only the two call-site lines and the helper insertion may change."""
    before = unpatched_file.read_bytes()
    assert before.count(b"response = requests.post(") == 2
    mod.apply_patch(unpatched_file)
    after = unpatched_file.read_bytes()
    assert _undo(after) == before, "modulo the helper insertion and the two rewraps, byte-identical"


def test_is_idempotent(unpatched_file):
    mod.apply_patch(unpatched_file)
    assert mod.apply_patch(unpatched_file) == "already-patched"
    body = unpatched_file.read_text(encoding="utf-8")
    assert body.count(mod.WRAPPED_SITE) == 2


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


def test_guard_fails_on_commented_out_asyncio_import(tmp_path):
    """A commented-out `import asyncio` is not a binding: the substring guard
    would pass it, the helper would be inserted, and the image would die with
    NameError on the first streaming query. Only a column-0 import counts."""
    p = tmp_path / "orchestrator.py"
    commented = "# import asyncio  # moved elsewhere\n"
    p.write_text(FAKE_ORCHESTRATOR.replace("import asyncio\n", commented), encoding="utf-8")
    with pytest.raises(SystemExit, match="ASSERT-ON-PATCH GUARD FAILED"):
        mod.apply_patch(p)


def test_name_mention_alone_does_not_count_as_helper(tmp_path):
    """A file that merely mentions the helper's name must still get the def.

    The insertion skip and the post-write verifier are structural (a real
    `async def _llm_post_offloop(` line), not a substring check: a stray
    mention would otherwise suppress the insertion while the rewrap still
    replaces both call sites — an image that builds green and dies with
    NameError on the first streaming query.
    """
    p = tmp_path / "orchestrator.py"
    mention = "# see _llm_post_offloop discussion upstream\n"
    body = FAKE_ORCHESTRATOR.replace("import requests\n", "import requests\n" + mention, 1)
    p.write_text(body, encoding="utf-8")
    assert mod.apply_patch(p) == "patched"
    text = p.read_text(encoding="utf-8")
    assert mod.HELPER in text, "the helper def must be present despite the stray name mention"
    assert text.count(mod.WRAPPED_SITE) == 2


def test_guard_fails_on_commented_out_call_site(tmp_path):
    """A commented-out call line matches the substring anchor but cannot be
    rewrapped: the guard must refuse with its diagnostic instead of crashing
    with an unhandled TypeError."""
    p = tmp_path / "orchestrator.py"
    body = FAKE_ORCHESTRATOR.replace(
        "        else:\n                    response = requests.post(",
        "        else:\n                    # response = requests.post(  # disabled upstream",
    )
    p.write_text(body, encoding="utf-8")
    with pytest.raises(SystemExit, match="ASSERT-ON-PATCH GUARD FAILED"):
        mod.apply_patch(p)


def test_guard_fails_on_missing_file(tmp_path):
    with pytest.raises(SystemExit, match="ASSERT-ON-PATCH GUARD FAILED"):
        mod.apply_patch(tmp_path / "nope.py")


def test_guard_fails_on_commented_out_requests_import(tmp_path):
    """The helper dereferences module-level `requests` too, so the import
    guard is symmetric: a commented-out `import requests` must refuse the
    patch just like a commented-out `import asyncio`."""
    p = tmp_path / "orchestrator.py"
    commented = "# import requests  # moved elsewhere\n"
    p.write_text(FAKE_ORCHESTRATOR.replace("import requests\n", commented), encoding="utf-8")
    with pytest.raises(SystemExit, match="ASSERT-ON-PATCH GUARD FAILED"):
        mod.apply_patch(p)


def test_guard_fails_on_import_inside_a_string_literal(tmp_path):
    """A column-0 `import asyncio` inside a module docstring is not a binding
    and cannot anchor the helper insertion: a line-shaped regex would match
    it, insert HELPER as string content, compile green, and ship an image
    with no live helper. Only a real module-level import statement counts."""
    p = tmp_path / "orchestrator.py"
    docstring = '"""Module docstring.\n\nimport asyncio\nimport requests\n"""\n'
    body = FAKE_ORCHESTRATOR.replace("import asyncio\n", "", 1).replace("import requests\n", "", 1)
    p.write_text(docstring + body, encoding="utf-8")
    with pytest.raises(SystemExit, match="ASSERT-ON-PATCH GUARD FAILED"):
        mod.apply_patch(p)


def test_guard_fails_when_helper_present_but_no_wrapped_sites(tmp_path):
    """A file carrying the helper def but no wrapped call sites is a mangled
    half-patch: it must abort, not pass the already-patched shortcut."""
    p = tmp_path / "orchestrator.py"
    body = FAKE_ORCHESTRATOR.replace("response = requests.post(", "response = upstream_post(")
    p.write_text(body + mod.HELPER, encoding="utf-8")
    with pytest.raises(SystemExit, match="ASSERT-ON-PATCH GUARD FAILED"):
        mod.apply_patch(p)


def test_orchestrator_path_uses_argv_override(monkeypatch):
    """The Dockerfile's test override and this suite rely on argv[1] routing
    the patcher at an arbitrary copy of the file."""
    monkeypatch.setattr(sys, "argv", ["comps_llm_stream_offloop_patch.py", "/somewhere/else/orchestrator.py"])
    assert mod.orchestrator_path() == Path("/somewhere/else/orchestrator.py")


def test_patched_output_is_valid_python(unpatched_file):
    mod.apply_patch(unpatched_file)
    compile(unpatched_file.read_text(encoding="utf-8"), str(unpatched_file), "exec")


def test_patch_preserves_line_endings(tmp_path):
    """A multi-line patch must not rewrite the file's line endings.

    The real orchestrator.py is LF in the v1.5 tag, but the guard must stay
    ending-agnostic: newline="" passes bytes through, so a CRLF file stays
    CRLF — including the two wrapped lines' own terminators, asserted
    directly: a rewrap that dropped the CR would otherwise pass unnoticed.
    """
    p = tmp_path / "orchestrator.py"
    original = FAKE_ORCHESTRATOR.replace("\n", "\r\n").encode("utf-8")
    p.write_bytes(original)
    assert mod.apply_patch(p) == "patched"
    raw = p.read_bytes()
    assert b"\r\n" in raw, "fixture should be CRLF"
    assert raw.count(mod.WRAPPED_SITE.encode("utf-8") + b"\r\n") == 2, "wrapped lines keep their CRLF terminator"
    assert _undo(raw) == original, "modulo the helper insertion and the two rewraps, byte-identical (CRLF intact)"
