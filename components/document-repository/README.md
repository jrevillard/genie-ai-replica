# Document Repository Service

This service provides a backend file system for managing file CRUD + search + ingest&extract operations. It is designed to connect with the frontend located at `/root/chat-ui-vue-app/gov-chat-frontend`.

```mermaid
%%{init: {'theme':'forest'}}%%
journey
    title User Journey for Document Handling

    section Upload & Security
        Admin selects file: 5:Admin
        File scanned and metadata auto-extracted: 3:System
        Metadata is stored in ArangoDB: 4:System

    section File Management (Any Time)
        Admin views and deletes files: 7:Admin
        Admin views and edits metadata: 5:Admin
        Admin searches files by metadata: 5:Admin

    section Ingestion into / Extract from Knowledge Base
        Admin chooses to ingest file: 5:Admin
        File sent to dataprep service: 4:System
        File processed. Metadata enriched automatically: 5:System
        Admin chooses to retract file (optional): 5:Admin
        Chunks, entities and relations are deleted: 5:System

    section Search & Traceability
        User sends a question: 5:Admin, User
        RAG workflow (enhanced by labels): 5:System
        User sees source document besides output: 5:Admin, User
```

```mermaid
---
config:
  layout: dagre,
  theme: base
title: Document Repository Service Workflow
---
flowchart TD
 subgraph User_Side["User_Side"]
        A["User Uploads File"]
        B["Edit/View Metadata"]
        C["Search Files by Metadata"]
        D["Ingest/Retract File"]
        P["Read/Delete File"]
  end
 subgraph Document_Repository_CPU_Node["Document_Repository_CPU_Node"]
        E["Security Check ClamAV"]
        O(["File Local Storage"])
        F["Extract Basic Metadata"]
        G(["Metadata in ArangoDB"])
        H["Send File to Dataprep / Delete Chunks, Entities and Relations from Database"]
  end
 subgraph Dataprep_Microservice_GPU_Node["Dataprep_Microservice_GPU_Node"]
        I["Extract Full Text and Language"]
        J["Chunk Text and Embed"]
        K["Extract Labels if not given"]
        L["Update Metadata in ArangoDB"]
        Q["Knowledge Graph Construction"]
  end
 subgraph Downstream["Downstream"]
        N["Show Source File\nvia Metadata Link"]
        M["LLM Query Answering (Including Retrieval + Textgen)"]
  end
    A --> E
    E --> O & F
    F --> G
    B --> G
    C --> G
    G --> O & M
    D <--> H
    H <--> I
    I --> J
    J --> K
    K --> L
    M --> N
    L --> M
    P --> O
    J --> Q
    Q --> M
```

## Supported File Types
The file system supports various file types, including but not limited to:
- Text files (`.txt`)
- Document files (`.pdf`, `.docx`, `.doc`, `.md`)
- Web files (`.html`)
- Sheet files (`.xls`, `.xlsx`)

## Feature Services

- **Upload Files:** Administrators can upload files from their local computers.
- **Upload Links:** Administrators can upload website links directly. The content of the webpage will be crawled automatically and saved as a local html file.
- **Read Files:** Uploaded files are stored in `/document-repository/uploads` and can be accessed for viewing in browser for all supported file types.
- **Download Files:** Files can be downloaded to the administrator's local machine.
- **Delete Files:** Administrators can remove files from the system.
- **Virus Scanning:** Files are scanned for viruses before being saved to the file system.
- **Metadata Extraction and Editing:** Metadata such as file labels and language is extracted and stored for search functionality. See [`README_metadata.md`](./README_metadata.md) for details.
- **Search Files:** Users can search files by metadata such as file name, type, and labels.
- **Ingest Files to Dataprep:** Files can be ingested into the dataprep microservice for knowledge graph building and further processing.
- **Retract Files from Dataprep:** Files can be retracted from the dataprep microservice, which deletes the associated graphs, preventing the files from being used for retrival and answer generation.

## Folder Structure (to be updated)

