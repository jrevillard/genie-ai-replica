#!/bin/bash

echo "Starting Superset initialization..."

superset fab create-admin --username admin --firstname Amina --lastname Admin --email admin@amina.com --password "$SUPERSET_ADMIN_PASSWORD"
superset db upgrade
superset init

echo "Connecting to ArcadeDB..."
superset set_database_uri -d "Amina Database" -u "postgresql+pg8000://root:${ARCADEDB_ROOT_PASSWORD}@arcadedb:5432/${ARCADEDB_DB}"
#superset set_database_uri -d "Amina Database" -u "postgresql+psycopg2://root:${ARCADEDB_ROOT_PASSWORD}@arcadedb:5432/${ARCADEDB_DB}"

echo "Initialization complete! Starting the web server..."
superset run -h 0.0.0.0 -p 8088 --with-threads --reload --debugger