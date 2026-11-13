// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// The navbar's declared handles, as one module: a spec that reads a
// navbar control imports the constant instead of re-typing the
// attribute selector — a rename lands here once (the helpers/layout.js
// pattern). Credentials stay in helpers/e2e-fixtures.js per the
// fixtures import-path convention; this module carries selectors only.
const NAV_LOGOUT_BUTTON = '[data-test-id="nav-icon-btn-logout"]';

module.exports = { NAV_LOGOUT_BUTTON };
