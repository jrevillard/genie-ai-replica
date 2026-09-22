/**
 * Shared cache schema config for the agri LKG layer.
 *
 * Web + mobile each maintain their own copy of these constants (mobile in
 * lib/services/agri_api_service.dart). When bumping the schema version,
 * ALSO add a migration entry to AgriApiService's constructor — otherwise
 * old `agri-lkg:vN:*` keys orphan in localStorage forever.
 *
 * The pairing matters: `CACHE_PREFIX + CACHE_SCHEMA_VERSION` is the
 * canonical LKG key namespace. Don't split them.
 */
export const CACHE_PREFIX = 'agri-lkg:';
export const CACHE_SCHEMA_VERSION = 'v2';
export const CACHE_KEY = `${CACHE_PREFIX}${CACHE_SCHEMA_VERSION}:`;
