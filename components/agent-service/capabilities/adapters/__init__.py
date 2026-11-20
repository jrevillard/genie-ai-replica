# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Adapters of the document capability layer: the OPEA-free implementations.

Each adapter ports one stage of the recorded query path (V02,
``docs/baselines/v02-opea-query-path-contract.md``). The behavior is frozen to
the record; the structure is free (clean-slate per the architecture spine's
AD-10). No adapter imports the OPEA overlay or its ``comps`` package.
"""
