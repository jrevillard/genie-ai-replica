"""Tests for the V03 deployed-baseline capture.

The capture reconciles a running deployment against the repository's chart
source. Its failure modes are quiet ones - an unexplained difference, a
secret value in the record, a dropped comparison - so they are pinned here
rather than left to a reading of the generated file.

Run: uv run --no-cache --with pytest --with pyyaml python -m pytest scripts/baseline/tests -q
"""

import base64
import importlib.util
import os
import re

import pytest

SCRIPT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "capture-deployed-baseline.py",
)


def _record_data():
    return {
        "capture": {
            "date": "2026-11-17",
            "timestamp": "2026-11-17T00:00:00+00:00",
            "cluster": "https://cluster",
            "namespace": "genieai",
            "release": "genieai",
            "release_revision": 1,
            "chart_name": "charts/genieai-umbrella",
            "local_chart_version": "0.2.1",
            "overlay_name": "overlay",
            "release_health": "True - Helm upgrade succeeded",
            "command": "python3 capture.py",
        },
        "images": [],
        "models": [],
        "config": [],
        "discrepancies": [],
        "image_disposition_note": "",
        "topology": {
            "services": [],
            "network_policies": 0,
            "edge": "(none)",
            "external": "(none)",
        },
    }


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
          enabled: true
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


def test_helper_rendered_variable_is_not_compared(chart_values, overlay_values, env_maps):
    """A variable the template renders by a helper is TEMPLATE, not a difference."""
    workload = {
        "name": "genieai-genieai-umbrella-chatqna",
        "component": "chatqna",
        "containers": [{"name": "chatqna", "image": "x", "env": {"OTEL_EXPORTER_OTLP_ENDPOINT": "http://x"}}],
    }
    effective = capture.deep_merge(chart_values, overlay_values)
    rows, undeclared = capture.compare_workload(
        workload, env_maps, chart_values, overlay_values, effective
    )
    row = next(row for row in rows if row["env"] == "OTEL_EXPORTER_OTLP_ENDPOINT")
    assert row["status"] == "TEMPLATE"
    assert not undeclared


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
    assert row["source_path"] == "opea.chatqna.rerankingStrategy"


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


def test_a_fallback_chain_resolves_to_the_value_the_chart_renders(chart_values, overlay_values, env_maps):
    """The chart's own fallback is part of the source: no difference, no disposition."""
    effective = capture.deep_merge(chart_values, overlay_values)
    workload = {
        "name": "genieai-genieai-umbrella-chatqna",
        "component": "chatqna",
        "containers": [{"name": "chatqna", "image": "x", "env": {"KC_REALM": "genie"}}],
    }
    rows, _ = capture.compare_workload(
        workload, env_maps, chart_values, overlay_values, effective
    )
    row = next(row for row in rows if row["env"] == "KC_REALM")
    assert row["status"] == "MATCH"
    assert row["source_path"] == "data.keycloak.realm"


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


def test_injected_variables_are_skipped_unless_the_chart_declares_them(chart_values, overlay_values, env_maps):
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
    effective = capture.deep_merge(chart_values, overlay_values)
    rows, undeclared = capture.compare_workload(
        workload, env_maps, chart_values, overlay_values, effective
    )
    compared = [row for row in rows if row["status"] != "NOT CARRIED"]
    assert [row["env"] for row in compared] == ["RETRIEVER_ARANGO_K"]
    # the injected variable is dropped, the declared-but-absent ones are reported
    assert "ARANGODB_SINGLE_SERVICE_HOST" not in [row["env"] for row in rows]
    # and it is not listed as "carried but not compared" either
    assert "ARANGODB_SINGLE_SERVICE_HOST" not in [name for name in undeclared]


def test_overlay_override_is_a_separate_layer(chart_values):
    """The overlay is a deployment-specific layer, not a discrepancy."""
    merged = capture.deep_merge(chart_values, {"opea": {"retriever": {"retrieverArangoK": "42"}}})
    assert capture.get_path(merged, "opea.retriever.retrieverArangoK") == "42"
    assert capture.get_path(chart_values, "opea.retriever.retrieverArangoK") == "20"
    # the chart's own defaults under the same subtree survive the merge: a
    # shallow merge would drop them and manufacture false differences
    assert capture.get_path(merged, "opea.retriever.retrieverHybridRrfK") == (
        capture.get_path(chart_values, "opea.retriever.retrieverHybridRrfK")
    )


def test_numbers_compare_numerically():
    """A chart default of 1.0 and a deployed "1.0" are the same value."""
    assert capture.values_equal(1.0, "1.0")
    assert capture.values_equal("1.0", "1.0")
    assert capture.values_equal("1.0", "1")
    assert not capture.values_equal("1.0", "2")


def test_an_undispositioned_difference_fails_the_capture(tmp_path):
    """The program's own gate: the record is written AND the capture exits 2."""
    data = _record_data()
    data["discrepancies"].append(
        {
            "workload": "genieai-genieai-umbrella-retriever",
            "env": "RETRIEVER_ARANGO_K",
            "source_value": "20",
            "deployed": "4",
            "disposition": "**UNRESOLVED**",
        }
    )
    out_path = tmp_path / "record.md"
    unresolved = capture.write_record(data, str(out_path))
    assert len(unresolved) == 1
    assert capture.exit_code_for(unresolved) == 2
    assert "**UNRESOLVED**" in out_path.read_text(encoding="utf-8")


def test_a_dispositioned_difference_exits_zero(tmp_path):
    """A known difference is recorded with its disposition and does not fail the capture."""
    data = _record_data()
    data["discrepancies"].append(
        {
            "workload": "genieai-genieai-umbrella-chatqna",
            "env": "KC_REALM",
            "source_value": "",
            "deployed": "genie",
            "disposition": "By design - the chart leaves the realm empty.",
        }
    )
    out_path = tmp_path / "record.md"
    unresolved = capture.write_record(data, str(out_path))
    assert unresolved == []
    assert capture.exit_code_for(unresolved) == 0

def test_a_model_difference_reaches_the_discrepancy_table(tmp_path, chart_values):
    """A served model that differs from the source is a difference, and it fails."""
    models = capture.build_models(
        {
            "chatqna": {
                "LLM_MODEL": "ibm-granite/granite-4.1-8b",
                "VLLM_TRANSLATION_MODEL_ID": "google/gemma-3-4b-it",
            },
            "embedding": {"EMBEDDING_MODEL_ID": "BAAI/bge-large-en-v1.5"},
        },
        chart_values,
        chart_values,
        {
            "embedding": {"model_id": "BAAI/bge-large-en-v1.5"},
            "reranker": {"model_id": "BAAI/bge-reranker-v2-m3"},
            "llm": {"model_id": "another/model"},
            "translation": {"model_id": "google/gemma-3-4b-it"},
        },
    )
    llm = next(model for model in models if model["role"] == "llm")
    assert llm["status"] == "DIFFERENT"

    data = _record_data()
    # The production rule builds the rows: a test that hand-copies them
    # would pass even if the rule were dropped.
    data["discrepancies"].extend(capture.model_discrepancy_rows(models))
    out_path = str(tmp_path / "record.md")
    unresolved = capture.write_record(data, out_path)
    assert len(unresolved) == 1
    assert capture.exit_code_for(unresolved) == 2


