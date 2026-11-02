# GENIE.AI - Project Instructions (GEMINI.md)

This file contains team-shared architecture, conventions, and workflows for the GENIE.AI project.

## Deployment & Infrastructure

- **Primary Configuration**: The project uses `docker-compose.yaml` for service orchestration (GPU models behind the `gpu-models` profile).
- **Exposure**: The application is exposed on the internet via **Azure Front Door** (serving as a reverse proxy).
- **Public Endpoint**: [agrivisory.itu.int](https://agrivisory.itu.int)
