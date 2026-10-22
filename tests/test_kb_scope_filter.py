# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""
Tests for Knowledge Set scoping of retrieval in the ChatQnA orchestrator.

A Twin's Knowledge Set (`aiTwins.linkedKbFileIds`) is an operator statement that
the Twin may answer only from those documents. Retrieval is still global — there
is no file_id filter in the retriever AQL — so the orchestrator post-filters the
retrieved documents, and that filter is the only thing standing between a
Hypertension Twin and a solar-flare document.

Covered here:

  1. parsing the allow-list off the request context, including the distinction
     between "no Knowledge Set" (do not scope) and "scope to nothing"
  2. the allow-list surviving `strip_non_retrieval_keys`, which drops any key
     not named in it and would otherwise discard the scope silently
  3. the filter at the retriever output: in-scope kept, out-of-scope dropped,
     unattributed dropped, and filtering-to-empty handing off to abstention

The heavy OPEA / FastAPI / transformers dependencies are stubbed by reusing the
harness in test_strict_grounding, so this runs with no installed dependencies:

    python3 -m unittest tests.test_kb_scope_filter -v
"""

import importlib.util
import os
import unittest

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Loading the sibling test module installs the import stubs and puts the chatqna
# directory on sys.path, so the orchestrator it exposes as `gc` is the real one.
_spec = importlib.util.spec_from_file_location(
    "_kb_scope_harness", os.path.join(_REPO_ROOT, "tests", "test_strict_grounding.py")
)
_harness = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_harness)

gc = _harness.gc

import context_auto_router  # noqa: E402  (import stubs must be installed first)


class _FakeService:
    def __init__(self, service_type):
        self.service_type = service_type


class _FakeSelf:
    """Stand-in for the megaservice, which align_outputs only reads services off."""

    def __init__(self, cur_node, service_type):
        self.services = {cur_node: _FakeService(service_type)}


class _FakeRuntimeGraph:
    """Minimal ServiceOrchestrator graph: enough to answer downstream() and record edits."""

    def __init__(self, downstream_of_retriever):
        self._downstream = {"retriever": list(downstream_of_retriever), "rerank/0": ["llm/0"]}
        self.deleted = []
        self.added_edges = []

    def downstream(self, node):
        return self._downstream.get(node, [])

    def add_edge(self, src, dst):
        self.added_edges.append((src, dst))

    def delete_node_if_exists(self, node):
        self.deleted.append(node)


def _retriever_output(docs_and_files, query="what should I do about high blood pressure?"):
    """
    Build a retriever payload in RETRIEVER_SEARCH_START='chunk' shape — the
    deployed default, where file ids map one-to-one onto retrieved documents in
    order. The orchestrator asserts that 1:1 relationship, so the metadata here
    is positional rather than keyed.
    """
    return {
        "initial_query": query,
        "retrieved_docs": [{"id": doc_id, "text": text} for doc_id, text, _ in docs_and_files],
        "metadata": [{"file_ids": [file_id]} for _, _, file_id in docs_and_files],
    }


def _run_retriever_output(data, context, downstream=("rerank/0",)):
    graph = _FakeRuntimeGraph(downstream)
    inputs = {"context": context} if context is not None else {}
    next_data = gc.align_outputs(
        _FakeSelf("retriever", gc.ServiceType.RETRIEVER),
        data,
        "retriever",
        inputs,
        graph,
        {},
    )
    return next_data, graph


# Three documents: two from the Twin's Knowledge Set, one from outside it.
_MIXED_DOCS = (
    ("doc-1", "Hypertension is managed with diet and medication.", "file-bp"),
    ("doc-2", "Solar flares disrupt radio communication.", "file-solar"),
    ("doc-3", "Reduce salt intake to lower blood pressure.", "file-salt"),
)


class KbScopeParsing(unittest.TestCase):
    """The allow-list must only ever narrow retrieval when it is genuinely set."""

    def test_absent_context_means_unscoped(self):
        for context in (None, {}, "not-a-dict", 42):
            self.assertEqual(
                gc.kb_scope_from_context(context),
                set(),
                f"expected no scope for context {context!r}",
            )

    def test_empty_list_means_unscoped_not_scope_to_nothing(self):
        # A Twin with no Knowledge Set must keep answering, not abstain on
        # everything, so an empty list has to read as "do not scope".
        self.assertEqual(gc.kb_scope_from_context({"kbFileIds": []}), set())

    def test_non_list_value_is_ignored(self):
        self.assertEqual(gc.kb_scope_from_context({"kbFileIds": "file-bp"}), set())

    def test_ids_are_normalised(self):
        scope = gc.kb_scope_from_context(
            {"kbFileIds": ["file-bp", "  file-salt  ", "", None, {"nope": 1}, 7]}
        )
        self.assertEqual(scope, {"file-bp", "file-salt", "7"})


class SanitizerKeepsTheScope(unittest.TestCase):
    """
    strip_non_retrieval_keys drops every key it does not name, so omitting
    kbFileIds there loses the scope between the router and the retriever
    without any error — the failure mode is silently global retrieval.
    """

    def test_kb_file_ids_survive(self):
        out = context_auto_router.strip_non_retrieval_keys(
            {
                "categoryLabel": "Health",
                "serviceLabels": ["Hypertension"],
                "language": "EN",
                "kbFileIds": ["file-bp", "file-salt"],
                "somethingElse": "dropped",
            }
        )
        self.assertEqual(out.get("kbFileIds"), ["file-bp", "file-salt"])
        self.assertNotIn("somethingElse", out)

    def test_absent_scope_is_not_invented(self):
        out = context_auto_router.strip_non_retrieval_keys({"categoryLabel": "Health"})
        self.assertNotIn("kbFileIds", out)


class ScopeFilterAtRetrieverOutput(unittest.TestCase):
    """The enforcement point: what actually reaches the reranker and the LLM."""

    def test_unscoped_turn_keeps_every_document(self):
        # Regression guard: Twins with no Knowledge Set must behave exactly as
        # they did before scoping existed.
        next_data, _ = _run_retriever_output(_retriever_output(_MIXED_DOCS), {})
        self.assertEqual(
            [doc["id"] for doc in next_data["retrieved_docs"]],
            ["doc-1", "doc-2", "doc-3"],
        )

    def test_out_of_scope_document_is_dropped(self):
        # Andy's reproduction: a Hypertension Twin must not be handed the
        # solar-flare document.
        next_data, _ = _run_retriever_output(
            _retriever_output(_MIXED_DOCS), {"kbFileIds": ["file-bp", "file-salt"]}
        )
        self.assertEqual(
            [doc["id"] for doc in next_data["retrieved_docs"]], ["doc-1", "doc-3"]
        )
        self.assertEqual(
            next_data["file_id_pairs"], {"doc-1": "file-bp", "doc-3": "file-salt"}
        )

    def test_unattributed_document_is_dropped(self):
        # A document whose file_id could not be resolved cannot be shown to be
        # in the Knowledge Set, so scoping fails closed rather than passing it.
        docs = (
            ("doc-1", "Hypertension is managed with diet and medication.", "file-bp"),
            ("doc-2", "Unattributed chunk.", ""),
        )
        next_data, _ = _run_retriever_output(
            _retriever_output(docs), {"kbFileIds": ["file-bp"]}
        )
        self.assertEqual([doc["id"] for doc in next_data["retrieved_docs"]], ["doc-1"])

    def test_filtering_to_empty_hands_off_to_abstention(self):
        # Nothing in scope is a legitimate outcome and must reach the
        # no-documents path: the reranker is removed from the graph, no
        # documents go forward, and the prompt carries the abstention block.
        #
        # Note what this does *not* guarantee. Which abstention text is appended
        # depends on CHATQNA_STRICT_GROUNDING: in strict mode the model refuses,
        # but in the default mode it is told to answer from general guidance
        # anyway. So scoping alone stops out-of-scope documents reaching the
        # LLM; it takes strict mode as well to stop an out-of-scope *answer*.
        # See test_strict_grounding for that half.
        next_data, graph = _run_retriever_output(
            _retriever_output(_MIXED_DOCS), {"kbFileIds": ["file-nothing-retrieved"]}
        )
        self.assertEqual(next_data["retrieved_docs"], [])
        self.assertIn("did not return any results", next_data["inputs"])
        self.assertEqual(graph.deleted, ["rerank/0"])
        self.assertIn(("retriever", "llm/0"), graph.added_edges)

    def test_scope_does_not_reorder_or_rewrite_survivors(self):
        next_data, _ = _run_retriever_output(
            _retriever_output(_MIXED_DOCS), {"kbFileIds": ["file-salt", "file-bp"]}
        )
        self.assertEqual(
            [doc["text"] for doc in next_data["retrieved_docs"]],
            [_MIXED_DOCS[0][1], _MIXED_DOCS[2][1]],
        )


class ScopeSurvivesRouting(unittest.TestCase):
    """
    Regression for the defect the first version of this change shipped with.

    The filter itself was correct, but the scope never reached it: the retrieval
    context is rewritten twice between the request and the retriever, and both
    rewrites drop any key they do not know about. Tests that drive the filter
    directly cannot catch that, so these exercise the rewrites themselves.
    """

    _ROUTE = {
        "primary": {"categoryLabel": "Health", "serviceLabels": ["Hypertension"], "confidence": 0.99},
        "secondary": None,
        "search_mode": "deep_search",
    }

    def test_auto_router_drops_the_scope(self):
        # Documents the hazard rather than the desired end state: the router
        # returns a context built from the classifier route, so anything not in
        # its literal dict is gone. apply_kb_scope exists because of this.
        retrieval_context, _meta, _strategy = context_auto_router.build_retrieval_from_route(
            base_context={"categoryLabel": "General", "serviceLabels": [], "language": "EN"},
            route=self._ROUTE,
        )
        self.assertNotIn("kbFileIds", retrieval_context)

    def test_scope_is_restored_after_auto_routing(self):
        retrieval_context, _meta, _strategy = context_auto_router.build_retrieval_from_route(
            base_context={"categoryLabel": "General", "serviceLabels": [], "language": "EN"},
            route=self._ROUTE,
        )
        restored = gc.apply_kb_scope(retrieval_context, {"kbFileIds": ["file-bp"]})
        self.assertEqual(restored["kbFileIds"], ["file-bp"])
        # Routing decisions themselves must be left alone.
        self.assertEqual(restored["categoryLabel"], "Health")

    def test_scope_is_restored_after_vector_search_reset(self):
        # vector_search replaces the context outright with just the language,
        # which is the path taken by default.
        reset_context = {"language": "EN"}
        restored = gc.apply_kb_scope(reset_context, {"kbFileIds": ["file-bp", "file-salt"]})
        self.assertEqual(restored["kbFileIds"], ["file-bp", "file-salt"])

    def test_no_scope_is_not_invented(self):
        for raw in ({}, {"kbFileIds": []}, {"kbFileIds": None}, None):
            restored = gc.apply_kb_scope({"language": "EN"}, raw)
            self.assertNotIn("kbFileIds", restored, f"invented a scope from {raw!r}")

    def test_restored_scope_is_what_the_filter_reads(self):
        # Closes the loop: the key apply_kb_scope writes is the key the filter
        # at the retriever output looks for.
        restored = gc.apply_kb_scope({"language": "EN"}, {"kbFileIds": ["file-bp"]})
        self.assertEqual(gc.kb_scope_from_context(restored), {"file-bp"})


if __name__ == "__main__":
    unittest.main()