def test_the_discrepancy_row_carries_the_effective_value():
    """The source of a difference is the effective value, not the chart default."""
    row = {
        "env": "RERANKING_STRATEGY",
        "status": "DIFFERENT",
        "source_value": "slice",  # the chart default
        "overlay_value": "threshold",  # the overlay override
        "effective_value": "threshold",  # what the comparison used
        "source_path": "opea.chatqna.rerankingStrategy",
        "deployed": "adaptive",
    }
    discrepancy = capture.discrepancy_row("chatqna", row, None)
    assert discrepancy["source_value"] == "threshold"
    assert discrepancy["source_path"] == "opea.chatqna.rerankingStrategy"
    assert discrepancy["disposition"] == "**UNRESOLVED**"

def test_index_into_a_dotted_variable_resolves_to_its_path(env_maps):
    """`index ($okf.server | default dict) "url"` is the leaf okf.server.url."""
    chain = env_maps["dataprep"]["OKF_SERVER_URL"]["chain"]
    assert ("path", "okf.server.url") in chain


def test_index_into_a_plain_variable_resolves_to_its_path(env_maps):
    """`index $dataKeycloak "internalUrl"` is the leaf data.keycloak.internalUrl."""
    chain = env_maps["dataprep"]["KEYCLOAK_INTERNAL_URL"]["chain"]
    assert ("path", "data.keycloak.internalUrl") in chain


def test_a_falsy_leaf_falls_to_the_next_candidate():
    """Sprig's `default` treats zero and false as empty: the fallback renders."""
    chain = [("path", "opea.dataprep.dataprepContextualDocBudget"), ("literal", "6000")]
    assert capture._resolve_chain(chain, {"opea": {"dataprep": {"dataprepContextualDocBudget": 0}}}) == (
        None,
        "6000",
    )
    assert capture._resolve_chain(
        chain, {"opea": {"dataprep": {"dataprepContextualDocBudget": "8192"}}}
    ) == ("opea.dataprep.dataprepContextualDocBudget", "8192")


def test_a_subtree_is_not_treated_as_a_value():
    """A mis-parsed path that points at a subtree would compare a repr."""
    chain = [("path", "opea.retriever"), ("literal", "fallback")]
    resolved = capture._resolve_chain(chain, {"opea": {"retriever": {"retrieverArangoK": "20"}}})
    assert resolved == (None, "fallback")


def test_the_overlay_is_read_where_the_value_resolves(chart_values, env_maps):
    """An override further down the chain is the layer that produced the value."""
    overlay = {"opea": {"enabled": True}, "data": {"keycloak": {"realm": "gov-realm"}}}
    effective = capture.deep_merge(chart_values, overlay)
    workload = {
        "name": "genieai-genieai-umbrella-chatqna",
        "component": "chatqna",
        "containers": [{"name": "chatqna", "image": "x", "env": {"KC_REALM": "gov-realm"}}],
    }
    rows, _ = capture.compare_workload(
        workload, env_maps, chart_values, overlay, effective
    )
    row = next(row for row in rows if row["env"] == "KC_REALM")
    assert row["status"] == "MATCH"
    assert row["source_path"] == "data.keycloak.realm"
    assert row["overlay_value"] == "gov-realm"


def test_a_subtree_candidate_falls_through_to_the_literal(env_maps):
    """`index ($okf.server | default dict) "url"` with no okf.server renders the literal."""
    chain = env_maps["dataprep"]["OKF_SERVER_URL"]["chain"]
    literal = next(value for kind, value in chain if kind == "literal")
    resolved = capture._resolve_chain(chain, {"okf": {"server": {"name": "x"}}})
    assert resolved == (None, literal)


def test_the_record_names_the_source_each_column_came_from(
    tmp_path, chart_values, overlay_values, env_maps
):
    """The record says where the chart default and the effective value came from.

    The overlay pins the realm; the chart's own default falls through the
    template's fallback chain to another leaf. The record must say which
    is which - the two columns are not the same source.
    """
    overlay = {
        "opea": {"enabled": True, "chatqna": {"kcRealm": "gov-realm"}},
        "data": {"keycloak": {"realm": "fallback-realm"}},
    }
    effective = capture.deep_merge(chart_values, overlay)
    workload = {
        "name": "genieai-genieai-umbrella-chatqna",
        "component": "chatqna",
        "containers": [{"name": "chatqna", "image": "x", "env": {"KC_REALM": "gov-realm"}}],
    }
    rows, _ = capture.compare_workload(
        workload, env_maps, chart_values, overlay, effective
    )
    row = next(row for row in rows if row["env"] == "KC_REALM")
    assert row["source_path"] == "opea.chatqna.kcRealm"
    assert row["default_path"] == "data.keycloak.realm"

    data = _record_data()
    data["config"] = [{"workload": workload["name"], "rows": rows, "undeclared": []}]
    out_path = tmp_path / "record.md"
    capture.write_record(data, str(out_path))
    text = out_path.read_text(encoding="utf-8")
    assert "data.keycloak.realm" in text


def test_the_record_names_the_chart_source_it_reconciles_against(tmp_path):
    """The record says which chart source the comparison is made against."""
    data = _record_data()
    data["capture"]["local_chart_version"] = "0.2.2"
    out_path = tmp_path / "record.md"
    capture.write_record(data, str(out_path))
    text = out_path.read_text(encoding="utf-8")
    assert "version 0.2.2" in text


def test_a_row_the_chart_renders_under_a_condition_is_not_a_missing_one(chart_values, env_maps):
    """The chart omits the prompt row when the value is empty: not a difference."""
    overlay = {"opea": {"enabled": True}}
    effective = capture.deep_merge(chart_values, overlay)
    workload = {
        "name": "genieai-genieai-umbrella-chatqna",
        "component": "chatqna",
        "containers": [{"name": "chatqna", "image": "x", "env": {"LLM_MODEL": "m"}}],
    }
    rows, _ = capture.compare_workload(
        workload, env_maps, chart_values, overlay, effective
    )
    assert "CHATQNA_SYSTEM_PROMPT" not in [row["env"] for row in rows]


def test_a_guarded_row_is_reported_when_the_condition_holds(chart_values, env_maps):
    """With the operator's prompt set, the chart declares the row: it is reported."""
    overlay = {"opea": {"enabled": True, "chatqna": {"systemPrompt": "be brief"}}}
    effective = capture.deep_merge(chart_values, overlay)
    workload = {
        "name": "genieai-genieai-umbrella-chatqna",
        "component": "chatqna",
        "containers": [{"name": "chatqna", "image": "x", "env": {"LLM_MODEL": "m"}}],
    }
    rows, _ = capture.compare_workload(workload, env_maps, chart_values, overlay, effective)
    row = next(row for row in rows if row["env"] == "CHATQNA_SYSTEM_PROMPT")
    assert row["status"] == "NOT CARRIED"


def test_the_backend_translation_model_is_read_through_the_template(chart_values, overlay_values, env_maps):
    """The template's own fallback is the source: the chart's leaf is empty."""
    workload = {
        "name": "genieai-genieai-umbrella-backend",
        "component": "backend",
        "containers": [
            {
                "name": "backend",
                "image": "x",
                "env": {"VLLM_TRANSLATION_MODEL_ID": "google/gemma-3-4b-it"},
            }
        ],
    }
    effective = capture.deep_merge(chart_values, overlay_values)
    rows, _ = capture.compare_workload(
        workload, env_maps, chart_values, overlay_values, effective
    )
    row = next(row for row in rows if row["env"] == "VLLM_TRANSLATION_MODEL_ID")
    assert row["source_path"] == "services.backend.translation.modelId"
    assert row["source_value"] == "google/gemma-3-4b-it"
    assert row["status"] == "MATCH"


