// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// keycloak-auth-service.js — thin re-export of the shared OIDC verifier.
//
// The verifier lives in components/shared/lib/keycloak-auth-service.js (the
// single copy; also consumed by okf-server). This file keeps the backend's
// historical require path (`../services/keycloak-auth-service`) stable for
// the middleware and user-provisioning service.
module.exports = require('../shared-lib/keycloak-auth-service');
