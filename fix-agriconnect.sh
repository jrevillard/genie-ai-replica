#!/bin/bash
echo "$(date) - AgriConnect fix starting..."
sleep 10
docker cp ~/genie-ai/genie-ai-overlay/chatqna/genieai_chatqna.py genie-ai-chatqna-server:/app/ChatQnA/genieai_chatqna.py
docker cp ~/genie-ai/components/gov-chat-frontend/public/agriconnect.html genieai_mvp-frontend-1:/app/dist/agriconnect.html
docker cp ~/genie-ai/components/gov-chat-frontend/public/manifest.json genieai_mvp-frontend-1:/app/dist/manifest.json
docker cp ~/genie-ai/components/gov-chat-frontend/public/sw.js genieai_mvp-frontend-1:/app/dist/sw.js
docker cp ~/genie-ai/components/gov-chat-frontend/public/icons genieai_mvp-frontend-1:/app/dist/icons
docker cp ~/genie-ai/components/gov-chat-frontend/public/config genieai_mvp-frontend-1:/app/dist/config
echo "$(date) - Files deployed. AgriConnect fix complete."

# Restore AgriConnect config
docker cp ~/genie-ai/components/gov-chat-frontend/public/config/genie-ai-config.json genieai_mvp-frontend-1:/app/dist/config/genie-ai-config.json
echo "$(date) - AgriConnect config restored"

# Restore AgriConnect SVG icons
docker cp ~/genie-ai/components/gov-chat-frontend/public/config/genie-ai-icon-light.svg genieai_mvp-frontend-1:/app/dist/config/genie-ai-icon-light.svg
docker cp ~/genie-ai/components/gov-chat-frontend/public/config/genie-ai-icon-dark.svg genieai_mvp-frontend-1:/app/dist/config/genie-ai-icon-dark.svg
docker cp ~/genie-ai/components/gov-chat-frontend/public/config/genie-ai-icon.svg genieai_mvp-frontend-1:/app/dist/config/genie-ai-icon.svg
docker cp ~/genie-ai/components/gov-chat-frontend/public/config/genie-ai.svg genieai_mvp-frontend-1:/app/dist/config/genie-ai.svg
echo "$(date) - SVG icons restored"