```
document-repository/
├── src/
│   ├── controllers/              # Handles HTTP requests
│   │   ├── fileController.js
│   ├── routes/                   # Express routes
│   │   ├── fileRoutes.js
│   ├── services/                 # Business logic
│   │   ├── fileService.js
│   │   ├── securityService.js
│   │   ├── metadataService.js
│   │   ├── dataprepClient.js     # Handles HTTP calls to dataprep
│   ├── utils/                    # Helper functions
│   │   ├── fileUtils.js
│   │   ├── virusScanner.js       # Hooks to ClamAV or similar
│   │   ├── mimeTypes.js
│   ├── middlewares/             # Middleware for Express
│   │   ├── fileUpload.js         # Multer config
│   │   ├── errorHandler.js
│   ├── config/
│   │   ├── appConfig.js
│   │   ├── dataprepConfig.js
│   ├── app.js                    # Express app
│   ├── server.js                 # Entry point
├── uploads/                      # Stores uploaded files
├── tests/
│   ├── unit/
│   ├── integration/
├── Dockerfile
├── package.json
├── README.md
```

## Responsibilities

**document-repository responsibilities**:

| Feature                   | Responsibility                               |
| ------------------------- | -------------------------------------------- |
| File upload               | ✔️                                           |
| Link upload               | ✔️                                           |
| Virus scan                | ✔️ (`virusScanner.js`)                       |
| Save to `/uploads` folder | ✔️                                           |
| Read/view/download file   | ✔️                                           |
| Metadata extraction *     | ✔️ (`metadataService.js`)                    |
| Search by metadata        | ✔️                                           |
| Delete file (from disk)   | ✔️                                           |
| Ingest to dataprep        | ✅ via `POST /api/:fileId/ingest` router     |
| Retract from dataprep     | ✅ via `POST /api/:fileId/retract` router     |

> ✅ Means this service initiates the action, but the dataprep microservice owns the actual data processing.
> Metadata extraction is done at both upload time and ingest time, allowing for quick user access and later semantic enrichment. In document-repository, the basic metadata is extracted and stored in the ArangoDB database, while the enrichment is handled by the dataprep microservice.

**Dataprep microservice responsibilities (related to document-repository)**:

* **Metadata extraction (especially for file labels and file language)**
* **Content safety checks**
* Text extraction from files
* Chunking
* Embedding
* Indexing & storing in DB
* ...

## Routes Overview (to be updated)

| Method | Route                                 | Description                                 | Access          |
| ------ | ------------------------------------- | ------------------------------------------- | --------------- |
| POST   | `/api/files/upload`                   | Upload and validate a single file           | Admin only      |
| POST   | `/api/files/uploads`                  | Upload and validate multiple files          | Admin only      |
| POST   | `/api/files/upload-link`              | Upload a link (webpage) as a file           | Admin only      |
| GET    | `/api/files`                          | Get all files with pagination/filtering     | Authenticated   |
| GET    | `/api/files/search`                   | Search files by metadata                    | Authenticated   |
| GET    | `/api/files/:metadata`                | Get file metadata by ID                     | Authenticated   |
| GET    | `/api/files/:fileId/view`             | Get file as base64 for viewing              | Authenticated 🤔|
| GET    | `/api/files/:fileId/viewbrowser`      | View file in browser (if supported)         | Authenticated 🤔|
| GET    | `/api/files/:fileId/download`         | Download file by ID                         | Authenticated 🤔|
| POST   | `/api/files/downloads`                | Download multiple files as a ZIP archive    | Authenticated 🤔|
| PATCH  | `/api/files/:fileId`                  | Update file metadata                        | Admin only      |
| DELETE | `/api/files/:fileId`                  | Delete file by ID                           | Authenticated   |
| DELETE | `/api/files`                          | Delete multiple files by IDs                | Authenticated   |
| POST   | `/api/files/:fileId/ingest`           | Ingest file to dataprep                     | Admin only      |
| POST   | `/api/files/:fileId/retract`          | Retract file from dataprep                  | Admin only      |

## Setup (to be updated)

### via Docker

1. Navigate to the components directory

  ```bash
  cd components
  ```

2. Create the Docker network

  ```bash
  docker network create chatqna_default
  ```

3. Start the required services

  ```bash
  docker compose up arango-vector-db document-repository
  ```

4. Configure ArangoDB

* Open your web browser and go to http://localhost:8529
* Change the root password:
  * Log in with username `root` and password `default-arango-password`
  * Change the password to `test`
* Create a new database named `node-services`
* Give the `root` user `administrate` permission for the `node-services` database
* In the node-services database, create a new collection named `files`
* Import the `users` collection into the `node-services` database

### via npm

