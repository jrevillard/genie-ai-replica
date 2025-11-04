# **GENIE.AI Installation and Configuration Guide**

### **Introduction**

Welcome to the GENIE.AI framework. This guide will walk you through the necessary steps to set up, configure, and deploy your own Retrieval-Augmented Generation (RAG) solution. The success of any AI-driven knowledge system lies in the quality and structure of its data. Therefore, the first and most critical phase is to define, curate, and structure the data that will form the backbone of your system's knowledge. This cannot be over-emphasized. It is the most critical aspects. Our suggestion is that you establish an MVP with the framework by simply curating the data, defining the knowledge hioerarchy, configuraing your quickhelp buttons with prompts and then labelling and ingesting your curated data prior to modifying any code.

---

### **Step 1: Data Curation and Knowledge Hierarchy**

Before any data is ingested into GENIE.AI, you must first establish the scope of knowledge for your application and organize it logically. This process involves a strategic design of your knowledge core, the curation and verification of source documents, and the creation of a multi-level labeling system that serves as the knowledge hierarchy within the framework's user interface (i.e., the Knowledge Hierarchy on the left sidebar).

#### **1.1 Designing the Knowledge Core with Domain Analysis**

A powerful RAG solution is built on a well-designed data model. We recommend using a conceptual Venn diagram exercise with your subject matter experts to map your information landscape. This helps visualize the relationships between different data sets and define the boundaries of your knowledge base. I will also help you to craft your labelling strategy.

This process involves identifying three tiers of data:

* **Primary Data Sets (Core):** This is the essential information that directly addresses the most critical and frequent user queries. It forms the central circles of your diagram.  
* **Secondary Data Sets (Supporting):** This data provides necessary context and is often required to give a complete answer. It is the second ring of your diagram circles and it overlaps significantly with the primary set.  
* **Tertiary Data Sets (Peripheral):** This information is supplementary and enhances the user's understanding, but may not be essential for every query. It has a minor overlap with the primary and secondary sets in specific areas.

**Example Domain Analysis using Venn Diagrams:**

**1\. Agriculture**

For an agricultural support system, you need to combine various interconnected domains.

* **Primary:** "Corn Crop Management Guide." This is the core document farmers need.  
* **Secondary:** "Approved Pesticides & Herbicides," "Chemical Fertilizer Specifications," "Soil Sample Analysis Protocols." These are directly referenced by the crop guide.  
* **Tertiary:** "Regional Weather Data," "Historical Market Prices," "Local Agricultural Equipment Suppliers." This data provides valuable context for decision-making.

**2\. Government Services**

For a citizen portal helping with passport applications.

* **Primary:** "Official Passport Application Process & Forms."  
* **Secondary:** "Schedule of Fees & Payment Options," "Civil Registry Database (for birth certificate verification)."  
* **Tertiary:** "List of Authorized Photo Studios," "Post Office Locations & Operating Hours."

**3\. Healthcare**

For a patient portal providing information on a specific medical condition.

* **Primary:** "Clinical Guidelines for Type 2 Diabetes Management."  
* **Secondary:** "Pharmaceutical Database (Metformin, Insulin dosages)," "Nutritional & Dietary Plans for Diabetics."  
* **Tertiary:** "Directory of Endocrinologists," "Information on Local Support Groups," "Recommended Fitness Routines."

#### **1.2 Impact on the Labeling System Design**

This domain analysis directly informs the structure of your 2-level labeling system. The clear relationships and boundaries identified in the Venn diagrams translate naturally into a logical hierarchy.

* **Categories (Level 1\)** often emerge from the overarching themes that group your primary and secondary data sets. For example, in Agriculture, the primary set "Corn Crop Management" and secondary sets like "Pesticides" and "Fertilizers" all fall under the logical **Category** of Crop Management.  
* **Services/Topics (Level 2\)** are the primary, secondary, and even tertiary data sets themselves. They become the specific, actionable knowledge points within a category.

Applying this to the Agriculture example:

