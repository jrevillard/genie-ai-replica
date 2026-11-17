"""Tests for the V03 deployed-baseline capture (story 1.2, issue #1948).

The capture reconciles a running deployment against the repository's chart
source. Its failure modes are quiet ones - an unexplained difference, a
secret value in the record, a dropped comparison - so they are pinned here
rather than left to a reading of the generated file.

Run: uv run --no-cache --with pytest --with pyyaml python -m pytest scripts/baseline/tests -q
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


@pytest.fixture(scope="module")
def overlay_values():
    import yaml

    return yaml.safe_load(
        """
        opea:
          chatqna:
            rerankingStrategy: threshold
          gpu:
            mode: external
            nodeHost: "https://gpu.example:444"
            paths: {llm: /llm, embedding: /embed, reranker: /rerank, translation: /translation}
        ingress:
          host: "genieai.example:4443"
          scheme: https
        """
    )


def test_values_leaf_resolves_to_its_chart_path(env_maps):
    """A variable the template renders from a values leaf points at that leaf."""
    assert (
        env_maps["chatqna"]["RERANKING_STRATEGY"]["path"]
        == "opea.chatqna.rerankingStrategy"
    )
    assert (
        env_maps["retriever"]["RETRIEVER_HYBRID_RRF_K"]["path"]
        == "opea.retriever.retrieverHybridRrfK"
    )
    assert env_maps["embedding"]["EMBEDDING_MODEL_ID"]["path"] == "opea.embedding.modelId"


def test_every_opea_workload_is_parsed(env_maps):
    """A template the parse cannot read would silently drop every comparison."""
    for component in capture.OPEA_WORKLOADS:
        assert env_maps[component], f"{component} template parsed nothing"


def test_template_literal_is_the_source_of_a_literal(env_maps):
    """A value the template renders verbatim is compared against that literal."""
    entry = env_maps["chatqna"]["RETRIEVER_SERVICE_PORT"]
    assert entry["literal"] == "7000"


def test_helper_rendered_variable_is_not_compared(chart_values, env_maps):
    """A variable the template renders by a helper is TEMPLATE, not a difference."""
    workload = {
        "name": "genieai-genieai-umbrella-chatqna",
        "component": "chatqna",
        "containers": [{"name": "chatqna", "image": "x", "env": {"OTEL_EXPORTER_OTLP_ENDPOINT": "http://x"}}],
    }
    rows, undeclared = capture.compare_workload(workload, env_maps, chart_values, {}, chart_values)
    row = next(row for row in rows if row["env"] == "OTEL_EXPORTER_OTLP_ENDPOINT")
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
    rows, _ = capture.compare_workload(workload, env_maps, chart_values, {}, chart_values)
    row = next(row for row in rows if row["env"] == "RERANKING_STRATEGY")
    assert row["status"] == "MATCH"
    assert row["source_path"] == "opea.chatqna.rerankingStrategy"


def test_the_three_layers_stay_distinct(chart_values, overlay_values, env_maps):
    """The chart default, the overlay override and the deployed value are three columns."""
    effective = capture.deep_merge(chart_values, overlay_values)
    workload = {
        "name": "genieai-genieai-umbrella-chatqna",
        "component": "chatqna",
        "containers": [
            {"name": "chatqna", "image": "x", "env": {"RERANKING_STRATEGY": "threshold"}}
        ],
    }
    rows, _ = capture.compare_workload(
        workload, env_maps, chart_values, overlay_values, effective
    )
    row = next(row for row in rows if row["env"] == "RERANKING_STRATEGY")
    assert row["source_value"] == "slice"  # the chart's own default
    assert row["overlay_value"] == "threshold"  # the overlay override
    assert row["deployed"] == "threshold"  # what the pod carries
    assert row["status"] == "MATCH"


def test_derived_value_is_compared_against_the_chart_derivation(chart_values, overlay_values, env_maps):
    """A helper-rendered endpoint is compared against the same derivation."""
    effective = capture.deep_merge(chart_values, overlay_values)
    workload = {
        "name": "genieai-genieai-umbrella-chatqna",
        "component": "chatqna",
        "containers": [
            {
                "name": "chatqna",
                "image": "x",
                "env": {"VLLM_LLM_ENDPOINT": "https://gpu.example:444/llm"},
            }
        ],
    }
    rows, _ = capture.compare_workload(
        workload, env_maps, chart_values, overlay_values, effective
    )
    row = next(row for row in rows if row["env"] == "VLLM_LLM_ENDPOINT")
    assert row["status"] == "MATCH"
    assert row["overlay_value"] == "https://gpu.example:444/llm"


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


def test_injected_variables_are_skipped_unless_the_chart_declares_them(chart_values, env_maps):
    """Kubernetes injects the service-discovery variables; a chart-declared one is compared."""
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
    rows, undeclared = capture.compare_workload(workload, env_maps, chart_values, {}, chart_values)
    assert [row["env"] for row in rows] == ["RETRIEVER_ARANGO_K"]
    assert not undeclared


def test_overlay_override_is_a_separate_layer(chart_values):
    """The overlay is a deployment-specific layer, not a discrepancy."""
    merged = capture.deep_merge(chart_values, {"opea": {"retriever": {"retrieverArangoK": "42"}}})
    assert capture.get_path(merged, "opea.retriever.retrieverArangoK") == "42"
    assert capture.get_path(chart_values, "opea.retriever.retrieverArangoK") == "20"


def test_image_tag_is_read_from_a_tagged_reference():
    """A digest-pinned image has no tag to resolve."""
    assert capture.image_tag("registry.example/genie-ai-backend:main") == "main"
    assert capture.image_tag("registry.example/genie-ai-backend@sha256:abc") == ""


def test_numbers_compare_numerically():
    """A chart default of 1.0 and a deployed "1.0" are the same value."""
    assert capture.values_equal(1.0, "1.0")
    assert capture.values_equal("1.0", "1.0")
    assert capture.values_equal("1.0", "1")
    assert not capture.values_equal("1.0", "2")


def test_an_undispositioned_difference_fails_the_capture(tmp_path):
    """The program's own gate: the record is written AND the capture exits 2."""
    data = {
        "capture": {
            "date": "2026-11-17",
            "timestamp": "2026-11-17T00:00:00+00:00",
            "cluster": "https://cluster",
            "namespace": "genieai",
            "release": "genieai",
            "release_revision": 1,
            "chart_name": "charts/genieai-umbrella",
            "chart_version": "0.2.1",
            "local_chart_version": "0.2.1",
            "overlay_name": "overlay",
            "command": "python3 capture.py",
        },
        "images": [],
        "models": [],
        "config": [],
        "discrepancies": [
            {
                "workload": "genieai-genieai-umbrella-retriever",
                "env": "RETRIEVER_ARANGO_K",
                "source_value": "20",
                "deployed": "4",
                "disposition": "**UNRESOLVED**",
            }
        ],
        "image_disposition_note": "",
        "topology": {
            "services": [],
            "network_policies": 0,
            "edge": "(none)",
            "external": "(none)",
        },
    }
    out_path = tmp_path / "record.md"
    unresolved = capture.write_record(data, str(out_path))
    assert len(unresolved) == 1
    assert capture.exit_code_for(unresolved) == 2
    assert "**UNRESOLVED**" in out_path.read_text(encoding="utf-8")


def test_a_dispositioned_difference_exits_zero(tmp_path):
    """A known difference is recorded with its disposition and does not fail the capture."""
    data = {
        "capture": {
            "date": "2026-11-17",
            "timestamp": "2026-11-17T00:00:00+00:00",
            "cluster": "https://cluster",
            "namespace": "genieai",
            "release": "genieai",
            "release_revision": 1,
            "chart_name": "charts/genieai-umbrella",
            "chart_version": "0.2.1",
            "local_chart_version": "0.2.1",
            "overlay_name": "overlay",
            "command": "python3 capture.py",
        },
        "images": [],
        "models": [],
        "config": [],
        "discrepancies": [
            {
                "workload": "genieai-genieai-umbrella-chatqna",
                "env": "KC_REALM",
                "source_value": "",
                "deployed": "genie",
                "disposition": "By design - the chart leaves the realm empty.",
            }
        ],
        "image_disposition_note": "",
        "topology": {
            "services": [],
            "network_policies": 0,
            "edge": "(none)",
            "external": "(none)",
        },
    }
    out_path = tmp_path / "record.md"
    unresolved = capture.write_record(data, str(out_path))
    assert unresolved == []
    assert capture.exit_code_for(unresolved) == 0
