# Copyright (c) 2024-2026 International Telecommunication Union (ITU)

"""Mock-reality parity test.

This test runs inside the built Docker image where real ``comps`` is available.
It compares the stub inventory in ``tests/conftest.py`` against real v1.5
``comps`` and fails if the suite stubs a dead symbol (v1.3-only) or misses a
v1.5 addition.

The parity check is the guardrail that prevents conftest.py from drifting
silently away from reality. Without it, the mocked suite can be green against
fiction (v1.3 stubs) while the real image ships v1.5.
"""

from pathlib import Path

import pytest


def _load_conftest_stub_inventory():
    """Load the stub inventory from tests/conftest.py.

    Returns a dict mapping module path → set of stubbed attribute names.
    """
    conftest_path = Path(__file__).parent.parent / "tests" / "conftest.py"
    if not conftest_path.exists():
        return {}

    # Parse conftest.py for sys.modules.setdefault() calls
    stubs = {}
    with open(conftest_path) as f:
        for line in f:
            line = line.strip()
            if line.startswith("sys.modules.setdefault("):
                # Extract module path from sys.modules.setdefault("path", ...)
                parts = line.split('"')
                if len(parts) >= 2:
                    module_path = parts[1]
                    stubs[module_path] = set()

    return stubs


def _get_real_comps_inventory():
    """Get the real v1.5 comps module inventory.

    Returns a dict mapping module path → set of available attribute names.
    """
    inventory = {}

    # Top-level comps module
    try:
        import comps

        inventory["comps"] = set(dir(comps))
    except ImportError:
        pass

    # comps.cores.proto.docarray
    try:
        from comps.cores.proto import docarray

        inventory["comps.cores.proto.docarray"] = set(dir(docarray))
    except (ImportError, AttributeError):
        pass

    # comps.cores.proto.api_protocol
    try:
        from comps.cores.proto import api_protocol

        inventory["comps.cores.proto.api_protocol"] = set(dir(api_protocol))
    except (ImportError, AttributeError):
        pass

    # comps.cores.proto.genieai_api_protocol
    try:
        from comps.cores.proto import genieai_api_protocol

        inventory["comps.cores.proto.genieai_api_protocol"] = set(dir(genieai_api_protocol))
    except (ImportError, AttributeError):
        pass

    # comps.cores.telemetry.opea_telemetry
    try:
        from comps.cores.telemetry import opea_telemetry

        inventory["comps.cores.telemetry.opea_telemetry"] = set(dir(opea_telemetry))
    except (ImportError, AttributeError):
        pass

    # comps.dataprep.src.integrations.arangodb
    try:
        from comps.dataprep.src.integrations import arangodb

        inventory["comps.dataprep.src.integrations.arangodb"] = set(dir(arangodb))
    except (ImportError, AttributeError):
        pass

    # comps.dataprep.src.utils
    try:
        from comps.dataprep.src import utils

        inventory["comps.dataprep.src.utils"] = set(dir(utils))
    except (ImportError, AttributeError):
        pass

    # comps.rerankings.src.integrations.genieai_tei_reranker
    try:
        from comps.rerankings.src.integrations import genieai_tei_reranker

        inventory["comps.rerankings.src.integrations.genieai_tei_reranker"] = set(dir(genieai_tei_reranker))
    except (ImportError, AttributeError):
        pass

    # comps.retrievers.src.integrations.genieai_retriever_arangodb
    try:
        from comps.retrievers.src.integrations import genieai_retriever_arangodb

        inventory["comps.retrievers.src.integrations.genieai_retriever_arangodb"] = set(dir(genieai_retriever_arangodb))
    except (ImportError, AttributeError):
        pass

    return inventory


def test_mock_reality_parity():
    """Verify conftest.py stubs match real v1.5 comps.

    Fails if:
    - A stubbed module path doesn't exist in v1.5 (dead stub)
    - A v1.5 module used by overlay code isn't stubbed (missing stub)
    """
    # This test only runs inside Docker where real comps is available
    try:
        import comps  # noqa: F401
    except ImportError:
        pytest.skip("Real comps not available (not inside Docker build)")

    stub_inventory = _load_conftest_stub_inventory()
    real_inventory = _get_real_comps_inventory()

    dead_stubs = []
    missing_stubs = []

    # Check for dead stubs (stubbed but not in v1.5)
    for module_path in stub_inventory:
        if module_path not in real_inventory:
            dead_stubs.append(module_path)

    # Check for missing stubs (in v1.5 but not stubbed)
    # We only check modules that overlay code imports
    required_modules = [
        "comps",
        "comps.cores.proto.docarray",
        "comps.cores.proto.api_protocol",
        "comps.cores.proto.genieai_api_protocol",
        "comps.cores.telemetry.opea_telemetry",
        "comps.dataprep.src.integrations.arangodb",
        "comps.dataprep.src.utils",
        "comps.rerankings.src.integrations.genieai_tei_reranker",
        "comps.retrievers.src.integrations.genieai_retriever_arangodb",
    ]

    for module_path in required_modules:
        if module_path in real_inventory and module_path not in stub_inventory:
            missing_stubs.append(module_path)

    if dead_stubs:
        pytest.fail(f"Dead stubs (stubbed but not in v1.5): {', '.join(dead_stubs)}")

    if missing_stubs:
        pytest.fail(f"Missing stubs (in v1.5 but not stubbed): {', '.join(missing_stubs)}")


def test_v1_5_service_type_slots():
    """Verify ServiceType enum matches v1.5 upstream (slots 0-28 + TRANSLATOR=29)."""
    try:
        from comps import ServiceType
    except ImportError:
        pytest.skip("Real comps not available (not inside Docker build)")

    # v1.5 slots (from core/constants.py)
    expected_slots = {
        "GATEWAY": 0,
        "EMBEDDING": 1,
        "RETRIEVER": 2,
        "RERANK": 3,
        "LLM": 4,
        "ASR": 5,
        "TTS": 6,
        "GUARDRAIL": 7,
        "VECTORSTORE": 8,
        "DATAPREP": 9,
        "UNDEFINED": 10,
        "RAGAS": 11,
        "LVM": 12,
        "KNOWLEDGE_GRAPH": 13,
        "WEB_RETRIEVER": 14,
        "IMAGE2VIDEO": 15,
        "TEXT2IMAGE": 16,
        "ANIMATION": 17,
        "IMAGE2IMAGE": 18,
        "TEXT2SQL": 19,
        "TEXT2GRAPH": 20,
        "TEXT2CYPHER": 21,
        "TEXT2KG": 22,
        "STRUCT2GRAPH": 23,
        "LANGUAGE_DETECTION": 24,
        "PROMPT_TEMPLATE": 25,
        "PROMPT_REGISTRY": 26,
        "TEXT2QUERY": 27,
        "ARB_POST_HEARING_ASSISTANT": 28,
        "TRANSLATOR": 29,  # OVERRIDE: re-appended tail
    }

    for name, expected_value in expected_slots.items():
        assert hasattr(ServiceType, name), f"ServiceType.{name} missing in v1.5"
        actual_value = ServiceType[name].value
        assert actual_value == expected_value, f"ServiceType.{name} = {actual_value}, expected {expected_value}"
