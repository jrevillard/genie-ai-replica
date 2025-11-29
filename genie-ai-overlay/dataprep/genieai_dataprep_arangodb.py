# Copyright (C) 2025 International Telecommunication Union (ITU)
# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import json
import os
import re
import asyncio
import aiohttp
from typing import List, Optional, Union, Dict, Any
from datetime import datetime

from numpy import dot
from numpy.linalg import norm
from rank_bm25 import BM25Okapi

from openai import AsyncOpenAI
from langchain_community.embeddings import HuggingFaceHubEmbeddings
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_core.documents import Document
from langchain_text_splitters import HTMLHeaderTextSplitter, RecursiveCharacterTextSplitter
from langchain_arangodb import ArangoGraph
# Import exceptions for robust error handling
from arango.exceptions import AQLQueryExecuteError
from fastapi import HTTPException

# Import OPEA Core
from comps import CustomLogger, DocPath, OpeaComponent, OpeaComponentRegistry
# Import Custom GENIE Protocols
from comps.cores.proto.genieai_api_protocol import ArangoDBDataprepRequestFromDocRepo
# Import Custom Utils
from comps.dataprep.src.genieai_dataprep_utils import (
    is_valid_content,
    docling_document_loader,
    document_loader
)
from comps.dataprep.src.utils import get_tables_result, get_separators
# Import Parent Class
from comps.dataprep.src.integrations.arangodb import OpeaArangoDataprep

logger = CustomLogger("GENIE_DATAPREP_ARANGODB")
logflag = os.getenv("LOGFLAG", "false").lower() == "true"

# --- GENIE-Specific Configuration ---
DOCUMENT_REPOSITORY_URL = os.getenv("DOCUMENT_REPOSITORY_URL", "http://document-repository:3001")
GET_AUTH_TOKEN_URL = os.getenv("GET_AUTH_TOKEN_URL", "http://http-service:6666/get-token")

GUARDRAIL_URL = os.getenv("GUARDRAIL_URL", "http://guardrail:9090/v1/guardrails")
GUARDRAIL_ENABLED = os.getenv("GUARDRAIL_ENABLED", "false").lower() == "true"

# Spec 8.0: New Env Vars
LABELING_STRATEGY = os.getenv("LABELING_STRATEGY", "llm") 
EMBEDDING_LABEL_THRESHOLD = float(os.getenv("EMBEDDING_LABEL_THRESHOLD", "0.75"))
BM25_LABEL_THRESHOLD = float(os.getenv("BM25_LABEL_THRESHOLD", "2.00"))
CONTENT_EXTRACTION_METHOD = os.getenv("CONTENT_EXTRACTION_METHOD", "opea") 

# Spec 5.3: Externalized Prompt
LABEL_SELECTOR_SYSTEM_PROMPT = os.getenv("LABEL_SELECTOR_SYSTEM_PROMPT", """
<SYSTEM INSTRUCTIONS> 
Select the relevant labels from the provided list that best match the content of the input text. 
Use only the exact labels from the list. Return an empty list if none fit. 
Output must strictly follow the given JSON format. 
</SYSTEM INSTRUCTIONS>
""")

