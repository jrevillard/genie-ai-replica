#!/bin/sh
set -e

REQUIREMENTS_FILE=$1

if [ -f "$REQUIREMENTS_FILE" ]; then
    echo "Patching $REQUIREMENTS_FILE to remove unused dependencies..."

    # 1. Remove the non-existent Pathway dependency
    sed -i '/pathway==0.3.3/d' "$REQUIREMENTS_FILE"

    # 2. Remove the conflicting graspologic dependency
    sed -i '/graspologic==3.4.1/d' "$REQUIREMENTS_FILE"

    echo "Patching complete. Unneeded dependencies removed."
else
    echo "Warning: requirements file $REQUIREMENTS_FILE not found. Skipping patch."
fi
