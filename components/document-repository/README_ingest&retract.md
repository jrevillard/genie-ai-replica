# Document Repository - Ingest and Retract

## What should be handled by the document repository?

**Ingest**

Expose an endpoint (e.g. `POST /api/files/:fileId/ingest`) that:
1. Finds the file and its metadata.
2. Sends the file and certain metadata to the dataprep microservice (via HTTP request, e.g. using `axios`).
3. Waits for a response from dataprep (success/failure).
4. On success, updates the file’s metadata:
* dataprep.status = "ingested"
* dataprep.ingest_date = <current_time>

**Retract**

Expose an endpoint (e.g. `POST /api/files/:fileId/retract`) that:

1. Sends a request to the dataprep microservice to delete all related chunks, embeddings, entities, and relations for that file.
2. Waits for a response from dataprep (success/failure).
3. On success, updates the file’s metadata:
* dataprep.status = "retracted"
* dataprep.retract_date = <current_time>

## What should be handled by the dataprep microservice?

**Ingest**

* Receives the file and metadata.
* Performs text extraction, chunking and embedding of the file content.
* Calls guardrail microservices for content checking for each chunk (optional)
    * If fails, return an error response.
    * If successful, start the next step.
* Labels each chunk with the pre-defined service and category labels.
* Performs entity and relation extraction for each chunk.
* Stores results in related collections (SOURCE, ENTITY, HAS_SOURCE, LINKS_TO).
* Returns a success/failure response.

**Retract**

* Receives a file ID.
* Deletes all related chunks, entities, and relations from the database.
* Returns a success/failure response.
