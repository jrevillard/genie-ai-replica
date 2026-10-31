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

import ast
import sys
from pathlib import Path

# The exact call-site shape in the vendored v1.5 orchestrator: both streaming
# branches open identically (20-space indent, ``response = requests.post(``).
# Matching on CONTENT while preserving the file's own indentation is
# reflow-tolerant; anchoring on ``response = `` (not bare ``requests.post``)
# keeps the sync generator's ``res = requests.post(`` sites untouched.
UNPATCHED_SITE = "response = requests.post("
WRAPPED_SITE = "response = await _llm_post_offloop("

# Names the inserted helper dereferences at call time; both must be bound by
# real module-level import statements (see _module_imports).
REQUIRED_IMPORTS = ("asyncio", "requests")

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


def _split_source_lines(source: str) -> list[str]:
    """Split for line-index math that agrees with ast line numbers: \\n
    boundaries only (str.splitlines also breaks on form feeds, \\x85 and
    Unicode line separators, which ast does not count as lines). Joining the
    result reproduces the source byte for byte."""
    parts = source.split("\n")
    return [part + "\n" for part in parts[:-1]] + ([parts[-1]] if parts[-1] else [])


def _module_imports(source: str) -> tuple[set[str], int]:
    """Top-level names bound by real ``import`` statements, and the line index
    after the module's last import statement of any kind.

    Parsed, not regexed: a column-0 ``import asyncio`` inside a docstring is
    string content, not a binding, and anchoring the helper insertion there
    would make it inert. Only statements at ``tree.body`` level count, so an
    import guarded by ``if TYPE_CHECKING:`` or a commented-out line binds
    nothing. ``from X import Y`` positions the insertion (it belongs to the
    import block) but binds only ``Y`` — the helper needs the modules
    themselves, so bindings come from plain ``import`` statements alone.
    """
    tree = ast.parse(source)
    bindings: set[str] = set()
    last_import_end = 0
    for node in tree.body:
        if isinstance(node, ast.Import):
            # The helper dereferences the module names themselves, so only
            # the BOUND name counts: `import asyncio as aio` binds `aio`.
            bindings.update(alias.asname or alias.name.split(".")[0] for alias in node.names)
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            last_import_end = max(last_import_end, node.end_lineno)
    return bindings, last_import_end


def _requests_post_assignments(source: str, target_name: str) -> list[int]:
    """1-based line numbers of ``<target_name> = requests.post(...)``
    assignments, parsed not regexed.

    One definition of the vendored call-site shape for both consumers: the
    streaming sites assign to ``response`` (the exactly-2 guard), the
    generator sites to ``res`` (the stay-untouched contract). A line that
    merely LOOKS like the call (string content, a comment) is not an
    assignment and never counts; prose cannot inflate any count.
    """
    tree = ast.parse(source)
    out = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Assign)
            and isinstance(node.value, ast.Call)
            and isinstance(node.value.func, ast.Attribute)
            and node.value.func.attr == "post"
            and isinstance(node.value.func.value, ast.Name)
            and node.value.func.value.id == "requests"
            and any(isinstance(t, ast.Name) and t.id == target_name for t in node.targets)
        ):
            out.append(node.lineno)
    return sorted(out)


def _streaming_site_lines(source: str) -> list[int]:
    """The streaming call sites: requests.post assigned to ``response``."""
    return _requests_post_assignments(source, "response")