def test_the_backend_translation_endpoint_is_compared(chart_values, overlay_values, env_maps):
    """A derived endpoint the application tier carries is reconciled, not dropped."""
    effective = capture.deep_merge(chart_values, overlay_values)
    workload = {
        "name": "genieai-genieai-umbrella-backend",
        "component": "backend",
        "containers": [
            {
                "name": "backend",
                "image": "x",
                "env": {"VLLM_TRANSLATION_ENDPOINT": "https://gpu.example:444/translation"},
            }
        ],
    }
    rows, undeclared = capture.compare_workload(
        workload, env_maps, chart_values, overlay_values, effective
    )
    row = next(row for row in rows if row["env"] == "VLLM_TRANSLATION_ENDPOINT")
    assert row["status"] == "MATCH"
    assert "VLLM_TRANSLATION_ENDPOINT" not in [name for name, _value in undeclared]


def test_a_role_the_deployment_does_not_declare_is_not_compared(chart_values):
    """The reranker model belongs to the in-cluster tier this venue does not run."""
    models = capture.build_models(
        {"chatqna": {"LLM_MODEL": "ibm-granite/granite-4.1-8b"}},
        chart_values,
        chart_values,
        {
            "embedding": {"model_id": "BAAI/bge-large-en-v1.5"},
            "reranker": {"model_id": "BAAI/bge-reranker-v2-m3"},
            "llm": {"model_id": "ibm-granite/granite-4.1-8b"},
            "translation": {"model_id": "google/gemma-3-4b-it"},
        },
    )
    reranker = next(model for model in models if model["role"] == "reranker")
    assert reranker["status"] == "NOT DECLARED HERE"
    assert reranker["served"] == "BAAI/bge-reranker-v2-m3"
    llm = next(model for model in models if model["role"] == "llm")
    assert llm["status"] == "MATCH"


def test_the_images_are_compared_by_content_not_by_index(monkeypatch):
    """The same content behind another index digest is not a difference."""
    digests = {
        "main": ("sha256:index-new", "sha256:child", ""),
        "sha256:index-old": ("sha256:index-old", "sha256:child", ""),
        "sha256:child": ("sha256:child", "sha256:child", ""),
    }

    def fake_manifest(image, reference):
        return digests.get(reference, (None, "", "not found"))

    monkeypatch.setattr(capture, "registry_manifest", fake_manifest)
    images = [
        {
            "workload": "w",
            "container": "c",
            "image": "registry.example/genie-ai-backend:main",
            "running_digest": "registry.example/genie-ai-backend@sha256:index-old",
            "running_child_digest": "",
            "pull_policy": "Always",
            "registry_digest": "",
            "registry_child_digest": "",
            "status": "NOT RUNNING",
        }
    ]
    capture.resolve_registry_digests(images)
    assert images[0]["status"] == "SAME CONTENT"

    digests["sha256:index-old"] = ("sha256:index-old", "sha256:other-child", "")
    images[0]["running_digest"] = "registry.example/genie-ai-backend@sha256:index-old"
    capture.resolve_registry_digests(images)
    assert images[0]["status"] == "DIFFERENT"


def test_the_overlay_values_inline_in_the_release_win_over_the_sources(monkeypatch):
    """Flux: the values inlined in the HelmRelease have the higher priority."""
    helmrelease = {
        "spec": {
            "chart": {"spec": {"chart": "genieai-umbrella"}},
            "values": {"opea": {"chatqna": {"rerankingStrategy": "inline"}}},
            "valuesFrom": [
                {
                    "kind": "ConfigMap",
                    "name": "overlay",
                    "valuesKey": "values.yaml",
                }
            ],
        },
        "status": {
            "conditions": [{"type": "Ready", "status": "True", "message": "ok"}],
            "history": [{"version": 1, "chartVersion": "0.2.1"}],
        },
    }
    configmap = {"data": {"values.yaml": "opea:\n  chatqna:\n    rerankingStrategy: from-source\n"}}

    def fake_kubectl(namespace, *args):
        if args[0] == "get" and args[1] == "helmrelease":
            return helmrelease
        if args[0] == "get" and args[1] == "configmap":
            return configmap
        raise AssertionError(args)

    monkeypatch.setattr(capture, "kubectl_json", fake_kubectl)
    release = capture.capture_release("flux-system", "genieai")
    assert (
        release["overlay"]["opea"]["chatqna"]["rerankingStrategy"] == "inline"
    )
    assert "overlay" in release["overlay_name"]
    assert "inline values" in release["overlay_name"]


def test_the_comparison_reports_a_difference_it_finds(
    tmp_path, chart_values, overlay_values, env_maps
):
    """The comparison itself says a row differs - not a hand-built row.

    A mutant that makes `compare_workload` stop reporting DIFFERENT dies
    here: the row is produced by the comparison, not by the test.
    """
    effective = capture.deep_merge(chart_values, overlay_values)
    workload = {
        "name": "genieai-genieai-umbrella-chatqna",
        "component": "chatqna",
        "containers": [
            {"name": "chatqna", "image": "x", "env": {"RERANKING_STRATEGY": "adaptive"}}
        ],
    }
    rows, _ = capture.compare_workload(
        workload, env_maps, chart_values, overlay_values, effective
    )
    row = next(row for row in rows if row["env"] == "RERANKING_STRATEGY")
    assert row["status"] == "DIFFERENT"

    data = _record_data()
    data["discrepancies"] = capture.collect_discrepancies(
        [{"workload": workload["name"], "rows": rows}], [], []
    )
    # the DIFFERENT row is the one that reaches the discrepancy table
    differing = [row for row in rows if row["status"] == "DIFFERENT"]
    assert "RERANKING_STRATEGY" in [row["env"] for row in differing]
    assert "RERANKING_STRATEGY" in [row["env"] for row in data["discrepancies"]]
    out_path = str(tmp_path / "record.md")
    unresolved = capture.write_record(data, out_path)
    # and it is among the differences that carry no disposition
    assert "RERANKING_STRATEGY" in [row["env"] for row in unresolved]
    assert capture.exit_code_for(unresolved) == 2


def test_an_unprobeable_model_is_an_unresolved_difference(tmp_path, chart_values):
    """A model that could not be probed is a gap in the record: it fails."""
    models = capture.build_models(
        {
            "chatqna": {
                "LLM_MODEL": "ibm-granite/granite-4.1-8b",
                "VLLM_TRANSLATION_MODEL_ID": "google/gemma-3-4b-it",
            },
            "embedding": {"EMBEDDING_MODEL_ID": "BAAI/bge-large-en-v1.5"},
        },
        chart_values,
        chart_values,
        {
            "embedding": {"model_id": "BAAI/bge-large-en-v1.5"},
            "reranker": {"model_id": "BAAI/bge-reranker-v2-m3"},
            "llm": {"error": "401 unauthorized"},
            "translation": {"model_id": "google/gemma-3-4b-it"},
        },
    )
    llm = next(model for model in models if model["role"] == "llm")
    assert llm["status"] == "NOT PROBED"

    data = _record_data()
    data["discrepancies"].extend(capture.model_discrepancy_rows(models))
    out_path = tmp_path / "record.md"
    unresolved = capture.write_record(data, str(out_path))
    assert len(unresolved) == 1
    assert capture.exit_code_for(unresolved) == 2


def test_a_pinned_image_reference_names_its_artifact():
    """`repo:tag@sha256:digest` names the pinned artifact, not the tag."""
    assert capture.image_reference("registry.example/app:main") == (
        "registry.example/app",
        "main",
        "",
    )
    assert capture.image_reference("registry.example/app@sha256:abc") == (
        "registry.example/app",
        "",
        "sha256:abc",
    )
    assert capture.image_reference("registry.example/app:main@sha256:abc") == (
        "registry.example/app",
        "main",
        "sha256:abc",
    )


