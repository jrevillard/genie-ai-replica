"""AMINA translation v2 pipeline.

Staged migration scaffold (Step 0). Inert until feature flags flip.
See README.md and STEP_0_NOTES.md.

The legacy translator at services.translator is the only live path.
"""

# Stage 8b — entry-point-independent activation. When any USE_V2_*
# flag is set, install the legacy shim so the live entry point
# (main_with_emergency, main_with_literacy, etc.) picks up v2 without
# needing a dedicated main_with_translation_v2 switch. No-op when all
# flags are False; safe to import under every entry point.
from . import _autoinstall  # noqa: F401  (side-effect import)
