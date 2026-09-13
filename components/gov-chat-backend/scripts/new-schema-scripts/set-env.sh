#!/bin/bash

# --- ArangoDB Environment Configuration ---
# This script sets the necessary environment variables for the ArangoDB connection.
# To use it, run 'source set-env.sh' in your terminal before running the Node.js scripts.

# The full URL of your ArangoDB instance.
export ARANGO_URL="http://127.0.0.1:8529"

# The name of the database to connect to.
export ARANGO_DATABASE="genie-ai"
#export ARANGO_DATABASE="node-services"

# The username for the database connection.
export ARANGO_USER="root"

# The password for the specified user.
# IMPORTANT: Replace "your-database-password" with your actual password.
export ARANGO_PASSWORD="arangopwd"

# The ArangoDB graph name. Chunks are stored in the "<name>_SOURCE" collection.
# Must match ARANGO_GRAPH_NAME in the deployment, which defaults to "GRAPH".
export ARANGO_GRAPH_NAME="GRAPH"

echo "ArangoDB environment variables set."

