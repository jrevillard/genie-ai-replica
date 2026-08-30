[![pipeline status](https://opensource.unicc.org/un/itu/genie-ai/badges/main/pipeline.svg)](https://opensource.unicc.org/un/itu/genie-ai/-/pipelines?ref=main)
[![coverage report](https://opensource.unicc.org/un/itu/genie-ai/badges/main/coverage.svg)](https://opensource.unicc.org/un/itu/genie-ai/-/graphs/main/charts)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![Digital Public Good](https://img.shields.io/badge/DPG-aligned-0089D6.svg)](https://www.digitalpublicgoods.net/standard)
[![OSI Open Source AI](https://img.shields.io/badge/OSI%20Open%20Source%20AI-compliant-3DA639.svg)](https://opensource.org/ai/open-source-ai-definition)
[![documentation](https://img.shields.io/badge/docs-GENIE.AI-FF6A00.svg)](https://genie-ai-7e342b.opensource.unicc.org/)

# GENIE.AI

**GENIE.AI** is a sovereign, open-source Retrieval-Augmented Generation (RAG) framework for the public sector. It lets governments and public institutions deploy grounded, multilingual, auditable AI assistants over their own document repositories — on their own infrastructure, with full data sovereignty and no vendor lock-in.

It is compliant with the [OSI Open Source AI Definition](https://opensource.org/ai/open-source-ai-definition) and aligned with the [Digital Public Goods (DPG) Standard](https://www.digitalpublicgoods.net/standard), and integrates [OPEA (Open Platform for Enterprise AI)](https://opea.dev) for its AI/ML services. Initiated under the [ITU OSEE programme](https://www.itu.int/en/ITU-D/ICT-Applications/Pages/Initiatives/OSEEPSI/home.aspx).

## Why GENIE.AI

- **Sovereign by design** — embedding, reranking, generation and translation models run on your infrastructure (OPEA / vLLM / TEI). No third-party model API required.
- **Grounded answers** — the LLM answers only from retrieved knowledge-base content and abstains when the answer is not present.
- **Standards-based, no lock-in** — OIDC identity, OpenTelemetry observability, OpenAI-compatible model APIs, W3C trace context.
- **Multilingual** — English as RAG source of truth, translated UI and answer streams (11+ languages).

→ Full context: [About GENIE.AI](https://genie-ai-7e342b.opensource.unicc.org/about/) and [Project overview](https://genie-ai-7e342b.opensource.unicc.org/docs/core/project-overview/).

---

## Quick start

```bash
# 1. Clone
git clone https://opensource.unicc.org/un/itu/genie-ai.git
cd genie-ai

# 2. Configure (secrets: ARANGO_PASSWORD, KEYCLOAK_ADMIN_PASSWORD,
#    KEYCLOAK_CLIENT_SECRET, HUGGING_FACE_HUB_TOKEN, VLLM_API_KEY, ...)
cp env .env && $EDITOR .env

# 3. Deploy
docker compose up -d                                  # core services
docker compose --profile opea --profile gpu-models up -d   # full stack
docker compose --env-file .env --env-file env.t4 --profile opea --profile gpu-models up -d   # NVIDIA T4
```

Access the Web UI at **https://localhost/** and the API docs at **/api-docs**.

For the complete procedure (GPU setup, Swarm, Ansible, knowledge-base population), read the [Installation & Configuration Guide](https://genie-ai-7e342b.opensource.unicc.org/docs/deployment/install-guide/).

---

## Documentation

The full documentation lives on the **[GENIE.AI Docs site](https://genie-ai-7e342b.opensource.unicc.org/)** — architecture, RAG pipeline, knowledge-base management, deployment, operations, observability, and API contracts. Start by audience:

| You are… | Start here |
|---|---|
| Evaluating / deciding | [About](https://genie-ai-7e342b.opensource.unicc.org/about/) + [Project overview](https://genie-ai-7e342b.opensource.unicc.org/docs/core/project-overview/) |
| Deploying / operating | [Deployment](https://genie-ai-7e342b.opensource.unicc.org/docs/deployment/) + [Operations](https://genie-ai-7e342b.opensource.unicc.org/docs/operations/) |
| Managing the knowledge base | [Knowledge base](https://genie-ai-7e342b.opensource.unicc.org/docs/knowledge-base/) |
| Developing / integrating | [Architecture](https://genie-ai-7e342b.opensource.unicc.org/docs/architecture/) + [RAG pipeline](https://genie-ai-7e342b.opensource.unicc.org/docs/rag/) |

In this repository: [CONTRIBUTING.md](CONTRIBUTING.md) · [STANDARDS.md](STANDARDS.md) · [CLA.md](CLA.md) · [THIRD_PARTY.md](THIRD_PARTY.md) · [Code Management Process](UNICC-ITU-Genie-AI%20Code%20Management%20Process.md) · [`site/`](./site) (docs source) · [`docs/`](./docs) (internal engineering docs).

---

## Contributing

Contributions are welcome. Before contributing, read and accept the [CLA](CLA.md), follow [CONTRIBUTING.md](CONTRIBUTING.md) and [STANDARDS.md](STANDARDS.md), and respect the [Code Management Process](UNICC-ITU-Genie-AI%20Code%20Management%20Process.md). Comply with [THIRD_PARTY.md](THIRD_PARTY.md) for dependencies.

## License

Apache License 2.0 — see [LICENSE](LICENSE).

## Resources

- [AI for Good — Open-Source AI for Digital Public Goods track](https://aiforgood.itu.int/eventcat/discovery-open-source-ai-for-digital-public-goods/)
- [ITU Open Source Programme Office (OSPO)](https://www.itu.int/en/ITU-D/ICT-Applications/Pages/Initiatives/ITU_OSPO/About.aspx)
- [ITU Initiative on Open Source AI for Public Services](https://www.itu.int/en/ITU-D/ICT-Applications/Pages/Initiatives/ITU_OSPO/Open-Source_AI_for_Public_Services/About_the_Initiative.aspx)
- [OPEA — Open Platform for Enterprise AI](https://opea.dev)
- [GovStack — Digital Public Infrastructure](https://specs.govstack.global)
- [Multi-stakeholder working group (Confluence)](https://osaips.atlassian.net/wiki/external/ZjA2MjBhMWM1NDQ4NDFhY2EzNTRiYjZjMWNjNjI3NjQ)

---

**Maintained by:** ITU (International Telecommunication Union) · **License:** Apache-2.0