def test_a_digest_pinned_reference_is_resolved_as_its_digest(monkeypatch):
    """The registry columns describe the artifact the deployment DECLARES."""
    resolved = []

    def fake_manifest(image, reference):
        resolved.append(reference)
        return ("sha256:index", "sha256:child", "")

    monkeypatch.setattr(capture, "registry_manifest", fake_manifest)
    images = [
        {
            "workload": "w",
            "container": "c",
            "image": "registry.example/app:main@sha256:pinned",
            "running_digest": "registry.example/app@sha256:index",
            "running_child_digest": "",
            "pull_policy": "Always",
            "registry_digest": "",
            "registry_child_digest": "",
            "status": "NOT RUNNING",
        }
    ]
    capture.resolve_registry_digests(images)
    # the DECLARED artifact is resolved by its pin, the running one by its
    # own digest
    assert resolved[0] == "sha256:pinned"


def test_a_value_that_lives_in_a_secret_never_reaches_the_record(tmp_path, monkeypatch):
    """A Secret-kind overlay source is compared, never printed."""
    helmrelease = {
        "spec": {
            "chart": {"spec": {"chart": "genieai-umbrella"}},
            "valuesFrom": [
                {
                    "kind": "Secret",
                    "name": "overlay-secret",
                    "valuesKey": "values.yaml",
                }
            ],
        },
        "status": {
            "conditions": [{"type": "Ready", "status": "True", "message": "ok"}],
            "history": [{"version": 1, "chartVersion": "0.2.1", "status": "deployed"}],
        },
    }
    secret = {
        "data": {
            "values.yaml": base64.b64encode(
                b"opea:\n  chatqna:\n    env:\n      OPENAI_API_KEY: sk-live-SUPERSECRET\n"
            ).decode()
        }
    }

    def fake_kubectl(namespace, *args):
        if args[0] == "get" and args[1] == "helmrelease":
            return helmrelease
        if args[0] == "get" and args[1] == "secret":
            return secret
        raise AssertionError(args)

    monkeypatch.setattr(capture, "kubectl_json", fake_kubectl)
    release = capture.capture_release("flux-system", "genieai")

    # the value is used for the comparison...
    assert (
        release["overlay"]["opea"]["chatqna"]["env"]["OPENAI_API_KEY"]
        == "sk-live-SUPERSECRET"
    )
    # ...but its path is remembered so the record can hide it
    assert "opea.chatqna.env.OPENAI_API_KEY" in release["secret_paths"]

    data = _record_data()
    data["capture"]["secret_paths"] = sorted(release["secret_paths"])
    data["config"] = [
        {
            "workload": "genieai-genieai-umbrella-chatqna",
            "rows": [
                {
                    "env": "OPENAI_API_KEY",
                    "source_path": "opea.chatqna.env.OPENAI_API_KEY",
                    "default_path": "opea.chatqna.env.OPENAI_API_KEY",
                    "source_value": "",
                    "overlay_value": "sk-live-SUPERSECRET",
                    "effective_value": "sk-live-SUPERSECRET",
                    "deployed": "<secret:vllm-api-key/VLLM_API_KEY>",
                    "status": "MATCH",
                },
                {
                    "env": "OPENAI_API_KEY_DRIFTED",
                    "source_path": "opea.chatqna.env.OPENAI_API_KEY",
                    "default_path": "opea.chatqna.env.OPENAI_API_KEY",
                    "source_value": "",
                    "overlay_value": "sk-live-SUPERSECRET",
                    "effective_value": "sk-live-SUPERSECRET",
                    "deployed": "another-value",
                    "status": "DIFFERENT",
                },
            ],
            "undeclared": [],
            "multi_container": False,
        }
    ]
    data["discrepancies"] = capture.collect_discrepancies(data["config"], [], [])
    out_path = tmp_path / "record.md"
    capture.write_record(data, str(out_path))
    text = out_path.read_text(encoding="utf-8")
    assert "sk-live-SUPERSECRET" not in text
    assert "<from secret>" in text


def test_a_targeted_overlay_source_wins_over_the_inline_values(monkeypatch):
    """Flux applies the values with a targetPath last, replacing the subtree."""
    helmrelease = {
        "spec": {
            "chart": {"spec": {"chart": "genieai-umbrella"}},
            "values": {"opea": {"chatqna": {"env": {"CHATQNA_TYPE": "inline"}}}},
            "valuesFrom": [
                {
                    "kind": "ConfigMap",
                    "name": "overlay",
                    "valuesKey": "values.yaml",
                    "targetPath": "opea.chatqna.env",
                }
            ],
        },
        "status": {
            "conditions": [{"type": "Ready", "status": "True", "message": "ok"}],
            "history": [{"version": 1, "chartVersion": "0.2.1", "status": "deployed"}],
        },
    }
    configmap = {
        "data": {"values.yaml": "CHATQNA_TYPE: from-targetPath\n"}
    }

    def fake_kubectl(namespace, *args):
        if args[0] == "get" and args[1] == "helmrelease":
            return helmrelease
        if args[0] == "get" and args[1] == "configmap":
            return configmap
        raise AssertionError(args)

    monkeypatch.setattr(capture, "kubectl_json", fake_kubectl)
    release = capture.capture_release("flux-system", "genieai")
    assert release["overlay"]["opea"]["chatqna"]["env"]["CHATQNA_TYPE"] == (
        "from-targetPath"
    )


def test_the_revision_is_the_one_the_cluster_attests_as_deployed(monkeypatch):
    """A failed upgrade is in the history before it fails: it is not deployed."""
    helmrelease = {
        "spec": {"chart": {"spec": {"chart": "genieai-umbrella"}}},
        "status": {
            "conditions": [{"type": "Ready", "status": "True", "message": "ok"}],
            "history": [
                {"version": 51, "chartVersion": "0.2.178", "status": "failed"},
                {"version": 50, "chartVersion": "0.2.177", "status": "deployed"},
            ],
        },
    }

    def fake_kubectl(namespace, *args):
        return helmrelease

    monkeypatch.setattr(capture, "kubectl_json", fake_kubectl)
    release = capture.capture_release("flux-system", "genieai")
    assert release["revision"] == 50


def test_an_unconditional_row_the_deployment_does_not_carry_fails_the_capture(
    chart_values, overlay_values, env_maps, tmp_path
):
    """A chart-declared variable the deployment lacks is a difference."""
    overlay = {"opea": {"enabled": True}}
    effective = capture.deep_merge(chart_values, overlay)
    workload = {
        "name": "genieai-genieai-umbrella-chatqna",
        "component": "chatqna",
        "containers": [{"name": "chatqna", "image": "x", "env": {"LLM_MODEL": "m"}}],
    }
    rows, _ = capture.compare_workload(
        workload, env_maps, chart_values, overlay, effective
    )
    not_carried = [row for row in rows if row["status"] == "NOT CARRIED"]
    assert not_carried, "the fixture must produce an unconditional missing row"

    data = _record_data()
    data["discrepancies"] = capture.collect_discrepancies(
        [{"workload": workload["name"], "rows": not_carried}], [], []
    )
    out_path = tmp_path / "record.md"
    unresolved = capture.write_record(data, str(out_path))
    assert capture.exit_code_for(unresolved) == 2


# --------------------------------------------------------------------------
# the review findings the scoped fix review marked required before merge
# --------------------------------------------------------------------------