def apply_patch(path: Path) -> str:
    """Patch, verify idempotently, or fail loudly. Returns a short outcome label."""
    if not path.is_file():
        raise SystemExit(f"ASSERT-ON-PATCH GUARD FAILED: {path} does not exist")

    try:
        original = _read(path)
        ast.parse(original)
    except UnicodeDecodeError as exc:
        raise SystemExit(
            f"ASSERT-ON-PATCH GUARD FAILED: {path} is not UTF-8 text ({exc}) — "
            "the image layout resolved the orchestrator path to something else; re-derive the patch."
        ) from exc
    except ValueError as exc:
        # Python 3.11 (the build image) parses a NUL byte as ValueError,
        # where 3.12+ raises the SyntaxError arm above - same layout-shift class.
        raise SystemExit(
            f"ASSERT-ON-PATCH GUARD FAILED: {path} is not parseable Python ({exc}) — "
            "the image layout resolved the orchestrator path to something else; re-derive the patch."
        ) from exc
    except SyntaxError as exc:
        raise SystemExit(
            f"ASSERT-ON-PATCH GUARD FAILED: {path} is not valid Python ({exc.lineno}: {exc.msg}) — "
            "the image layout resolved the orchestrator path to something else; re-derive the patch."
        ) from exc
    lines = _split_source_lines(original)

    # The AST is the site detector; _rewrap_line only rewraps the detected
    # line while preserving its indent and line ending. A detected site whose
    # line no longer carries the expected opening shape means upstream
    # reformatted the call — the count falls below 2 and the guard fires.
    # The import bindings are verified on BOTH paths: an already-patched
    # file whose import block was refactored away dies at the first
    # streaming query exactly like an unpatched one would.
    bindings, last_import_line = _module_imports(original)
    missing = [name for name in REQUIRED_IMPORTS if name not in bindings]
    if missing:
        raise SystemExit(
            f"ASSERT-ON-PATCH GUARD FAILED: {path} has no module-level import binding "
            f"{', '.join(missing)} — the off-loop helper dereferences it, and the image would die "
            "with NameError at the first streaming query; re-derive the patch."
        )

    ast_sites = _streaming_site_lines(original)
    if len(set(ast_sites)) != len(ast_sites):
        raise SystemExit(
            f"ASSERT-ON-PATCH GUARD FAILED: {path} has multiple streaming call sites sharing one "
            "physical line — a one-line rewrap would silently drop the second site; re-derive the "
            "patch."
        )
    sites = []
    for lineno in ast_sites:
        if lineno - 1 >= len(lines):
            raise SystemExit(
                f"ASSERT-ON-PATCH GUARD FAILED: {path} uses lone-\r (classic-Mac) line endings — "
                "the tokenizer counts them as lines but the patcher's index math cannot; re-derive "
                "the patch."
            )
        rewrapped = _rewrap_line(lines[lineno - 1])
        if rewrapped is None:
            raise SystemExit(
                f"ASSERT-ON-PATCH GUARD FAILED: line {lineno} of {path} carries a streaming call "
                "the patcher cannot rewrap (unexpected shape at the detected site) — re-derive the "
                "patch."
            )
        sites.append((lineno - 1, rewrapped))
    if not sites:
        if len(_wrapped_site_lines(original)) == 2 and helper_present(original):
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

    for i, rewrapped in sites:
        lines[i] = rewrapped

    # Insert the helper after the module's last import statement, so both
    # names it needs are bound before any call site can reference it — and
    # the function does not split the import block. The helper's own line
    # endings follow the file's, so a CRLF file stays uniformly CRLF.
    if not helper_present(original):
        crlf = original.count("\r\n")
        lf = original.count("\n") - crlf
        helper = HELPER.replace("\n", "\r\n") if crlf > lf else HELPER
        lines.insert(last_import_line, helper)

    patched = "".join(lines)

    # Verify the EDITED SOURCE before anything reaches disk: valid Python,
    # exactly 2 wrapped sites, no live requests.post site left, one helper.
    # A guard failure therefore leaves the original file untouched.
    try:
        compile(patched, str(path), "exec")
    except (SyntaxError, ValueError) as exc:
        # The rewrap injects `await`; if upstream moved the sites into a sync
        # def, that injection is invalid and the build must say so in the
        # guard's voice, not with a raw traceback. ValueError covers a null
        # byte reaching compile(), the same class of layout-shift content.
        raise SystemExit(
            f"ASSERT-ON-PATCH GUARD FAILED: the rewrapped {path} does not compile "
            f"({exc}) — the streaming sites moved out of their async context or the "
            "source carries content compile() cannot process; re-derive the patch."
        ) from exc
    if len(_wrapped_site_lines(patched)) != 2 or _streaming_site_lines(patched) or not helper_present(patched):
        raise SystemExit(f"ASSERT-ON-PATCH GUARD FAILED: post-patch verification failed for {path}")
    _write(path, patched)

    # Re-read: the file on disk is the artefact that ships, so confirm the
    # write landed byte for byte what was verified.
    if _read(path) != patched:
        raise SystemExit(f"ASSERT-ON-PATCH GUARD FAILED: post-write verification failed for {path}")
    return "patched"


def _wrapped_site_lines(source: str) -> list[int]:
    """1-based line numbers of the wrapped call sites — the AST mirror of
    ``_streaming_site_lines``: prose cannot impersonate an assignment, in
    either direction (a comment naming the wrapped call is not a site, and a
    real wrapped site in a reshaped file still counts)."""
    tree = ast.parse(source)
    out = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        # The wrapped site IS awaited: a bare call assigns a coroutine object,
        # which is the broken shape the patch exists to prevent, not a patch.
        if (
            isinstance(node.value, ast.Await)
            and isinstance(node.value.value, ast.Call)
            and isinstance(node.value.value.func, ast.Name)
            and node.value.value.func.id == "_llm_post_offloop"
            and any(isinstance(t, ast.Name) and t.id == "response" for t in node.targets)
        ):
            out.append(node.lineno)
    return sorted(out)


def helper_present(source: str) -> bool:
    """Whether the file defines the helper — a live MODULE-LEVEL async def
    whose body dispatches through ``asyncio.to_thread(requests.post, ...)``.

    ast.walk would also accept a nested same-named def, but the call sites
    resolve the name in module scope: only a statement in ``tree.body``
    binds it there. The body check keeps a mangled helper — def kept, sync
    ``requests.post`` call restored — from passing idempotency as a no-op.
    """
    tree = ast.parse(source)
    for node in tree.body:
        if not (isinstance(node, ast.AsyncFunctionDef) and node.name == "_llm_post_offloop"):
            continue
        # The helper's OWN body only: ast.walk would descend into a nested
        # inner def, so a mangled outer body with the real dispatch buried
        # inside one could pass while the outer call runs sync on the loop.
        stack = list(ast.iter_child_nodes(node))
        while stack:
            child = stack.pop()
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)):
                continue
            if (
                isinstance(child, ast.Await)
                and isinstance(child.value, ast.Call)
                and isinstance(child.value.func, ast.Attribute)
                and child.value.func.attr == "to_thread"
                and isinstance(child.value.func.value, ast.Name)
                and child.value.func.value.id == "asyncio"
                and child.value.args
                and isinstance(child.value.args[0], ast.Attribute)
                and child.value.args[0].attr == "post"
                and isinstance(child.value.args[0].value, ast.Name)
                and child.value.args[0].value.id == "requests"
            ):
                return True
            stack.extend(ast.iter_child_nodes(child))
    return False


def main() -> int:
    path = orchestrator_path()
    outcome = apply_patch(path)
    print(f"comps_llm_stream_offloop_patch: {outcome} {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