@OpeaComponentRegistry.register("GENIE_DATAPREP_ARANGODB")
class GenieArangoDataprep(OpeaArangoDataprep):
    """
    GENIE.AI Extension of OpeaArangoDataprep.
    Adds: Docling, Multi-Strategy Labeling, Guardrails, Batched Ingestion, and Repo Callbacks.
    """

    def __init__(self, name: str, description: str, config: dict = None):
        super().__init__(name, description, config)
        # We no longer load the static token here. 
        # We fetch it dynamically from the http-service as needed.

    # --- Utilities (Spec 4.1, 5.2, 6.1) ---

    async def _get_auth_token(self):
        """Fetches a fresh JWT from the internal http-service."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(GET_AUTH_TOKEN_URL) as response:
                    if response.status == 200:
                        data = await response.json()
                        token = data.get("accessToken")
                        if token:
                            return token
                        logger.error(f"Auth Service returned 200 but no accessToken: {data}")
                    else:
                        logger.error(f"Auth Service failed. Status: {response.status}, Body: {await response.text()}")
        except Exception as e:
            logger.error(f"Error connecting to Auth Service ({GET_AUTH_TOKEN_URL}): {e}")
        return None

    async def _update_doc_status(self, file_id: str, status: str, chunk_count: int = None):
        """Updates file status in Document Repository (Spec 4.1/6.1)."""
        token = await self._get_auth_token()
        if not token:
            logger.warning(f"Skipping status update for {file_id} due to missing auth token.")
            return

        url = f"{DOCUMENT_REPOSITORY_URL}/api/files/{file_id}/status"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        
        # FIX: Only include chunk_count if explicitly provided.
        # This prevents "Validation error: dataprep.chunk_count is not allowed" from backend.
        dataprep_payload = {"status": status}
        if chunk_count is not None:
            dataprep_payload["chunk_count"] = chunk_count

        payload = {
            "dataprep": dataprep_payload
        }

        try:
            async with aiohttp.ClientSession() as session:
                async with session.patch(url, json=payload, headers=headers) as response:
                    if response.status != 200:
                        logger.error(f"Failed to update status {status} for {file_id}: {await response.text()}")
        except Exception as e:
            logger.error(f"Error calling Doc Repo Status API: {e}")

    async def _write_ingestion_log(self, file_id: str, level: str, stage: str, message: str):
        """Writes human-readable logs to Document Repository (Spec 5.2/6.2)."""
        token = await self._get_auth_token()
        if not token:
            logger.warning(f"Skipping log write for {file_id} due to missing auth token.")
            return

        url = f"{DOCUMENT_REPOSITORY_URL}/api/files/{file_id}/ingestion-log"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        payload = {
            "level": level.lower(),
            "stage": stage,
            "message": message
        }
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, headers=headers) as response:
                    if response.status != 201:
                        logger.error(f"Failed to write log for {file_id}: {await response.text()}")
        except Exception as e:
            logger.error(f"Error calling Doc Repo Log API: {e}")

    async def _fetch_all_labels(self):
        """Fetch taxonomy from the Node Service."""
        token = await self._get_auth_token()
        if not token:
            logger.warning("Skipping label fetch due to missing auth token.")
            return []

        url = f"{DOCUMENT_REPOSITORY_URL}/api/service-categories/categories"
        headers = {"Authorization": f"Bearer {token}"}
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers) as response:
                    if response.status == 200:
                        data = await response.json()
                        labels = []
                        for item in data:
                            labels.append(item['name'])
                            labels.extend(item.get('children', []))
                        return list(set(labels))
                    logger.error(f"Label fetch failed. Status: {response.status}")
        except Exception as e:
            logger.error(f"Error fetching labels: {e}")
        return []

    # --- Core Pipeline Steps ---

    async def _load_and_chunk(self, doc_path: DocPath) -> List[str]:
        path = doc_path.path
        if path.endswith(".pdf") and CONTENT_EXTRACTION_METHOD == "docling":
            content = await docling_document_loader(path)
        else:
            content = await document_loader(path)

        if not content:
            return []

        if path.endswith(".html"):
            text_splitter = HTMLHeaderTextSplitter(headers_to_split_on=[("h1", "H1"), ("h2", "H2")])
        else:
            text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=doc_path.chunk_size,
                chunk_overlap=doc_path.chunk_overlap,
                add_start_index=True,
                separators=get_separators(),
            )

        if isinstance(content, list): 
            raw_chunks = []
            for item in content:
                item_str = str(item)
                if len(item_str) > doc_path.chunk_size:
                    raw_chunks.extend(text_splitter.split_text(item_str))
                else:
                    raw_chunks.append(item_str)
            plain_chunks = raw_chunks
        else:
            docs = text_splitter.create_documents([content])
            plain_chunks = [d.page_content for d in docs]

        # Spec: Validate content validity
        valid_chunks = [c for c in plain_chunks if is_valid_content(c)]
        
        if not valid_chunks:
            return []
            
        return valid_chunks

    async def _run_guardrail(self, plain_chunks: List[str]) -> Dict[str, Any]:
        if not GUARDRAIL_ENABLED:
            return {"success": True}

        async with aiohttp.ClientSession() as session:
            for i, text in enumerate(plain_chunks):
                try:
                    async with session.post(GUARDRAIL_URL, json={"text": text}) as resp:
                        if resp.status != 200:
                            return {"success": False, "message": f"Guardrail error chunk {i}"}
                        
                        result = await resp.json()
                        if result.get("text") != text:
                            return {
                                "success": False, 
                                "message": f"Chunk {i}: Blocked by guardrail.", 
                                "chunk_index": i
                            }
                except Exception as e:
                    return {"success": False, "message": f"Guardrail connection failed: {e}"}

        return {"success": True}

    # --- Labeling Strategies (Spec 5.3, 5.4) ---

    async def _label_with_llm(self, chunks: List[str], all_labels: List[str], file_id: str):
        """Labels chunks using VLLM with Retry Logic (Spec 5.3)."""
        client = AsyncOpenAI(api_key=os.getenv("VLLM_API_KEY", "EMPTY"), base_url=f"{os.getenv('VLLM_ENDPOINT')}/v1")
        model = os.getenv("VLLM_MODEL_ID")
        
        results = []
        for i, text in enumerate(chunks):
            retries = 0
            labels = []
            while retries < 3:
                try:
                    response = await client.chat.completions.create(
                        model=model,
                        messages=[
                            {"role": "system", "content": LABEL_SELECTOR_SYSTEM_PROMPT},
                            {"role": "user", "content": f"Input: {text}\nLabels: {all_labels}"}
                        ]
                    )
                    parsed = json.loads(response.choices[0].message.content)
                    labels = [l for l in parsed.get("labels", []) if l in all_labels]
                    break 
                except Exception as e:
                    retries += 1
            
            if retries == 3:
                await self._write_ingestion_log(file_id, "WARN", "Labeling", f"Chunk {i}: LLM failed to provide valid labels after 3 attempts.")
                labels = [] # Fallback to empty

            results.append({"text": text, "labels": labels})
        return results

    async def _label_with_embedding(self, chunks: List[str], all_labels: List[str]):
        """Spec 5.4: Cosine Similarity Labeling."""
        if not self.embeddings: 
            self._initialize_embeddings()
            
        # Cache label embeddings
        label_vecs = self.embeddings.embed_documents(all_labels)
        results = []
        
        for text in chunks:
            chunk_vec = self.embeddings.embed_query(text)
            selected = []
            for i, l_vec in enumerate(label_vecs):
                # Calculate Cosine Similarity
                sim = dot(l_vec, chunk_vec) / (norm(l_vec) * norm(chunk_vec))
                if sim >= EMBEDDING_LABEL_THRESHOLD:
                    selected.append(all_labels[i])
            results.append({"text": text, "labels": selected})
        return results

    async def _label_with_bm25(self, chunks: List[str], all_labels: List[str]):
        """Spec 5.4: BM25 Labeling."""
        # Simple whitespace tokenization
        tokenized_labels = [re.findall(r"\b\w+\b", l.lower()) for l in all_labels]
        bm25 = BM25Okapi(tokenized_labels)
        results = []
        
        for text in chunks:
            tokens = re.findall(r"\b\w+\b", text.lower())
            scores = bm25.get_scores(tokens)
            selected = [all_labels[i] for i, s in enumerate(scores) if s >= BM25_LABEL_THRESHOLD]
            results.append({"text": text, "labels": selected})
        return results

    async def _apply_labels(self, plain_chunks: List[str], all_labels: List[str], file_id: str):
        if not all_labels:
            await self._write_ingestion_log(file_id, "WARN", "Labeling", "No labels provided in Knowledge Hierarchy. Skipping labeling.")
            return [{"text": c, "labels": []} for c in plain_chunks]

        logger.info(f"Labeling using strategy: {LABELING_STRATEGY}")
        
        if LABELING_STRATEGY == "embedding":
            return await self._label_with_embedding(plain_chunks, all_labels)
        elif LABELING_STRATEGY == "bm25":
            return await self._label_with_bm25(plain_chunks, all_labels)
        else:
            # Default to LLM (with retry fix)
            return await self._label_with_llm(plain_chunks, all_labels, file_id)

    # --- Main Ingestion Logic (Async + Batched) ---

    async def ingest_file_with_guardrail(self, input: ArangoDBDataprepRequestFromDocRepo):
        # 1. Update Status to Ingesting (Spec 5.1)
        await self._update_doc_status(input.file_id, "Ingesting")
        await self._write_ingestion_log(input.file_id, "INFO", "System", "Ingestion task started.")
        
        try:
            # 2. Fetch Labels
            all_labels = await self._fetch_all_labels()
            
            # 3. Init LLM
            self._initialize_llm(
                allowed_node_types=getattr(input, "allowed_node_types", []),
                allowed_edge_types=getattr(input, "allowed_edge_types", []),
                node_properties=getattr(input, "node_properties", ["description"]),
                edge_properties=getattr(input, "edge_properties", ["description"]),
            )

            # 4. Load & Chunk
            doc_path = DocPath(
                path=input.file_path,
                chunk_size=input.chunk_size,
                chunk_overlap=input.chunk_overlap,
                process_table=input.process_table,
                table_strategy=input.table_strategy,
            )
            
            chunks = await self._load_and_chunk(doc_path)
            if not chunks:
                raise Exception("No valid content extracted from file.")

            await self._write_ingestion_log(input.file_id, "INFO", "Chunking", f"Generated {len(chunks)} chunks.")

            # 5. Guardrails
            gr_result = await self._run_guardrail(chunks)
            if not gr_result["success"]:
                await self._write_ingestion_log(input.file_id, "ERROR", "Guardrail", gr_result["message"])
                raise Exception("Guardrail Violation")

            # 6. Labeling
            labelled_docs = await self._apply_labels(chunks, all_labels, input.file_id)

            # 7. Graph Insertion (BATCHED)
            graph_name = getattr(input, "graph_name", os.getenv("ARANGO_GRAPH_NAME", "GRAPH_TEST"))
            
            documents_to_process = []
            for i, doc in enumerate(labelled_docs):
                documents_to_process.append(Document(
                    page_content=doc["text"],
                    metadata={
                        "file_id": input.file_id,
                        "file_path": input.storage_path,
                        "chunk_index": i,
                        "chunk_labels": doc["labels"]
                    }
                ))

            BATCH_SIZE = 10 
            total_batches = (len(documents_to_process) + BATCH_SIZE - 1) // BATCH_SIZE
            
            graph = ArangoGraph(db=self.db, generate_schema_on_init=False)
            
            for i in range(0, len(documents_to_process), BATCH_SIZE):
                batch_docs = documents_to_process[i : i + BATCH_SIZE]
                current_batch_num = (i // BATCH_SIZE) + 1
                
                await self._write_ingestion_log(input.file_id, "INFO", "Graph", f"Processing Batch {current_batch_num}/{total_batches}...")
                
                graph_docs = self.llm_transformer.convert_to_graph_documents(batch_docs)
                
                if graph_docs:
                    graph.add_graph_documents(
                        graph_documents=graph_docs,
                        include_source=getattr(input, "include_chunks", True),
                        graph_name=graph_name,
                        use_one_entity_collection=True,
                        embeddings=self.embeddings,
                        embedding_field="embedding",
                        embed_source=getattr(input, "embed_chunks", True),
                        embed_nodes=getattr(input, "embed_nodes", True),
                        embed_relationships=getattr(input, "embed_edges", True),
                        capitalization_strategy=getattr(input, "text_capitalization_strategy", "upper")
                    )

            # 8. Success Status (Spec 5.1/5.5)
            await self._update_doc_status(input.file_id, "Ingested", chunk_count=len(chunks))
            await self._write_ingestion_log(input.file_id, "INFO", "System", "Ingestion completed successfully.")

            return {
                "status": 200, 
                "message": f"Successfully ingested {len(chunks)} chunks.",
                "graph_name": graph_name
            }
            
        except Exception as e:
            # Spec 5.5: Error Handling & Auto-Retraction
            error_msg = f"Ingestion failed: {str(e)}"
            logger.error(error_msg)
            await self._write_ingestion_log(input.file_id, "ERROR", "System", f"{error_msg}. Rolling back.")
            await self._update_doc_status(input.file_id, "Ingestion Error")
            
            await self.retract_file(file_id=input.file_id, graph_name=getattr(input, "graph_name", "GRAPH_TEST"))
            await self._write_ingestion_log(input.file_id, "INFO", "System", "Rollback complete. Document retracted.")
            
            # Raise exception to ensure the microservice wrapper knows it failed
            raise HTTPException(status_code=500, detail=error_msg)

    async def retract_file(self, file_id: str, graph_name: str):
        """
        Retracts a file and performs a clean graph cascade deletion.
        1. Identifies Source Chunks for the file.
        2. Identifies 'Orphan' Entities (entities linked ONLY to this file).
        3. Preserves 'Shared' Entities (entities linked to this file AND others).
        4. Deletes Chunks, Orphans, and all associated Edges.
        """
        logger.info(f"Retracting file {file_id} from {graph_name} with cascading graph cleanup.")
        
        # Define collection names based on the graph naming convention
        col_source = f"{graph_name}_SOURCE"
        col_entity = f"{graph_name}_ENTITY"
        col_has_source = f"{graph_name}_HAS_SOURCE"
        col_links_to = f"{graph_name}_LINKS_TO"

        # AQL Query to perform safe, cascading deletion
        # This ensures we don't delete entities used by OTHER files.
        aql_cascade_delete = f"""
        // 1. Find all Source Chunks belonging to this file
        LET chunks_to_delete = (
            FOR doc IN @@col_source
            FILTER doc.file_id == @file_id OR doc.metadata.file_id == @file_id
            RETURN doc._id
        )

        // 2. Find HAS_SOURCE edges connecting Entities to these Chunks
        LET source_edges_to_delete = (
            FOR edge IN @@col_has_source
            FILTER edge._to IN chunks_to_delete
            RETURN edge
        )

        // 3. Identify Entities referenced by these edges
        LET referenced_entities = (
            FOR edge IN source_edges_to_delete
            RETURN DISTINCT edge._from
        )

        // 4. Distinguish Orphans vs. Shared Entities
        // An orphan is an entity that has NO other edges pointing to non-deleted chunks
        LET true_orphan_entities = (
            FOR entity_id IN referenced_entities
                // Check if this entity links to ANY chunk that is NOT in our delete list
                LET other_links = (
                    FOR edge IN @@col_has_source
                    FILTER edge._from == entity_id
                    AND edge._to NOT IN chunks_to_delete
                    LIMIT 1
                    RETURN 1
                )
                // If no other links exist, it is safe to delete this entity
                FILTER LENGTH(other_links) == 0
                RETURN entity_id
        )

        // 5. EXECUTE DELETIONS

        // A. Delete the HAS_SOURCE edges linking to our chunks
        FOR edge IN source_edges_to_delete
            REMOVE edge IN @@col_has_source

        // B. Delete LINKS_TO edges where the orphan is either source or target
        // (We only do this for orphans; shared entities keep their relationships)
        FOR entity_id IN true_orphan_entities
            FOR edge IN @@col_links_to
                FILTER edge._from == entity_id OR edge._to == entity_id
                REMOVE edge IN @@col_links_to

        // C. Delete the Orphan Entities themselves
        FOR entity_id IN true_orphan_entities
            REMOVE entity_id IN @@col_entity

        // D. Delete the Source Chunks
        FOR chunk_id IN chunks_to_delete
            REMOVE chunk_id IN @@col_source

        // Return stats
        RETURN {{
            deleted_chunks: LENGTH(chunks_to_delete),
            deleted_entities: LENGTH(true_orphan_entities)
        }}
        """
        
        try:
            bind_vars = {
                "file_id": file_id,
                "@col_source": col_source,
                "@col_entity": col_entity,
                "@col_has_source": col_has_source,
                "@col_links_to": col_links_to
            }
            
            cursor = self.db.aql.execute(aql_cascade_delete, bind_vars=bind_vars)
            result = [doc for doc in cursor]
            
            # Spec 6.1: Update status to Retracted
            await self._update_doc_status(file_id, "Retracted")
            
            stats = result[0] if result else {"deleted_chunks": 0, "deleted_entities": 0}
            
            if stats["deleted_chunks"] == 0:
                logger.warning(f"Retraction run but no chunks found for {file_id}")
                return {"status": 404, "message": "No chunks found."}
                
            msg = f"Retracted. Deleted {stats['deleted_chunks']} chunks and {stats['deleted_entities']} graph entities."
            logger.info(msg)
            return {"status": 200, "message": msg, "details": stats}
            
        except AQLQueryExecuteError as e:
            if e.error_code == 1203:
                logger.warning(f"Graph Collection {graph_name} not found. Nothing to retract.")
                return {"status": 200, "message": "Graph not found, nothing to retract."}
            logger.error(f"AQL Cleanup Error: {e}")
            raise e