def test_a_with_block_does_not_close_an_enclosing_if_guard(tmp_path):
    """A `with` block's end closes its own block, never the `if` around it."""
    template = tmp_path / "svc.yaml"
    template.write_text(
        "{{- $svc := .Values.services.backend | default dict -}}\n"
        "{{- if $svc.enabled -}}\n"
        "{{- with $svc.env -}}\n"
        '{{- $_ := set . "IGNORED" "x" -}}\n'
        "{{- end -}}\n"
        "- name: INSIDE\n"
        "  value: {{ $svc.name }}\n"
        "{{- end -}}\n"
        "- name: OUTSIDE\n"
        "  value: {{ $svc.name }}\n",
        encoding="utf-8",
    )
    mapping = capture.parse_template_env(str(template))
    assert mapping["INSIDE"]["guards"], "the `if` guard must survive the `with` block"
    assert not mapping["OUTSIDE"]["guards"]


def test_a_negated_condition_yields_a_conditional_row(
    tmp_path, chart_values, overlay_values
):
    """A condition the capture cannot evaluate leaves the row conditional."""
    template = tmp_path / "svc.yaml"
    template.write_text(
        "{{- $svc := .Values.services.backend | default dict -}}\n"
        "{{- if not $svc.enabled -}}\n"
        "- name: ONLY_WHEN_DISABLED\n"
        "  value: {{ $svc.name }}\n"
        "{{- end -}\n",
        encoding="utf-8",
    )
    mapping = capture.parse_template_env(str(template))
    assert mapping["ONLY_WHEN_DISABLED"]["unresolved_guard"] is True

    overlay = {"opea": {"enabled": True}}
    effective = capture.deep_merge(chart_values, overlay)
    workload = {
        "name": "genieai-genieai-umbrella-chatqna",
        "component": "chatqna",
        "containers": [{"name": "chatqna", "image": "x", "env": {"LLM_MODEL": "m"}}],
    }
    rows, _ = capture.compare_workload(
        workload, {"chatqna": mapping}, chart_values, overlay, effective
    )
    row = next(row for row in rows if row["env"] == "ONLY_WHEN_DISABLED")
    assert row["status"] == "CONDITIONAL"


def test_a_conditional_row_reaches_the_discrepancy_table_and_fails_the_capture(
    tmp_path,
):
    """A row the capture cannot decide is a difference it cannot explain."""
    data = _record_data()
    data["discrepancies"] = capture.collect_discrepancies(
        [
            {
                "workload": "genieai-genieai-umbrella-chatqna",
                "rows": [
                    {
                        "env": "ONLY_WHEN_DISABLED",
                        "status": "CONDITIONAL",
                        "source_value": "",
                        "overlay_value": "",
                        "effective_value": "",
                        "source_path": "services.backend.name",
                        "deployed": "(not carried)",
                    }
                ],
            }
        ],
        [],
        [],
    )
    assert len(data["discrepancies"]) == 1
    assert data["discrepancies"][0]["disposition"] == "**UNRESOLVED**"
    out_path = tmp_path / "record.md"
    unresolved = capture.write_record(data, str(out_path))
    assert capture.exit_code_for(unresolved) == 2


def test_capture_emits_a_section_for_a_workload_with_only_undeclared_variables(
    monkeypatch, tmp_path
):
    """A workload that carries only application variables still gets a section."""
    monkeypatch.setattr(
        capture,
        "capture_workloads",
        lambda namespace: [
            {
                "kind": "deploy",
                "name": "genieai-genieai-umbrella-frontend",
                "component": "frontend",
                "selector": {"app.kubernetes.io/name": "frontend"},
                "replicas": 1,
                "containers": [
                    {
                        "name": "frontend",
                        "image": "x",
                        "env": {"VUE_APP_API_URL": "http://x"},
                    }
                ],
            }
        ],
    )
    monkeypatch.setattr(capture, "capture_pods", lambda namespace: [])
    monkeypatch.setattr(
        capture,
        "capture_topology",
        lambda namespace: {"services": [], "network_policies": 0},
    )
    monkeypatch.setattr(
        capture,
        "capture_release",
        lambda namespace, release: {
            "chart": {"chart": "genieai-umbrella"},
            "revision": 1,
            "overlay": {},
            "overlay_name": "(none)",
            "secret_paths": set(),
            "status": "",
            "ready": "",
        },
    )
    monkeypatch.setattr(capture, "capture_models", lambda namespace, env: {})
    monkeypatch.setattr(capture, "run", lambda args, check=True: "")
    monkeypatch.setattr(capture, "local_chart_version", lambda: "0.2.1")

    data = capture.capture(
        "genieai", "flux-system", "genieai", "2026-11-18", str(tmp_path / "record.md")
    )
    section = next(
        item
        for item in data["config"]
        if item["workload"] == "genieai-genieai-umbrella-frontend"
    )
    assert section["rows"] == []
    assert section["undeclared"]


# --------------------------------------------------------------------------
# the cleanups the scoped fix review listed
# --------------------------------------------------------------------------


def test_a_short_image_name_still_names_a_tag():
    """`redis:7-alpine` is a tag; a registry port is not."""
    assert capture.image_reference("redis:7-alpine") == ("redis", "7-alpine", "")
    assert capture.image_reference("registry.example.com:5000/team/app:v1") == (
        "registry.example.com:5000/team/app",
        "v1",
        "",
    )
    assert capture.image_reference("registry.example.com:5000/team/app") == (
        "registry.example.com:5000/team/app",
        "",
        "",
    )
    assert capture.image_reference("team/app@sha256:abc") == ("team/app", "", "sha256:abc")


def test_a_workload_that_runs_no_pod_says_why():
    """A scaled-to-zero workload is not a crashed one."""
    assert capture._not_running_status({"replicas": 0}) == "NOT RUNNING (scaled to zero)"
    assert (
        capture._not_running_status({"replicas": 1})
        == "NOT RUNNING (no running pod)"
    )


def test_a_targeted_overlay_path_through_a_scalar_fails_loudly():
    """Flux refuses such a path: the capture must not drop the source."""
    with pytest.raises(RuntimeError):
        capture.set_path({"a": 1}, "a.b", {})


def test_a_commented_out_row_is_not_a_declaration(tmp_path):
    """A Go template comment documents a row; the chart never renders it."""
    template = tmp_path / "svc.yaml"
    template.write_text(
        "{{- $svc := .Values.services.backend | default dict -}}\n"
        "{{/*\n"
        "- name: COMMENTED_OUT\n"
        "  value: {{ $svc.name }}\n"
        "*/ -}}\n"
        "- name: REAL\n"
        "  value: {{ $svc.name }}\n",
        encoding="utf-8",
    )
    mapping = capture.parse_template_env(str(template))
    assert "COMMENTED_OUT" not in mapping
    assert "REAL" in mapping


def test_a_non_negated_condition_the_capture_cannot_evaluate_is_conditional(
    tmp_path, chart_values, overlay_values
):
    """A condition that is neither a local nor a path leaves the row conditional."""
    template = tmp_path / "svc.yaml"
    template.write_text(
        "{{- $svc := .Values.services.backend | default dict -}}\n"
        "{{- if eq $svc.name \"x\" -}}\n"
        "- name: ONLY_WHEN_NAMED_X\n"
        "  value: {{ $svc.name }}\n"
        "{{- end -}}\n",
        encoding="utf-8",
    )
    mapping = capture.parse_template_env(str(template))
    assert mapping["ONLY_WHEN_NAMED_X"]["unresolved_guard"] is True

    overlay = {"opea": {"enabled": True}}
    effective = capture.deep_merge(chart_values, overlay)
    workload = {
        "name": "genieai-genieai-umbrella-chatqna",
        "component": "chatqna",
        "containers": [{"name": "chatqna", "image": "x", "env": {"LLM_MODEL": "m"}}],
    }
    rows, _ = capture.compare_workload(
        workload, {"chatqna": mapping}, chart_values, overlay, effective
    )
    row = next(row for row in rows if row["env"] == "ONLY_WHEN_NAMED_X")
    assert row["status"] == "CONDITIONAL"


