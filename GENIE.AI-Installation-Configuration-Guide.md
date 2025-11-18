# **GENIE.AI Installation and Configuration Guide**

### **Introduction**

Welcome to the GENIE.AI framework. This guide will walk you through the necessary steps to set up, configure, and deploy your own Retrieval-Augmented Generation (RAG) solution. The success of any AI-driven knowledge system lies in the quality and structure of its data. Therefore, the first and most critical phase is to define, curate, and structure the data that will form the backbone of your system's knowledge. This cannot be over-emphasized. It is the most critical aspect. Our suggestion is that you establish an initial MVP with the framework by simply curating the data, defining the knowledge hierarchy, configuring your quickhelp buttons with prompts and then labeling and ingesting your curated data prior to modifying any code. This way, you will get used to how the framework operates, before you delve into deeper issues and extensions. This approach can also be used to deliver a rapid solution to a RAG problem, without any coding at all (just implementing a knowledge base design and the associated configuration). The application title and theme can also be modified by configuration in JSON without changing code. The suggested approach for this is to utilize something like ChatGOT, Gemini Pro or Grok etc. to build a new configuration for color theme and title etc. This can be done in minutes.

For a high-level understanding of the system architecture before beginning any work, please refer to the [**Architecture Overview**](https://osaips.atlassian.net/wiki/external/N2U5ZjkwM2FhOTgyNDZlZjk3MWRlODY5Mzk5OTBhNjE). This will give you an insight into most of the high level components and how they are assembled.

---

### **Step 1: Data Curation and Knowledge Hierarchy (Conceptual Design)**

Before any data is ingested into GENIE.AI, you must first establish the scope of knowledge for your application and organize it logically. This process involves a strategic design of your knowledge core, the curation and verification of source documents, and the creation of an associated two-level labeling system that serves as the knowledge hierarchy within the framework's user interface (i.e., the Knowledge Hierarchy displayed on the left sidebar). Ingested data is tagged with these labels, and queries can also select the same labels, which enhances RAG accuracy as we have utilized labeling as part of the hybrid-retrieval strategy for RAG at the backend.

#### **1.1 Designing the Knowledge Core with Domain Analysis**

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

#### **1.2 Impact on the Labeling System Design**

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

#### **1.3 Data Curation and Verification Process**

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

### **Step 2: Prerequisites**

Before attempting installation, ensure your infrastructure meets the necessary requirements.

#### **2.1 Hardware Requirements**

GENIE.AI requires significant computational resources, particularly for AI model inference (LLMs, embeddings, rerankers). This is critical and the solution will potentially not even run without the required resources.

* Please refer to the [**T-Shirt Sizing Guide**](https://osaips.atlassian.net/wiki/external/ODg2YmZmZTJjNGMyNGQzYzgwZWUzNTk2NWI3NjdiMDk) to determine the appropriate hardware for your deployment scale. Even for development and MVP work, you will need to meet the minimum requirements outlined in the small tee shirt size.

#### **2.2 Software Prerequisites**

* **Ubuntu Linux 22.04:** Everything has been tested on Ubuntu 22.04. It is OK to use variant Linux distributions but that is something you need to resolve.  
* **Docker & Docker Compose:** Required for orchestrating the containerized services.  
* **NVIDIA Drivers & CUDA:** Required for GPU acceleration of the AI services (vLLM, TEI).  
  * Follow the [**NVIDIA Driver Installation Guide**](https://osaips.atlassian.net/wiki/external/NTY1ZGY1N2RmYzkzNGRiMGIxMzc1ZDM4ZjI4NmNlOTE) to ensure your host is ready for GPU workloads.  
* **Node.js:** Required for the JavaScript components

#### **2.3 Install and Verify Docker on Every Host**

Bash

##### 1\. Update and install prerequisites

sudo apt-get update

sudo apt-get install \-y ca-certificates curl gnupg

##### 2\. Add Docker's official GPG key

sudo install \-m 0755 \-d /etc/apt/keyrings

curl \-fsSL [https://download.docker.com/linux/ubuntu/gpg](https://download.docker.com/linux/ubuntu/gpg) | sudo gpg \--dearmor \-o /etc/apt/keyrings/docker.gpg

sudo chmod a+r /etc/apt/keyrings/docker.gpg

##### 3\. Set up the official Docker repository

echo  
"deb \[arch="$(dpkg \--print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg\] [https://download.docker.com/linux/ubuntu](https://download.docker.com/linux/ubuntu)  
"$(. /etc/os-release && echo "$VERSION\_CODENAME")" stable" |  
sudo tee /etc/apt/sources.list.d/docker.list \> /dev/null

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

#### **2.4 Install Node.js on Every Host and Verify**

Bash

curl \-fsSL [https://deb.nodesource.com/setup\_lts.x](https://deb.nodesource.com/setup_lts.x) | sudo \-E bash \-

sudo apt-get install \-y nodejs

node \-v

npm \-v

---

### **Step 3: Base Installation**

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

#### **Option A: Single-Node Installation (MVP/Dev)**

This method deploys all services onto a single host using Docker Compose.

1\. Clone the Repository

Clone the appropriate repository to your local machine:

* *Public Replica:* [https://gitlab.com/fordendk/genie-ai-replica](https://gitlab.com/fordendk/genie-ai-replica)  
* *Internal UNICC GitLab:* (Check with administrator)

Bash

git clone [https://gitlab.com/fordendk/genie-ai-replica](https://gitlab.com/fordendk/genie-ai-replica)  
cd genie-ai-replica

#### 2\. Environment Configuration (.env)

The docker-compose.yaml file sources its configuration from an .env file located in the root of the repository (named env in the repo). You must create this file (e.g., by copying the existing env example to .env) and populate it with your specific settings.

The following tables document the key variables found in the .env file1, grouped by the service they configure.

**Kong (API Gateway) & Database**

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| POSTGRES\_USER | Username for the Kong database. | kong |
| POSTGRES\_DB | Name of the Kong database. | kong |
| POSTGRES\_PASSWORD | Password for the Kong database. | k1ngk0ng |
| KONG\_DATABASE | Tells Kong which database type to use. | postgres |
| KONG\_PG\_HOST | Hostname for the Kong database service. | kong-database |
| KONG\_ADMIN\_LISTEN | Kong admin API listen address. | 0.0.0.0:8001, 0.0.0.0:8444 ssl |
| KONG\_DNS\_RESOLVER | DNS resolver for Kong (e.g., Docker's internal). | 127.0.0.11 |

**Frontend & Backend (Shared)**

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| FRONTEND\_PORT | The port that the frontend Vue 3 app will run on. | 8090 |
| VUE\_APP\_API\_URL | Path for the frontend to reach the backend API. | https://\<your-reverse-proxy\>/api |
| VUE\_PROXY\_HOST | Target for the Vue development proxy. | kong:8010 |
| CSP\_CONNECT\_SRC | Content Security Policy connect-src directive. | 'self' http://localhost... |
| CORS\_ALLOWED\_ORIGINS | Allowed origins for CORS. | http://localhost,https://genie-ai... |

**Backend Service**

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| NODE\_ENV | Sets the application environment. | development or production |
| BACKEND\_PORT | Internal port the Node.js app listens on. | 3000 |
| API\_PREFIX | Global prefix for all API routes. | /api |
| JWT\_SECRET | Secret key for signing JSON Web Tokens. | UJeFROw+yRJeVOPiUTgdcXzl... |
| JWT\_EXPIRES\_IN | Expiration time for JWTs. | 24h |
| TRANSLATION\_CACHE | Switch on/off translation caching. | on |
| TRANSLATION\_CACHE\_HOST | Redis host for translation caching. | redis-cache |
| TRANSLATION\_CACHE\_PORT | Redis port. | 6379 |
| TRANSLATION\_CACHE\_PASSWORD | Password for the Redis cache. | \!@\#$$5678 |
| EMAIL\_HOST | SMTP server for sending emails. | your-smtp-host |
| EMAIL\_USER | SMTP username. | your-email-user |
| EMAIL\_PASSWORD | SMTP password. | your-smtp-password |
| EMAIL\_FROM | Noreply email address. | noreply@your-domain-name |
| OPEA\_HOST | Hostname for the OPEA backend service. | chatqna-xeon-backend-server |

**ArangoDB (Knowledge Base)**

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| ARANGO\_PASSWORD | Root password for ArangoDB. | test |
| ARANGO\_DB\_NAME | Database name used by the backend. | genie-backend |
| ARANGO\_DB | Database name used by the frontend. | genie-frontend |
| ARANGO\_URL | Connection URL for ArangoDB. | http://arango-vector-db:8529 |
| ARANGO\_USER | Username for ArangoDB. | root |

**Document Repository Service**

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| DOC\_REPO\_PORT | Internal port for the document service. | 3001 |
| DATAPREP\_HOST | Hostname for the Dataprep service. | http://localhost |
| DATAPREP\_PORT | Port for the Dataprep service. | 6007 |
| MAX\_FILE\_SIZE | Maximum file upload size in bytes (e.g., 50MB). | 52428800 |
| VIRUS\_SCANNING | Enable/disable ClamAV virus scanning. | true |
| CLAMSCAN\_HOST | Hostname for the ClamAV service. | 127.0.0.1 |
| CLAMSCAN\_PORT | Port for the ClamAV service. | 3310 |

**Dataprep & Retriever Services**

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| DATAPREP\_CHUNK\_SIZE | Size of document chunks for ingestion. | 500 |
| DATAPREP\_CHUNK\_OVERLAP | Overlap between document chunks. | 50 |
| DATAPREP\_ARANGO\_GRAPH\_NAME | Graph name for Dataprep to write to. | graph\_el\_salvador |
| RETRIEVER\_ARANGO\_GRAPH\_NAME | Graph name for Retriever to read from. | graph\_el\_salvador |
| RETRIEVER\_OPENAI\_EMBED\_MODEL | Embedding model used by the retriever. | text-embedding-3-small |
| ARANGO\_FILTER\_STRATEGY | Strategy for applying filters (e.g., OR, AND). | OR |

**AI Models & Inference Configuration**

These variables control the specific AI models used for generation, embeddings, and reranking.

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| HUGGINGFACEHUB\_API\_TOKEN | API key for Hugging Face (Required for gated models). | hf\_... |
| VLLM\_API\_KEY | API key for the VLLM service. | eyJhb... |
| VLLM\_ENDPOINT | URL for the VLLM inference server. | http://vllm:80 |
| **Main Inference (vLLM)** |  |  |
| VLLM\_LLM\_MODEL\_ID | Model ID for the main chat/generation. | ibm-granite/granite-3.3-2b-instruct |
| VLLM\_GPU\_UTIL | GPU Memory Utilization for main model (0.0 \- 1.0). | 0.65 (Standard) / 0.5 (T4) |
| VLLM\_MAX\_MODEL\_LEN | Context window size for main model. | 4096 (Standard) / 2048 (T4) |
| VLLM\_DTYPE | Data type for model weights (half, bfloat16). | half (T4), bfloat16 (Ampere+) |
| **Guardrails (Translation)** |  |  |
| VLLM\_TRANSLATION\_MODEL\_ID | Model ID for guardrails/translation tasks. | google/gemma-3-1b-it |
| VLLM\_TRANSLATION\_GPU\_UTIL | GPU Memory Utilization for guardrail model. | 0.15 (Standard) / 0.2 (T4) |
| VLLM\_TRANSLATION\_MAX\_MODEL\_LEN | Context window for guardrail model. | 2048 |
| VLLM\_TRANSLATION\_DTYPE | Data type for guardrail model. | bfloat16 |
| **Embeddings & Reranking** |  |  |
| EMBEDDING\_MODEL\_ID | Model ID for embeddings. | BAAI/bge-base-en-v1.5 |
| TEI\_EMBED\_MODEL | TEI embedding model (must match above). | BAAI/bge-base-en-v1.5 |
| RERANKER\_MODEL\_ID | Model ID for reranking. | cross-encoder/ms-marco-MiniLM-L-6-v2 |

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

![][image1]

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

![][image2]

***GPU memory profile: Enterprise***

#### 4\. Launch Services

Prerequisite: Download OCR Models  
Because the framework uses EasyOCR during data prep and model downloads inside containers can be slow or unreliable, you must download these files to the root of your project folder first.

Bash

wget \-O craft\_mlt\_25k.zip https://github.com/JaidedAI/EasyOCR/releases/download/pre-v1.1.6/craft\_mlt\_25k.zip  
wget \-O english\_g2.zip https://github.com/JaidedAI/EasyOCR/releases/download/v1.3/english\_g2.zip

Launch Option A: Standard Launch (RTX 6000 Ada / A100 / H100)  
Use this command if you are running on modern Ampere or Ada generation hardware with sufficient VRAM (24GB+). This uses the standard docker-compose.yaml.

Bash

docker compose up \-d \--build

Launch Option B: Legacy Launch (NVIDIA Tesla T4)  
Use this command only if you are running on a Tesla T4 (16GB). This uses docker-compose-t4.yaml, which applies specific overrides:

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
At this stage, while the containers are running, they are not yet configured. If you inspect the backend logs now, you will see errors related to missing databases (ArangoDB) and unconfigured routes (Kong). This is normal. Do NOT attempt to debug these errors yet. Proceed immediately to Step 4 to complete the necessary infrastructure configuration.  
**This is normal. Do NOT attempt to debug these errors yet.**

Proceed immediately to **Step 4** to complete the necessary infrastructure configuration.

---

### **Step 4: Infrastructure Configuration**

Once the base services are running (Step 3), you must configure the core infrastructure components before the system is usable.

#### **4.1 ArangoDB Database Initialization**

While the arango-vector-db service is running, the specific application databases must be created.

1. Access the ArangoDB web interface at [http://localhost:8529](http://localhost:8529) (login with root and the password defined in your .env).  
2. Create the necessary databases as defined in your environment variables (default: genie-ai) \- ensure both the frontend and backend services use the same database.

#### **4.2 NGINX and Kong API Gateway Configuration**

There are Nginx default.conf files available for both three-node and single-node deployments:

1. For three-node deployments, use the default default.conf and modify the upstream addresses  
2. for single-node deployments, use the default.conf-single-node

Kong requires specific initialization and configuration to route traffic correctly.

1. **Initialize Database:** Execute these commands to prepare the Kong postgres database:

Bash

docker compose exec kong-database psql \-U kong postgres \-c "CREATE DATABASE kong;"

docker compose exec kong-database psql \-U kong postgres \-c "GRANT ALL PRIVILEGES ON DATABASE kong TO kong;"

docker compose run \--rm kong kong migrations bootstrap docker compose restart kong

2. **Apply Configuration:** Navigate to the config directory, stage the correct configuration file (overwriting the default kong\_config.json), and run the apply script (ensure that curl and jq are installed).  
   For Single-Node installation: 

Bash

cd api-gateway-solution/new-config/

cp kong\_config.json-single-node kong\_config.json

chmod \+x [manage-kong-config.sh](http://manage-kong-config.sh)

sudo apt update sudo apt install jq

./manage-kong-config.sh \-a

\*(For Three-Node installation, simply run ./manage-kong-config.sh \\-a as kong\\\_config.json is the default).\*

**Enter the correct hosts and expect the following output**:

Bash

govstack@bb-ai-gpu-01:\~/genie-ai-replica-single-node/api-gateway-solution/new-config$ ./manage-kong-config.sh \-a  
This script will configure your Kong instance.  
Please provide the required connection details.

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

#### **4.3 Nginx Configuration**

Nginx acts as the reverse proxy and SSL termination point.

1\. Navigate to api-gateway-solution/nginx.  
2\. Select the appropriate configuration file:  
\* For \*\*Single-Node\*\*, use: default.conf-single-node (rename to default.conf if necessary for volume mapping, or adjust mapping).  
\* For \*\*Three-Node\*\*, use: default.conf.  
3\. Ensure your SSL certificates are placed in the mapped volumes defined in docker-compose.yaml (nginx\\\_certs volume or ./api-gateway-solution/nginx/certs bind mount).

---

### **Step 5: Knowledge Base Population & User Setup**

With the infrastructure configured, you can now instantiate the knowledge hierarchy designed in Step 1 and create the required system accounts.

#### **Method 1: Automated Script Approach (Recommended for Initial Setup)**

This method is ideal for initial deployments, migrating an existing instance, or automated CI/CD workflows.

##### **5.1 Prepare Script Environment** You must source the environment configuration before running schema scripts to set necessary variables like database URLs and credentials: i.e. modify the set\_env.sh script for the correct database environment

Bash

cd components/gov-chat-backend/scripts/new-schema-scripts

chmod \+x set-env.sh source set-env.sh

5.2 Create Database Schema

Use the arango-schema-creator.js script to generate the collections, indexes, and graphs.

Bash

\# Ensure you are still in the new-schema-scripts directory and environment is set  
npm install arangojs node arango-schema-creator.js ./arango-schema.json

##### 5.3 Create Initial User Accounts

You must create the default Admin and Manager accounts. These are required for the application to load correctly and for full integration with the Document Repository.

Bash

\# Create the Admin account  
node create-genie-ai-admin-account.js

\# Create the Manager account  
node create-genie-ai-manager-account.js

**Note:** These scripts create accounts with default credentials. It is highly recommended to change these passwords immediately after first login via the Admin Dashboard.

##### 5.4 Populate Hierarchy

Use the create-knowledge-hierarchy.js script to import your Category/Service structure.

* *Note:* Ensure schema validation is temporarily disabled on serviceCategories, services, and categoryServices collections if using an older schema version.

Bash

\# Return to the parent scripts directory if the hierarchy file is there, or adjust the path.  
cd ..  
node create-knowledge-hierarchy.js \--file ./my-hierarchy.json

##### 5.5 Generate Translations

(Optional) Use create-translations.js to auto-generate labels for other supported languages (requires Google Cloud credentials).

#### **Method 2: Manual Admin Dashboard Approach**

This method is ideal for users who prefer a visual interface, or for making incremental changes after an initial setup. This can be done after you have completed **Step 6** and logged into the application.

---

### **Step 6: Final Verification and Launch**

After all configuration steps are complete, you must restart the services to ensure they pick up the new configurations and verify the system is healthy.

1. Restart Services: \`\`\`bash  
   docker-compose down  
   docker-compose up \-d

2\. Verify Service Health:  
Check that all containers are running and healthy.

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

### **Step 7: Post-Launch Configuration (Manual Dashboard)**

Once you have logged in as Admin, you can use the visual dashboard to manage your knowledge base.

#### **7.1 Manage the Knowledge Hierarchy**

Navigate to the **Knowledge Hierarchy** tab in the Admin Dashboard.

* **Add Categories:** Click "+ Add New Category" for top-level entries.  
* **Add Services:** Hover over a category and click the plus icon for nested services.  
* **Edit/Delete:** Use hover icons to modify entries.  
* **Translations:** Use the form to add display translations for different languages.

#### **7.2 Upload and Ingest Documents**

Navigate to the **Document Management** tab.

1. **Upload:** Click "+ Upload Files" or "+ Add from Link". Status will be "Pending".  
2. **Apply Labels:** Click the document, and use the "Labels" multi-select dropdown to apply relevant categories/services from your hierarchy.  
3. **Ingest:** Click "Ingest" to trigger chunking, embedding, and storage. Status will update to "Ingested".

[image1]: <data:image/png;base64,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>

[image2]: <data:image/png;base64,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>