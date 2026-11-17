"""Tests for the V03 deployed-baseline capture (story 1.2, issue #1948).

The capture reconciles a running deployment against the repository's chart
source. Its failure modes are quiet ones - an unexplained difference, a
secret value in the record, a dropped comparison - so they are pinned here
rather than left to a reading of the generated file.

Run: python3 -m pytest scripts/baseline/tests -q
"""

import importlib.util
import os

import pytest

SCRIPT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "capture-deployed-baseline.py",
)


def load_capture():
    spec = importlib.util.spec_from_file_location("capture_deployed_baseline", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


capture = load_capture()


@pytest.fixture(scope="module")
def chart_values():
    import yaml

    path = os.path.join(capture.REPO_ROOT, "charts", "genieai-umbrella", "values.yaml")
    with open(path, encoding="utf-8") as handle:
        return yaml.safe_load(handle)


@pytest.fixture(scope="module")
def env_maps():
    return capture.template_env_maps()


def test_values_leaf_resolves_to_its_chart_path(env_maps):
    """A variable the template renders from a values leaf points at that leaf."""
    assert (
        env_maps["chatqna"]["RERANKING_STRATEGY"] == "opea.chatqna.rerankingStrategy"
    )
    assert (
        env_maps["retriever"]["RETRIEVER_HYBRID_RRF_K"] == "opea.retriever.retrieverHybridRrfK"
    )
    assert env_maps["embedding"]["EMBEDDING_MODEL_ID"] == "opea.embedding.modelId"


def test_every_opea_workload_is_parsed(env_maps):
    """A template the parse cannot read would silently drop every comparison."""
    for component in capture.OPEA_WORKLOADS:
        assert env_maps[component], f"{component} template parsed nothing"


def test_template_literal_is_not_compared(chart_values, env_maps):
    """A variable the template renders from a helper is TEMPLATE, not a difference."""
    workload = {
        "name": "genieai-genieai-umbrella-chatqna",
        "component": "chatqna",
        "containers": [{"name": "chatqna", "image": "x", "env": {"DOC_REPO_URL": "http://x"}}],
    }
    rows, undeclared = capture.compare_workload(workload, env_maps, chart_values)
    row = next(row for row in rows if row["env"] == "DOC_REPO_URL")
    assert row["status"] == "TEMPLATE"
    assert not undeclared


def test_matching_value_is_reported_as_match(chart_values, env_maps):
    """The chart default and the deployed value agree -> MATCH."""
    workload = {
        "name": "genieai-genieai-umbrella-chatqna",
        "component": "chatqna",
        "containers": [
            {"name": "chatqna", "image": "x", "env": {"RERANKING_STRATEGY": "slice"}}
        ],
    }
    rows, _ = capture.compare_workload(workload, env_maps, chart_values)
    row = next(row for row in rows if row["env"] == "RERANKING_STRATEGY")
    assert row["status"] == "MATCH"
    assert row["source_path"] == "opea.chatqna.rerankingStrategy"


def test_difference_without_disposition_stays_unresolved():
    """An unexplained difference has no disposition - the capture must fail on it."""
    row = {"env": "RERANKING_STRATEGY", "status": "DIFFERENT"}
    assert capture.disposition_for(row, "genieai-genieai-umbrella-chatqna") is None


def test_known_difference_carries_its_disposition():
    """A known difference names the reason it is not a defect."""
    row = {"env": "KC_REALM", "status": "DIFFERENT"}
    disposition = capture.disposition_for(row, "genieai-genieai-umbrella-chatqna")
    assert disposition
    assert "data.keycloak.realm" in disposition


def test_secret_value_never_reaches_the_record():
    """A secret-backed variable shows its reference, never its value."""
    env = capture.container_env(
        {
            "env": [
                {"name": "ARANGO_PASSWORD", "valueFrom": {"secretKeyRef": {"name": "s", "key": "k"}}},
                {"name": "PLAIN", "value": "visible"},
            ]
        }
    )
    assert env["ARANGO_PASSWORD"] == "<secret:s/k>"
    assert env["PLAIN"] == "visible"


def test_injected_service_variables_are_skipped(chart_values, env_maps):
    """Kubernetes injects the service-discovery variables; they are not configuration."""
    workload = {
        "name": "genieai-genieai-umbrella-retriever",
        "component": "retriever",
        "containers": [
            {
                "name": "retriever",
                "image": "x",
                "env": {
                    "ARANGODB_SINGLE_SERVICE_HOST": "10.0.0.1",
                    "RETRIEVER_ARANGO_K": "20",
                },
            }
        ],
    }
    rows, undeclared = capture.compare_workload(workload, env_maps, chart_values)
    assert [row["env"] for row in rows] == ["RETRIEVER_ARANGO_K"]
    assert not undeclared


def test_overlay_override_is_reported_as_a_separate_layer(chart_values):
    """The overlay is a deployment-specific layer, not a discrepancy."""
    merged = capture.deep_merge(chart_values, {"opea": {"retriever": {"retrieverArangoK": "42"}}})
    assert capture.get_path(merged, "opea.retriever.retrieverArangoK") == "42"
    assert capture.get_path(chart_values, "opea.retriever.retrieverArangoK") == "20"


def test_image_tag_is_read_from_a_tagged_reference():
    """A digest-pinned image has no tag to resolve."""
    assert capture.image_tag("registry.example/genie-ai-backend:main") == "main"
    assert capture.image_tag("registry.example/genie-ai-backend@sha256:abc") == ""
