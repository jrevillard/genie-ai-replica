\# Application Docker Compose Setup



This document provides a detailed guide to the `docker-compose.yaml` file used for deploying the application. This setup defines a multi-container application consisting of a frontend and a backend service, configured for a production environment.



\## 1\\. Overview



The `docker-compose.yaml` file orchestrates the build and deployment of two main services:



&nbsp; \* \*\*`frontend`\*\*: The user-facing web application, built from the `./gov-chat-frontend` directory.

&nbsp; \* \*\*`backend`\*\*: The server-side application that handles business logic, API requests, and database connections.



Both services are designed to connect to an external Docker network named `chatqna\_default` for inter-service communication.



\## 2\\. Prerequisites



Before running this setup, ensure the following prerequisites are met:



1\.  \*\*Docker and Docker Compose\*\*: Must be installed on your system.

2\.  \*\*Source Code\*\*: The necessary source code directories must be present relative to the `docker-compose.yaml` file:

&nbsp;     \* `./gov-chat-frontend/` for the frontend service build.

&nbsp;     \* `./gov-chat-backend/Dockerfile` for the backend service build.

3\.  \*\*External Docker Network\*\*: The services rely on a pre-existing network. Create it with the following command:

&nbsp;   ```bash

&nbsp;   docker network create chatqna\_default

&nbsp;   ```

4\.  \*\*Environment File for Backend\*\*: The `backend` service requires an environment file for sensitive data. Create a file named `.env` inside the `./gov-chat-backend/` directory. At a minimum, this file should contain secrets for the session and JWT:

&nbsp;   ```env

&nbsp;   # ./gov-chat-backend/.env

&nbsp;   SESSION\_SECRET=a-very-strong-and-long-random-string-for-sessions

&nbsp;   JWT\_SECRET=another-very-strong-and-long-random-string-for-jwt

&nbsp;   ```



\## 3\\. Usage



\### Starting the Services



To build and start all services in detached mode, run the following command from the same directory as the `docker-compose.yaml` file:



```bash

docker-compose up -d --build

```



\### Stopping the Services



To stop and remove the containers, run:



```bash

docker-compose down

```



\### Viewing Logs



To view the real-time logs for all services, run:



```bash

docker-compose logs -f

```



To view logs for a specific service, add the service name (e.g., `docker-compose logs -f backend`).



\## 4\\. Service Details



\### 4.1. `frontend` Service



This service runs the user interface of the application.



&nbsp; \* \*\*Build\*\*: The container image is built using the Dockerfile located in the `./gov-chat-frontend` directory.

&nbsp; \* \*\*Restart Policy\*\*: The service is configured to restart automatically unless it is explicitly stopped (`restart: unless-stopped`).

&nbsp; \* \*\*Ports\*\*: The frontend is accessible on the host machine at port \*\*8090\*\*. This maps to port 8090 inside the container.

&nbsp; \* \*\*Dependencies\*\*: The `frontend` service will only start after the `backend` service has started successfully (`depends\_on: - backend`).

&nbsp; \* \*\*Configuration\*\*:

&nbsp;     \* `NODE\_ENV=production`: Configures the application to run in production mode.

&nbsp;     \* `VUE\_APP\_API\_URL`: Specifies the public-facing URL of the backend API that the frontend will communicate with.



\### 4.2. `backend` Service



This service runs the Node.js server that provides the application's API and business logic.



&nbsp; \* \*\*Build\*\*: The image is built using the `Dockerfile` located in the `./gov-chat-backend/` directory.

&nbsp; \* \*\*Restart Policy\*\*: Configured to restart automatically unless explicitly stopped (`restart: unless-stopped`).

&nbsp; \* \*\*Ports\*\*: The backend API is accessible on the host machine at port \*\*3000\*\*.

&nbsp; \* \*\*Volumes\*\*: The service uses several bind mounts to persist data and facilitate development:

&nbsp;     \* `./database\_backups:/app/database\_backups`: Persists automated database backups created by the application.

&nbsp;     \* `./logs:/app/logs`: Persists application logs.

&nbsp;     \* `./data:/app/data`: A volume for general application data persistence.

&nbsp;     \* `./gov-chat-backend/Uploads:/app/Uploads`: Persists user-uploaded files.