| Category (Level 1\) | Service/Topic (Level 2\) | Data Source Origin |
| :---- | :---- | :---- |
| **Crop Management** | Corn Planting & Harvest Guide | Primary |
|  | Soil Health and Fertilization | Secondary |
|  | Pest and Disease Control | Secondary |
| **Market & Logistics** | Historical Market Prices | Tertiary |
|  | Approved Equipment Suppliers | Tertiary |

This method ensures your knowledge hierarchy is not arbitrary but is a direct reflection of how the information is interrelated, making the system more intuitive for both the AI and the end-user.

#### **1.3 Data Curation and Verification Process**

To deliver an accurate, trustworthy, and useful RAG solution, the underlying data must be meticulously curated and verified. Ingesting inaccurate, outdated, or poorly formatted data is the primary cause of poor performance and "hallucinations" in RAG systems. The GENIE.AI framework supports a wide range of file formats for the ingestion process.

**Supported Formats:**

* Web pages (.html, via URL links)  
* Documents (.pdf, .doc, .docx) \- .doc may be removed as it is legacy and problematic (converting to .docx or .pdf is recommended)  
* Spreadsheets (.xls, .xlsx) \- we suggest that .xls and .xlsx are also avoided as we may elect to remove them too (problematic)  
* Markdown (.md)  
* Plain Text (.txt)

**Curation Best Practices:**

1. **Source Vetting:** Always prioritize authoritative and official sources. For government services, this means official government websites and publications. For healthcare, use peer-reviewed medical journals, clinical guidelines from recognized health organizations, and regulatory bodies. You will need a team of experts to validate and curate this knowledge and it will need to be agreed and signed-off before ingestion.  
2. **Data Cleaning:**  
   * **Standardize Terminology:** Ensure consistent use of terms (e.g., "Type 2 Diabetes" vs. "T2D").  
   * **Remove Duplicates & Noise:** Eliminate redundant documents, boilerplate text (headers, footers, irrelevant ads), and artifacts from the conversion process.  
   * **Verify OCR Accuracy:** When converting scanned PDFs, manually review the resulting text for Optical Character Recognition (OCR) errors, as these can introduce factual inaccuracies.  
3. **Logical Chunking:** Ensure that data is ingested and split into semantically meaningful chunks. A chunk should ideally represent a complete idea or paragraph. A split in the middle of a sentence can cause the system to lose context.

**Verification Workflow:**

1. **Subject Matter Expert (SME) Review:** This is the most critical step. Once data is curated, it must be reviewed by experts in the relevant domain. An agronomist should verify the crop data, and a doctor should verify the healthcare guidelines. SMEs check for factual accuracy, completeness, and relevance.  
2. **Version Control:** Your knowledge base is not static. Regulations, guidelines, and data change. Implement a system to track document versions and schedule regular reviews (e.g., annually) to update or retire outdated information. The sources for these documents should be version controlled.  
3. **Establish a Feedback Loop:** The GENIE.AI framework includes capabilities for users to provide feedback on responses. This user feedback is an invaluable, continuous source of verification. A process must be in place to review flagged responses, trace them back to the source document, and make corrections as needed.

By following this rigorous process of designing, curating, and verifying your data, you will build a robust and reliable knowledge base that allows GENIE.AI to perform at its full potential.

---

### **Step 2: Database Setup and Knowledge Base Population**

After completing the data analysis and curation in Step 1, the next phase is to create the physical database and populate it with your defined knowledge hierarchy and source documents. This step makes the conceptual structure a reality that the GENIE.AI application can connect to.

You have two primary methods for accomplishing this: using the provided command-line scripts for automated or bulk operations, or using the Admin Dashboard for a manual, visual approach.

#### **Method 1: Using the Database Setup Scripts**

This method is ideal for initial deployments, migrating an existing instance, or automated CI/CD workflows. The scripts provide a powerful way to manage the database schema and its content.

##### **Option A: Setting Up a New GENIE.AI Instance from Scratch (recommended)**

This workflow is for when you are creating a brand-new knowledge base (the normal case).

