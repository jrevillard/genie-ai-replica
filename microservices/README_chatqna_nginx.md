# ChatQnA-Xeon NGINX Server

## Overview

The **ChatQnA-Xeon NGINX Server** is a web server that acts as a gateway for the ChatQnA system.  

It connects the user interface (UI) and backend services, making it easy for users to access the chat application through a single, simple web address.  

NGINX is a popular open-source web server and reverse proxy, but you do **not** need to know NGINX to use this service—everything is pre-configured for you. 

## Architecture & Flow

- **NGINX Container:** Runs as a Docker container and listens on port `80` (or another port you choose).
- **Reverse Proxy:** Forwards user requests to the correct backend or UI service.
- **Health Checks:** Waits for the backend and UI to be ready before starting.
- **Environment Variables:** Uses environment variables to know where the backend and UI are running.

**Workflow:**

1. **Start the NGINX container:**  
   The container waits until both the backend and UI are running and healthy.
2. **User visits the web address:**  
   The user opens a browser and goes to `http://your-server-address` (default port 80).
3. **NGINX receives the request:**  
   NGINX checks if the request is for the UI (frontend) or for the backend (API).
4. **NGINX forwards the request:**  
   - If it’s a UI request (like loading the chat page), NGINX sends it to the UI server.
   - If it’s an API request (like sending a chat message), NGINX sends it to the backend server.
5. **Response is returned:**  
   The user gets the correct web page or chat response, all through the same address.

## Usage

### Run with Docker

```sh
docker run -d \
  --name chatqna-xeon-nginx-server \
  -p 80:80 \
  -e FRONTEND_SERVICE_IP=chatqna-xeon-ui-server \
  -e FRONTEND_SERVICE_PORT=5173 \
  -e BACKEND_SERVICE_NAME=chatqna \
  -e BACKEND_SERVICE_IP=chatqna-xeon-backend-server \
  -e BACKEND_SERVICE_PORT=8888 \
  -e DATAPREP_SERVICE_IP=dataprep-arango-service \
  -e DATAPREP_SERVICE_PORT=5000 \
  opea/nginx:latest
```

#### Key Elements Explained

- `-p 80:80`: Makes the service available at `http://localhost` (or your server’s IP).
- `FRONTEND_SERVICE_IP` and `FRONTEND_SERVICE_PORT`: Tell NGINX where to find the UI server.
- `BACKEND_SERVICE_IP` and `BACKEND_SERVICE_PORT`: Tell NGINX where to find the backend server.
- `DATAPREP_SERVICE_IP` and `DATAPREP_SERVICE_PORT`: (Optional) For file upload and processing.
- `opea/nginx:latest`: The Docker image for the pre-configured NGINX server.

## Notes

- **No NGINX Knowledge Needed:**  
  All NGINX configuration is handled for you. You do not need to edit any config files.
- **Backend and UI Dependency:**  
  The NGINX server needs both the backend and UI containers to be running and healthy.
- **Port Conflicts:**  
  Make sure port 80 is not used by another service on your machine. You can change the port by modifying the `-p` flag (e.g., `-p 8080:80`).
- **Environment Variables:**  
  These must match the actual container names and ports of your backend and UI services.

## Extending

- **Change Ports:**  
  You can change the external port by modifying the `-p` flag (e.g., `-p 8080:80`).
- **Custom NGINX Config:**  
  Advanced users can build their own image with a custom NGINX configuration for more features (like SSL).
- **Add More Services:**  
  You can add more environment variables and proxy rules if you want

## License

SPDX-License-Identifier: Apache-2.0