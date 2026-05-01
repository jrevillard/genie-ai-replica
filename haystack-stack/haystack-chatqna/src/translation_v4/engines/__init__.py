"""Translation v4.2 -- engine implementations.

v3.5 had two engines (phrasebank, LLM) inlined into stage2_multi_engine.py.
v4.2 adds NLLB as a third engine via the sidecar HTTP API. The
phrasebank and LLM engines stay in stage2 for backwards compatibility;
only the NLLB engine moves into this package.
"""
