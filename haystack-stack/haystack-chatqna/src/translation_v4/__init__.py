"""
AMINA Translation v3.5 (the v4-architecture slice without NLLB).

Master flag: AMINA_TRANSLATION_V4_ENABLED (env var, default false).
Reuses the v4 name on purpose so v4.2 can swap engines beneath without
another flag flip.

Stages (1, 2, 4-8 in v3.5; 3 deferred to v4.2):
    1. Simplifier       -- pre-translation English simplification
    2. Multi-engine     -- phrasebank + LLM (NLLB engine deferred)
    3. Bambara adapter  -- DEFERRED to v4.2
    4. Back-translator  -- cross-temperature LLM round-trip
    5. Quality scorer   -- 4-axis (clinical safety, fidelity, fluency, fit)
    6. Clinical gate    -- wraps existing v5.1 corrector
    7. Sentence router  -- per-sentence serve decision
    8. Telemetry        -- structured JSON log (no ArcadeDB in v3.5)

When the flag is OFF, importing this module is harmless: ``pipeline.translate``
returns ``None`` immediately and the v1 path runs untouched.
"""