Step 2.1.1: Create the Database Schema  
First, create the database itself along with all the necessary collections, indexes, and graphs. The arango-schema-creator.js script uses a predefined arango-schema.json file to build this structure. This can be done in the ArangoDB console (http://localhost:8529/)  
Bash

Bash

\# Set the name for your new database    
export ARANGO\_DATABASE="genie-ai-new-use-case" 

\# Run the script with the schema definition file from the gov-chat-backend/scripts/new-schema-scripts folder  
node arango-schema-creator.js ./arango-schema.json

Step 2.1.2: Populate the English Knowledge Hierarchy  
There are 2 options for this : 1 \- script based (documented directly below) and 2 \- Using the Admin Dashboard (documented further below)  
Next, populate the serviceCategories and services collections with your English labels. The create-knowledge-hierarchy.js script can be run in two ways:  
⚠️ IMPORTANT: Disable Schema Validation First\!  
Before running this script, you must temporarily disable schema validation on the serviceCategories, services, and categoryServices collections to prevent errors. You can do this in the ArangoDB web UI under each collection's "Settings" tab by setting the Validation Level to "none". Remember to re-enable it after the script succeeds. The latest version of the schema has this already disabled for all collections. The scripts can handle either interactive or file modes.

* Interactive Mode: The script will prompt you to enter categories and services one by one.  
  Bash  
  Bash  
  node create-knowledge-hierarchy.js

* File Mode: Provide a simple JSON file containing your hierarchy. This is recommended for automated setups.  
  Bash  
  Bash  
  \# Example my-hierarchy.json    
  \# \[    
  \#   { "category": "Emergency Services", "services": \["Ambulance Dispatch", "Emergency Room Locations"\] }    
  \# \]

  node create-knowledge-hierarchy.js \--file ./my-hierarchy.json

Step 2.1.3: Generate Language Translations (one of the hassles with scripts)  
Finally, use the create-translations.js script to automatically translate the English labels into your desired languages using the Google Cloud Translate API.

* **Prerequisites:** You must have a google-credentials.json file configured with a service account key and an API key. The Cloud Translation API must be enabled in your Google Cloud project.  
* Usage: Run the script for each language you need to support.  
  Bash  
  Bash  
  \# Create French translations    
  node create-translations.js FR

  \# Create Swahili translations    
  node create-translations.js SW

##### **Option B: Migrating or Cloning an Existing GENIE.AI Instance**

This workflow is used when you have a pre-existing, populated GENIE.AI database that you want to transfer to a new environment.

Step 2.1.1: Extract Schema and Export Data (from Source DB)  
On your source system, run the extraction and export scripts.

1. Extract Schema:  
   Bash  
   Bash  
   \# Point to your source database    
   export ARANGO\_DATABASE="genie-ai-source"    
   node arango-schema-extractor.js

   This produces an arango-schema.json file.  
2. Export Data:  
   Bash  
   Bash  
   \# Still pointing to the source database    
   node export-service-categories.js

   This produces a comprehensive JSON file in the /exports directory containing all hierarchy and translation data. Note the timestamped filename for the next step.

Step 2.1.2: Create Database and Import Data (on Target DB)  
On your target system, use the files generated above.

1. Create Schema: Use the arango-schema.json from the source to create an identical database structure.  
   Bash  
   Bash  
   \# Point to your new target database    
   export ARANGO\_DATABASE="genie-ai-production"    
   node arango-schema-creator.js ./arango-schema.json

2. Import Data: Use the import-service-categories.js script to populate the new database.⚠️ IMPORTANT: Disable Schema Validation First\!  
   Just as with the scratch setup, you must disable schema validation for the relevant collections in the new target database before importing.  
   Bash  
   Bash  
   \# Point to the new database and the exported file    
   export ARANGO\_DATABASE="genie-ai-production"    
   export IMPORT\_FILE="./exports/serviceCategoriesAndServices\_export\_... .json"

   node import-service-categories.js

#### **Method 2: Using the Admin Dashboard**

This method is ideal for users who prefer a visual interface, for making incremental changes after an initial setup, or for less technical administrators.

Step 2.2.1: Create and Manage the Knowledge Hierarchy  
Navigate to the Knowledge Hierarchy tab in the GENIE.AI Admin Dashboard. From here you can:

* **Add Categories:** Click the **"+ Add New Category"** button to create a new top-level entry.  
* **Add Services:** Hover over a category and click the **plus icon** to add a nested service.  
* **Edit and Delete:** Use the pencil and trash icons that appear on hover to modify or remove any category or service.  
* **Manage Translations:** When adding or editing an item, a form will appear allowing you to input the primary English name (nameEN) and add multiple display translations for different languages in a table.

Step 2.2.2: Upload and Ingest Documents  
Navigate to the Document Management tab. The process is as follows:

1. **Upload:** Click **"+ Upload Files"** or **"+ Add from Link"** to add a new document to the repository. The document's status will initially be "Pending".  
2. **Apply Labels:** Click on the newly uploaded document in the list. A detail panel will slide out.  
3. **Select Labels:** In the "Labels" field, use the multi-select dropdown to browse the knowledge hierarchy you just created. Select all relevant categories and services that apply to this document.  
4. **Ingest:** Click the **"Ingest"** button. This triggers the backend data preparation pipeline, which chunks the document, creates vector embeddings, and associates each chunk with the labels you selected. The document's status will update to "Ingested".

---

### **Step 3: Application Setup and Deployment**

Once your database is created and populated (Step 2), you are ready to configure and run the application services. This section covers cloning the repository, setting up the core environment variables, and launching the stack using Docker Compose.

#### **3.1 Cloning the Repository**

First, obtain the application source code. The repository is available from the following locations. Clone the one you have access to:

* **Public Replica:** https://gitlab.com/fordendk/genie-ai-replica  
* **Internal UNICC GitLab Server:** (Check with your administrator for the internal repository URL)

Clone the repository to your local machine (using the public replica as an example):

Bash

git clone https://gitlab.com/fordendk/genie-ai-replica  
cd genie-ai-replica

#### **3.2 Environment Configuration**

The docker-compose.yaml file sources its configuration from an .env file located in the root of the repository. You must create this file (e.g., by copying an existing .env.example) and populate it with your specific settings.

The following tables document the key variables found in the .env file, grouped by the service they configure. 1

**Kong (API Gateway) & Database** 2

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| POSTGRES\_USER | Username for the Kong database. | kong |
| POSTGRES\_DB | Name of the Kong database. | kong |
| POSTGRES\_PASSWORD | Password for the Kong database. | your-kong-db-password |
| KONG\_DATABASE | Tells Kong which database type to use. | postgres |
| KONG\_PG\_HOST | Hostname for the Kong database service. | kong-database |
| KONG\_ADMIN\_LISTEN | Kong admin API listen address. | 0.0.0.0:8001, 0.0.0.0:8444 ssl |
| KONG\_DNS\_RESOLVER | DNS resolver for Kong (e.g., Docker's internal). | 127.0.0.11 |

**Frontend & Backend (Shared)** 3

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| VUE\_APP\_API\_URL | Path for the frontend to reach the backend API. | /api |
| VUE\_PROXY\_HOST | Target for the Vue development proxy. | kong:8010 |
| CSP\_CONNECT\_SRC | Content Security Policy connect-src directive. | 'self' http://locahost... |
| CORS\_ALLOWED\_ORIGINS | Allowed origins for CORS. | http://localhost,https://localhost... |

**Backend Service** 4

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| NODE\_ENV | Sets the application environment. | production |
| BACKEND\_PORT | Internal port the Node.js app listens on. | 3000 |
| API\_PREFIX | Global prefix for all API routes. | /api |
| JWT\_SECRET | Secret key for signing JSON Web Tokens. | UJeFROw+yRJeVOPiUTgdcXzl... |
| JWT\_EXPIRES\_IN | Expiration time for JWTs. | 24h |
| TRANSLATION\_CACHE\_HOST | Redis host for translation caching. | redis-cache |
| TRANSLATION\_CACHE\_PORT | Redis port. | 6379 |
| EMAIL\_HOST | SMTP server for sending emails. | smtp.itu.ch |
| EMAIL\_USER | SMTP username. | genie-ai |
| EMAIL\_PASSWORD | SMTP password. | your-password |
| OPEA\_HOST | Hostname for the OPEA backend service. | chatqna-xeon-backend-server |

**ArangoDB (Knowledge Base)** 5

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| ARANGO\_PASSWORD | Root password for ArangoDB. | test |
| ARANGO\_DB\_NAME | Database name used by the backend. | genie-backend |
| ARANGO\_DB | Database name used by the frontend. | genie-frontend |
| ARANGO\_URL | Connection URL for ArangoDB. | http://arango-vector-db:8529 |
| ARANGO\_USER | Username for ArangoDB. | root |
| ARANGO\_USERNAME | Username for ArangoDB. | root |

**Document Repository Service** 6

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| DOC\_REPO\_PORT | Internal port for the document service. | 3001 |
| DATAPREP\_HOST | Hostname for the Dataprep service. | http://localhost |
| DATAPREP\_PORT | Port for the Dataprep service. | 6007 |
| MAX\_FILE\_SIZE | Maximum file upload size in bytes (e.g., 50MB). | 52428800 |
| VIRUS\_SCANNING | Enable/disable ClamAV virus scanning. | true |
| CLAMSCAN\_HOST | Hostname for the ClamAV service. | 127.0.0.1 |
| CLAMSCAN\_PORT | Port for the ClamAV service. | 3310 |

**Dataprep & Retriever Services** 7

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| DATAPREP\_CHUNK\_SIZE | Size of document chunks for ingestion. | 500 |
| DATAPREP\_CHUNK\_OVERLAP | Overlap between document chunks. | 50 |
| DATAPREP\_ARANGO\_GRAPH\_NAME | Graph name for Dataprep to write to. | graph\_el\_salvador |
| RETRIEVER\_ARANGO\_GRAPH\_NAME | Graph name for Retriever to read from. | graph\_el\_salvador |
| RETRIEVER\_OPENAI\_EMBED\_MODEL | Embedding model used by the retriever. | text-embedding-3-small |
| ARANGO\_FILTER\_STRATEGY | Strategy for applying filters (e.g., OR, AND). | OR |

**Models & External APIs** 8

| Variable | Description | Example Value |
| :---- | :---- | :---- |
| HUGGINGFACEHUB\_API\_TOKEN | API key for Hugging Face. | hf\_YnXMHAtvTTVfwZJIYxKrEC... |
| VLLM\_API\_KEY | API key for the VLLM service. | eyJhbGciOiJSUzI1NiIsInR5cCIg... |
| VLLM\_ENDPOINT | URL for the VLLM inference server. | http://vllm:80 |
| EMBEDDING\_MODEL\_ID | Model ID for embeddings. | BAAI/bge-base-en-v1.5 |
| RERANKER\_MODEL\_ID | Model ID for reranking. | BAAI/bge-reranker-v2-m3 |
| LLM\_MODEL\_ID | Model ID for the main language model. | meta-llama/Llama-3.3-70B-Instruct |
| TEI\_EMBED\_MODEL | Model ID for TEI embeddings. | BAAI/bge-base-en-v1.5 |

#### **3.3 Running the Application with Docker Compose**

The repository includes a docker-compose.yaml file configured for a single-node deployment. It orchestrates all the necessary services, including the backend, frontend, databases (Postgres, ArangoDB, Redis), and AI model services.

1. **Install Prerequisites:** Ensure you have **Docker** and **Docker Compose** installed on your server.  
2. **Navigate to Directory:** Change into the root directory of the cloned repository where the docker-compose.yaml file is located.  
3. **Verify Configuration:** Double-check that your .env file (see Step 3.2) is present and correctly configured with all necessary passwords, API keys, and hostnames.  
4. **Start the Services:** Run the following command to build the images (if not already built) and start all services in detached mode (in the background).  
   Bash  
   docker-compose up \-d

5. **Monitor Logs:** To view the logs from all running services in real-time, you can use:  
   Bash  
   docker-compose logs \-f

   To follow the logs for a specific service (e.g., the backend):  
   Bash  
   docker-compose logs \-f backend

6. **Stop the Services:** To stop and remove all the containers defined in the stack, run:  
   Bash  
   docker-compose down  
