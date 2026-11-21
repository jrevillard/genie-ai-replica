# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The component-wide AQL call-shape contract.

python-arango's ``AQL.execute`` binds its second positional parameter to
``count`` — a positional bind dict is accepted by Python, ships no
``bindVars`` at all, and is rejected server-side on the first real read.
Every adapter in the component therefore passes ``bind_vars`` by keyword,
and this file is that contract's canonical owner: an AST sweep over the
production package rejects a positional second argument to any
``.aql.execute`` call, in both shapes the component uses (the direct call
and the ``asyncio.to_thread`` form, where the bound method rides as an
argument). The per-suite module sweeps (``conftest.assert_module_aql_
fakes_faithful``) are the test-side twin: they keep every fake double
shaped like the real driver, so a call-shape regression cannot hide behind
a double that accepts it.
"""

from pathlib import Path

from conftest import assert_no_positional_aql_execute


def test_production_aql_calls_pass_bind_vars_by_keyword():
    assert_no_positional_aql_execute(Path(__file__).parent.parent / "capabilities")
