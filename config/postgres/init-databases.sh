#!/bin/sh
# Initialize service-specific databases and users in shared PostgreSQL
# Runs as superuser (POSTGRES_USER), creates dedicated users per service
set -e

PGHOST="${PGHOST:-kong-database}"
PGUSER="${PGUSER:-genieai}"
PGDATABASE="${PGDATABASE:-postgres}"
SERVICES="${SERVICES:-kong keycloak}"

# Authenticate as superuser via PGPASSWORD (not in command line)
export PGPASSWORD="${POSTGRES_PASSWORD}"

echo "Initializing PostgreSQL databases and users..."

for SVC in ${SERVICES}; do
  DB_NAME="${SVC}"
  DB_USER="${SVC}"

  # Per-service password (KONG_DB_PASSWORD, KEYCLOAK_DB_PASSWORD) — REQUIRED, no fallback
  SVC_UPPER=$(echo "${SVC}" | tr '[:lower:]' '[:upper:]')
  eval "DB_PASSWORD=\${${SVC_UPPER}_DB_PASSWORD}"
  if [ -z "${DB_PASSWORD}" ]; then
    echo "  ERROR: ${SVC_UPPER}_DB_PASSWORD is not set. Each service must have its own password." >&2
    exit 1
  fi

  # Create user if not exists
  USER_EXISTS=$(psql -h "${PGHOST}" -U "${PGUSER}" -tc \
    "SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '${DB_USER}'" 2>/dev/null | tr -d ' ')

  if [ "${USER_EXISTS}" = "1" ]; then
    echo "  User '${DB_USER}' already exists. Skipping creation."
  else
    psql -h "${PGHOST}" -U "${PGUSER}" -c \
      "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';" -o /dev/null
    echo "  User '${DB_USER}' created."
  fi

  # Create database if not exists
  DB_EXISTS=$(psql -h "${PGHOST}" -U "${PGUSER}" -tc \
    "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" 2>/dev/null | tr -d ' ')

  if [ "${DB_EXISTS}" = "1" ]; then
    echo "  Database '${DB_NAME}' already exists. Skipping creation."
  else
    psql -h "${PGHOST}" -U "${PGUSER}" -c \
      "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" -o /dev/null
    echo "  Database '${DB_NAME}' created."
  fi

  # Grant privileges (idempotent)
  psql -h "${PGHOST}" -U "${PGUSER}" -d "${DB_NAME}" -c \
    "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" -o /dev/null
  psql -h "${PGHOST}" -U "${PGUSER}" -d "${DB_NAME}" -c \
    "GRANT ALL PRIVILEGES ON SCHEMA public TO ${DB_USER};" -o /dev/null
  psql -h "${PGHOST}" -U "${PGUSER}" -d "${DB_NAME}" -c \
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${DB_USER};" -o /dev/null
  echo "  Privileges granted on '${DB_NAME}' to '${DB_USER}'."
done

echo "Database initialization complete!"
