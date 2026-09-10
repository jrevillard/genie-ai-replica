#!/bin/bash
HOST="govstack@10.0.0.101"
KEY="/home/fordendk/.ssh/cloud-deploy-np"

echo "=== Cloud doc-repo KEYCLOAK env ==="
ssh -i $KEY -o StrictHostKeyChecking=no $HOST 'docker exec $(docker ps --filter name=document-repository -q | head -1) env | grep -iE "KEYCLOAK|KC_"' 2>&1

echo ""
echo "=== Cloud Keycloak issuer (discovery) ==="
ssh -i $KEY -o StrictHostKeyChecking=no $HOST 'docker exec $(docker ps --filter name=document-repository -q | head -1) sh -c "wget -qO- --no-check-certificate \"\$KEYCLOAK_URL/realms/\$KC_REALM/.well-known/openid-configuration\" 2>/dev/null | grep -o \"\\\"issuer\\\":[^,]*\""' 2>&1