&nbsp; \* \*\*Environment File\*\*: It loads additional environment variables from `./gov-chat-backend/.env`, which is the recommended place for secrets.



\#### Backend Configuration Parameters



The `backend` service is configured via a comprehensive set of environment variables:



| Variable | Description | Example Value |

| :--- | :--- | :--- |

| \*\*Application\*\* |

| `NODE\_ENV` | Sets the Node.js environment. | `production` |

| `PORT` | The internal port the Express server listens on. | `3000` |

| `API\_PREFIX` | The base path for all API routes. | `/api` |

| `APP\_NAME` | The name of the application, used in user-facing messages like emails. | `GENIE AI` |

| `FRONTEND\_URL` | The public URL of the frontend application, used for generating links in emails. | `https://e2e-82-109.ssdcloudindia.net/` |

| `LOG\_LEVEL` | The verbosity of application logs. | `debug` |

| \*\*File Uploads\*\* |

| `UPLOAD\_DIR` | The internal directory where uploaded files are stored. | `./Uploads` |

| `MAX\_FILE\_SIZE`| The maximum allowed size for file uploads, in bytes (5,242,880 bytes = 5 MB). | `5242880` |

| \*\*Session \& Auth\*\* |

| `SESSION\_SECRET`| \*\*(Secret)\*\* A long, random string for signing session cookies. Should be set in the `.env` file. | `default-session-secret` |

| `SESSION\_EXPIRATION\_TIME` | The duration of a user session in milliseconds (1,800,000 ms = 30 minutes). | `1800000` |

| `JWT\_SECRET` | \*\*(Secret)\*\* A long, random string for signing JSON Web Tokens. Should be set in the `.env` file. | `default-jwt-secret` |

| `JWT\_EXPIRES\_IN` | The expiration time for JSON Web Tokens. | `24h` |

| `CORS\_ORIGIN` | The URL of the frontend allowed to make requests to this backend. | `https://e2e-82-109.ssdcloudindia.net/` |

| \*\*Email Service (Mailjet)\*\* |

| `EMAIL\_HOST` | The SMTP host for the email service. | `in-V3.mailjet.com` |

| `EMAIL\_PORT` | The SMTP port for the email service. | `587` |

| `EMAIL\_SECURE` | Whether to use a secure connection (TLS). | `false` |

| `EMAIL\_USER` | The API key or username for the email service. | `187ad32880...` |

| `EMAIL\_PASSWORD` | The API secret or password for the email service. | `6615d81d...` |

| `EMAIL\_FROM` | The email address from which application emails are sent. | `myapplication@gmail.com` |

| \*\*Database (ArangoDB)\*\* |

| `ARANGO\_URL` | The connection URL for the ArangoDB instance, using the service name. | `http://arango-vector-db:8529` |

| `ARANGO\_DB` | The name of the database to use within ArangoDB. | `my-database-name` |

| `ARANGO\_USER` | The username for the ArangoDB connection. | `root` |

| `ARANGO\_PASSWORD`| The password for the ArangoDB connection. | `test` |

| \*\*Database Backup\*\* |

| `BACKUP\_DIR` | The internal directory for storing database backups. | `./database\_backups` |

| `MAX\_BACKUPS` | The maximum number of backups to retain. | `5` |

| `BACKUP\_FORMAT`| The format for the backups. | `json` |

| \*\*OPEA Integration\*\* |

| `OPEA\_HOST` | The hostname of the OPEA service for RAG capabilities. | `e2e-109-198` |

| `OPEA\_PORT` | The port for the OPEA service. | `8888` |

| `CONTEXT\_OPTION`| A configuration option for how context is handled with the OPEA service. | `single-message` |



\## 5\\. Networking



&nbsp; \* \*\*`chatqna\_default`\*\*: This file defines a single network named `chatqna\_default`.

&nbsp; \* \*\*External Network\*\*: It is configured as `external: true`, which means Docker Compose will not create this network. You must create it manually before starting the services (see Prerequisites). This setup is useful when integrating these services into a larger system with a shared network.

&nbsp; \* \*\*Service Communication\*\*: The `frontend` and `backend` services can communicate with each other and with other services on this network (like `arango-vector-db`) using their service names as hostnames.

