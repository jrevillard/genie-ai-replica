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
# 1. Document Repository: Handles Logs and Status Updates
DOCUMENT_REPOSITORY_URL = os.getenv("DOCUMENT_REPOSITORY_URL", "http://document-repository:3001")
# 2. Backend Service: Source of Truth for Label Hierarchy
BACKEND_SERVICE_URL = os.getenv("BACKEND_SERVICE_URL", "http://backend:3000")
# 3. HTTP Service: Authentication Token Broker
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
You are a precise semantic labeler for a RAG knowledge graph.
Goal: Assign 1–4 MOST RELEVANT labels from the list below that best match the chunk content.
Rules:
- Return ONLY labels that are strongly relevant.
- Most chunks get 1–3 labels. Never exceed 5.
- Do NOT "maximize" coverage.
- Do NOT suggest new labels.
- If nothing fits well → return empty list.
- Use ONLY exact strings from the list.

Labels:
{labels_list}

Output strict JSON only:
{"labels": ["Label1", "Label2"]}
</SYSTEM INSTRUCTIONS>
""".strip())

@OpeaComponentRegistry.register("GENIE_DATAPREP_ARANGODB")
class GenieArangoDataprep(OpeaArangoDataprep):
    """
    GENIE.AI Extension of OpeaArangoDataprep.
    Adds: Docling, Multi-Strategy Labeling, Guardrails, Batched Ingestion, and Repo Callbacks.
    """

    def __init__(self, name: str, description: str, config: dict = None):
        super().__init__(name, description, config)
        # Token is fetched dynamically via _get_auth_token
        # Debug Requirement 2: Print environment at startup
        self._log_environment_variables()

    def _log_environment_variables(self):
        """Debug: Print all critical environment variables at startup."""
        print("\n" + "="*60)
        print(f" GENIE-AI DATAPREP CONFIGURATION ")
        print("="*60)
        print(f" DOCUMENT_REPO_URL    : {DOCUMENT_REPOSITORY_URL}")
        print(f" BACKEND_SERVICE_URL  : {BACKEND_SERVICE_URL}")
        print(f" AUTH_TOKEN_URL       : {GET_AUTH_TOKEN_URL}")
        print(f" GUARDRAIL_ENABLED    : {GUARDRAIL_ENABLED} ({GUARDRAIL_URL})")
        print("-" * 60)
        print(f" LABELING_STRATEGY    : {LABELING_STRATEGY}")
        print(f" EMBEDDING_THRESHOLD  : {EMBEDDING_LABEL_THRESHOLD}")
        print(f" BM25_THRESHOLD       : {BM25_LABEL_THRESHOLD}")
        print(f" EXTRACTION_METHOD    : {CONTENT_EXTRACTION_METHOD}")
        print(f" LLM_ENDPOINT         : {os.getenv('VLLM_ENDPOINT')}")
        print(f" ARANGO_DB            : {os.getenv('ARANGO_DB_NAME')}")
        print(f" SYSTEM PROMPT LEN    : {len(LABEL_SELECTOR_SYSTEM_PROMPT)} chars")
        print("="*60 + "\n")

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
        
        # FIX: chunk_count must be at the ROOT level, not inside dataprep object
        payload = {
            "dataprep": {"status": status}
        }
        if chunk_count is not None:
            payload["chunk_count"] = chunk_count

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
            "level": level, # Sent exactly as passed (INFO, WARN, ERROR)
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
        """Fetch full taxonomy from the Backend Service to guide the LLM."""
        token = await self._get_auth_token()
        if not token:
            logger.warning("Skipping label fetch due to missing auth token.")
            return []

        # FIX: Target the Backend Service for the hierarchy
        url = f"{BACKEND_SERVICE_URL}/api/service-categories/categories"
        headers = {"Authorization": f"Bearer {token}"}
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers) as response:
                    if response.status == 200:
                        data = await response.json()
                        labels = []
                        # Backend returns a tree structure (Category -> Children)
                        if isinstance(data, list):
                            for category in data:
                                # Add the Category Name
                                if isinstance(category, dict) and 'name' in category:
                                    labels.append(category['name'])
                                    # Add all Children (Services)
                                    if 'children' in category and isinstance(category['children'], list):
                                        for child in category['children']:
                                            # Children might be strings or objects depending on query
                                            if isinstance(child, dict) and 'name' in child:
                                                labels.append(child['name'])
                                            elif isinstance(child, str):
                                                labels.append(child)
                        
                        logger.info(f"Fetched {len(labels)} labels from Backend taxonomy.")
                        return list(set(labels))
                    
                    logger.error(f"Label fetch failed. Status: {response.status}, Body: {await response.text()}")
        except Exception as e:
            logger.error(f"Error fetching labels from Backend: {e}")
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

        valid_chunks = [c for c in plain_chunks if is_valid_content(c)]
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

    async def _label_with_llm(self, chunks: List[str], all_labels: List[str], file_labels: List[str], file_id: str):
        """Labels chunks using VLLM with Retry Logic and Advisory Warnings (Spec 5.3)."""
        client = AsyncOpenAI(api_key=os.getenv("VLLM_API_KEY", "EMPTY"), base_url=f"{os.getenv('VLLM_ENDPOINT')}/v1")
        model = os.getenv("VLLM_MODEL_ID")
        
        # Debug Requirement 3: Print what is sent to LLM
        print("\n" + "-"*60)
        print(f" DEBUG: LLM LABELING INPUTS ")
        print("-"*60)
        print(f" Taxonomy ({len(all_labels)} labels): {all_labels}") # Print ALL labels
        print(f" File Metadata Labels: {file_labels}")
        print(f" System Prompt: {LABEL_SELECTOR_SYSTEM_PROMPT}")
        print("-"*60 + "\n")
        
        results = []
        for i, text in enumerate(chunks):
            retries = 0
            suggested_labels = []
            
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
                    suggested_labels = parsed.get("labels", [])
                    break 
                except Exception as e:
                    retries += 1
            
            if retries == 3:
                await self._write_ingestion_log(file_id, "WARN", "Labeling", f"Chunk {i}: LLM failed to provide valid labels after 3 attempts.")
                suggested_labels = []

            # --- Logic: Merge File Labels + Suggestions & Generate Warnings ---
            
            # 1. Base: Always include the file's assigned labels
            final_labels = set(file_labels) if file_labels else set()
            
            # 2. Analyze Suggestions with Synonym Matching (Requirement 1 fix)
            for label in suggested_labels:
                if label in final_labels:
                    continue 
                
                # Exact Match
                if label in all_labels:
                    final_labels.add(label)
                    await self._write_ingestion_log(file_id, "WARN", "Labeling", 
                        f"Chunk {i}: LLM suggested existing label '{label}' (not in file metadata). Added to chunk.")
                else:
                    # Fuzzy/Synonym Match Check (Solves 'Safaris' vs 'Safari')
                    # Check case-insensitive and simple plural s/es
                    match = next((x for x in all_labels if x.lower() == label.lower()), None)
                    if not match and label.endswith('s'):
                        match = next((x for x in all_labels if x.lower() == label[:-1].lower()), None)
                    if not match:
                         match = next((x for x in all_labels if x.lower() == label.lower() + 's'), None)

                    if match:
                        # It's a synonym for an existing label! Use the existing one.
                        final_labels.add(match)
                        await self._write_ingestion_log(file_id, "INFO", "Labeling", 
                            f"Chunk {i}: LLM suggested '{label}' -> Mapped to existing '{match}'.")
                    else:
                        # Truly new
                        await self._write_ingestion_log(file_id, "WARN", "Labeling", 
                            f"Chunk {i}: LLM suggested NEW label '{label}'. Consider adding it to the Knowledge Hierarchy.")
            
            # Requirement 4: Human readable log for every chunk
            labels_list = list(final_labels)
            if labels_list:
                await self._write_ingestion_log(file_id, "INFO", "Labeling", f"Chunk {i}: Final Labels: {labels_list}")

            results.append({"text": text, "labels": labels_list})
        return results

    async def _label_with_embedding(self, chunks: List[str], all_labels: List[str]):
        """Spec 5.4: Cosine Similarity Labeling."""
        if not self.embeddings: 
            self._initialize_embeddings()
            
        label_vecs = self.embeddings.embed_documents(all_labels)
        results = []
        for text in chunks:
            chunk_vec = self.embeddings.embed_query(text)
            selected = []
            for i, l_vec in enumerate(label_vecs):
                sim = dot(l_vec, chunk_vec) / (norm(l_vec) * norm(chunk_vec))
                if sim >= EMBEDDING_LABEL_THRESHOLD:
                    selected.append(all_labels[i])
            results.append({"text": text, "labels": selected})
        return results

    async def _label_with_bm25(self, chunks: List[str], all_labels: List[str]):
        """Spec 5.4: BM25 Labeling."""
        tokenized_labels = [re.findall(r"\b\w+\b", l.lower()) for l in all_labels]
        bm25 = BM25Okapi(tokenized_labels)
        results = []
        for text in chunks:
            tokens = re.findall(r"\b\w+\b", text.lower())
            scores = bm25.get_scores(tokens)
            selected = [all_labels[i] for i, s in enumerate(scores) if s >= BM25_LABEL_THRESHOLD]
            results.append({"text": text, "labels": selected})
        return results

    async def _apply_labels(self, plain_chunks: List[str], all_labels: List[str], file_labels: List[str], file_id: str):
        if not all_labels:
            await self._write_ingestion_log(file_id, "WARN", "Labeling", "No labels found in Taxonomy. Using only file labels.")
            return [{"text": c, "labels": file_labels if file_labels else []} for c in plain_chunks]

        logger.info(f"Labeling using strategy: {LABELING_STRATEGY}")
        
        if LABELING_STRATEGY == "embedding":
            return await self._label_with_embedding(plain_chunks, all_labels)
        elif LABELING_STRATEGY == "bm25":
            return await self._label_with_bm25(plain_chunks, all_labels)
        else:
            # Default to LLM (with retry fix and advisory logic)
            return await self._label_with_llm(plain_chunks, all_labels, file_labels, file_id)

    # --- Main Ingestion Logic (Async + Batched) ---

    async def ingest_file_with_guardrail(self, input: ArangoDBDataprepRequestFromDocRepo):
        await self._update_doc_status(input.file_id, "Ingesting")
        await self._write_ingestion_log(input.file_id, "INFO", "System", "Ingestion task started.")
        
        try:
            # 1. Fetch Taxonomy (FROM BACKEND)
            all_labels = await self._fetch_all_labels()
            
            self._initialize_llm(
                allowed_node_types=getattr(input, "allowed_node_types", []),
                allowed_edge_types=getattr(input, "allowed_edge_types", []),
                node_properties=getattr(input, "node_properties", ["description"]),
                edge_properties=getattr(input, "edge_properties", ["description"]),
            )

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

            gr_result = await self._run_guardrail(chunks)
            if not gr_result["success"]:
                await self._write_ingestion_log(input.file_id, "ERROR", "Guardrail", gr_result["message"])
                raise Exception("Guardrail Violation")

            # 5. Labeling
            file_labels = getattr(input, "file_labels", [])
            labelled_docs = await self._apply_labels(chunks, all_labels, file_labels, input.file_id)

            # 6. Graph Insertion (BATCHED)
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

            await self._update_doc_status(input.file_id, "Ingested", chunk_count=len(chunks))
            await self._write_ingestion_log(input.file_id, "INFO", "System", "Ingestion completed successfully.")

            return {
                "status": 200, 
                "message": f"Successfully ingested {len(chunks)} chunks.",
                "graph_name": graph_name
            }
            
        except Exception as e:
            error_msg = f"Ingestion failed: {str(e)}"
            logger.error(error_msg)
            await self._write_ingestion_log(input.file_id, "ERROR", "System", f"{error_msg}. Rolling back.")
            await self._update_doc_status(input.file_id, "Ingestion Error")
            
            await self.retract_file(file_id=input.file_id, graph_name=getattr(input, "graph_name", "GRAPH_TEST"))
            await self._write_ingestion_log(input.file_id, "INFO", "System", "Rollback complete. Document retracted.")
            
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
        
        col_source = f"{graph_name}_SOURCE"
        col_entity = f"{graph_name}_ENTITY"
        col_has_source = f"{graph_name}_HAS_SOURCE"
        col_links_to = f"{graph_name}_LINKS_TO"

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
        LET true_orphan_entities = (
            FOR entity_id IN referenced_entities
                LET other_links = (
                    FOR edge IN @@col_has_source
                    FILTER edge._from == entity_id
                    AND edge._to NOT IN chunks_to_delete
                    LIMIT 1
                    RETURN 1
                )
                FILTER LENGTH(other_links) == 0
                RETURN entity_id
        )

        // 5. EXECUTE DELETIONS
        FOR edge IN source_edges_to_delete
            REMOVE edge IN @@col_has_source

        FOR entity_id IN true_orphan_entities
            FOR edge IN @@col_links_to
                FILTER edge._from == entity_id OR edge._to == entity_id
                REMOVE edge IN @@col_links_to

        FOR entity_id IN true_orphan_entities
            REMOVE entity_id IN @@col_entity

        FOR chunk_id IN chunks_to_delete
            REMOVE chunk_id IN @@col_source

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