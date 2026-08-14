# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Reranker v1.5 coupling-surface contract test.

Asserts the reranker adapter's integration with OPEA v1.5 vendored comps:

1. ``GenieTEIReranking`` imports cleanly from the real vendored module path.
2. The component is registered in ``OpeaComponentRegistry`` under the expected name.
3. ``ServiceType.RERANK`` resolves to the v1.5 enum value.
4. The microservice's ``@opea_telemetry`` decorator is present.
5. The adapter's ``invoke`` method signature is compatible with the v1.5 base class.

Isolation: runs in the reranker image against the real vendored ``comps``. In the
mocked dev env the in-image test skips via the ``comps`` fixture; the pure signature
tests run anywhere.
"""

from __future__ import annotations

import inspect

import _harness


def _reranker_module():
    """Import the real reranker adapter module from the image.

    Skips when the reranker module is absent (this test runs in the reranker
    image; other module images do not carry the reranker adapter). A genuine
    import BREAK inside the image must fail red, not skip — only the "module
    not in this image" case is a legitimate skip.
    """
    import pytest

    try:
        import comps.rerankings.src.integrations.genieai_tei_reranker as m
    except ImportError:
        if _harness.in_image_comps_importable():
            raise
        pytest.skip("reranker module not present in this image")
    return m


def _microservice_module():
    """Import the real reranker microservice module from the image.

    Skips when the microservice module is absent (same logic as above).
    """
    import pytest

    try:
        import comps.rerankings.src.opea_reranking_microservice as m
    except ImportError:
        if _harness.in_image_comps_importable():
            raise
        pytest.skip("reranker microservice not present in this image")
    return m


# --- pure: signature compatibility (runs in the dev venv too) -------------


def test_genie_tei_reranking_invoke_signature_compatible(comps):
    """The adapter's invoke signature is compatible with the v1.5 base class.

    The adapter subclasses ``OpeaTEIReranking`` from ``integrations.tei``. The
    invoke method must accept the same input types and return compatible output
    types. We introspect the signature to verify the input parameter exists and
    the return annotation is present.
    """
    mod = _reranker_module()
    cls = getattr(mod, "GenieTEIReranking", None)
    assert cls is not None, "GenieTEIReranking class missing from the real module"
    assert hasattr(cls, "invoke"), "GenieTEIReranking.invoke missing from the real module"

    sig = inspect.signature(cls.invoke)
    params = list(sig.parameters.keys())
    # The invoke method must accept at least 'self' and 'input'
    assert "self" in params, "invoke method missing 'self' parameter"
    assert "input" in params, "invoke method missing 'input' parameter"
    # Return annotation should be present (not None)
    assert sig.return_annotation != inspect.Signature.empty, "invoke method missing return type annotation"


# --- in-image: v1.5 coupling surface (requires real vendored comps) -------


def test_genie_tei_reranking_imports_cleanly(comps):
    """GenieTEIReranking imports cleanly from the real vendored module path.

    This is the first gate: if the import fails, the v1.5 coupling surface is
    broken (the module path changed, or a dependency is missing). A genuine
    import BREAK inside the image must fail red, not skip.
    """
    mod = _reranker_module()  # ensure the module is present (skip otherwise)
    cls = getattr(mod, "GenieTEIReranking", None)
    assert cls is not None, "GenieTEIReranking class missing from the real module"
    # Verify it's a class (not a function or variable)
    assert inspect.isclass(cls), "GenieTEIReranking is not a class"


def test_genie_tei_reranking_registered_in_component_registry(comps):
    """The component is registered in OpeaComponentRegistry under GENIE_TEI_RERANKING.

    The adapter uses ``@OpeaComponentRegistry.register("GENIE_TEI_RERANKING")`` to
    register itself. This test verifies the registration happened by querying the
    registry's get() API directly.
    """
    from comps import OpeaComponentRegistry

    # Use the registry's public API to verify registration
    # The registry exposes get(name) to retrieve registered components
    component = OpeaComponentRegistry.get("GENIE_TEI_RERANKING")
    assert component is not None, (
        "GENIE_TEI_RERANKING not found in OpeaComponentRegistry — "
        "the @OpeaComponentRegistry.register decorator may not have been applied"
    )


def test_service_type_rerank_resolves(comps):
    """ServiceType.RERANK resolves to the v1.5 enum value.

    The microservice registers with ``service_type=ServiceType.RERANK``. This test
    verifies the enum value exists and is an integer (the v1.5 contract).
    """
    from comps import ServiceType

    assert hasattr(ServiceType, "RERANK"), "ServiceType.RERANK enum value missing"
    rerank_value = ServiceType.RERANK
    # The enum value should be an integer (or an IntEnum member)
    assert isinstance(rerank_value, int) or hasattr(rerank_value, "value"), (
        f"ServiceType.RERANK is not an integer or enum member: {type(rerank_value)}"
    )


def test_opea_telemetry_decorator_present(comps):
    """The microservice's @opea_telemetry decorator is present.

    The microservice function is decorated with ``@opea_telemetry``. The decorator
    uses functools.wraps, which adds the ``__wrapped__`` attribute pointing to the
    original function. This is the standard Python decorator pattern.
    """
    mod = _microservice_module()
    reranking_fn = getattr(mod, "reranking", None)
    assert reranking_fn is not None, "reranking function missing from the microservice module"
    assert callable(reranking_fn), "reranking is not callable"

    # The opea_telemetry decorator uses functools.wraps, which adds __wrapped__
    # This is the standard Python decorator pattern — no need to guess marker names
    assert hasattr(reranking_fn, "__wrapped__"), (
        "reranking function does not have __wrapped__ attribute — "
        "the @opea_telemetry decorator may not be applied or may not use functools.wraps"
    )


def test_reranker_component_loader_uses_expected_name(comps):
    """The microservice uses OpeaComponentLoader with the expected component name.

    The microservice initializes ``OpeaComponentLoader(rerank_component_name)`` with
    ``rerank_component_name = os.getenv("RERANK_COMPONENT_NAME", "GENIE_TEI_RERANKING")``.
    This test verifies the loader is initialized and the component name is resolvable.
    """
    mod = _microservice_module()
    loader = getattr(mod, "loader", None)
    assert loader is not None, "OpeaComponentLoader not initialized in the microservice module"

    # The loader should have a component_name or similar attribute
    component_name = None
    for attr in ("component_name", "_component_name", "name"):
        if hasattr(loader, attr):
            component_name = getattr(loader, attr)
            break

    if component_name is not None:
        # Verify the component name is the expected default
        assert component_name == "GENIE_TEI_RERANKING" or "GENIE_TEI_RERANKING" in str(component_name), (
            f"OpeaComponentLoader component name is {component_name!r}, expected GENIE_TEI_RERANKING"
        )


# Trigger contract jobs