def test_an_else_branch_declares_its_row_only_when_the_condition_does_not_hold(
    tmp_path, chart_values
):
    """The else branch is the negated condition, not an unresolved one."""
    template = tmp_path / "svc.yaml"
    template.write_text(
        "{{- $svc := .Values.services.backend | default dict -}}\n"
        "{{- if $svc.enabled -}}\n"
        "- name: WHEN_ENABLED\n"
        "  value: {{ $svc.name }}\n"
        "{{- else -}}\n"
        "- name: WHEN_DISABLED\n"
        "  value: {{ $svc.name }}\n"
        "{{- end -}}\n",
        encoding="utf-8",
    )
    mapping = capture.parse_template_env(str(template))

    def declared_rows(enabled):
        overlay = {"opea": {"enabled": True}, "services": {"backend": {"enabled": enabled}}}
        effective = capture.deep_merge(chart_values, overlay)
        workload = {
            "name": "genieai-genieai-umbrella-chatqna",
            "component": "chatqna",
            "containers": [{"name": "chatqna", "image": "x", "env": {"LLM_MODEL": "m"}}],
        }
        rows, _ = capture.compare_workload(
            workload, {"chatqna": mapping}, chart_values, overlay, effective
        )
        return [row["env"] for row in rows]

    assert "WHEN_ENABLED" in declared_rows(True)
    assert "WHEN_DISABLED" not in declared_rows(True)
    assert "WHEN_DISABLED" in declared_rows(False)
    assert "WHEN_ENABLED" not in declared_rows(False)


def test_the_capture_only_reads_the_cluster():
    """The capture is read-only: it runs no mutating kubectl verb."""
    with open(SCRIPT, encoding="utf-8") as handle:
        source = handle.read()
    mutating = (
        "delete",
        "apply",
        "patch",
        "create",
        "replace",
        "edit",
        "scale",
        "rollout",
        "annotate",
        "label",
        "port-forward",
        "exec",
        "drain",
        "cordon",
    )
    for invocation in re.findall(r'\[\s*"kubectl".*?\]', source, re.S):
        for verb in mutating:
            assert f'"{verb}"' not in invocation, invocation


def test_the_record_carries_the_capture_date(tmp_path):
    """The record is dated: the capture's date is in its heading."""
    data = _record_data()
    data["capture"]["date"] = "2026-11-18"
    out_path = tmp_path / "record.md"
    capture.write_record(data, str(out_path))
    assert "2026-11-18" in out_path.read_text(encoding="utf-8").splitlines()[0]


# --------------------------------------------------------------------------
# the chart identity
# --------------------------------------------------------------------------


def _attested_chart(template_overrides=None, metadata_version=None):
    """The chart the deployment runs, built from the chart source this
    checkout carries.

    The content is the chart source's own, so the attested chart is the one
    a commit of this checkout carries - which is what the identity resolves
    against.
    """
    import yaml

    templates = []
    files = []
    for path, content in sorted(capture.local_chart_files().items()):
        entry = {"name": path, "data": base64.b64encode(content).decode("ascii")}
        if path.startswith("templates/"):
            templates.append(entry)
        else:
            files.append(entry)
    for entry in templates:
        override = (template_overrides or {}).get(entry["name"])
        if override is not None:
            entry["data"] = base64.b64encode(override).decode("ascii")
    with open(os.path.join(capture.CHART_DIR, "values.yaml"), encoding="utf-8") as handle:
        values = yaml.safe_load(handle)
    with open(os.path.join(capture.CHART_DIR, "Chart.lock"), encoding="utf-8") as handle:
        lock = yaml.safe_load(handle)
    return {
        "templates": templates,
        "files": files,
        "values": values,
        "metadata": {
            "name": "genieai-umbrella",
            "version": metadata_version or capture.local_chart_version(),
        },
        "lock": lock,
    }


# The template content no commit of this checkout carries: a chart the
# repository never saw, so the identity cannot resolve it.
_UNKNOWN_CHART = {
    "templates/opea/chatqna.yaml": b"-- a chart this checkout does not know\n"
}


def _encoded_release(payload):
    """A Helm release payload, the way Helm stores it: base64(gzip(json))."""
    import gzip
    import json

    return base64.b64encode(
        gzip.compress(json.dumps(payload).encode("utf-8"))
    ).decode("ascii")


def _release_secret(chart):
    """The release secret, encoded the way kubectl returns it.

    Helm stores the release as base64(gzip(json)); the secret holds that
    value, and kubectl returns the secret's data base64-encoded again. The
    capture decodes what kubectl returns, so the fixture carries both
    layers - the shape the production path reads.
    """
    payload = _encoded_release({"chart": chart})
    return {"data": {"release": base64.b64encode(payload.encode("ascii")).decode("ascii")}}


def _stub_release_secret(monkeypatch, chart=None, template_overrides=None):
    """The release secret the capture reads for the deployed revision."""
    monkeypatch.setattr(
        capture,
        "kubectl_json",
        lambda *args, **kwargs: _release_secret(
            chart
            if chart is not None
            else _attested_chart(template_overrides=template_overrides)
        ),
    )


def _release_info(**overrides):
    """The release facts the identity is resolved from."""
    info = {
        "chart_name": "genieai-umbrella",
        "chart_version": "0.2.182",
        "source_ref": {
            "kind": "GitRepository",
            "name": "genie-ai",
            "namespace": "flux-system",
        },
        "storage_namespaces": ["flux-system"],
        "release": "genieai",
        "revision": 72,
    }
    info.update(overrides)
    return info


def test_the_identity_names_the_chart_the_deployment_runs(monkeypatch):
    """The chart the deployment runs is read from the cluster objects."""
    _stub_release_secret(monkeypatch)
    identity = capture.chart_identity(_release_info())
    assert identity["status"] == "IDENTICAL"
    assert identity["chart_version"] == "0.2.182"
    assert identity["source_kind"] == "GitRepository"
    assert identity["commit"], (
        "the identity must name the commit that carries the chart"
    )
    assert identity["files"] == len(capture.local_chart_files())
    assert identity["differences"] == []


def test_a_commit_this_checkout_does_not_know_fails_closed(monkeypatch):
    """A chart no commit of this checkout carries cannot be established."""
    _stub_release_secret(monkeypatch, template_overrides=_UNKNOWN_CHART)
    identity = capture.chart_identity(_release_info())
    assert identity["status"] == "UNRESOLVED"
    assert identity["commit"] == ""
    rows = capture.chart_identity_rows(identity)
    assert len(rows) == 1
    assert rows[0]["disposition"] == "**UNRESOLVED**"


def test_an_empty_commit_fails_closed(monkeypatch):
    """An attested chart with no template: the commit that would carry it is
    empty, so it attests nothing."""
    chart = _attested_chart()
    chart["templates"] = []
    _stub_release_secret(monkeypatch, chart=chart)
    identity = capture.chart_identity(_release_info())
    assert identity["status"] == "UNRESOLVED"
    assert "no template" in identity["reason"]


def test_a_source_that_is_not_a_git_repository_fails_closed():
    """A release that does not render from a git source has no commit."""
    identity = capture.chart_identity(
        _release_info(source_ref={"kind": "HelmRepository", "name": "genieai"})
    )
    assert identity["status"] == "UNRESOLVED"
    assert "GitRepository" in identity["reason"]


