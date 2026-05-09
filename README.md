# GENIE.AI

[GENIE.AI](https://genie-ai.itu.int/) was initiated under the [Open Source Ecosystem Enabler OSEE](https://www.itu.int/en/ITU-D/ICT-Applications/Pages/Initiatives/OSEEPSI/home.aspx) programme as an exploratory capacity building instrument designed to help governments understand, experiment with and deploy open source generative AI in a sovereign and responsible manner. What started as a practical learning and experimentation environment progressively evolved into an off the shelf open source reference implementation dedicated to the public sector, facilitating the development of Digital Public Infrastructure (DPI) and Digital Public Goods (DPG).

[GENIE.AI](https://genie-ai.itu.int/) is fully compliant with the [OSI Open Source AI Definition](https://opensource.org/ai/open-source-ai-definition) and aligned with the [Digital Public Goods Standard from DPGA](https://www.digitalpublicgoods.net/standard). It is free, truly open source, transparently governed and designed to be reused, audited, adapted and deployed without licensing barriers, vendor lock in or hidden dependencies.

The framework empowers public institutions to rapidly design, deploy and manage custom generative AI solutions such as chatbots, digital assistants and domain specific knowledge systems at low cost, with full technical control, institutional ownership and data sovereignty.

### Core Characteristics:

[GENIE.AI](https://genie-ai.itu.int/) supports digitally inclusive, sovereign and responsible AI development. It is designed to strengthen local capacity, protect public values, ensure transparency in system design, and promote equitable access to AI capabilities across countries, particularly in low and middle income contexts.

- Fully open source and interoperable technology stack aligned with [GovStack principles](https://govstack.global/about/govstack-principles/) and the [DPI Universal Safeguards](https://www.dpi-safeguards.org/fr), enabling seamless integration within national digital ecosystems.
- Modular and adaptable architecture featuring a customizable user interface, hybrid Retrieval Augmented Generation (RAG) pipelines and support for agentic workflows and tool calling capabilities.
- Containerized deployment optimized for Kubernetes environments, ensuring scalability, resilience, portability and maintainability across diverse public sector infrastructures.

Developed through a [multi stakeholder working group](https://osaips.atlassian.net/wiki/external/YzMyMGM0MmIzODYzNGY4M2E0NjM1YjIxOTYzNTY5Y2U) and discussed in an all-year on dedicated track at [AIforGood on open source generative AI for Digital Public Goods](https://aiforgood.itu.int/eventcat/discovery-open-source-ai-for-digital-public-goods/), ensuring alignment with public interest objectives, transparency requirements and real government needs. Leverages state of the art open source components for production grade RAG systems, including:

- Modular and adaptable architecture, featuring a customizable UI, hybrid Retrieval-Augmented Generation (RAG) pipeline, and support for agentic and tool-calling capabilities.
- Dockerized deployment optimized for Kubernetes, ensuring scalability, reliability, and ease of maintenance.
- Developed based on input from a multi-stakeholder working group on open-source AI for digital public services.
- Leverages and integrates latest state-of-the-art open-source tools and libraries for production-grade RAG: 
   - [Docling](https://github.com/docling-project/docling); 
   - [Open Platform for Enterprise AI (OPEA)](https://opea.dev); 
   - [vLLM](https://github.com/vllm-project/vllm)
- ​​Fully open-source and interoperable technology stack, aligned with [GovStack](https://specs.govstack.global) digital public infrastructure standards, enabling seamless integration with the broader ecosystem of digital public services.

   among other community driven libraries.​

### International dialogue and governance space:

[GENIE.AI](https://genie-ai.itu.int/) is discussed and refined within the AI for Good track on open source generative AI for Digital Public Goods, which serves as a global forum for governments, international organizations, technical experts and civil society to exchange on standards, governance models and implementation strategies. This track provides the policy and technical dialogue space where GENIE.AI reference implementations, compliance with OSI AI Definition and alignment with DPG criteria are openly debated and strengthened.

### Objective: 

To empower governments and public institutions with a free and open source modular stack that enables them to:
- Design context specific generative AI and RAG applications
- Deploy sovereign AI services within national infrastructure
- Develop and test reference implementations for priority public sector use cases
- Strengthen internal technical capacity through hands on adoption
- Simplify configuration and maintenance
- Adhere to relevant AI, software standards and best practices
- Reduce structural dependency on proprietary AI vendors
- Match commercial performance at a lower cost

The reference implementations are designed to:
- Deliver performance comparable to commercial solutions at significantly lower cost
- Be tailored to public sector data governance, security and compliance requirements
- Simplify configuration, adaptation and long term maintenance
- Comply with the OSI Open Source AI Definition and the Digital Public Goods (DPG) Standard
- Integrate seamlessly with national Digital Public Infrastructure (DPI) building blocks

### Context:

The [UN Secretary General Roadmap for Digital Cooperation](https://www.un.org/en/content/digital-cooperation-roadmap/) highlights the importance of promoting Digital Public Goods and strengthening global cooperation on artificial intelligence to build a safer and more equitable digital world. GENIE.AI directly contributes to these objectives by providing a transparent, standards aligned and reusable open source AI framework tailored for the public sector. By adhering to internationally recognized open source and DPG principles, it lowers barriers to AI adoption, strengthens digital sovereignty, fosters interoperability and promotes responsible innovation.

Many public sector institutions face administrative, legal and technical constraints when adopting proprietary generative AI tools. These challenges include high licensing costs, limited configurability, restricted access to model internals, concerns around data privacy and extraterritorial exposure, and weak interoperability with national systems. GENIE.AI addresses these constraints by offering a standards based, auditable and adaptable open source alternative that can be deployed within national infrastructures. It enhances institutional control over data and models while enabling inclusive service improvement, particularly in developing countries where affordable, sovereign and trusted AI solutions are critical to advancing the Sustainable Development Goals (SDGs).

Further information about the project rational is accessible [here](https://osaips.atlassian.net/wiki/external/YzMyMGM0MmIzODYzNGY4M2E0NjM1YjIxOTYzNTY5Y2U)

### Scope: 

- Defining and documenting open technical specifications aligned with the OSI Open Source AI Definition and DPG criteria
- Developing and publishing reusable reference implementations for selected public sector use cases
- Curating and preparing datasets for testing, evaluation and fine tuning within public governance constraints
- Designing custom benchmarks reflecting public sector performance, multilingual and inclusion requirements
- Piloting implementations in selected countries as part of broader Digital Public Infrastructure strategies

Through this evolution from OSEE capacity building instrument to structured public sector reference implementation, GENIE.AI positions itself as a digitally inclusive, sovereign and responsible open source AI building block for governments worldwide.

### Relevant use cases: 
A non-exhaustive list of public sector use cases for GenAI and RAG has been collected by a [multi-stakeholder working group on Open-Source Generative AI for Public Services](https://osaips.atlassian.net/wiki/external/ZjA2MjBhMWM1NDQ4NDFhY2EzNTRiYjZjMWNjNjI3NjQ) and is accessible [here](https://osaips.atlassian.net/wiki/external/OTMzYWQ2MWJlYWRmNDk3ZjkwZWYyOWFiYzQzNzQwM2I). 


## Project Structure:

```
GENIE.AI/
├── components/                   # Core application components
│   ├── gov-chat-backend/         # Node.js/Express backend services
│   ├── gov-chat-frontend/        # Vue.js web interface
│   ├── document-repository/      # File management service
│   ├── arangodb/                 # Database configuration
│   ├── google-translate-example/ # Translation service
│   └── shared/                   # Shared libraries
├── mobile/                       # Mobile applications
│   └── genie_ai_mobile/          # Flutter mobile app
├── inko-overlay/             # OPEA integration layer
│   ├── chatqna/                  # Chat microservice
│   ├── core/                     # Core libraries and protocols
│   ├── dataprep/                 # Data preparation service
│   ├── retriever/                # Hybrid vector-graph retriever
│   └── reranker/                 # Reranking microservice
├── api-gateway-solution/         # API Gateway (Kong/NGINX)
├── configs/                      # Configuration files
│   └── opea-config/              # OPEA infrastructure configuration
├── data/                         # Country-specific data
│   ├── el-salvador/              # El Salvador data
│   ├── gambia/                   # Gambia data
│   ├── kenya/                    # Kenya data
│   └── lesotho/                  # Lesotho data
├── docs/                         # Documentation
├── tests/                        # End-to-end and integration tests
├── logs/                         # Application logs
├── CLA.md                        # Contributor License Agreement
├── CONTRIBUTING.md               # Contribution guidelines
├── STANDARDS.md                  # Coding standards specification
├── THIRD_PARTY.md                # Third-party software disclosure
├── GENIE.AI-Installation-Configuration-Guide.md  # Installation guide
├── GENIE.AI-Data-Labelling-Strategy.md           # Data labeling strategy
├── UNICC-ITU-Genie-AI Code Management Process.md # Development workflow
├── proposed-repo-structure-changes.md            # Repository architecture
├── docker-compose.yaml          # Dual-mode Docker Compose (compose up + Swarm)
├── env                          # Environment configuration (main)
├── env.t4                       # GPU overrides for NVIDIA T4 (16GB VRAM)
├── env.rtx6000                  # GPU overrides for RTX 6000 ADA (24GB VRAM)
└── package.json                 # Node.js dependencies and scripts
```

## Quick Start:

### Prerequisites

- Docker and Docker Compose (v2+ with Swarm support)
- NVIDIA GPU (for optimal performance)
- Hugging Face API token

### 1. Clone Repository

```bash
git clone https://github.com/your-org/GENIE.AI.git
cd GENIE.AI
```

### 2. Configure Environment

```bash
cp env .env
# Edit .env with your secrets (ARANGO_PASSWORD, KEYCLOAK_ADMIN_PASSWORD, etc.)
```

### 3. Start Services

```bash
# Core services only
docker compose up -d

# Full stack with OPEA/AI services
docker compose --profile opea up -d
```

For GPU-specific overrides:
```bash
docker compose --env-file .env --env-file env.t4 --profile opea up -d
```

See [docs/docker-compose-setup.md](docs/docker-compose-setup.md) for the full local development guide and [docs/docker-swarm-setup.md](docs/docker-swarm-setup.md) for Docker Swarm deployment.

### 4. Access Applications

- **Web Interface**: https://localhost/
- **Mobile App**: See [mobile/genie_ai_mobile/README.md](mobile/genie_ai_mobile/README.md)
- **API Documentation**: https://localhost/api-docs

## Documentation:

### Project Standards & Governance

- **[CONTRIBUTING.md](CONTRIBUTING.md)** - Comprehensive contribution guidelines, required documentation, and submission processes
- **[STANDARDS.md](STANDARDS.md)** - Complete coding standards specification (JavaScript, Vue 3, Node.js, Python, Bash, Docker)
- **[CLA.md](CLA.md)** - Contributor License Agreement with challenge-specific provisions
- **[THIRD_PARTY.md](THIRD_PARTY.md)** - Third-party software disclosure and licensing requirements
- **[UNICC-ITU-Genie-AI Code Management Process.md](UNICC-ITU-Genie-AI%20Code%20Management%20Process.md)** - Development workflow, branching strategy, and code review processes

### Technical Guides

- **[GENIE.AI-Installation-Configuration-Guide.md](GENIE.AI-Installation-Configuration-Guide.md)** - Comprehensive installation, setup, and configuration instructions
- **[GENIE.AI-Data-Labelling-Strategy.md](GENIE.AI-Data-Labelling-Strategy.md)** - Data labeling process for hybrid RAG systems
- **[proposed-repo-structure-changes.md](proposed-repo-structure-changes.md)** - Repository architecture and component organization

### Core Components

- **[Backend Services](components/gov-chat-backend/README.md)** - Node.js/Express microservices for chat, analytics, and user management
- **[Frontend Application](components/gov-chat-frontend/README.md)** - Vue.js web interface with comprehensive UI components
- **[Document Repository](components/document-repository/README.md)** - File management with virus scanning and metadata extraction
- **[Mobile Application](mobile/genie_ai_mobile/README.md)** - Flutter app for Android, iOS, Web, and desktop

### OPEA Integration

Stashed changes

### Configuration

- **[OPEA Configuration](configs/opea-config/README.md)** - Complete OPEA infrastructure setup
- **[API Gateway](api-gateway-solution/README.md)** - Kong and NGINX configuration

### Additional Documentation

- **[Components Docker Setup](components/README.md)** - Docker Compose orchestration
- **[Database Setup](components/arangodb/README.md)** - ArangoDB configuration and scripts

## Architecture:

GENIE.AI is built on a microservices architecture with the following layers:

1. **Client Layer**: Web (Vue.js), Mobile (Flutter), API clients
2. **Identity Provider**: Keycloak (OIDC, JWKS, JIT provisioning, service accounts)
3. **API Gateway**: Kong/NGINX for routing, rate limiting, SSL termination
4. **Application Layer**: Backend services (Node.js/Express)
5. **AI Layer**: OPEA microservices (LLM, Embeddings, Reranking)
6. **Data Layer**: ArangoDB (graph + vector), file storage, Redis cache

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vue.js 3, Vite, Tailwind CSS |
| Mobile | Flutter 3.10+ |
| Identity Provider | Keycloak 26 (OIDC, JWKS, service accounts) |
| Backend | Node.js, Express |
| AI/ML | OPEA, vLLM, TEI, ArangoDB |
| Database | ArangoDB 3.12+ (multi-model) |
| API Gateway | Kong, NGINX |
| Containerization | Docker, Kubernetes |

## Features:

- **Multilingual Support**: 11+ languages with automatic translation
- **RAG Pipeline**: Hybrid vector-graph retrieval for context-aware responses
- **Multi-Platform**: Web, mobile (Android, iOS, Windows, macOS, Linux)
- **Authentication**: Keycloak OIDC with JWKS token validation, role-based access control, and JIT user provisioning
- **Analytics**: Comprehensive usage and performance analytics
- **Document Management**: Secure file upload, processing, and knowledge base integration
- **Admin Dashboard**: System monitoring, user management, and security scanning
- **Offline Capabilities**: Mobile app works without internet connection

## Development:

### Setting Up Development Environment

1. **Install Dependencies**:
   ```bash
   # Backend
   cd components/gov-chat-backend
   npm install

   # Frontend
   cd ../gov-chat-frontend
   npm install

   # Mobile
   cd ../../mobile/genie_ai_mobile
   flutter pub get
   ```

2. **Configure Environment**:
   ```bash
   cp env .env
   # Edit .env with your configuration
   ```

3. **Start Services**:
   ```bash
   docker compose up -d
   ```

See [docs/docker-compose-setup.md](docs/docker-compose-setup.md) for the full local development guide.

### Testing

```bash
# Backend tests
cd components/gov-chat-backend
npm test

# Frontend tests
cd ../gov-chat-frontend
npm run test

# Mobile tests
cd ../../mobile/genie_ai_mobile
flutter test
```

## Deployment:

### Docker Compose (Local Development)

```bash
cp env .env

# Core services only
docker compose up -d

# Full stack with OPEA/AI services
docker compose --profile opea up -d
```

See [docs/docker-compose-setup.md](docs/docker-compose-setup.md) for the full guide.

### Docker Swarm Deployment

GENIE.AI is deployed using Docker Swarm. See [docs/docker-swarm-setup.md](docs/docker-swarm-setup.md) for the complete guide.

```bash
# Deploy the stack
set -a && source .env && set +a
docker stack deploy -c docker-compose.yaml genieai

# With GPU-specific settings:
set -a && source .env && source env.t4 && set +a && docker stack deploy -c docker-compose.yaml genieai
```

### Removing the Deployment

```bash
docker stack rm genieai
```

## Project Documentation:

### Essential Standards & Guidelines

- **[CONTRIBUTING.md](CONTRIBUTING.md)** - Contribution guidelines, required documentation, and submission processes
- **[STANDARDS.md](STANDARDS.md)** - Project coding standards specification covering all technologies
- **[CLA.md](CLA.md)** - Contributor License Agreement (must be accepted before contributing)
- **[THIRD_PARTY.md](THIRD_PARTY.md)** - Third-party software disclosure and licensing requirements

### Technical Documentation

- **[GENIE.AI-Installation-Configuration-Guide.md](GENIE.AI-Installation-Configuration-Guide.md)** - Detailed installation, setup, and configuration instructions
- **[GENIE.AI-Data-Labelling-Strategy.md](GENIE.AI-Data-Labelling-Strategy.md)** - Data labeling process for hybrid RAG systems
- **[UNICC-ITU-Genie-AI Code Management Process.md](UNICC-ITU-Genie-AI%20Code%20Management%20Process.md)** - Development workflow, branching strategy, and code review processes
- **[proposed-repo-structure-changes.md](proposed-repo-structure-changes.md)** - Repository architecture and component organization

### Documentation Requirements

Before contributing to GENIE.AI, all contributors must review and agree to:
1. **[CLA.md](CLA.md)** - Accept the Contributor License Agreement
2. **[STANDARDS.md](STANDARDS.md)** - Understand coding standards and best practices
3. **[CONTRIBUTING.md](CONTRIBUTING.md)** - Follow contribution guidelines and workflows
4. **[THIRD_PARTY.md](THIRD_PARTY.md)** - Comply with third-party integration requirements
5. **[UNICC-ITU-Genie-AI Code Management Process.md](UNICC-ITU-Genie-AI%20Code%20Management%20Process.md)** - Follow development workflow and branching strategy

## Contributing:

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for comprehensive guidelines.

### Contribution Process

1. Review and accept [CLA.md](CLA.md)
2. Read [CONTRIBUTING.md](CONTRIBUTING.md) for contribution areas and guidelines
3. Follow [STANDARDS.md](STANDARDS.md) for all code contributions
4. Review [THIRD_PARTY.md](THIRD_PARTY.md) for third-party dependency requirements
5. Follow the workflow in [UNICC-ITU-Genie-AI Code Management Process.md](UNICC-ITU-Genie-AI%20Code%20Management%20Process.md)
6. Set up your environment using [GENIE.AI-Installation-Configuration-Guide.md](GENIE.AI-Installation-Configuration-Guide.md)

## License:

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## Relevant Sites and Resources:

- [ITU Initiative on Open Source AI for Public Services](https://www.itu.int/en/ITU-D/ICT-Applications/Pages/Initiatives/ITU_OSPO/Open-Source_AI_for_Public_Services/About_the_Initiative.aspx)
- [Open Source AI for Public Services - Confluence documentation](https://osaips.atlassian.net/wiki/external/ZjA2MjBhMWM1NDQ4NDFhY2EzNTRiYjZjMWNjNjI3NjQ)
- [AI for Good Global Summit: Track on Open-Source AI for Digital Public Goods](https://aiforgood.itu.int/eventcat/discovery-open-source-ai-for-digital-public-goods/)
- [ITU Open Source Programme Office](https://www.itu.int/en/ITU-D/ICT-Applications/Pages/Initiatives/ITU_OSPO/About.aspx)
- [OPEA (Open Platform for Enterprise AI)](https://opea.dev)
- [GovStack Digital Public Infrastructure](https://specs.govstack.global)

**Document Version:** 2.0
**Last Updated:** March 10, 2026
**Project:** GENIE.AI
**Maintained By:** ITU (International Telecommunication Union)
