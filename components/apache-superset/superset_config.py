# superset_config.py - ArcadeDB compatibility patches
SECRET_KEY = "aminaSupersetKey2026!xZ9qR3vL7wP2nK"
WTF_CSRF_ENABLED = False

from sqlalchemy.dialects.postgresql.base import PGDialect
from sqlalchemy.engine.default import DefaultDialect

# Patch 1: Skip pg_catalog.version()
_orig_version = PGDialect._get_server_version_info
def _patched_version(self, connection):
    try:
        return _orig_version(self, connection)
    except Exception:
        return (14, 0, 0)
PGDialect._get_server_version_info = _patched_version

# Patch 2: Ignore rollback errors
_orig_rollback = DefaultDialect.do_rollback
def _patched_rollback(self, dbapi_connection):
    try:
        _orig_rollback(self, dbapi_connection)
    except Exception:
        pass
DefaultDialect.do_rollback = _patched_rollback

# Patch 3: Skip current_schema()
_orig_schema = PGDialect._get_default_schema_name
def _patched_schema(self, connection):
    try:
        return _orig_schema(self, connection)
    except Exception:
        return None
PGDialect._get_default_schema_name = _patched_schema

# Patch 4: Skip isolation level detection
def _patched_isolation_level(self, dbapi_conn):
    return "READ COMMITTED"
PGDialect.get_isolation_level = _patched_isolation_level

# Patch 5: Skip get_default_isolation_level
def _patched_default_isolation(self, dbapi_conn):
    return "READ COMMITTED"
DefaultDialect.get_default_isolation_level = _patched_default_isolation

# Patch 6: Replace initialize entirely
def _patched_initialize(self, connection):
    self.default_isolation_level = "READ COMMITTED"
    self.server_version_info = (14, 0, 0)
    self.default_schema_name = None
    self.standard_conforming_strings = True
    self.implicit_returning = True
    self._has_native_hstore = False
    self._has_native_json = False
    self._has_native_enum = False
    self.has_native_uuid = False
PGDialect.initialize = _patched_initialize

# Patch 7: Ignore broken pipe on close
_orig_do_close = DefaultDialect.do_close
def _patched_do_close(self, dbapi_connection):
    try:
        _orig_do_close(self, dbapi_connection)
    except Exception:
        pass
DefaultDialect.do_close = _patched_do_close

# Patch 8: Intercept pg_backend_pid() and fix double-quoted identifiers at cursor level
import re
import pg8000.legacy
_orig_cursor_execute = pg8000.legacy.Cursor.execute
def _patched_cursor_execute(self, operation, args=(), stream=None):
    if isinstance(operation, str):
        if 'pg_backend_pid' in operation:
            operation = "SELECT 0"
            args = ()
        else:
            # Replace "col" AS "alias" → `col` AS alias (unquoted alias)
            #operation = re.sub(r'"([^"]+)"\s+AS\s+"([^"]+)"', r'`\1` AS \2', operation)
            # Replace remaining "identifier" → `identifier`
            #operation = re.sub(r'"([^"]+)"', r'`\1`', operation)
            operation = operation.replace('"', '')
    return _orig_cursor_execute(self, operation, args, stream)
pg8000.legacy.Cursor.execute = _patched_cursor_execute
    
# Patch 9: Skip pg_namespace schema query — ArcadeDB doesn't have it
_orig_get_schema_names = PGDialect.get_schema_names
def _patched_get_schema_names(self, connection, **kw):
    try:
        return _orig_get_schema_names(self, connection, **kw)
    except Exception:
        return []
PGDialect.get_schema_names = _patched_get_schema_names