def test_a_missing_release_secret_fails_closed(monkeypatch):
    """A release secret that cannot be read attests no chart."""

    def boom(*args, **kwargs):
        raise RuntimeError("command failed (1): kubectl get secret")

    monkeypatch.setattr(capture, "kubectl_json", boom)
    identity = capture.chart_identity(_release_info())
    assert identity["status"] == "UNRESOLVED"
    assert "release secret" in identity["reason"]


def test_a_differing_chart_source_is_recorded_with_its_disposition(
    tmp_path, monkeypatch
):
    """A chart source that is not the deployed chart is a known difference."""
    attested = _attested_chart()
    _stub_release_secret(monkeypatch, chart=attested)
    files = capture.local_chart_files()
    files["templates/opea/chatqna.yaml"] = b"-- another revision of the template\n"
    monkeypatch.setattr(capture, "local_chart_files", lambda: files)
    identity = capture.chart_identity(_release_info())
    assert identity["status"] == "DIFFERENT"
    paths = [difference["path"] for difference in identity["differences"]]
    assert "templates/opea/chatqna.yaml" in paths
    rows = capture.chart_identity_rows(identity)
    assert rows
    assert all(row["disposition"] != "**UNRESOLVED**" for row in rows)
    # A difference that IS established is recorded, not a failure: the
    # capture states the truth and exits zero on it.
    data = _record_data()
    data["chart_identity"] = identity
    data["discrepancies"] = capture.collect_discrepancies([], [], [], identity)
    out_path = tmp_path / "record.md"
    unresolved = capture.write_record(data, str(out_path))
    assert capture.exit_code_for(unresolved) == 0
    assert "templates/opea/chatqna.yaml" in out_path.read_text(encoding="utf-8")


def test_a_file_the_source_does_not_carry_is_a_difference(monkeypatch):
    """A file the attested chart carries and the source does not, and the
    other way round, are both differences."""
    attested = _attested_chart()
    _stub_release_secret(monkeypatch, chart=attested)
    files = capture.local_chart_files()
    dropped = "templates/opea/chatqna.yaml"
    added = "templates/opea/never-in-the-attested-chart.yaml"
    files.pop(dropped)
    files[added] = b"-- a file the release never carried\n"
    monkeypatch.setattr(capture, "local_chart_files", lambda: files)
    identity = capture.chart_identity(_release_info())
    assert identity["status"] == "DIFFERENT"
    kinds = {
        difference["path"]: difference["kind"]
        for difference in identity["differences"]
    }
    assert kinds[dropped] == "missing"
    assert kinds[added] == "extra"


def test_an_unestablishable_identity_fails_the_capture(tmp_path, monkeypatch):
    """An identity the capture cannot establish fails the capture."""
    _stub_release_secret(monkeypatch, template_overrides=_UNKNOWN_CHART)
    identity = capture.chart_identity(_release_info())
    data = _record_data()
    data["chart_identity"] = identity
    data["discrepancies"] = capture.collect_discrepancies([], [], [], identity)
    out_path = tmp_path / "record.md"
    unresolved = capture.write_record(data, str(out_path))
    assert capture.exit_code_for(unresolved) == 2


def test_the_record_states_the_chart_the_deployment_runs(tmp_path, monkeypatch):
    """The record says which chart the deployment runs, and where it came from."""
    _stub_release_secret(monkeypatch)
    identity = capture.chart_identity(_release_info())
    data = _record_data()
    data["chart_identity"] = identity
    out_path = tmp_path / "record.md"
    capture.write_record(data, str(out_path))
    record = out_path.read_text(encoding="utf-8")
    assert "## Chart identity" in record
    assert "0.2.182" in record
    assert identity["commit"] in record
    # The source the release was rendered from is named too.
    assert "GitRepository" in record
    assert "genie-ai" in record


def test_an_unresolved_identity_states_its_reason_in_the_record(tmp_path, monkeypatch):
    """A comparison that was not established says so, and why."""
    _stub_release_secret(monkeypatch, template_overrides=_UNKNOWN_CHART)
    identity = capture.chart_identity(_release_info())
    data = _record_data()
    data["chart_identity"] = identity
    out_path = tmp_path / "record.md"
    capture.write_record(data, str(out_path))
    record = out_path.read_text(encoding="utf-8")
    assert "UNRESOLVED" in record
    assert "no commit of this checkout carries the chart" in record
    assert "Chart files compared:** not established" in record


def test_the_okf_tier_is_compared_like_the_retrieval_tier(
    chart_values, overlay_values, env_maps
):
    """The three non-retrieval tiers carry their component label and their
    chart-declared environment is compared against the chart source."""
    effective = capture.deep_merge(chart_values, overlay_values)
    for component in ("pii-service", "okf-server", "ragas-service"):
        assert component in capture.OPEA_WORKLOADS
        assert env_maps[component], f"{component} template parsed nothing"
    workload = {
        "name": "genieai-genieai-umbrella-okf-server",
        "component": "okf-server",
        "containers": [
            {
                "name": "okf-server",
                "image": "x",
                "env": {"OKF_MAX_CONCEPT_DOC_CHARS": ""},
            }
        ],
    }
    rows, _ = capture.compare_workload(
        workload, env_maps, chart_values, overlay_values, effective
    )
    compared = [row for row in rows if row["env"] == "OKF_MAX_CONCEPT_DOC_CHARS"]
    assert compared, "the tier's chart-declared environment must be compared"
    assert compared[0]["status"] == "MATCH"
    assert compared[0]["source_path"] == "okf.maxConceptDocChars"


def test_the_okf_tier_operator_env_map_is_compared(chart_values, env_maps):
    """The operator's own env map is compared for the OKF tier too."""
    overlay = {"okf": {"enabled": True, "pii": {"env": {"PII_WEB_CONCURRENCY": "8"}}}}
    effective = capture.deep_merge(chart_values, overlay)
    workload = {
        "name": "genieai-genieai-umbrella-pii-service",
        "component": "pii-service",
        "containers": [
            {"name": "pii-service", "image": "x", "env": {"PII_WEB_CONCURRENCY": "8"}}
        ],
    }
    rows, _ = capture.compare_workload(
        workload, env_maps, chart_values, overlay, effective
    )
    compared = [row for row in rows if row["env"] == "PII_WEB_CONCURRENCY"]
    assert compared, "the operator's env map must be compared"
    assert compared[0]["status"] == "MATCH"
    assert compared[0]["source_path"] == "okf.pii.env.PII_WEB_CONCURRENCY"


def test_a_malformed_release_payload_fails_closed(monkeypatch):
    """A payload the capture cannot read attests no chart."""
    encoded = base64.b64encode(b"not a helm release").decode("ascii")
    monkeypatch.setattr(
        capture, "kubectl_json", lambda *args, **kwargs: {"data": {"release": encoded}}
    )
    identity = capture.chart_identity(_release_info())
    assert identity["status"] == "UNRESOLVED"
    assert "release secret" in identity["reason"]


def test_a_garbled_release_payload_fails_closed(monkeypatch):
    """A payload whose deflate stream is garbled attests no chart."""
    import gzip

    corrupted = gzip.compress(b"x" * 4000)[:12] + bytes(range(200))
    encoded = base64.b64encode(corrupted).decode("ascii")
    monkeypatch.setattr(
        capture, "kubectl_json", lambda *args, **kwargs: {"data": {"release": encoded}}
    )
    identity = capture.chart_identity(_release_info())
    assert identity["status"] == "UNRESOLVED"


