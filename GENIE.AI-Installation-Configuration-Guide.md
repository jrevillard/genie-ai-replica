# **GENIE.AI Installation and Configuration Guide**

# Introduction

Welcome to the GENIE.AI framework. This guide will walk you through the necessary steps to set up, configure, and deploy your own Retrieval-Augmented Generation (RAG) solution. The success of any AI-driven knowledge system lies in the quality and structure of its data. Therefore, the first and most critical phase is to define, curate, and structure the data that will form the backbone of your system's knowledge. This cannot be over-emphasized. It is the most critical aspect. Our suggestion is that you establish an initial MVP with the framework by simply curating the data, defining the knowledge hierarchy, configuring your quickhelp buttons with prompts and then labeling and ingesting your curated data prior to modifying any code. This way, you will get used to how the framework operates, before you delve into deeper issues and extensions. This approach can also be used to deliver a rapid solution to a RAG problem, without any coding at all (just implementing a knowledge base design and the associated configuration). The application title and theme can also be modified by configuration in JSON without changing code. The suggested approach for this is to utilize something like ChatGPT, Gemini Pro or Grok etc. to build a new configuration for color theme and title etc. This can be done in minutes.

For a high-level understanding of the system architecture before beginning any work, please refer to the [**Architecture Overview**](https://osaips.atlassian.net/wiki/external/N2U5ZjkwM2FhOTgyNDZlZjk3MWRlODY5Mzk5OTBhNjE). This will give you an insight into most of the high level components and how they are assembled.

---

# Step 1: Data Curation and Knowledge Hierarchy (Conceptual Design)

Before any data is ingested into GENIE.AI, you must first establish the scope of knowledge for your application and organize it logically. This process involves a strategic design of your knowledge core, the curation and verification of source documents, and the creation of an associated two-level labeling system that serves as the knowledge hierarchy within the framework's user interface (i.e., the Knowledge Hierarchy displayed on the left sidebar). Ingested data is tagged with these labels, and queries can also select the same labels, which enhances RAG accuracy as we have utilized labeling as part of the hybrid-retrieval strategy for RAG at the backend.

## 1.1 Designing the Knowledge Core with Domain Analysis

A powerful RAG solution is built on a well-designed data model. We recommend using a conceptual Venn diagram exercise with your subject matter experts to map your information landscape before you even start. This helps you visualize the relationships between different data sets and define the boundaries of your knowledge base. It helps you to identify the specific data sets you need and to ascertain the specific relationships between these data sets.

This process involves identifying three tiers of data:

* **Primary Data Sets (Core):** This is the essential information that directly addresses the most critical and frequent user queries. It forms the central circles of your diagram \- this totally depends on the scope of your solution. You can address as many facets of this central core set of data as required to serve the specific use case that you have in mind.  
* **Secondary Data Sets (Supporting):** This data provides necessary context and is often required to give a more complete answer. It is the second ring of your diagram circles and it overlaps significantly with the primary set. There could also be many bubbles in this secondary tier.  
* **Tertiary Data Sets (Peripheral):** This information is supplementary/peripheral and enhances the user's understanding, but may not be essential for every query. It has a minor overlap with the primary and secondary sets in specific areas. The Venn diagram is your best allie to get this right up front.

**Example Domain Analysis using Venn Diagrams:**

**1\. Agriculture**

* **Primary:** "Corn Crop Management Guide." This is the core document farmers need.  
* **Secondary:** "Approved Pesticides & Herbicides," "Chemical Fertilizer Specifications," "Soil Sample Analysis Protocols." These are directly referenced by the crop guide.  
* **Tertiary:** "Regional Weather Data," "Historical Market Prices," "Local Agricultural Equipment Suppliers." This data provides valuable context for decision-making.

**2\. Government Services**

* **Primary:** "Official Passport Application Process & Forms."  
* **Secondary:** "Schedule of Fees & Payment Options," "Civil Registry Database (for birth certificate verification)."  
* **Tertiary:** "List of Authorized Photo Studios," "Post Office Locations & Operating Hours."

**3\. Healthcare**

* **Primary:** "Clinical Guidelines for Type 2 Diabetes Management."  
* **Secondary:** "Pharmaceutical Database (Metformin, Insulin dosages)," "Nutritional & Dietary Plans for Diabetics."  
* **Tertiary:** "Directory of Endocrinologists," "Information on Local Support Groups," "Recommended Fitness Routines."

## 1.2 Impact on the Labeling System Design

This domain analysis directly informs the structure of your 2-level labeling system. The clear relationships and boundaries identified in the Venn diagrams translate naturally into a logical hierarchy. We suggest that you also use an AI-driven approach to assemble the labeling system design. You can use any of the common RAG tools like ChatGPT, Gemini or Grok for example to accomplish this in minutes. Once this is done, you will need to verify it with subject matter experts to ensure that it meets the needs of indexing the required data sets.

* **Categories (Level 1\)** often emerge from the overarching themes that group your primary and secondary data sets. For example, in Agriculture, the primary set "Corn Crop Management" and secondary sets like "Pesticides" and "Fertilizers" all fall under the logical **Category** of Crop Management.  
* **Services/Topics (Level 2\)** are the primary, secondary, and even tertiary data sets themselves. They become the specific, actionable knowledge points within a category.

**Tier-Based Design Strategy:** To translate your data tiers into a functional hierarchy, apply the following strategy:

1. **Primary Data MUST have dedicated labels:** Every primary data set represents a core user need and must have a distinct, clear Service (Level 2\) label.  
2. **Secondary Data usually needs dedicated labels:** These should generally have their own Service (Level 2\) labels, typically grouped under the same Category (Level 1\) as the primary data they support.  
3. **Group Tertiary Data to avoid clutter:** Avoid creating granular labels for every piece of tertiary data. Instead, group them into broader "Reference" or "General Information" Service labels. This prevents the hierarchy from becoming overwhelming while still making the data accessible.

**AVOID USING THE SAME LABELS FOR SERVICES IN MULTIPLE CATEGORIES**

**Common Sense Design Principles:**

* **User-Centric Naming:** Labels should reflect *user intent*, not internal organizational structures. A user looking for "Pesticides" does not care which government sub-department manages them.  
* **Mutually Exclusive, Collectively Exhaustive (MECE):** Aim for categories that don't overlap significantly. While documents can have multiple labels, the hierarchy itself should be clean and logical.  
* **Strict 2-Level Limit:** GENIE.AI uses a shallow hierarchy. Do not try to force a third level by creating overly complex names (e.g., avoid Crops \- Corn \- Pests \- Beetles; instead use Category: Crop Management, Service: Pest Control).

**Applying this to the Agriculture example:**

| Category (Level 1\) | Service/Topic (Level 2\) | Data Source Origin |
| :---- | :---- | :---- |
| **Crop Management** | Corn Planting & Harvest Guide | Primary |
|  | Soil Health and Fertilization | Secondary |
|  | Pest and Disease Control | Secondary |
| **Market & Logistics** | Historical Market Prices | Tertiary (Grouped) |
|  | Approved Equipment Suppliers | Tertiary (Grouped) |

This method ensures your knowledge hierarchy is not arbitrary but is a direct reflection of how the information is interrelated, making the system more intuitive for both the AI and the end-user.

## 1.3 Data Curation and Verification Process

To deliver an accurate, trustworthy, and useful RAG solution, the underlying data must be meticulously curated and verified. Ingesting inaccurate, outdated, or poorly formatted data is the primary cause of poor performance and "hallucinations" in RAG systems. The GENIE.AI framework supports a wide range of file formats for the ingestion process.

**Supported Formats:**

* Web pages (.html, via URL links) \- note that depth of crawling for web sites can be controlled as well as the language accepted.  
* Documents (.pdf, .docx) \- .doc HAS been removed as it is legacy and problematic (conversion to .docx or .pdf is recommended)  
* Spreadsheets (.xlsx) \- .xls has been removed for the same problametic legacyt reasons. You can use .xlsx sparingly. We suggest this is done sparingly as there are limitations related to multiple tabs and some of the other salient aspects of spreadsheets (such as calculations and charts etc.) that are problematic.  
* Markdown (.md)  
* Plain Text (.txt)

**Supported Language for Ingestion**

* GENIE-AI is set up to support a single language for ingestion purposes.  
* The single language is configurable \- our default configuration is EN.  
* File uploads will be constrained to the single configured language (by language detection).  
* Language detection technology is not perfect (especially with URL links)... you can always convert the required information to a supported file type.  
* Translations are performed on the fly in and out of the backend by an LLM (also configurable).

**Curation Best Practices:**

1. **Source Vetting:** Always prioritize authoritative and official sources. For government services, this means official government websites and publications. For healthcare, use peer-reviewed medical journals, clinical guidelines from recognized health organizations, and regulatory bodies. **You will need a team of experts to validate and curate this knowledge and it will need to be agreed and signed-off before ingestion.**  
2. **Data Cleaning:** \* **Standardize Terminology:** Ensure consistent use of terms (e.g., "Type 2 Diabetes" vs. "T2D").  
   * **Remove Duplicates & Noise:** Eliminate redundant documents, boilerplate text (headers, footers, irrelevant ads), and artifacts from the conversion process.  
   * **Verify OCR Accuracy:** When converting scanned PDFs, manually review the resulting text for Optical Character Recognition (OCR) errors, as these can introduce factual inaccuracies.  
3. **Logical Chunking:** Ensure that data is ingested and split into semantically meaningful chunks. A chunk should ideally represent a complete idea or paragraph. A split in the middle of a sentence can cause the system to lose context.

**Verification Workflow:**

1. **Subject Matter Expert (SME) Review:** This is the most critical step. Once data is curated, it must be reviewed by experts in the relevant domain. An agronomist should verify the crop data, and a doctor should verify the healthcare guidelines. SMEs check for factual accuracy, completeness, and relevance.  
2. **Version Control:** Your knowledge base is not static. Regulations, guidelines, and data change. Implement a system to track document versions and schedule regular reviews (e.g., annually) to update or retire outdated information. The sources for these documents should be version controlled. Note that documents can be retracted and ingested again as and when they change.  
3. **Establish a Feedback Loop:** The GENIE.AI framework includes capabilities for users to provide feedback on responses. This user feedback is an invaluable, continuous source of verification. A process must be in place to review flagged responses, trace them back to the source document, and make corrections as needed.

By following this rigorous process of designing, curating, and verifying your data, you will build a robust and reliable knowledge base that allows GENIE.AI to perform at its full potential.

---

# Step 2: Prerequisites

Before attempting installation, ensure your infrastructure meets the necessary requirements.

## 2.1 Hardware Requirements

GENIE.AI requires significant computational resources, particularly for AI model inference (LLMs, embeddings, rerankers). This is critical and the solution will potentially not even run without the required resources.

* Please refer to the [**T-Shirt Sizing Guide**](https://osaips.atlassian.net/wiki/external/ODg2YmZmZTJjNGMyNGQzYzgwZWUzNTk2NWI3NjdiMDk) to determine the appropriate hardware for your deployment scale. Even for development and MVP work, you will need to meet the minimum requirements outlined in the small tee shirt size.

## 2.2 Software Prerequisites

* **Ubuntu Linux 22.04:** Everything has been tested on Ubuntu 22.04. It is OK to use variant Linux distributions but that is something you need to resolve.  
* **Docker & Docker Compose:** Required for orchestrating the containerized services.  
* **NVIDIA Drivers & CUDA:** Required for GPU acceleration of the AI services (vLLM, TEI).  
  * Follow the [**NVIDIA Driver Installation Guide**](https://osaips.atlassian.net/wiki/external/NTY1ZGY1N2RmYzkzNGRiMGIxMzc1ZDM4ZjI4NmNlOTE) to ensure your host is ready for GPU workloads.  
* **Node.js:** Required for the JavaScript components

## 2.3 Install and Verify Docker on Every Host

### Note: that the specifics of getting this done on any cloud providers Ubuntu images may differ
#### Most importantly... get the pre-requisites installed and check them
1. docker
2. node
3. npm

#### CRITICAL - pay strict attention to the specifics of 3-node or single-node architecture

Bash

##### 1\. Update and install prerequisites

sudo apt-get update

sudo apt-get install \-y ca-certificates curl gnupg

##### 2\. Add Docker's official GPG key

sudo install \-m 0755 \-d /etc/apt/keyrings

curl \-fsSL [https://download.docker.com/linux/ubuntu/gpg](https://download.docker.com/linux/ubuntu/gpg) | sudo gpg \--dearmor \-o /etc/apt/keyrings/docker.gpg

sudo chmod a+r /etc/apt/keyrings/docker.gpg

##### 3\. Set up the official Docker repository
```
echo \
"deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/debian \
$(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
```

##### 4\. Install Docker Engine

###### *(This also removes conflicting older versions like docker.io if present)*

sudo apt-get update

sudo apt-get install \-y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

##### 5\. Start and enable the Docker daemon

###### *(Necessary if the installer fails to start it automatically)*

sudo systemctl start docker

sudo systemctl enable docker

##### 6\. Grant your user standard Docker permissions

sudo usermod \-aG docker $USER

newgrp docker

##### 7\. Verify Docker

docker run hello-world

---

## 2.4 Install Node.js on Every Host and Verify

Bash

curl \-fsSL [https://deb.nodesource.com/setup\_lts.x](https://deb.nodesource.com/setup_lts.x) | sudo \-E bash \-

sudo apt-get install \-y nodejs

node \-v

npm \-v

---

# Step 3: Base Installation

You must complete one of these base docker compose based installations before configuring the application services (single node or three node) \- Kubernetes will be added later. The way that the 2 docker compose based deployent options are organized in the repository is as follows:

Plaintext

repository-root/  
├── docker-compose.yaml           \# Single-node docker compose deployment model  
├── env                           \# .env file for the single-node docker compose  
├── components/  
│   ├── docker-compose.yaml       \# Docker compose for infrastructure tier (three node model)  
│   ├── gov-chat-backend/  
│   │   └── env                   \# .env file for the node.js backend service  
│   ├── gov-chat-frontend/  
│   │   └── env                   \# .env file for the Vue 3 application  
│   └── document-repository/  
│       └── env                   \# .env file for the document repository service  
├── api-gateway-solution/  
│   ├── docker-compose.yaml       \# Docker compose for bastion host tier  
│   └── env                       \# .env file for the bastion tier  
└── genie-ai-overlay/       \# This is the folder where all the build overlay files exist  
│   ├── build-patches       \# Shell scripts to patch the build  
│   ├── chatqna                \# Overlay files for the chatqna server extensions  
│   ├── core                      \# Overlay files for the OPEA core extensions  
│   ├── dataprep              \# Overlay files for the dataprep service extensions  
│   ├── http-service          \# Overlay files for the http-service service extensions  
     └── retriever                \# Overlay files for the retriever service extensions  
├── docker-compose.yaml       \# Docker compose for customized GENIE.AI OPEA  
└── env                       \# .env file for the OPEA tier

Following are the details for configuring both the single-node deployment model and the three node deployment model (Options A and B):

## Option A: Single-Node Installation (MVP/Dev)

This method deploys all services onto a single host using Docker Compose.

##### 1\. Clone the Repository

**Note:** if you plan to commit then you must clone the main UNICC repository at https://opensource.unicc.org/un/itu/genie-ai/ and not the replica. Also not that as a 3rd party, you may be required to checkout a specific branch - check with the administrator.

Clone the appropriate repository to your local machine:

* **Public Replica:** https://gitlab.com/fordendk/genie-ai-replica  
* **Internal UNICC GitLab:** [(Check with administrator)](https://opensource.unicc.org/un/itu/genie-ai/)


Bash

git clone https://gitlab.com/fordendk/genie-ai-replica  
cd genie-ai-replica

##### 2\. Environment Configuration (.env)

The docker-compose.yaml file sources its configuration from an .env file located in the root of the repository (named env in the repo). You must create this file (e.g., by copying the existing env example to .env) and populate it with your specific settings.

There are 2 templates in the repository to start with:
1) env - used for modern GPU on single-node deployments (copy env .env to kickstart your config)
2) env-T4 - used for older GPUs on single node deployments

The following tables document all variables found in the .env file, grouped by the service they configure. You can determin the appropriate configuration and use this table to determin the values that you should use. Note that you will need to create access tokens and API keys yourselves for various services. You will also need to establish email infrastructure services and configure the credentials for that. If you are starting with one of the templates, then you can largely skip the settings section other than tailoring some specifics which should be self-evident when you look at the .env file.

**General & Proxy Settings**  
These settings control global logging and proxy configurations for environments behind corporate firewalls.

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| LOGFLAG | Global flag to enable/disable detailed logging. | true |
| no\_proxy | Comma-separated list of hosts to bypass the proxy. | noproxy |
| http\_proxy | HTTP proxy URL (leave blank if not used). | http://proxy.example.com:8080 |
| https\_proxy | HTTPS proxy URL (leave blank if not used). | http://proxy.example.com:8080 |

**Kong (API Gateway) & Database**  
Configuration for the Kong API Gateway and its backing PostgreSQL database.

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| POSTGRES\_USER | Username for the Kong database. | kong |
| POSTGRES\_DB | Name of the Kong database. | kong |
| POSTGRES\_PASSWORD | Password for the Kong database. | k1ngk0ng |
| KONG\_DATABASE | Tells Kong which database type to use. | postgres |
| KONG\_PG\_HOST | Hostname for the Kong database service. | kong-database |
| KONG\_PG\_USER | Kong service user (usually matches POSTGRES\_USER). | kong |
| KONG\_PG\_PASSWORD | Kong service password. | k1ngk0ng |
| KONG\_PROXY\_ACCESS\_LOG | Path for proxy access logs. | /dev/stdout |
| KONG\_ADMIN\_ACCESS\_LOG | Path for admin access logs. | /dev/stdout |
| KONG\_PROXY\_ERROR\_LOG | Path for proxy error logs. | /dev/stderr |
| KONG\_ADMIN\_ERROR\_LOG | Path for admin error logs. | /dev/stderr |
| KONG\_ADMIN\_LISTEN | Kong admin API listen address and ports. | 0.0.0.0:8001, 0.0.0.0:8444 ssl |
| KONG\_DNS\_RESOLVER | DNS resolver for Kong (Docker internal DNS). | 127.0.0.11 |
| KONG\_DNS\_ORDER | Order of DNS resolution types. | LAST,A,AAAA,CNAME |

**Frontend Service (Vue.js)**  
Configuration for the user-facing web application.

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| APP\_NAME | The display name of the application. | Genie AI |
| FRONTEND\_PORT | The port the Vue 3 app runs on locally. | 8090 |
| VUE\_APP\_API\_URL | Public URL for the frontend to reach the backend API. | https://\<your-proxy\>/api |
| VUE\_PROXY\_HOST | Target for the Vue development proxy. | kong:8010 |
| VUE\_APP\_CSP\_CONNECT\_SRC | Allowed connection sources for CSP (Vue build). | 'self' https://genie-ai.itu.int |
| CSP\_CONNECT\_SRC | Allowed connection sources for CSP (Backend Helmet config). | 'self' wss://localhost:8090 |
| CORS\_ALLOWED\_ORIGINS | Comma-separated list of allowed CORS origins. | http://localhost,https://genie.ai |

**Backend Service (Node.js Logic)**  
Configuration for core logic, sessions, email, backups, and OPEA integration.

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| NODE\_ENV | Application environment (development/production). | production |
| BACKEND\_PORT | Internal port the Node.js app listens on. | 3000 |
| API\_PREFIX | Global prefix for all API routes. | /api |
| UV\_THREADPOOL\_SIZE | Libuv thread pool size for async operations. | 128 |
| LOG\_LEVEL | Logging verbosity. | debug |
| JWT\_SECRET | Secret key for signing JSON Web Tokens. | UJeFROw+yRJe... |
| JWT\_EXPIRES\_IN | Expiration time for JWTs. | 24h |
| SESSION\_SECRET | Secret used to sign session cookies. | default-session-secret |
| SESSION\_EXPIRATION\_TIME | Session lifetime in milliseconds. | 1800000 |
| CORS\_ORIGIN | Primary CORS origin for the backend integration. | http://localhost/ |
| OPENWEATHERMAP\_API\_KEY | API Key for weather widget integration. | b115ccced... |
| EMAIL\_HOST | SMTP server host. | \<your-smtp-host\> |
| EMAIL\_PORT | SMTP server port. | \<your-smtp-port\> |
| EMAIL\_SECURE | Use secure connection (TLS/SSL). | false |
| EMAIL\_USER | SMTP username. | \<your-email-user\> |
| EMAIL\_PASSWORD | SMTP password. | \<your-smtp-password\> |
| EMAIL\_FROM | Noreply email address. | noreply@\<your-domain\> |
| FRONTEND\_URL | Base URL of the frontend (for email links). | https://localhost/ |
| BACKUP\_DIR | Directory to store database backups. | ./database\_backups |
| MAX\_BACKUPS | Number of backups to retain. | 5 |
| BACKUP\_FORMAT | Format for backups (e.g., json, dump). | json |
| COMPRESS\_BACKUPS | Enable gzip compression for backups. | true |
| OPEA\_HOST | Hostname for the OPEA backend service. | chatqna-xeon-backend-server |
| OPEA\_PORT | Port for the OPEA backend service. | 8888 |
| CONTEXT\_OPTION | Strategy for handling conversation context. | conversation-with-context-labels |

**Translation & Caching**  
Configuration for the translation engine and Redis caching.

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| TRANSLATION\_THREADS | Number of concurrent translation threads. | 4 |
| TRANSLATION\_BATCHES | Batch size for translation processing. | 5 |
| TRANSLATION\_CACHE | Enable or disable translation caching. | on |
| TRANSLATION\_CACHE\_PATH | File path for cache (if file-based). | /cache/translations |
| TRANSLATION\_CACHE\_HOST | Redis host for translation caching. | redis-cache |
| TRANSLATION\_CACHE\_PORT | Redis port. | 6379 |
| TRANSLATION\_CACHE\_PASSWORD | Password for the Redis cache. | \!@\#$5678 |

**ArangoDB (Knowledge Base)**  
Connection settings for the graph and vector database.

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| ARANGO\_URL | Connection URL for ArangoDB. | http://arango-vector-db:8529 |
| ARANGO\_PORT | Port ArangoDB is listening on. | 8529 |
| ARANGO\_DB\_NAME | Database name used by the backend. | genie-ai |
| ARANGO\_DB | Database name used by the frontend/utility scripts. | genie-ai |
| ARANGO\_USER | Database username. | root |
| ARANGO\_USERNAME | Database username (alias). | root |
| ARANGO\_PASSWORD | Root password for ArangoDB. | test |
| MAX\_SOCKETS | Maximum concurrent socket connections. | 100 |
| MAX\_FREE\_SOCKETS | Maximum free sockets to keep open. | 50 |

**Document Repository & Virus Scanning**  
Configuration for file ingestion, storage, and security scanning.

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| DOC\_REPO\_PORT | Internal port for the document service. | 3001 |
| DOC\_REPO\_URL | URL for the backend to access the doc repo. | http://localhost:3001 |
| UPLOAD\_DIR | Local directory path for file uploads. | ./uploads |
| MAX\_FILES\_UPLOAD | Max number of files allowed per upload. | 10 |
| MAX\_FILE\_SIZE | Maximum file upload size in bytes (approx 50MB). | 52428800 |
| DOCUMENT\_INGESTION\_LANGUAGE | Language code for document ingestion. | en |
| BCRYPT\_ROUNDS | Cost factor for hashing. | 10 |
| LOG\_FILE | Application log file name. | app.log |
| VIRUS\_SCANNING | Enable/Disable ClamAV scanning on upload. | true |
| CLAMSCAN\_ACTIVE | Master switch for ClamAV integration. | true |
| CLAMSCAN\_HOST | Hostname for the ClamAV service. | 127.0.0.1 |
| CLAMSCAN\_PORT | Port for the ClamAV service. | 3310 |
| CLAMSCAN\_TIMEOUT | Timeout for virus scanning (ms). | 60000 |
| CLAMSCAN\_REMOVE\_INFECTED | Automatically delete infected files. | false |
| CLAMSCAN\_QUARANTINE\_INFECTED | Quarantine infected files instead of deleting. | false |
| CLAMSCAN\_DEBUG\_MODE | Enable debug logging for scanner. | false |
| CLAMSCAN\_SOCKET | Use socket connection (vs TCP). | false |
| CLAMSCAN\_LOCAL\_FALLBACK | Fallback to local binary if daemon fails. | true |
| CLAMSCAN\_PATH | Path to local ClamAV binary. | /usr/bin/clamdscan |

**Authentication Service**  
Dedicated service for managing user authorization tokens.

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| AUTH\_SERVICE\_URL | Base URL for the auth service. | https://localhost/ |
| AUTH\_SERVICE\_PORT | Port for the auth service. | 6666 |
| GET\_AUTH\_TOKEN\_URL | Internal URL to retrieve auth tokens. | http://http-service:6666/get-token |
| AUTH\_SERVICE\_USERNAME | Service account username for token generation. | genie-ai-manager |
| AUTH\_SERVICE\_PASSWORD | Service account password for token generation. | 1357924680+Manager |

**OPEA & ChatQnA Service Orchestration**  
These variables define the internal wiring and ports for the AI microservices.

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| NGINX\_PORT | Port for the ChatQnA Nginx router. | 80 |
| FRONTEND\_SERVICE\_IP | Hostname for the ChatQnA UI Server. | chatqna-xeon-ui-server |
| FRONTEND\_SERVICE\_PORT | Port for the ChatQnA UI Server. | 5173 |
| BACKEND\_SERVICE\_NAME | Name of the ChatQnA backend service. | chatqna |
| BACKEND\_SERVICE\_IP | Hostname/IP of the ChatQnA backend. | chatqna-xeon-backend-server |
| BACKEND\_SERVICE\_PORT | Port of the ChatQnA backend. | 8888 |
| DATAPREP\_SERVICE\_IP | Hostname for the Dataprep service. | dataprep-arango-service |
| DATAPREP\_SERVICE\_PORT | Port for the Dataprep service. | 5000 |
| MEGA\_SERVICE\_HOST\_IP | Hostname of the Mega Service Orchestrator. | chatqna-xeon-backend-server |
| CHATQNA\_TYPE | Type of ChatQnA deployment. | CHATQNA\_MACDAVID |
| OPEA\_EXAMPLES\_URL | URL for OPEA Examples Git repo. | https://github.com/... |
| OPEA\_GENAI\_COMPS\_URL | URL for OPEA GenAI Comps Git repo. | https://github.com/... |
| EMBEDDING\_SERVER\_HOST\_IP | Hostname for the TEI embedding service. | tei |
| EMBEDDING\_SERVER\_PORT | Port for the TEI embedding service. | 80 |
| RETRIEVER\_SERVICE\_HOST\_IP | Hostname for the retriever service. | retriever-arango-service |
| RETRIEVER\_SERVICE\_PORT | Port for the retriever service. | 7025 |
| RERANK\_SERVER\_HOST\_IP | Hostname for the TEI reranking service. | tei\_reranker |
| RERANK\_SERVER\_PORT | Port for the TEI reranking service. | 80 |
| LLM\_SERVER\_HOST\_IP | Hostname for the vLLM inference engine. | vllm |
| LLM\_SERVER\_PORT | Port for the vLLM inference engine. | 8000 |
| CHATQNA\_SYSTEM\_PROMPT | Main ChatQnA system prompt for responding to user queries based on retrieved content. | "You are a friendly and polite information assistant..." |
| CHATQNA\_ENFORCE\_ABSTENTION | Enables or disables strict abstention behavior by the LLM | true |
| CHATQNA\_ABSTENTION\_INSTRUCTIONS | Custom instructions to enforce abstention when no relevant info is retrieved | "The knowledge base search did not return relevant or sufficient information. You should clearly inform the user ..." |
| GUARDRAIL\_SERVICE\_HOST\_IP | Hostname for the guardrail service. | guardrail |
| GUARDRAIL\_SERVICE\_PORT | Port for the guardrail service. | 9090 |
| TRANSLATION\_SERVICE\_HOST\_IP | Hostname for the translation service. | translation |
| TRANSLATION\_SERVICE\_PORT | Port for the translation service. | 9030 |
| GUARDRAIL\_URL | Full URL for the Guardrail endpoint. | http://guardrail:9090/v1/guardrails |
| E2E\_CPU\_URL | End-to-end CPU URL endpoint. | http://localhost:3000 |

**Dataprep Configuration**  
Configuration for how documents are chunked and prepared for the knowledge graph.

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| DATAPREP\_HOST | Hostname for the Dataprep service. | http://dataprep-arango-service |
| DATAPREP\_PORT | Port for the Dataprep service. | 5000 |
| DATAPREP\_CHUNK\_SIZE | Token/Character count per document chunk. | 500 |
| DATAPREP\_CHUNK\_SIZE\_PDF | The chunk size to use for PDF files | 500 |
| DATAPREP\_CHUNK\_SIZE\_DOCX | The chunk size to use for DOCX files (better at 1000 or more) | 1000 |
| DATAPREP\_CHUNK\_SIZE\_XLSX  | The chunk size to use for XLSX files (better to use 1500 or more \- rows can be large \- you don't want to split rows) | 1500 |
| DATAPREP\_CHUNK\_SIZE\_PPTX  | The chunk size to use for PPTX files | 500 |
| DATAPREP\_CHUNK\_SIZE\_HTML  | The chunk size to use for HTML files | 500 |
| DATAPREP\_CHUNK\_SIZE\_TXT  | The chunk size to use for TXT files | 500 |
| DATAPREP\_CHUNK\_SIZE\_MD | The chunk size to use for markdown files | 500 |
| DATAPREP\_CHUNK\_OVERLAP | Overlap between chunks to preserve context. | 50 |
| DATAPREP\_ARANGO\_GRAPH\_NAME | Graph name for storing ingested data. | GRAPH |
| DATAPREP\_ARANGO\_INSERT\_ASYNC | Perform inserts asynchronously. | false |
| DATAPREP\_ARANGO\_USE\_GRAPH\_NAME | Force usage of graph name. | true |
| DATAPREP\_NODE\_PROPERTIES | Custom properties for graph nodes. | (Empty) |
| DATAPREP\_RELATIONSHIP\_PROPERTIES | Custom properties for graph edges. | (Empty) |
| DATAPREP\_OPENAI\_CHAT\_ENABLED | Enable OpenAI format for chat prep. | true |
| DATAPREP\_OPENAI\_EMBED\_ENABLED | Enable OpenAI format for embeddings. | true |
| DATAPREP\_EMBED\_NODES | Embed graph nodes. | true |
| DATAPREP\_EMBED\_RELATIONSHIPS | Embed graph relationships. | true |
| DATAPREP\_EMBED\_SOURCE\_DOCUMENTS | Embed original source documents. | true |
| MAX\_CONCURRENT\_BATCHES | Limit on concurrent processing batches for data preparation.  | 5 |
| DOCLING\_DEVICE | Configure docking to user either cuda or cpu (cuda|cpu). Cuda will be much faster for document processing. | cuda |
| DATAPREP\_COMPONENT\_NAME | Name of the specific dataprep component. | GENIE\_DATAPREP\_ARANGODB |
| DOCUMENT\_REPOSITORY\_URL | Internal URL for the Node.js Document Repository Service. | `http://document-repository:3001` |
| BACKEND\_SERVICE\_URL | URL to the backend component used to fetch knowledge hierarchy.  | `http://backend:3000` |
| `LABELING_STRATEGY` | Strategy for labeling chunks (`llm`, `embedding`, or `bm25`).  | llm |
| EMBEDDING\_LABEL\_THRESHOLD | Threshold score for embedding-based labeling.  | 0.75 |
| BM25\_LABEL\_THRESHOLD | Threshold score for BM25-based labeling.  | 2.00 |
| CONTENT\_EXTRACTION\_METHOD | Method for text extraction (`opea` or `docling`).  | docling |
| LABEL\_SELECTOR\_SYSTEM\_PROMPT | System prompt defining the rules for LLM semantic labeling.  | You are a precise semantic... |

**Retriever Configuration**  
Configuration for the retrieval logic (hybrid search, traversals, etc.).

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| RETRIEVER\_COMPONENT\_NAME | Name of the specific retriever component.  | GENIE\_RETRIEVER\_ARANGODB |
| RETRIEVER\_ARANGO\_GRAPH\_NAME | Graph name for retrieving data. | GRAPH |
| RETRIEVER\_ARANGO\_SEARCH\_START | Starting point for graph search. | node |
| RETRIEVER\_ARANGO\_SEARCH\_MODE | Search mode (e.g., hybrid, vector). | hybrid |
| RETRIEVER\_ARANGO\_TRAVERSAL\_ENABLED | Enable graph traversal during retrieval. | true |
| RETRIEVER\_ARANGO\_TRAVERSAL\_MAX\_DEPTH | Max depth for graph traversal. | 3 |
| RETRIEVER\_ARANGO\_TRAVERSAL\_MAX\_RETURNED | Maximum number of items returned during graph traversal.  | 3 |
| RETRIEVER\_ARANGO\_TRAVERSAL\_SCORE\_THRESHOLD | Minimum score threshold for keeping traversal results.  | 0.5 |
| RETRIEVER\_ARANGO\_TRAVERSAL\_CONCURRENT\_BATCHES | Number of concurrent batches for traversal operations.  | 1 |
| RETRIEVER\_ARANGO\_DISTANCE\_STRATEGY | Distance metric used for vector search (e.g., COSINE).  | COSINE |
| RETRIEVER\_ARANGO\_NUM\_CENTROIDS | Number of centroids for vector search optimization.  | 1 |
| RETRIEVER\_ARANGO\_USE\_APPROX\_SEARCH | Use approximate nearest neighbor search. | false |
| RETRIEVER\_ARANGO\_K | Controls the number of top-rated  chunks returned by the retriever.  | 5 |
| RETRIEVER\_ARANGO\_FETCH\_K | Regulates the number of candidate chunks to which the similarity score filtering is applied. Increasing FETCH\_K and K could contribute to better accuracy in case of information-dense queries or content. Decreasing both could boost speed. Increasing the former while decreasing the latter could potentially improve both accuracy and speed, but create greater risk of errors for edge cases | 10 |
| RETRIEVER\_SUMMARIZER\_ENABLED | Enable summarization of retrieved docs. | false |
| RETRIEVER\_OPENAI\_CHAT\_ENABLED | Enable OpenAI chat format in retriever. | true |
| RETRIEVER\_OPENAI\_EMBED\_ENABLED | Enable OpenAI embed format in retriever. | true |
| RETRIEVER\_OPENAI\_EMBED\_MODEL | Embedding model used by the retriever. | text-embedding-3-small |
| ARANGO\_FILTER\_STRATEGY | Strategy for applying filters (OR/AND). | OR |

### Retriever Overview

The retriever's primary role is to receive a query embedding, perform a multi-stage search, and output the top K most relevant document chunks to be processed by a reranker.

The **GENIE.AI retriever** utilizes a hybrid strategy combining vector similarity search, metadata label filtering, and ArangoDB graph traversals to uncover contextually linked information.

#### 1. Vector Search & Candidate Selection
These parameters define the initial "dragnet" that pulls potential matches from the database.

- **RETRIEVER_ARANGO_FETCH_K** (e.g., 15)
  - *Logic:* The number of initial candidates fetched for MMR (Maximal Marginal Relevance) or initial filtering.
  - *Impact:* Higher values increase "recall" (chance of finding the right doc) but also increase database latency and memory usage during the diversity sorting phase.

- **RETRIEVER_ARANGO_K** (e.g., 5)
  - *Logic:* The final count of chunks passed from the retriever to the reranker.
  - *Impact:* This is the primary driver of Reranker Latency. Increasing this provides more variety to the reranker but slows down total response time.

- **RETRIEVER_ARANGO_SCORE_THRESHOLD** (e.g., 0.5)
  - *Logic:* The minimum similarity score required for a chunk to be considered.
  - *Impact:* Controls precision. Setting this too high may result in "no results found," while setting it too low increases "noise" that can lead to LLM hallucinations.

### 2. Graph Traversal Strategy
When enabled, the retriever explores relationships in ArangoDB to find relevant neighbors of the initial vector matches.

- **RETRIEVER_ARANGO_TRAVERSAL_ENABLED** (True/False)
  - *Impact:* Toggles multi-hop retrieval. When True, it adds "hidden" context but increases compute/latency.

- **RETRIEVER_ARANGO_SEARCH_START**
This determines the strategy of traversal based on provided AQL snippets:

| Mode | Logic | Use Case |
|---|---|---|
| CHUNK | Goes from found chunk → Parent Node → Other Linked Edges | Broadening context: "I found a paragraph about Apples. Show me other concepts linked to Apples." |
| EDGE | Uses found document to fetch its specific source chunk | Grounding metadata: "I found a reference or specific edge. Give me the actual source text." |
| NODE | Traverses deep into graph up to MAX_DEPTH, finds linked edges and returns their source chunks | Complex reasoning: "Find Suppliers or Risks linked to Product A." |

- **RETRIEVER_ARANGO_TRAVERSAL_MAX_DEPTH** (e.g., 3)
  - *Impact:* Limits how many "hops" the search goes. Increasing beyond 2 or 3 can cause exponential latency spikes in dense graphs.

- **RETRIEVER_ARANGO_TRAVERSAL_MAX_RETURNED** (e.g., 3)
  - *Impact:* Limits volume of related information injected into a single chunk's context, protecting the LLM's context window.

### 3. Additional Modules: Filtering & Summarization
These modules refine data before it leaves the retriever.

#### Labels-Based Filtering
- How it works: Applies strict AQL FILTER based on `categoryLabel` or `serviceLabels` during similarity search.
- Tuning: Using AND ensures high accuracy for domain-specific queries; OR allows broader exploration.

#### Summarization (`SUMMARIZER_ENABLED`)
- How it works: Uses an LLM to rewrite each retrieved chunk addressing user query and integrating related info via graph.
- Impact:
    - *Accuracy:* Dramatically improves context relevance for final answer.
    - *Speed:* Major bottleneck due to synchronous LLM calls per chunk, adding several seconds.

**RERANKER Configuration**  
Configuration for the reranker logic

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| RERANKING\_STRATEGY | Defines how the final subset of chunks is selected after reranking. Possible values are: 'slice', 'threshold', and 'knee_threshold'. | threshold |
| RERANKER\_TOP\_N | Regulates the number of chunks returned by the reranker if RERANKING_STRATEGY is 'slice'. | 3 | 
| RERANKING\_THRESHOLD | Defines the minimum relevance score required for a chunk to be included if RERANKING_STRATEGY is 'threshold'. | 0.75 |


## The Reranker

The Reranker acts as the final quality filter. It receives the top candidates from the retriever and performs a more computationally intensive **"cross-encoder"** analysis to re-score the relevance of each chunk against the actual user query.

### Key Parameters 
#### `RERANKING_STRATEGY`
Defines how the final subset of chunks is selected after reranking.

**slice (default)**
Selects the top N chunks based on ranking score. → Controlled by RERANKER_TOP_N.

**threshold**
Selects all chunks whose relevance score exceeds a fixed threshold. → Controlled by RERANKING_THRESHOLD.

**knee_threshold**
Dynamically determines a cutoff point (“knee” or “elbow”) in the score distribution using the kneed algorithm. → Automatically balances recall and precision based on score drop-off.

#### `RERANKER_TOP_N`
This parameter controls the final number of high-confidence chunks sent to the LLM as context for response generation.

##### Increasing the value of `RERANKER_TOP_N`
- **Improves the "Recall"** for the LLM. It is more likely to capture the full answer if the information is spread across multiple documents.
- Can introduce **"Context Stuffing."** If the extra chunks are only marginally relevant, they can distract the LLM or lead to **"lost in the middle"** phenomena, where the model ignores the most relevant data.
- **Increases** the time to generate a response. A larger context window requires the LLM to perform more computation during the "prefill" stage, and increased prompt size can lead to higher token costs and slower output.

##### Reducing the value of `RERANKER_TOP_N`
- Creates a **higher risk of missing the answer.** If reranker's top results are very similar, or if answering requires four specific pieces of information, a low N will result in incomplete or **"I don't know"** responses.
- Significantly **speeds up** response times. Smaller prompts allow for faster processing by the LLM and reduce memory consumption on inference servers.
- Forces the LLM to focus only on high-confidence matches, which can reduce hallucinations caused by conflicting or noisy information in lower-ranked chunks.

#### `RERANKING_THRESHOLD`
Defines the minimum relevance score required for a chunk to be included.

##### Increasing the value of `RERANKING_THRESHOLD`
- Produces fewer, higher-confidence chunks;
- Increases the risk of missing information (especially when spread across multiple chunks and mixed with other context);

##### Reducing the value of `RERANKING_THRESHOLD`
- Produces more context, potentially leading to more comprehensive responses;
- Increases noise and adds more 'cost' to response generation;



## Crawler Configuration (implemented in the doc repo) 
These variables control the specifics of how crawls are done.

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| CRAWLER\_POLL\_INTERVAL\_MS | Interval (in ms) for the crawler to poll for new jobs.  | 5000 |
| CRAWLER\_MAX\_PAGES | Maximum number of pages to crawl per job.  | 1500 |
| CRAWLER\_WORKER\_CONCURRENCY | Number of concurrent workers for the crawler.  | 10 |

**AI Inference Configuration (vLLM, TEI, TextGen)**  
These variables control the specific AI models used for generation, guardrails, embeddings, and reranking.

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| HUGGINGFACEHUB\_API\_TOKEN | API key for Hugging Face (Required for gated models). | hf\_... |
| HUGGING\_FACE\_HUB\_TOKEN | Alias for the Hugging Face Token. | hf\_... |
| VLLM\_API\_KEY | API key for the VLLM service. | eyJhb... |
| VLLM\_ENDPOINT | URL for the VLLM inference server. | http://vllm:8000 |
| TEXTGEN\_PORT | Port for the text generation service. | 9000 |
| RUST\_BACKTRACE | Enable Rust backtraces for debugging. | 1 |
| NVIDIA\_VISIBLE\_DEVICES | GPUs visible to the container. | all |

**Main Inference Model (vLLM)**

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| VLLM\_LLM\_MODEL\_ID | Model ID for the main chat/generation. | ibm-granite/granite-3.3-2b-instruct |
| VLLM\_MODEL\_ID | Alias for `VLLM_LLM_MODEL_ID` (it is a duplicate/fallback and needs to be removed).  | ibm-granite/granite-3.3-2b-instruct |
| VLLM\_GPU\_UTIL | GPU Memory Utilization for main model (0.0 \- 1.0). | 0.6 |
| VLLM\_MAX\_MODEL\_LEN | Context window size for main model. | 16384 |
| VLLM\_DTYPE | Data type for model weights. | half |

**Translation & Guardrail Model (vLLM)**

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| VLLM\_TRANSLATION\_ENDPOINT | URL for the translation/guardrail service. | http://vllm-translation-guardrail:9031 |
| VLLM\_TRANSLATION\_SERVICE\_PORT | Port for the translation/guardrail service. | 9031 |
| VLLM\_TRANSLATION\_MODEL\_ID | Model ID for guardrails/translation tasks. | google/gemma-3-1b-it |
| VLLM\_TRANSLATION\_GPU\_UTIL | GPU Memory Utilization for guardrail model. | 0.3 |
| VLLM\_TRANSLATION\_MAX\_MODEL\_LEN | Context window for guardrail model. | 16384 |
| VLLM\_TRANSLATION\_DTYPE | Data type for guardrail model. | auto |
| VLLM\_TRANSLATION\_KV\_CACHE\_DTYPE | KV Cache data type for guardrail model. | auto |

**Embeddings & Reranking Models (TEI)**

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| EMBEDDING\_MODEL\_ENDPOINT | Endpoint for the embedding service. | http://tei:80 |
| EMBEDDING\_MODEL\_ID | Model ID used by OPEA embedding service. | BAAI/bge-base-en-v1.5 |
| TEI\_EMBED\_MODEL | TEI embedding model (must match above). | BAAI/bge-base-en-v1.5 |
| TEI\_EMBEDDING\_ENDPOINT | TEI Endpoint (Note: duplicate of Dataprep config). | http://tei:80 |
| RERANKER\_MODEL\_ENDPOINT | Endpoint for the reranking service. | http://tei\_reranker:80 |
| TEI\_RERANKING\_ENDPOINT | Endpoint alias for reranking. | http://tei\_reranker:80 |
| RERANKER\_MODEL\_ID | Model ID for reranking results. | cross-encoder/ms-marco-MiniLM-L-6-v2 |

#### 3\. Model Selection and GPU Compatibility

The GENIE.AI framework relies on four distinct AI models working in concert. Configuring these correctly in your .env file is the single most important factor for system stability and performance.

**The Four Key Model Parameters:**

1. **VLLM\_LLM\_MODEL\_ID**: The main "brain" of the chatbot (e.g., Granite 3B). It generates the final answer based on retrieved context.  
2. **VLLM\_TRANSLATION\_MODEL\_ID**: A smaller, specialized model (e.g., Gemma 2B) used for guardrails and translation tasks to offload work from the main model.  
3. **EMBEDDING\_MODEL\_ID**: Converts documents and queries into mathematical vectors. This determines search accuracy.  
4. **RERANKER\_MODEL\_ID**: A specialized model that double-checks search results for relevance. This is the "quality control" step.

**Hardware Profiles and Recommended Configurations:**

Select the profile below that matches your GPU hardware to avoid "Out of Memory" (OOM) crashes or architecture incompatibility errors.

**Profile A: The "Entry Level" Profile (NVIDIA Tesla T4 \- 16GB VRAM)**

* **Status:** Restricted / Legacy.  
* **Challenge:** The T4 has limited memory (16GB) and older compute architecture (Turing). It does **not** support bfloat16, requiring float16 (half precision) which impacts stability.  
* **Recommended Configuration:**  
  * **LLM:** ibm-granite/granite-3.3-2b-instruct (Small enough to fit alongside other services).  
  * **Embeddings:** BAAI/bge-base-en-v1.5.  
  * **Reranker:** cross-encoder/ms-marco-MiniLM-L-6-v2.  
    * **CRITICAL:** Do not run BAAI/bge-reranker-v2-m3 on a T4. It uses an XLM-RoBERTa architecture that may cause compatibility issues with the T4-optimized TEI images, and its memory footprint is too large for a shared 16GB card.  
  * **Env Settings:** Ensure VLLM\_DTYPE=half and keep VLLM\_MAX\_MODEL\_LEN at 2048\.

After launching services and waiting for the service startup: the following is about how the entry level profile should look in the GPU:

`+-----------------------------------------------------------------------------------------+`  
`| NVIDIA-SMI 550.163.01             Driver Version: 550.163.01     CUDA Version: 12.4     |`  
`|-----------------------------------------+------------------------+----------------------+`  
`| GPU  Name                 Persistence-M | Bus-Id          Disp.A | Volatile Uncorr. ECC |`  
`| Fan  Temp   Perf          Pwr:Usage/Cap |           Memory-Usage | GPU-Util  Compute M. |`  
`|                                         |                        |               MIG M. |`  
`|=========================================+========================+======================|`  
`|   0  Tesla T4                       Off |   00000000:01:01.0 Off |                    0 |`  
`| N/A   33C    P0             26W /   70W |   14099MiB /  15360MiB |      0%      Default |`  
`|                                         |                        |                  N/A |`  
`+-----------------------------------------+------------------------+----------------------+`

`+-----------------------------------------------------------------------------------------+`  
`| Processes:                                                                              |`  
`|  GPU   GI   CI        PID   Type   Process name                              GPU Memory |`  
`|        ID   ID                                                               Usage      |`  
`|=========================================================================================|`  
`|    0   N/A  N/A     14319      C   VLLM::EngineCore                             7774MiB |`  
`|    0   N/A  N/A     16411      C   /usr/bin/python3                             5480MiB |`  
`|    0   N/A  N/A     17763      C   text-embeddings-router                        370MiB |`  
`|    0   N/A  N/A     17810      C   text-embeddings-router                        210MiB |`  
`|    0   N/A  N/A     18355      C   python                                        248MiB |`  
`+-----------------------------------------------------------------------------------------+`

***GPU memory profile: Entry Level***

**Profile B: The "Enterprise" Profile (RTX 6000 Ada, L40S, A100 \- 48GB+ VRAM)**

* **Status:** Production Ready.  
* **Advantage:** These cards support bfloat16 for higher precision and stability. 48GB allows for larger context windows and concurrent processing.  
* **Recommended Configuration:**  
  * **LLM:** ibm-granite/granite-3.3-2b-instruct or meta-llama/Meta-Llama-3.1-70B-Instruct-AWQ (Quantized).  
  * **Embeddings:** BAAI/bge-base-en-v1.5 or BAAI/bge-m3.  
  * **Reranker:** cross-encoder/ms-marco-MiniLM-L-6-v2.  
  * **Env Settings:** Use VLLM\_DTYPE=bfloat16 and enable VLLM\_ATTENTION\_BACKEND=FLASH\_ATTN (if supported) for maximum throughput.

After launching services and waiting for the service startup: the following is about how the enterprise profile should look in the GPU:

`+-----------------------------------------------------------------------------------------+`  
`| NVIDIA-SMI 580.95.05              Driver Version: 580.95.05      CUDA Version: 13.0     |`  
`+-----------------------------------------+------------------------+----------------------+`  
`| GPU  Name                 Persistence-M | Bus-Id          Disp.A | Volatile Uncorr. ECC |`  
`| Fan  Temp   Perf          Pwr:Usage/Cap |           Memory-Usage | GPU-Util  Compute M. |`  
`|                                         |                        |               MIG M. |`  
`|=========================================+========================+======================|`  
`|   0  NVIDIA RTX 6000 Ada Gene...    On  |   00000000:00:05.0 Off |                  Off |`  
`| 31%   47C    P8             34W /  300W |   43359MiB /  49140MiB |      0%      Default |`  
`|                                         |                        |                  N/A |`  
`+-----------------------------------------+------------------------+----------------------+`

`+-----------------------------------------------------------------------------------------+`  
`| Processes:                                                                              |`  
`|  GPU   GI   CI              PID   Type   Process name                        GPU Memory |`  
`|        ID   ID                                                               Usage      |`  
`|=========================================================================================|`  
`|    0   N/A  N/A          829239      C   VLLM::EngineCore                      33060MiB |`  
`|    0   N/A  N/A          831611      C   VLLM::EngineCore                       8402MiB |`  
`|    0   N/A  N/A          833589      C   text-embeddings-router                  540MiB |`  
`|    0   N/A  N/A          833600      C   text-embeddings-router                  700MiB |`  
`|    0   N/A  N/A          834222      C   python                                  626MiB |`  
`+-----------------------------------------------------------------------------------------+`

***GPU memory profile: Enterprise***

#### 4\. Launch Services

Prerequisite: Download OCR Models  **CRITICAL**
Because the framework uses EasyOCR during data prep and model downloads inside containers can be slow or unreliable, you must download these files to the root of your project folder first.

Bash

wget \-O craft\_mlt\_25k.zip https://github.com/JaidedAI/EasyOCR/releases/download/pre-v1.1.6/craft\_mlt\_25k.zip  
wget \-O english\_g2.zip https://github.com/JaidedAI/EasyOCR/releases/download/v1.3/english\_g2.zip

Launch Option A: Standard Launch (RTX 6000 Ada / A100 / H100 / A40)  
Use this command if you are running on modern Ampere or Ada generation hardware with sufficient VRAM (48GB+). This uses the standard docker-compose.yaml.

Bash

docker compose up \-d \--build

Launch Option B: Legacy Launch (nVIDIA Tesla T4)  
Use this command only if you are running on a Tesla T4 (16GB). This uses docker-compose-t4.yaml, which applies specific overrides. It must be understood that the environment for the T4 is restrictive due to the VRAM and the configuration shoe-horns multiple models into a small VRAM footprint:

* **Precision:** Forces dtype=half (float16).  
* **Images:** Uses specific turing tags for TEI containers to ensure CUDA 7.5 compatibility.  
* **Memory Safety:** Reduces batch tokens and GPU utilization limits to prevent system crashes.

Bash

docker compose \-f docker-compose-t4.yaml up \-d \--build

5\. Initial Verification  
After the containers launch, check their status. It may take several minutes for the large AI models (vLLM) to download and initialize.

Bash

\# Check container status  
docker ps

\# Monitor the vLLM initialization (wait for "Application startup complete")  
docker logs \-f vllm-vllm-2

⚠️ **IMPORTANT: EXPECTED ERRORS**  
At this stage, while the containers are running, they are not yet configured. If you inspect the backend logs now, you will see errors related to missing databases (ArangoDB) and unconfigured routes (Kong). This is normal. Do NOT attempt to debug these errors yet. Proceed immediately to Step 4 to complete the necessary infrastructure configuration. The primary purpose of booting the containers now is to allow us to continur configuring Kong, NGINX and ArangoDB infrastructure.
**ERRORS ARE NORMAL. Do NOT attempt to debug these errors.**

Proceed immediately to **Step 4** to complete the necessary infrastructure configuration.

---

# Step 4: Infrastructure Configuration

Once the base services are running (Step 3), you must configure the core infrastructure components before the system is usable.

## 4.1 ArangoDB Database Initialization

While the arango-vector-db service is running, the specific application databases must be created.

1. Access the ArangoDB web interface at [http://localhost:8529](http://localhost:8529) (login with root and the password defined in your .env).  
2. Create the necessary databases as defined in your environment variables (default: genie-ai) \- ensure ALL of the services use the same database (check the .env) - there are multiple ARANGO vars ARANGO_DB and ARANGO_DB_NAME (they msut be the same).

## 4.2 NGINX and Kong API Gateway Configuration **CRITICAL**

#### There are Nginx default.conf files available for both three-node and single-node deployments:

1. For three-node deployments, use the default default.conf and modify the upstream addresses (different servers as it is a three-node deployment)
2. for single-node deployments, use the default.conf-single-node (this uses the container service names)

#### Kong requires specific initialization and configuration to route traffic correctly.

1. **Initialize Database:** Execute these commands to prepare the Kong postgres database:

Bash

\# Note:- the database may have already bean iniitalized<b>

docker compose exec kong-database psql \-U kong postgres \-c "CREATE DATABASE kong;" 

docker compose exec kong-database psql \-U kong postgres \-c "GRANT ALL PRIVILEGES ON DATABASE kong TO kong;"

docker compose run \--rm kong kong migrations bootstrap docker compose restart kong

2. **Apply Configuration:** Navigate to the config directory, stage the correct configuration file (overwriting the default kong\_config.json), and run the apply script (ensure that curl and jq are installed).  
   For Single-Node installation: 

Bash

cd api-gateway-solution/new-config/

cp kong\_config.json-single-node kong\_config.json

chmod \+x [manage-kong-config.sh](http://manage-kong-config.sh)

sudo apt update 

sudo apt install jq

./manage-kong-config.sh \-a

#### For Three-Node installation: 
simply run ./manage-kong-config.sh \\-a as kong\\\_config.json is the default). For a single node config you must use the container service names from the docker-compose.yaml to configure the services in kong i.e. backend and document-repository\*

## CRITICAL - Enter the correct hosts and expect the following output:

Bash

govstack@bb-ai-gpu-01:\~/genie-ai-replica-single-node/api-gateway-solution/new-config$ ./manage-kong-config.sh \-a  
This script will configure your Kong instance.  
Please provide the required connection details - be sure to enter the correct hosts (this depends on whether you are using a 3-node or single-node config - for single-node, use the container service names - for 3-node, use the infrastructure hostname). The example below shows a single-node config.

\--- Kong Admin API Details \---  
Enter Kong host \[default: localhost\]:  
Enter Kong admin port \[default: 8001\]:

\--- Backend Service Details \---  
Enter 'express-api' service host \[default: localhost\]: backend  
Enter 'express-api' service port \[default: 3000\]:

Enter 'document-repository' service host \[default: localhost\]: document-repository  
Enter 'document-repository' service port \[default: 3001\]:

\[2025-11-08 14:12:02\] Applying configuration from kong\_config.json  
\[2025-11-08 14:12:02\] Using Kong Admin API at: [http://localhost:8001](http://localhost:8001)  
\[2025-11-08 14:12:02\] Setting 'express-api' to: backend:3000  
\[2025-11-08 14:12:02\] Setting 'document-repository' to: document-repository:3001  
\[2025-11-08 14:12:02\] Processing service: express-api  
\[2025-11-08 14:12:02\] Service 'express-api' applied successfully.  
...

## 4.3 Nginx Configuration

Nginx acts as the reverse proxy and SSL termination point.

1. Navigate to api-gateway-solution/nginx.  
2. Select the appropriate configuration file:  
\* For \*\*Single-Node\*\*, use: default.conf-single-node (rename to default.conf if necessary for volume mapping, or adjust mapping).  
\* For \*\*Three-Node\*\*, use: default.conf.  
3. Ensure your SSL certificates are placed in the mapped volumes defined in docker-compose.yaml (nginx\\\_certs volume or ./api-gateway-solution/nginx/certs bind mount).

## 4.4 Domain & Security Configuration (CSP & CORS)

When deploying GENIE.AI to a specific host domain (e.g., genie.agency.gov) or a public IP address other than localhost, you must configure the **Content Security Policy (CSP)** and **Cross-Origin Resource Sharing (CORS)** settings. Failure to do this will result in the browser blocking the application from connecting to the backend API or WebSocket services.

This configuration involves updates in two locations: the central .env file and the Nginx configuration file.

### 1. Update Environment Variables (.env)

The frontend and backend services rely on specific environment variables to construct their security headers. Locate the following variables in your root .env file and update them to include your target domain/IP.

**Critical Formatting Note:** When defining CSP sources that contain single quotes (like 'self'), you **must** wrap the entire value in double quotes. Failure to do so may cause the backend configuration to strip the quotes, resulting in browser errors.

**Example Configuration for genie.agency.gov:**

Bash

\# \========= FRONTEND SERVICE CONFIG \=========

\# 1\. VUE\_APP\_CSP\_CONNECT\_SRC: Used by the Vue build process.  
\# Ensure you include both http/https for API and ws/wss for WebSockets.  
VUE\_APP\_CSP\_CONNECT\_SRC="'self' https://genie.agency.gov wss://genie.agency.gov https://genie-ai.itu.int"

\# 2\. CSP\_CONNECT\_SRC: Used by the Node.js Backend (Helmet Middleware).  
\# Must match the frontend allowed sources.  
CSP\_CONNECT\_SRC="'self' https://genie.agency.gov wss://genie.agency.gov https://genie-ai.itu.int"

\# 3\. CORS\_ALLOWED\_ORIGINS: A comma-separated list of origins allowed to access the backend.  
CORS\_ALLOWED\_ORIGINS=https://genie.agency.gov,https://genie-ai.itu.int

**Checklist for Variables:**

* **Protocols:** Ensure you list wss:// (Secure WebSockets) if you are using https://. If you are testing on http://, use ws://.  
* **Ports:** If your application runs on a non-standard port (e.g., :8443), that port must be appended to the domain in the CSP (e.g., https://genie.agency.gov:8443).  
* **Quoting:** Verify that 'self' is enclosed in single quotes, and the whole string is enclosed in double quotes.
* **System Prompts:** These must be single line strings in the environment or docker will not like them.

### 2\. Update Nginx Configuration

The Nginx reverse proxy also serves a Content-Security-Policy header which acts as the final gatekeeper. You must ensure the default.conf file matches your environment variables.

1. Open your active Nginx configuration file (e.g., api-gateway-solution/nginx/default.conf or default.conf-single-node).  
2. Locate the add\_header Content-Security-Policy directive.  
3. Append your new domain to the connect-src section.

**Example Nginx Update:**

Nginx

\# Ensure this is on a SINGLE line to avoid syntax errors  
add\_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; img-src 'self' data:; font-src 'self' data: https://cdnjs.cloudflare.com; connect-src 'self' https://genie.agency.gov wss://genie.agency.gov https://genie-ai.itu.int;" always;

### 3\. Rebuild the Frontend

**Crucial Step:** The Vue.js frontend "bakes" the VUE\_APP\_ environment variables into the static HTML/JS files at **build time**. Simply restarting the container is not enough.

If you change the CSP or Domain settings, you must force a rebuild of the frontend container:

Bash

\# For Single Node  
docker compose down  
docker compose \-f docker-compose.yaml up --build \-d --force-recreate

\# For Standard/Three-Node  
TBD

---

# Step 5: Knowledge Base Population & User Setup

You have a choice at this juncture. Assuming you have done all your data analysis and you have a defined knowledge hierarchy, you can move forward with knowledge hierarchy configuration by script, UI or a combination of both. If you want to start with the UI then skip forward to step 6. If you decide to configure with scripts, with the infrastructure now configured, you can now instantiate the knowledge hierarchy designed in Step 1 and create the required system accounts as follows:

## Method 1: Automated Script Approach (Recommended for Initial Setup)

This method is ideal for initial deployments, migrating an existing instance, or automated CI/CD workflows.

### **5.1 Prepare Script Environment** You must source the environment configuration before running schema scripts to set necessary variables like database URLs and credentials: i.e. modify the set\_env.sh script for the correct database environment

Bash

cd components/gov-chat-backend/scripts/new-schema-scripts

chmod \+x set-env.sh 

source set-env.sh

5.2 Create Database Schema

Use the arango-schema-creator.js script to generate the collections, indexes, and graphs.

Bash

\# Ensure you are still in the new-schema-scripts directory and environment is set  
npm install arangojs 

node arango-schema-creator.js ./arango-schema.json

### 5.3 Create Initial User Accounts

You must create the default Admin and Manager accounts. These are required for the application to load correctly and for full integration with the Document Repository.

Bash

\# Create the Admin account  
node create-genie-ai-admin-account.js

\# Create the Manager account  
node create-genie-ai-manager-account.js

**Note:** These scripts create accounts with default credentials. It is highly recommended to change these passwords immediately after first login via the Admin Dashboard. At this point you can bounce the services and login if you want to test the config without establishing any knowledge heirarchy. The UI allows an Admin to establish the hierarchy with a GUI.

### **Skip to Step 6 if you like**


### 5.4 Populate Hierarchy

Use the create-knowledge-hierarchy.js script to import your Category/Service structure.

* *Note:* Ensure schema validation is temporarily disabled on serviceCategories, services, and categoryServices collections if using an older schema version.

Bash

\# Return to the parent scripts directory if the hierarchy file is there, or adjust the path.  
cd ..  
node create-knowledge-hierarchy.js \--file ./my-hierarchy.json

### 5.5 Generate Translations

(Optional) Use `create-translations.js` to auto-generate labels for other supported languages. You will need to read the README.md in the scripts folder. The script supports **two translation engines**:

#### **Option A: Internal Translation Service (Recommended)**

Uses the built-in NLLB-200 translation model running in the GENIE.AI stack. No external API keys required.

**Prerequisites:**
- GENIE.AI services must be running (`docker-compose up -d`)
- Valid user account with login credentials

**Usage:**

```bash
# Navigate to the scripts directory
cd components/gov-chat-backend/scripts/new-schema-scripts

# Run the script with the internal translation engine
node create-translations.js <LANG> --translation-engine=internal
```

**Example commands:**

```bash
# Generate French translations
node create-translations.js FR --translation-engine=internal

# Generate Bengali translations
node create-translations.js BN --translation-engine=internal

# Generate Mandinka translations for Vue 3 frontend
node create-translations.js MAN --translation-engine=internal

# Generate Mandinka translations for mobile app (uses different code)
node create-translations.js MNK --translation-engine=internal

# Generate Sesotho translations
node create-translations.js ST --translation-engine=internal
```

**Authentication:**
When using `--translation-engine=internal`, the script will prompt for:
- Username (e.g., your admin account)
- Password (entered securely, not echoed to terminal)

The script authenticates with the backend at `http://localhost:3000/api/auth/login` and uses the JWT token to call the internal translation service.

**Supported Language Codes:**
- `ar` - Arabic
- `bn` - Bengali
- `de` - German
- `en` - English (source language, cannot create translations)
- `es` - Spanish
- `fr` - French
- `id` - Indonesian
- `man` - Mandinka (Vue 3 frontend)
- `mnk` - Mandinka (Mobile app - both codes map to same translation)
- `pt` - Portuguese
- `ru` - Russian
- `st` - Sesotho
- `sw` - Kiswahili
- `th` - Thai
- `zh` - Chinese

#### **Option B: Google Cloud Translation API**

Uses Google Cloud Translate API. Requires Google Cloud credentials and API key.

**Prerequisites:**
- Google Cloud project with Translation API enabled
- Service account credentials JSON file
- Set `GOOGLE_APPLICATION_CREDENTIALS` environment variable

**Usage:**

```bash
# Navigate to the scripts directory
cd components/gov-chat-backend/scripts/new-schema-scripts

# Set your Google Cloud credentials (Linux/Mac)
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/credentials.json"

# Run the script with Google Translate (default engine)
node create-translations.js <LANG>
# OR explicitly specify:
node create-translations.js <LANG> --translation-engine=google
```

**Example:**

```bash
# Generate French translations using Google Cloud
node create-translations.js FR --translation-engine=google
```

#### **Script Behavior**

- **Existing Translations:** If translations already exist for a language, the script will prompt to overwrite them.
- **Database Storage:** Language codes are stored in UPPERCASE in the database (e.g., `FR`, `BN`, `MNK`).
- **Translation Content:** Both engines translate service categories and services from English to the target language.
- **Internal Service Details:** The internal service uses the NLLB-200 distilled model with Dyula as a linguistic proxy for Mandinka (Mande language family).

#### **Troubleshooting**

**Internal Translation Service Errors:**

| Error | Solution |
|-------|----------|
| `404 Not Found` | Ensure backend services are running: `docker-compose ps` |
| `401 Unauthorized` | Verify credentials are correct. Password is hashed via SHA-256 before sending. |
| `500 Unsupported language code` | Check that the language code is supported by NLLB-200 model (see list above). |
| `Connection refused` | Ensure the backend is accessible at `http://localhost:3000` |

**Google Cloud Errors:**

| Error | Solution |
|-------|----------|
| `Invalid credentials` | Verify `GOOGLE_APPLICATION_CREDENTIALS` path is correct and file is valid JSON. |
| `API key not found` | Ensure Translation API is enabled in your Google Cloud project. |
| `Quota exceeded` | Check your Google Cloud usage quotas and billing status. |

#### **Method 2: Manual Admin Dashboard Approach**

This method is ideal for users who prefer a visual interface, or for making incremental changes after an initial setup. This can be done after you have completed **Step 6** and logged into the application.

---

# Step 6: Final Verification and Launch

After all configuration steps are complete, you must restart the services to ensure they pick up the new configurations and verify the system is healthy.

1. Restart Services: \`\`\`bash  
   docker-compose down  
   docker-compose up \-d

2. Verify Service Health:  
Check that all containers are running and healthy.

### ** WAIT FOR ALL THE SERVICES TO FINALIZE WITH ALL 5 MODELS LOADED**

watch nvidia-smi

Bash

docker ps

*Look for (healthy) status next to critical services like kong, kong-database, vllm, and arango-vector-db.* 3\. Check Logs for Errors:

Inspect the logs again to ensure no new critical errors have appeared after the restart.

Bash

docker-compose logs \-f

4. Initial Login:  
   Access the application in your browser (e.g., [https://localhost](https://localhost) or your configured domain). Log in using the default Admin credentials created in Step 5.3:  
   * **Username:** Admin  
   * **Password:** ADMINadmin

---

# Step 7: Post-Launch Configuration (Manual Dashboard)

Once you have logged in as Admin, you can use the visual dashboard to manage your knowledge base.

## 7.1 Manage the Knowledge Hierarchy

Navigate to the **Knowledge Hierarchy** tab in the Admin Dashboard.

* **Add Categories:** Click "+ Add New Category" for top-level entries.  
* **Add Services:** Hover over a category and click the plus icon for nested services.  
* **Edit/Delete:** Use hover icons to modify entries.  
* **Translations:** Use the form to add display translations for different languages.

## 7.2 Upload and Ingest Documents

Navigate to the **Document Management** tab.

1. **Upload:** Click "+ Upload Files" or "+ Add from Link". Status will be "Pending".  
2. **Apply Labels:** Click the document, and use the "Labels" multi-select dropdown to apply relevant categories/services from your hierarchy.  
3. **Ingest:** Click "Ingest" to trigger chunking, embedding, and storage. Status will update to "Ingested".

---

# Step 8: Labeling Strategies and Taxonomy Refinement

The GENIE-AI Dataprep module supports three distinct strategies for labeling document chunks during ingestion. Choosing the right strategy is critical for balancing ingestion speed, labeling accuracy, and the maturity of your Knowledge Hierarchy (Taxonomy).

The system is designed to support a **Taxonomy Refinement Lifecycle**, moving from discovery (using LLMs) to stable production (using Embeddings).

## 1\. Labeling Strategy Comparison

| Strategy | Configuration Value | Core Mechanism | Best Use Case | Pros | Cons |
| :---- | :---- | :---- | :---- | :---- | :---- |
| **LLM** | llm | **Generative Reasoning.** The LLM reads the text and the full taxonomy list, then reasons which labels apply. | **Taxonomy Building & Discovery.** Use this when starting a new project or when you suspect your label list is incomplete. | Can suggest **NEW** labels (Gap Analysis). Understands deep context and nuance. | Slowest ingestion speed. Highest resource/cost. Non-deterministic (results may vary slightly). |
| **Embedding** | embedding | **Semantic Vector Search.** Calculates the mathematical "distance" (Cosine Similarity) between the meaning of the chunk and the meaning of the label. | **Production / Mature Taxonomy.** Use this when your label list is finalized and you want consistent, fast tagging that captures synonyms. | Fast. Captures semantic meaning (e.g., "Car" matches "Vehicle"). Deterministic results. | Cannot suggest new labels. Requires threshold tuning. |
| **BM25** | bm25 | **Keyword Matching.** Probabilistically counts valid words from the label that appear in the chunk. | **Strict/Technical Search.** Use this when labels are specific part numbers, codes, or proper nouns that must match textually. | Extremely fast (CPU only). Zero "hallucinations"—only tags what is literally present. | Misses synonyms. Ignores context. Cannot suggest new labels. |

## 2\. Recommended Workflow: The Taxonomy Refinement Cycle

We recommend following this three-phase approach to build and mature your Knowledge Hierarchy.

### Phase 1: Discovery & Gap Analysis (Current Phase)

**Objective:** Identify gaps in the Knowledge Hierarchy using the LLM's reasoning capabilities.

1. **Configuration:** Set LABELING\_STRATEGY=llm.  
2. **Action:** Ingest a representative set of documents (e.g., 5-10 key files).  
3. **Review:** Check the **Ingestion Logs** in the Admin Dashboard. Look for WARN entries stating: *"LLM suggested NEW label..."*.  
4. **Refine:**  
   * If the suggested label is valid (e.g., "Safari"), add it to the Knowledge Hierarchy via the Admin Dashboard.  
   * If the suggested label is a synonym for an existing one (e.g., "Safaris" vs "Safari"), keep your hierarchy clean; do not add duplicates.  
5. **Repeat:** Continue until the logs show mostly "Existing label added" messages and very few "NEW label" suggestions.

### Phase 2: Production Stabilization

**Objective:** Speed up ingestion and ensure consistent tagging once the hierarchy is established.

1. **Configuration:** Switch to LABELING\_STRATEGY=embedding.  
2. **Action:** Re-ingest a document.  
3. **Review:** Check the resulting graph or search results.  
4. **Tuning:**  
   * **Too many irrelevant tags?** Increase EMBEDDING\_LABEL\_THRESHOLD (e.g., to 0.80 or 0.85).  
   * **Missing obvious tags?** Decrease EMBEDDING\_LABEL\_THRESHOLD (e.g., to 0.70 or 0.65).

### Phase 3: Specialized/Strict Matching (Optional)

**Objective:** Enforce strict keyword presence for technical domains.

1. **Configuration:** Switch to LABELING\_STRATEGY=bm25.  
2. **Usage:** Only recommended if embedding is too "loose" and is tagging concepts that are semantically related but factually incorrect for your specific use case.

## 3\. Configuration Reference

Add or modify the following variables in your .env file to control the behavior. You must restart the dataprep-arango-service container for changes to take effect.

### Option A: LLM Strategy (Default / Discovery)

Bash

\# Discovery Mode  
LABELING\_STRATEGY=llm

\# Optional: Tune the system prompt if the LLM hallucinates formats  
\# LABEL\_SELECTOR\_SYSTEM\_PROMPT="You are a label selector..." 

### Option B: Embedding Strategy (Production / Semantic)

Bash

\# Semantic Match Mode  
LABELING\_STRATEGY=embedding

\# Similarity Threshold (0.0 to 1.0)  
\# Start at 0.75. Increase for stricter matching.  
EMBEDDING\_LABEL\_THRESHOLD=0.75

### Option C: BM25 Strategy (Strict Keyword)

Bash

\# Keyword Match Mode
LABELING\_STRATEGY=bm25

\# Relevance Score Threshold
\# Start at 2.0. This is a raw score, not a percentage.
BM25\_LABEL\_THRESHOLD=2.0

---

# Step 9: Mobile Application Configuration

## 9.1 Overview

The GENIE.AI mobile application is a cross-platform Flutter application that provides users with access to the GENIE.AI chatbot functionality on Android, iOS, Web, and Desktop platforms. This section covers the configuration steps required to deploy and customize the mobile application for your specific GENIE.AI deployment.

**Key Features:**
- Cross-platform support (Android, iOS, Web, Desktop)
- Multi-language support (11 languages)
- Configuration-driven theming (JSON-based)
- Complete authentication flow (login, register, password reset)
- PDF export functionality
- Online/offline detection
- Material Design 3 UI

## 9.2 Prerequisites

### Required Software

| Software | Minimum Version | Notes |
|----------|-----------------|-------|
| **Flutter SDK** | 3.10.8+ | Download from [flutter.dev](https://flutter.dev) |
| **Dart SDK** | 3.10.8+ | Included with Flutter |
| **Git** | Latest | For version control |
| **VS Code** | Latest | Recommended IDE with Flutter/Dart extensions |
| **Android Studio** | Latest | Required for Android SDK & Emulator |
| **Java JDK** | 17 | Required for Android builds (Gradle 8.5+) |

### Optional Software
- **Xcode** (macOS only) - Required for iOS builds
- **Chrome/Edge** - For web development testing

### IDE Setup (VS Code)

Install these extensions:
- Flutter
- Dart
- Flutter Widget Snippets

**Recommended VS Code Settings** (to minimize file locking on Windows):

```json
{
  "files.watcherExclude": {
    "**/.git/objects/**": true,
    "**/.git/subtree-cache/**": true,
    "**/build/**": true,
    "**/.dart_tool/**": true
  },
  "files.hotExit": "off"
}
```

## 9.3 Mobile Application Structure

The mobile application is located in the `mobile/genie_ai_mobile/` directory:

```
mobile/genie_ai_mobile/
├── lib/
│   ├── main.dart                          # App entry point
│   ├── i18n/                              # Internationalization
│   │   └── locales/                       # Language files
│   ├── components/                        # UI Components
│   │   ├── auth/                          # Authentication screens
│   │   ├── chat/                          # Chat functionality
│   │   ├── settings/                      # Settings screens
│   │   └── shared/                        # Shared UI elements
│   ├── services/                          # Business logic & API
│   │   ├── api_service.dart               # Base API client
│   │   ├── auth_proxy.dart                # Authentication API
│   │   ├── chatbot_proxy.dart             # Chatbot API
│   │   └── genie_ai_config.dart           # Configuration loader
│   └── utils/                             # Utilities
│       └── theme_manager.dart             # Theme management
├── assets/
│   ├── config/
│   │   └── genie-ai-config.json          # App configuration
│   ├── images/                           # Images and icons
│   ├── fonts/                            # Custom fonts
│   └── FAQ.md                            # FAQ content
└── pubspec.yaml                          # Dependencies
```

## 9.4 API Configuration

### Setting the Backend API Endpoint

The mobile application connects to your GENIE.AI backend API. Configure the API endpoint in `lib/services/api_service.dart`:

**File:** `mobile/genie_ai_mobile/lib/services/api_service.dart`

```dart
class ApiService {
  // Production API endpoint - UPDATE THIS TO YOUR BACKEND URL
  String get baseUrl => 'https://your-domain.com/api';

  // For local development:
  // String get baseUrl => 'http://localhost:3000/api';
}
```

**Configuration Steps:**

1. **Open the file:** `mobile/genie_ai_mobile/lib/services/api_service.dart`
2. **Locate line 10** (approximately): `String get baseUrl => 'https://genie-ai.itu.int/api';`
3. **Replace the URL** with your actual backend API endpoint
4. **Save the file**

**Example configurations:**

```dart
// Production environment
String get baseUrl => 'https://genie-ai.your-org.com/api';

// Staging environment
String get baseUrl => 'https://staging.genie-ai.your-org.com/api';

// Local development
String get baseUrl => 'http://localhost:3000/api';

// Local network testing (use your actual IP)
String get baseUrl => 'http://192.168.1.100:3000/api';
```

## 9.5 App Configuration (genie-ai-config.json)

The mobile application uses a comprehensive JSON configuration file for theming and feature customization. This file is located at `mobile/genie_ai_mobile/assets/config/genie-ai-config.json`.

### Configuration Structure

```json
{
  "app": {
    "title": "Genie AI",
    "icon": {
      "type": "file",
      "value": "assets/config/genie-ai-icon-light.svg"
    }
  },
  "theme": {
    "primaryColor": "#4682B4",
    "secondaryColor": "#5F9EA0",
    "backgroundColor": "#D3E0EA",
    "textColor": "#1C2526",
    "navbar": {
      "gradientStart": "#4682B4",
      "gradientEnd": "#5F9EA0",
      "textColor": "#F0F8FF"
    }
  },
  "features": {
    "chat": {
      "welcomeMessage": "Welcome to Genie AI",
      "botName": "Genie AI",
      "quickHelp": {
        "layout": {
          "columns": 2,
          "gapX": "8px",
          "gapY": "8px",
          "childAspectRatio": 4.2
        },
        "buttons": [
          {
            "id": "just-chat",
            "category": null,
            "action": {
              "visibleText": "quickhelp.justChatUserPrompt",
              "hiddenPrompt": "quickhelp.justChatPrompt"
            },
            "appearance": {
              "label": {
                "text": "quickhelp.justChat",
                "color": "#1C2526"
              },
              "icon": {
                "value": "/config/quickhelp/just-chat.svg",
                "color": "#4682B4"
              }
            }
          }
        ]
      }
    }
  }
}
```

### Customization Options

#### 1. App Title and Icon

```json
"app": {
  "title": "Your App Name",
  "icon": {
    "type": "file",
    "value": "assets/config/your-icon.svg"
  }
}
```

#### 2. Theme Colors

```json
"theme": {
  "primaryColor": "#4682B4",        // Main brand color
  "secondaryColor": "#5F9EA0",      // Accent color
  "backgroundColor": "#D3E0EA",     // Background color
  "textColor": "#1C2526",           // Primary text color
  "navbar": {
    "gradientStart": "#4682B4",     // Navbar gradient start
    "gradientEnd": "#5F9EA0",       // Navbar gradient end
    "textColor": "#F0F8FF"          // Navbar text color
  }
}
```

#### 3. Chat Configuration

```json
"features": {
  "chat": {
    "welcomeMessage": "Welcome to Your App",
    "botName": "Your Bot Name"
  }
}
```

#### 4. Quick Help Buttons

Quick Help buttons provide pre-configured prompts for common tasks. Each button is associated with a category from your Knowledge Hierarchy:

```json
"buttons": [
  {
    "id": "unique-button-id",
    "category": "1",  // Category ID from your Knowledge Hierarchy
    "action": {
      "visibleText": "quickhelp.userPrompt",
      "hiddenPrompt": "quickhelp.systemPrompt"
    },
    "appearance": {
      "label": {
        "text": "Button Label",
        "color": "#1C2526"
      },
      "icon": {
        "value": "/config/quickhelp/your-icon.svg",
        "color": "#4682B4"
      },
      "style": {
        "background": {
          "gradient": {
            "start": "#D3E0EA",
            "end": "#A3BFFA",
            "direction": "horizontal"
          }
        }
      }
    }
  }
]
```

**Quick Help Button Configuration:**

1. **id**: Unique identifier for the button
2. **category**: Category ID from your Knowledge Hierarchy (or `null` for general chat)
3. **action.visibleText**: Text displayed to users in the chat
4. **action.hiddenPrompt**: Actual prompt sent to the LLM
5. **appearance**: Visual styling (colors, icons, gradients)
6. **darkMode**: Optional dark mode overrides

## 9.6 Asset Configuration

### Declaring Assets (pubspec.yaml)

All assets must be declared in `mobile/genie_ai_mobile/pubspec.yaml`:

```yaml
flutter:
  uses-material-design: true
  generate: true

  assets:
    - assets/images/
    - assets/config/
    - assets/config/genie-ai-config.json
    - assets/config/quickhelp/
    - assets/FAQ.md
    - assets/icons/

  fonts:
    - family: Roboto
      fonts:
        - asset: assets/fonts/Roboto-Regular.ttf
```

**Important:**
- After modifying `pubspec.yaml`, run `flutter pub get` to update dependencies
- Ensure all asset files exist in the specified paths
- Icons referenced in `genie-ai-config.json` must be present in `assets/config/quickhelp/`

## 9.7 Building the Mobile Application

### 1. Install Dependencies

```bash
cd mobile/genie_ai_mobile
flutter pub get
```

### 2. Verify Flutter Setup

```bash
flutter doctor
```

Fix any issues reported before proceeding.

### 3. Running on Different Platforms

#### Web Development (Fastest Iteration)

```bash
flutter run -d chrome
```

#### Android Debug

```bash
# Enable USB debugging on device
flutter run
```

#### iOS Debug (macOS only)

```bash
flutter run -d iphone
```

### 4. Building for Release

#### Android Release Build

```bash
# Clean the project
flutter clean

# Build APK (for direct installation)
flutter build apk --no-tree-shake-icons

# Build App Bundle (for Play Store)
flutter build appbundle --no-tree-shake-icons
```

**Output locations:**
- APK: `build/app/outputs/flutter-apk/app-release.apk`
- AAB: `build/app/outputs/bundle/release/app-release.aab`

#### iOS Release Build (macOS only)

```bash
# Build the iOS app
flutter build ios --no-tree-shake-icons

# Open in Xcode
open ios/Runner.xcworkspace

# In Xcode:
# - Select your team
# - Update signing certificates
# - Archive the app
# - Distribute to App Store Connect
```

#### Web Build

```bash
flutter build web
```

## 9.8 Configuration Summary

| Configuration Item | File Location | Description |
|--------------------|---------------|-------------|
| API Endpoint | `lib/services/api_service.dart:10` | Backend API base URL |
| App Title | `assets/config/genie-ai-config.json:329` | Application title |
| Bot Name | `assets/config/genie-ai-config.json:349` | Chatbot display name |
| Theme Colors | `assets/config/genie-ai-config.json:336-344` | Primary, secondary, background colors |
| Quick Help Buttons | `assets/config/genie-ai-config.json:370+` | Pre-configured prompt buttons |
| Assets | `pubspec.yaml:66-73` | Declared assets for the app |

## 9.9 Troubleshooting

### Issue: Mobile app can't connect to API

**Solution:**
1. Verify the API endpoint in `lib/services/api_service.dart`
2. Check network permissions (Android requires `INTERNET` permission)
3. Ensure SSL certificates are valid (development: certificate override available in `main.dart`)

### Issue: Assets not loading

**Solution:**
1. Verify all assets are declared in `pubspec.yaml`
2. Run `flutter pub get` after modifying `pubspec.yaml`
3. Check file paths are correct (case-sensitive)

### Issue: Build fails on Windows

**Solution:**
1. Close VS Code before building
2. Move project out of OneDrive/Dropbox folders
3. Use the PowerShell build script if available: `.\build-release.ps1`

### Issue: Theme not loading

**Solution:**
1. Verify `genie-ai-config.json` is valid JSON
2. Check that the config file is declared in `pubspec.yaml`
3. Ensure the config loader is initialized in `main.dart`  
