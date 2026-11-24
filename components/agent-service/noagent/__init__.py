# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Config B — the fixed no-agent pipeline.

One single-pass call: preparation → retrieval/reranking/selection (the
``search_knowledge`` capability) → context/prompt construction → one fixed
generation stage → checking/verdict/result assembly, admitted through the
flock slot-pool lane. No agent loop, no tool calls, no multi-step reasoning:
E01 compares this pipeline against config A (the deployed path), which has
no executor and no loop either.

Modules:

* :mod:`config`   — the frozen env-knob surface (deployed names, deployed defaults).
* :mod:`lane`     — the admission lane (the flock slot-pool idiom).
* :mod:`generation` — the fixed generation client (recorded payload, discovery).
* :mod:`prompt`   — the ported prompt surface (system default, user template,
  document rendering, abstention injection, history truncation).
* :mod:`pipeline` — the single-pass entry :func:`NoAgentPipeline.run`.

The pipeline calls the capability DIRECTLY — never the executor: config A
has no executor, and the capability's own authorized-set check already
guards the call (the recorded decision).
"""