def test_the_two_attestations_of_the_chart_must_agree(monkeypatch):
    """The release history and the release secret must name the same chart."""
    _stub_release_secret(monkeypatch)
    identity = capture.chart_identity(_release_info(chart_version="0.2.181"))
    assert identity["status"] == "DIFFERENT"
    paths = [difference["path"] for difference in identity["differences"]]
    assert "release history: version" in paths


def test_a_null_leaf_and_an_empty_one_are_different(monkeypatch):
    """The chart declares null; the chart the deployment runs carries ""."""
    attested = _attested_chart()
    attested["values"]["services"]["backend"]["replicas"] = ""
    _stub_release_secret(monkeypatch, chart=attested)
    identity = capture.chart_identity(_release_info())
    assert identity["status"] == "DIFFERENT"
    paths = [difference["path"] for difference in identity["differences"]]
    assert "values.yaml:services.backend.replicas" in paths


def test_a_release_payload_of_the_wrong_shape_fails_closed(monkeypatch):
    """A payload that is valid JSON of the wrong shape attests no chart."""
    for payload in (
        [1, 2, 3],
        {"chart": [1, 2]},
        {"chart": "x"},
        {"chart": {"templates": "abc"}},
        {"chart": {"templates": ["abc"]}},
        {"chart": {"templates": [{"name": "t", "data": 5}]}},
    ):
        secret = {"data": {"release": _encoded_release(payload)}}
        monkeypatch.setattr(
            capture,
            "kubectl_json",
            lambda *args, _secret=secret, **kwargs: _secret,
        )
        identity = capture.chart_identity(_release_info())
        assert identity["status"] == "UNRESOLVED", payload


def test_a_deployed_revision_without_a_chart_version_fails_closed(monkeypatch):
    """A deployed revision the history names no chart version for: not attested."""
    _stub_release_secret(monkeypatch)
    identity = capture.chart_identity(_release_info(chart_version=""))
    assert identity["status"] == "UNRESOLVED"
    assert "no chart version" in identity["reason"]


def test_an_incomplete_chart_source_fails_closed(monkeypatch):
    """A checkout without the chart's lock cannot be compared."""
    _stub_release_secret(monkeypatch)
    monkeypatch.setattr(capture, "chart_source_complete", lambda: False)
    identity = capture.chart_identity(_release_info())
    assert identity["status"] == "UNRESOLVED"
    assert "incomplete" in identity["reason"]


def test_a_release_history_without_a_deployed_entry_is_not_attested(monkeypatch):
    """The production path: a history with no deployed entry attests no chart."""
    helmrelease = {
        "spec": {
            "chart": {
                "spec": {
                    "chart": "charts/genieai-umbrella",
                    "sourceRef": {
                        "kind": "GitRepository",
                        "name": "genie-ai",
                        "namespace": "flux-system",
                    },
                }
            }
        },
        "status": {
            "conditions": [
                {"type": "Ready", "status": "False", "message": "upgrade failed"}
            ],
            "history": [{"version": 72, "chartVersion": "0.2.182", "status": "failed"}],
            "storageNamespace": "flux-system",
        },
    }
    monkeypatch.setattr(capture, "kubectl_json", lambda namespace, *args: helmrelease)
    release = capture.capture_release("flux-system", "genieai")
    assert release["chart_version"] == ""
    assert release["history_deployed"] is False
    identity = capture.chart_identity(release)
    assert identity["status"] == "UNRESOLVED"
    assert "no deployed revision" in identity["reason"]


def test_the_chart_version_is_the_deployed_revision_s(monkeypatch):
    """The version and the name the history records are the deployed
    revision's, not the failed upgrade above it."""
    helmrelease = {
        # The spec carries the chart PATH, the history the chart's name: the
        # two differ on purpose, so the assertion below pins where the name
        # comes from. The names of the three entries differ on purpose too -
        # a real Flux history carries the same chart name in every entry, so
        # identical names would leave the assertion unable to fail.
        "spec": {"chart": {"spec": {"chart": "charts/genieai-umbrella"}}},
        "status": {
            "conditions": [{"type": "Ready", "status": "True", "message": "ok"}],
            "history": [
                {
                    "version": 71,
                    "chartVersion": "0.2.181",
                    "chartName": "genieai-umbrella-superseded",
                    "status": "superseded",
                },
                {
                    "version": 72,
                    "chartVersion": "0.2.182",
                    "chartName": "genieai-umbrella",
                    "status": "deployed",
                },
                {
                    "version": 73,
                    "chartVersion": "0.2.183",
                    "chartName": "genieai-umbrella-failed",
                    "status": "failed",
                },
            ],
        },
    }
    monkeypatch.setattr(
        capture, "kubectl_json", lambda namespace, *args: helmrelease
    )
    release = capture.capture_release("flux-system", "genieai")
    assert release["revision"] == 72
    assert release["chart_version"] == "0.2.182"
    assert release["chart_name"] == "genieai-umbrella"
    assert release["history_deployed"] is True


def test_the_release_secret_is_looked_for_in_every_candidate_namespace(monkeypatch):
    """The release secret is read from the storage namespace, and the next
    candidate is tried when one holds no secret."""
    helmrelease = {
        "spec": {
            "chart": {
                "spec": {
                    "chart": "genieai-umbrella",
                    "sourceRef": {
                        "kind": "GitRepository",
                        "name": "genie-ai",
                        "namespace": "flux-system",
                    },
                }
            },
            "targetNamespace": "genieai",
        },
        "status": {
            "conditions": [{"type": "Ready", "status": "True", "message": "ok"}],
            "history": [
                {"version": 72, "chartVersion": "0.2.182", "status": "deployed"}
            ],
        },
    }
    attested = _attested_chart()

    def fake_kubectl(namespace, *args):
        if "helmrelease" in args:
            return helmrelease
        if "secret" in args:
            if namespace == "flux-system":
                raise RuntimeError("command failed (1): kubectl get secret")
            return _release_secret(attested)
        raise AssertionError(f"unexpected kubectl call: {args}")

    monkeypatch.setattr(capture, "kubectl_json", fake_kubectl)
    release = capture.capture_release("flux-system", "genieai")
    assert release["storage_namespaces"] == ["flux-system", "genieai"]
    identity = capture.chart_identity(release)
    assert identity["status"] == "IDENTICAL"


def test_the_chart_source_of_this_checkout_is_complete():
    """The predicate the identity leans on is exercised on a real checkout."""
    assert capture.chart_source_complete() is True


def test_the_chart_source_guard_covers_every_file_the_comparison_reads():
    """The guard's list is the files the capture reads - no file left out."""
    expected = {
        "Chart.yaml",
        "Chart.lock",
        "values.yaml",
        os.path.join("templates", "services", "backend.yaml"),
    }
    expected.update(
        os.path.join("templates", "opea", name)
        for name in capture.OPEA_WORKLOADS.values()
    )
    assert set(capture.chart_source_files()) == expected


@pytest.mark.parametrize(
    "missing",
    [
        "Chart.yaml",
        "Chart.lock",
        "values.yaml",
        os.path.join("templates", "services", "backend.yaml"),
        os.path.join("templates", "opea", "chatqna.yaml"),
    ],
)
def test_a_missing_chart_source_file_leaves_the_source_incomplete(missing, monkeypatch):
    """Dropping any file from the guard would let an incomplete source through."""
    import os as os_module

    real_exists = os_module.path.exists
    suffix = os.path.join("genieai-umbrella", missing)

    def without_it(path):
        if str(path).endswith(suffix):
            return False
        return real_exists(path)

    monkeypatch.setattr(capture.os.path, "exists", without_it)
    assert capture.chart_source_complete() is False

