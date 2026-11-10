'use strict';

// Re-export the real parsePositiveInt (pure function, no deps) so that
// the virtual-mock for `shared-lib/validation-utils` can share this file.
const { parsePositiveInt } = require('../../../shared/lib/validation-utils');
// Re-exported for real, not stubbed: the stream handler calls
// `tracingBaggage.withBaggage` around the chatqna request, and a stub would
// silently skip the baggage instead of failing.
const spanAttrs = require('../../../shared/lib/span-attrs');
const tracingBaggage = require('../../../shared/lib/tracing-baggage');
// The canonical ArangoDB absence predicate, re-exported for real (pure
// function, no deps) so the mocked dbService answers exactly like the real one.
const { isExpectedAbsence } = require('../../../shared/lib/arango-absence');
// Re-exported for real (pure function, no deps): the GDPR erasure tombstone
// digest shared by keycloak-proxy-service and user-provisioning-service.
const { erasureTombstoneKey } = require('../../../shared/lib/erasure-tombstone');
// Re-exported for real (pure function, no deps): human-readable byte
// formatting and the arangojs figures() decode shared by the admin stats
// and backup services.
const { formatSize, readCollectionUsage } = require('../../../shared/lib/format-utils');

module.exports = {
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  },
  dbService: { getConnection: jest.fn() },
  isExpectedAbsence,
  securityHeaders: (req, res, next) => next(),
  SecurityMiddleware: { applySecurityMiddleware: jest.fn() },
  reconfigureLogger: jest.fn(),
  parsePositiveInt,
  erasureTombstoneKey,
  formatSize,
  readCollectionUsage,
  spanAttrs,
  tracingBaggage
};