0. **Ensure ArangoDB and ClamAV are running locally**

    When using `npm run dev` for development, you'll want to see your code changes immediately. This setup relies on ArangoDB and ClamAV running in the background. We recommend running their Docker images before starting `npm run dev`. 

    For ArangoDB, follow the instructions above (`docker compose up arango-vector-db` instead of adding `document-repository`), or run the following docker command:

    ```bash
    docker run -d \
    --name arango-vector-db \
    -p 8529:8529 \
    -e ARANGO_ROOT_PASSWORD=default-arango-password \
    --restart unless-stopped \
    arangodb:latest
    ```

    For ClamAV, using Docker is the recommended approach as it requires no code changes. Choose the command for your operating system:

    for Mac ⬇️

    ```bash
    docker run -d \
    --name clamav-daemon \
    -p 3310:3310 \
    mkodockx/docker-clamav:alpine
    ```

    for Windows ⬇️

    ```bash
    docker run -d \
    --name clamav-daemon \
    -p 3310:3310 \
    clamav/clamav:stable
    ```

    Alternatively, you can manually configure ClamAV's configuration files. This is a quite tedious process and might not always lead to success. If you're interested, you can refer to [this chat history with GPT](https://chatgpt.com/share/68766754-6920-8007-9f4a-298492df7135) for guidance. Remember, if you go this route, you'll need to ensure ClamAV is configured to listen on port 3310 and connect via TCP instead of sockets.

1. **Navigate to the project directory:**

    ```bash
    cd document-repository
    ```

2. **Initialize the project:**

    This creates a new file called "package.json" that keeps track of your project's information and what other code libraries it needs. The -y means "yes to everything" so it won't ask you questions. If you already have a "package.json" file, you can skip running this.

    ```bash
    npm init -y
    ```

3. **Install required dependencies:**

    ```bash
    npm install
    ```

4. **Run the service (in the background):**

    ```bash
    npm run dev
    ```

## Usage (to be updated)

Use the following `curl` commands to interact with the file system backend service. Replace `<remote-node-ip>` with the actual IP address of the remote node if you are accessing it remotely.

### Upload a File

**Request**

```bash
curl -X POST http://localhost:3000/api/files/upload \
  -H "Authorization: Bearer <accessToken>" \
  -F "file=@/Users/scarlettsun/Desktop/ITU/ExamplePDF.pdf"
```

**Response**

```json
{"success":true,
 "message":"File uploaded successfully",
 "data":{"file_id":"1750164284119-30f48760",
         "file_name":"ExamplePDF.pdf",
         "file_size":4577594,
         "file_type":"application/pdf",
         "storage_path":"/app/uploads/1750164284119-30f48760.pdf","file_hash":"65f7f55f1142a85eff2ee54896dbe531c6db38289a1dac9ded7594ca7f9a5892",
         "labels":[],
         "crawl_date":null,
         "source_url":"",
         "language":"",
         "chunk_count":0,
         "dataprep":{"status":"pending",
                     "ingest_date":"",
                     "retract_date":""}}}
```

---

### Upload Multiple Files (max 5)

```bash
curl -X POST http://localhost:3000/api/files/uploads \
  -H "Authorization: Bearer <accessToken>" \
  -F "files=@/Users/scarlettsun/Desktop/ITU/txtai.txt" \
  -F "files=@/Users/scarlettsun/Desktop/ITU/Sample_criteria.xlsx" \
  -F "files=@/Users/scarlettsun/Desktop/ITU/EMBEDDING MODEL TESTS.docx" \
  -F "files=@/Users/scarlettsun/Desktop/ITU/pymupdf4llm_markdown.md" \
  -F "files=@/Users/scarlettsun/Desktop/ITU/ExamplePDF.pdf"
```

**Response**

```json
{"success":true,
 "message":"Files uploaded successfully",
 "data":[{"file_id":"1750164437466-b51fa7c5", "file_name":"txtai.txt", "file_size":210930, "file_type":"text/plain", "storage_path":"/app/uploads/1750164437466-b51fa7c5.txt","file_hash":"60a92fa3b2ce3bd8039702806ffdf65250ddfcab59cca1ed6cbd0f60cf23beff","labels":[], "crawl_date":null, "source_url":"","language":"","chunk_count":0, "dataprep":{"status":"pending","ingest_date":"","retract_date":""}},
         {"file_id":"1750164437466-1c31ed4c","file_name":"Sample_criteria.xlsx", "..."},{"file_id":"1750164437467-42b326a7", "..."},
         {"..."}]}
```

---

### Upload a Link

```bash
curl -X POST http://localhost:3000/api/files/upload-link \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://ieeeht.org/get-involved/funding-opportunities/genai-for-good/"}'
```

**Response**

```json
{"success":true,
 "message":"URL crawled and html file saved successfully",
 "data":{"file_id":"1753107703650-7e7b18fe",
         "file_name":"GenAI for Good Challenge - IEEE Humanitarian Technologies.html",
         "file_size":225894,
         "file_type":"text/html",
         "storage_path":"/app/uploads/1753107703650-7e7b18fe.html",
         "file_hash":"cff5f98ba82a1ade25de41e9dc7ba030fe436485bd4b47b18b0067b727458c12",
         "labels":[],
         "author":"crawler",
         "crawl_date":"2025-07-21T14:21:43.650Z",
         "source_url":"https://ieeeht.org/get-involved/funding-opportunities/genai-for-good/",
         "language":"en",
         "chunk_count":0,
         "dataprep":{"status":"pending","ingest_date":"","retract_date":""}}}
```

---

### View a File

**View a file in base64** (for future API integration)

```bash
curl http://localhost:3000/api/files/1752590647147-8ca95cff/view \
  -H "Authorization: Bearer <accessToken>"
```

**Response**

```base64
...IGl0LiBUaGlzIHdpbGwgZGVwZW5kIG9uIGhvdyB0aGUgCnRhb...
```

**View a file in browser** (for supported file types. For example, PDF, HTML, etc. Files in other types will be downloaded instead.)

❗ Cannot open the browswer to view a file due to authorization. Is it necessary to add it to this function?

```
Open your browser and navigate to:

http://localhost:3000/api/files/1752590647147-8ca95cff/viewbrowser
```

---

### Download a File

Download from the backend server:

```bash
curl http://localhost:3000/api/files/1752662663501-73b73909/download --output /Desktop/ITU/test-download-4.html \
  -H "Authorization: Bearer <accessToken>"
```

**Response**

```bash
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100 4470k  100 4470k    0     0   148M      0 --:--:-- --:--:-- --:--:--  174M
```

---

### Download Multiple Files in a ZIP Archive

```bash
curl -X POST http://localhost:3000/api/files/downloads \
  -H "Content-Type: application/json" \
  -o /Desktop/ITU/download-files-2.zip \
  -d '{"fileIds":["1752590647457-165b5132","1752662663501-73b73909","1752755682277-8bed74bc"]}' \
  -H "Authorization: Bearer <accessToken>"
```

**Response**

```bash
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100  101k    0  101k  100    88  1161k   1009 --:--:-- --:--:-- --:--:-- 1220k
```

---

### Delete a File

Delete from the backend server:
```bash
curl -X DELETE http://localhost:3000/api/files/1751639317979-872bb122 \
  -H "Authorization: Bearer <accessToken>"
```

**Response**

```json
{"success":true, "message":"File deleted successfully"}
```

---

### Delete Multiple Files

```bash
curl -X DELETE http://localhost:3000/api/files \
  -H "Content-Type: application/json" \
  -d '{"fileIds":["76d74b7c-b3e5-4162-b4ca-6ba09809515a", "1750163480096-19d9304a", "1750164437466-b51fa7c5"]}' \
  -H "Authorization: Bearer <accessToken>"
```

**Response**

```json
{"message":"Batch delete completed",
 "results":[{"fileId":"76d74b7c-b3e5-4162-b4ca-6ba09809515a",
             "success":false,
             "error":"File record not found in database: 76d74b7c-b3e5-4162-b4ca-6ba09809515a"},
            {"fileId":"1750163480096-19d9304a","success":true},{"fileId":"1750164437466-b51fa7c5","success":true}]}
```

---

### Get File Metadata by ID

```bash
curl -X GET "http://localhost:3000/api/files/1752590647458-fea8525c" \
  -H "Authorization: Bearer <accessToken>"
```

**Response**

```json
{"success":true,
 "message":"Metadata retrieved successfully",
 "data":{"_key":"120121",
         "_id":"files/120121",
         "_rev":"_k-4J-YS---",
         "file_id":"1752590647458-fea8525c",
         "file_name":"ExamplePDF.pdf",
         "file_size":4577594,
         "file_type":"application/pdf",
         "storage_path":"/app/uploads/1752590647458-fea8525c.pdf",
         "file_hash":"65f7f55f1142a85eff2ee54896dbe531c6db38289a1dac9ded7594ca7f9a5892",
         "labels":[],
         "author":"",
         "upload_date":"2025-07-15T14:44:07.494Z",
         "create_date":"2025-07-15T14:44:07.458Z",
         "crawl_date":"",
         "source_url":"",
         "language":"unknown",
         "chunk_count":0,
         "dataprep":{"status":"pending","ingest_date":"","retract_date":""},
         "page_count":104}}
```


### Get Files (by common metadata fields for simple, fast filtering)

💚 Default to return the first 10 files, sorted by `upload_date` in descending order.

```bash
curl "http://localhost:3000/api/files" \
  -H "Authorization: Bearer <accessToken>"
```

💚 Get files with pagination and limit:
```bash
curl "http://localhost:3000/api/files?page=2&limit=5" \
  -H "Authorization: Bearer <accessToken>"
```

💚 Get files by mimetype:
```bash
curl "http://localhost:3000/api/files?mimeType=text/html" \
  -H "Authorization: Bearer <accessToken>"
```

💚 Search by file name (case insensitive):
```bash
curl "http://localhost:3000/api/files/search?file_name=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' 世界)" \
  -H "Authorization: Bearer <accessToken>"
```

💚 Filter by dataprep status:

```bash
curl "http://localhost:3000/api/files?dataprepStatus=pending" \
  -H "Authorization: Bearer <accessToken>"
```

💚 Combine filters (e.g., PDF files with 'example' in the name)

```bash
curl "http://localhost:3000/api/files?mimeType=text/html&search=world" \
  -H "Authorization: Bearer <accessToken>"
```

**Response (for the combine filters)**

```json
{"success":true,
 "message":"Files retrieved successfully",
 "data":[{"_key":"2665","_id":"files/2665","_rev":"_j1S7H16---","file_id":"1750018631535-79b1bc54","file_name":"ExamplePDF.pdf","file_size":4577594,"file_type":"application/pdf","file_path":"/app/uploads/1750018631535-79b1bc54.pdf","labels":[],"uploaded_date":"2025-06-15T20:17:11.545Z","created_date":"2025-06-15T20:17:11.536Z","crawl_date":null,"source_url":"","language":"","chunk_count":0,"dataprep":{"status":"pending","ingested_date":"","retracted_date":""}},
         {"_key":"3132","_id":"files/3132","_rev":"_j1TKMHO---","file_id":"1750019618934-ce1317a4","file_name":"ExamplePDF.pdf","file_size":4577594,"file_type":"application/pdf","file_path":"/app/uploads/1750019618934-ce1317a4.pdf","labels":[],"uploaded_date":"2025-06-15T20:33:38.961Z","created_date":"2025-06-15T20:33:38.936Z","crawl_date":null,"source_url":"","language":"","chunk_count":0,"dataprep":{"status":"pending","ingested_date":"","retracted_date":""}},
         {"_key":"3663","_id":"files/3663","_rev":"_j1TbepG---","file_id":"1750020752005-1ba26d2d","file_name":"ExamplePDF.pdf","file_size":4577594,"file_type":"application/pdf","file_path":"/app/uploads/1750020752005-1ba26d2d.pdf","labels":[],"uploaded_date":"2025-06-15T20:52:32.048Z","created_date":"1970-01-01T00:00:00.000Z","crawl_date":null,"source_url":"","language":"","chunk_count":0,"dataprep":{"status":"pending","ingested_date":"","retracted_date":""}}]
 "pagination":{"currentPage":1,
               "totalPages":3,
               "totalFiles":28,
               "limit":10}}
```

---

### Update File Metadata

```bash
curl -X PATCH http://localhost:3000/api/files/1752757770440-ce960082 \
  -H "Content-Type: application/json" \
  -d '{"language":"zh", "labels":["one", "red"], "author":"New Author"}' \
  -H "Authorization: Bearer <accessToken>"
```


**Response**

```json
{"success":true,
 "message":"File updated successfully",
 "data":{"file_id":"1752757770440-ce960082",
         "file_name":"国际电联：致力于连通世界.html",
         "file_size":100686,
         "file_type":"text/html",
         "storage_path":"/app/uploads/1752757770440-ce960082.html",
         "file_hash":"0625305ccd073180e6f3896ca793e654f2250ba96dd4eb6ec70943a0dfab9507",
         "labels":["one","red"],
         "author":"New Author",
         "create_date":"2025-07-17T13:09:30.441Z",
         "crawl_date":"2025-07-17T13:09:30.440Z",
         "source_url":"https://www.itu.int/zh/Pages/default.aspx#/zh",
         "language":"zh",
         "chunk_count":0,
         "dataprep":{"status":"pending","ingest_date":"","retract_date":""}}}
```

---

### Search Files by Filtering Metadata

For search files by name, the terminal does not encode non-ASCII characters correctly in the URL. Must percent-encode all characters.

```bash
curl "http://localhost:3000/api/files/search?file_type=application/pdf" \
  -H "Authorization: Bearer <accessToken>"

curl "http://localhost:3000/api/files/search?file_name=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' 世界)" \
  -H "Authorization: Bearer <accessToken>"

curl "http://localhost:3000/api/files/search?file_name=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' ITU)" \
  -H "Authorization: Bearer <accessToken>"

curl "http://localhost:3000/api/files/search?upload_date_from=2025-07-15T14:30:00.092Z&upload_date_to=2025-07-16T14:40:07.092Z" \
  -H "Authorization: Bearer <accessToken>"

curl "http://localhost:3000/api/files/search?labels=one,orange" \
  -H "Authorization: Bearer <accessToken>"

curl "http://localhost:3000/api/files/search?author=Google" \
  -H "Authorization: Bearer <accessToken>"

curl "http://localhost:3000/api/files/search?status=pending" \
  -H "Authorization: Bearer <accessToken>"

curl "http://localhost:3000/api/files/search?language=zh" \
  -H "Authorization: Bearer <accessToken>"

curl "http://localhost:3000/api/files/search?file_type=text/html&labels=orange" \
  -H "Authorization: Bearer <accessToken>"

curl "http://localhost:3000/api/files/search?file_name=budget&file_type=application/html&upload_date_from=2024-06-01T00:00:00Z&upload_date_to=2024-06-30T23:59:59Z&labels=finance,orange&author=Anonymous&status=pending&language=en" \
  -H "Authorization: Bearer <accessToken>"
```

**Response**

```json
{"success":true,
 "message":"Metadata search completed successfully",
 "data":[{"_key":"42503","_id":"files/42503","_rev":"_j2IEPHa---","file_id":"1750239869811-68b40128","file_name":"Urban Immunization Toolkit.pdf","file_size":2770818,"file_type":"application/pdf","storage_path":"/app/uploads/1750239869811-68b40128.pdf","file_hash":"3456a1eef50facf4d1b70768ee904f91dd057c6f702f55923243fbe20b5c1131","labels":["two","orange"],"author":"NewAuthor","upload_date":"2025-06-18T09:44:29.852Z","create_date":"2025-06-18T09:44:29.813Z","crawl_date":"","source_url":"","language":"sw","chunk_count":0,"dataprep":{"status":"pending","ingest_date":"","retract_date":""},"page_count":69}],
 "query":{"file_type":"application/pdf","labels":"orange"},
 "resultCount":1}
```

```json
{"success":true,
 "message":"Metadata search completed successfully",
 "data":[],
 "query":{"file_name":"budget","file_type":"application/html","upload_date_from":"2024-06-01T00:00:00Z","upload_date_to":"2024-06-30T23:59:59Z","labels":"finance,orange","author":"Anonymous","status":"pending","language":"en"},
 "resultCount":0}
```

---

## Security for Access Control

- Common users authenticated as citizens can only read files.
- Users authenticated as administrators can access all the file operations.
- File access is not restricted to intranet or localhost; remote access is supported.

## Notes

* For metadata-related operations, please see [`README_metadata.md`](./README_metadata.md) for more details.

## Extending

* Hybrid Upload/Ingest feature: Default to Manual Ingest, but Offer "Auto-Ingest" as a Setting

    By default, uploaded files are **not automatically ingested** into the knowledge base (via the dataprep microservice). This allows users to review or manage files before deciding to include them in retrieval-augmented generation (RAG) workflows. However, for convenience, an **optional auto-ingest setting** can be enabled to automatically push uploaded files to the knowledge base. This setting is configurable and ideal for trusted environments where immediate ingestion is preferred.

## License

SPDX-License-Identifier: Apache-2.0