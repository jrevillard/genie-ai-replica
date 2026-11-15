// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// The navbar's declared handles, as one module: a spec that reads a
// navbar control imports the constant instead of re-typing the
// attribute selector — a rename lands here once (the helpers/layout.js
// pattern). Credentials stay in helpers/e2e-fixtures.js per the
// fixtures import-path convention; this module carries selectors only.
//
// NAV_LOGOUT_BUTTON doubles as the authenticated-shell proof: App.vue
// renders the navbar (this button with it) only inside its authenticated
// gate (isAuthenticated && currentUser), so a visible logout button
// proves the authenticated UI actually rendered — not merely that a URL
// matched. This is desktop-shell scoped: a mobile-viewport run renders
// the mobile sibling (nav-icon-btn-logout-mobile) instead.
const NAV_LOGOUT_BUTTON = '[data-test-id="nav-icon-btn-logout"]';

module.exports = { NAV_LOGOUT_BUTTON };
