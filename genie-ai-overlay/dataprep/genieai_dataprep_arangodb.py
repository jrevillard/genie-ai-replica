# Copyright (C) 2025 International Telecommunication Union (ITU)
# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import json
import os
import re
import asyncio
import aiohttp
from typing import List, Optional, Union, Dict, Any

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
E2E_CPU_URL = os.getenv("E2E_CPU_URL", "http://91.203.132.51:3000")
GUARDRAIL_URL = os.getenv("GUARDRAIL_URL", "http://guardrail:9090/v1/guardrails")
GUARDRAIL_ENABLED = os.getenv("GUARDRAIL_ENABLED", "false").lower() == "true"
GET_AUTH_TOKEN_URL = os.getenv("GET_AUTH_TOKEN_URL", "http://http-service:6666/get-token")

# Labeling & Extraction Config
CONTENT_EXTRACTION_METHOD = os.getenv("CONTENT_EXTRACTION_METHOD", "opea") 
LABELING_STRATEGY = os.getenv("LABELING_STRATEGY", "llm") 
EMBEDDING_LABEL_THRESHOLD = float(os.getenv("EMBEDDING_LABEL_THRESHOLD", "0.75"))
BM25_LABEL_THRESHOLD = float(os.getenv("BM25_LABEL_THRESHOLD", "2.00"))

LABEL_SELECTOR_SYSTEM_PROMPT = """
<SYSTEM INSTRUCTIONS> 
Select the relevant labels from the provided list that best match the content of the input text. 
Use only the exact labels from the list. Return an empty list if none fit. 
Output must strictly follow the given JSON format. 
</SYSTEM INSTRUCTIONS>
"""

@OpeaComponentRegistry.register("GENIE_DATAPREP_ARANGODB")
class GenieArangoDataprep(OpeaArangoDataprep):
    """
    GENIE.AI Extension of OpeaArangoDataprep.
    Adds: Docling support, Semantic/LLM Labeling, Guardrails, and Batched Ingestion.
    """

    def __init__(self, name: str, description: str, config: dict = None):
        super().__init__(name, description, config)

    # --- Utilities ---

    async def _get_auth_token(self):
        """Retrieve admin token for internal service calls."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(GET_AUTH_TOKEN_URL) as response:
                    if response.status == 200:
                        data = await response.json()
                        return data.get("accessToken")
                    logger.error(f"Failed to get token. Status: {response.status}")
        except Exception as e:
            logger.error(f"Auth token request failed: {e}")
        return None

    async def _fetch_all_labels(self):
        """Fetch taxonomy from the Node Service."""
        token = await self._get_auth_token()
        if not token:
            return []

        url = f"{E2E_CPU_URL}/api/service-categories/categories"
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
        """Loads file (supporting Docling for PDFs) and chunks it."""
        path = doc_path.path
        
        # 1. Load Content
        if path.endswith(".pdf") and CONTENT_EXTRACTION_METHOD == "docling":
            content = await docling_document_loader(path)
        else:
            content = await document_loader(path)

        if not content:
            logger.error(f"File {path} is empty or unreadable.")
            return []

        # 2. Configure Splitter
        if path.endswith(".html"):
            text_splitter = HTMLHeaderTextSplitter(headers_to_split_on=[("h1", "H1"), ("h2", "H2")])
        else:
            text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=doc_path.chunk_size,
                chunk_overlap=doc_path.chunk_overlap,
                add_start_index=True,
                separators=get_separators(),
            )

        # 3. Split
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

        # 4. Filter Invalid Content
        valid_chunks = [c for c in plain_chunks if is_valid_content(c)]
        
        if not valid_chunks:
            return []
            
        ratio = len(valid_chunks) / len(plain_chunks)
        if ratio < 0.2:
            logger.error(f"High noise detected in {path} (valid ratio: {ratio:.2f}). Aborting.")
            return []

        return valid_chunks

    async def _run_guardrail(self, plain_chunks: List[str]) -> Dict[str, Any]:
        """Checks chunks against the Guardrail service."""
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
                                "message": "Harmful content detected", 
                                "chunk_index": i
                            }
                except Exception as e:
                    return {"success": False, "message": f"Guardrail connection failed: {e}"}

        return {"success": True}

    # --- Labeling Strategies ---

    async def _label_with_llm(self, chunks: List[str], all_labels: List[str]):
        """Labels chunks using VLLM/OpenAI."""
        client = AsyncOpenAI(api_key=os.getenv("VLLM_API_KEY", "EMPTY"), base_url=f"{os.getenv('VLLM_ENDPOINT')}/v1")
        model = os.getenv("VLLM_MODEL_ID")
        
        results = []
        for text in chunks:
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
                results.append({"text": text, "labels": labels})
            except Exception as e:
                logger.warning(f"LLM Labeling failed: {e}")
                results.append({"text": text, "labels": []})
        return results

    async def _label_with_embedding(self, chunks: List[str], all_labels: List[str]):
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
        tokenized_labels = [re.findall(r"\b\w+\b", l.lower()) for l in all_labels]
        bm25 = BM25Okapi(tokenized_labels)
        results = []
        for text in chunks:
            tokens = re.findall(r"\b\w+\b", text.lower())
            scores = bm25.get_scores(tokens)
            selected = [all_labels[i] for i, s in enumerate(scores) if s >= BM25_LABEL_THRESHOLD]
            results.append({"text": text, "labels": selected})
        return results

    async def _apply_labels(self, plain_chunks: List[str], all_labels: List[str]):
        if not all_labels:
            return [{"text": c, "labels": []} for c in plain_chunks]

        logger.info(f"Labeling {len(plain_chunks)} chunks using strategy: {LABELING_STRATEGY}")
        
        if LABELING_STRATEGY == "llm":
            return await self._label_with_llm(plain_chunks, all_labels)
        elif LABELING_STRATEGY == "embedding":
            return await self._label_with_embedding(plain_chunks, all_labels)
        elif LABELING_STRATEGY == "bm25":
            return await self._label_with_bm25(plain_chunks, all_labels)
        else:
            logger.warning(f"Unknown strategy {LABELING_STRATEGY}, skipping labels.")
            return [{"text": c, "labels": []} for c in plain_chunks]

    # --- Main Ingestion Logic (Batched) ---

    async def ingest_file_with_guardrail(self, input: ArangoDBDataprepRequestFromDocRepo):
        logger.info(f"Starting ingestion for file: {input.file_id}")
        
        # 1. Fetch Labels
        all_labels = await self._fetch_all_labels()
        
        # 2. Init LLM
        self._initialize_llm(
            allowed_node_types=getattr(input, "allowed_node_types", []),
            allowed_edge_types=getattr(input, "allowed_edge_types", []),
            node_properties=getattr(input, "node_properties", ["description"]),
            edge_properties=getattr(input, "edge_properties", ["description"]),
        )

        # 3. Load & Chunk
        doc_path = DocPath(
            path=input.file_path,
            chunk_size=input.chunk_size,
            chunk_overlap=input.chunk_overlap,
            process_table=input.process_table,
            table_strategy=input.table_strategy,
        )
        
        chunks = await self._load_and_chunk(doc_path)
        if not chunks:
            raise HTTPException(status_code=400, detail="No valid content extracted.")

        logger.info(f"Generated {len(chunks)} chunks from file {input.file_id}")

        # 4. Guardrails
        gr_result = await self._run_guardrail(chunks)
        if not gr_result["success"]:
            return gr_result

        # 5. Labeling
        labelled_docs = await self._apply_labels(chunks, all_labels)

        # 6. Graph Insertion (BATCHED)
        graph_name = getattr(input, "graph_name", os.getenv("ARANGO_GRAPH_NAME", "GRAPH_TEST"))
        
        # Build Document list
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

        # --- BATCHING LOGIC ---
        BATCH_SIZE = 10 
        total_batches = (len(documents_to_process) + BATCH_SIZE - 1) // BATCH_SIZE
        current_batch_num = 0

        try:
            graph = ArangoGraph(db=self.db, generate_schema_on_init=False)
            
            for i in range(0, len(documents_to_process), BATCH_SIZE):
                batch_docs = documents_to_process[i : i + BATCH_SIZE]
                current_batch_num = (i // BATCH_SIZE) + 1
                
                logger.info(f"Processing Batch {current_batch_num}/{total_batches} ({len(batch_docs)} chunks)...")
                
                # A. Convert Batch to Graph
                graph_docs = self.llm_transformer.convert_to_graph_documents(batch_docs)
                
                # B. Write Batch to DB
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
                        # --- CRITICAL FIX: Pass capitalization strategy explicitly ---
                        capitalization_strategy=getattr(input, "text_capitalization_strategy", "upper")
                    )
                
                logger.info(f"Batch {current_batch_num} written to DB.")

            return {
                "status": 200, 
                "message": f"Successfully ingested {len(chunks)} chunks in {total_batches} batches.",
                "graph_name": graph_name
            }
            
        except Exception as e:
            logger.error(f"Graph insertion failed at batch {current_batch_num}: {e}")
            await self.retract_file(file_id=input.file_id, graph_name=graph_name)
            raise HTTPException(status_code=500, detail=f"Ingestion failed: {e}")

    async def retract_file(self, file_id: str, graph_name: str):
        """Retracts all data associated with a specific file ID."""
        logger.info(f"Retracting file {file_id} from {graph_name}")
        
        aql_delete_source = f"""
        FOR s IN {graph_name}_SOURCE
            FILTER s.file_id == @file_id
            REMOVE s IN {graph_name}_SOURCE
            RETURN OLD._id
        """
        
        try:
            cursor = self.db.aql.execute(aql_delete_source, bind_vars={"file_id": file_id})
            deleted_chunks = [doc for doc in cursor]
            if not deleted_chunks:
                return {"status": 404, "message": "No chunks found."}
            return {"status": 200, "message": "Retracted.", "deleted_count": len(deleted_chunks)}
            
        except AQLQueryExecuteError as e:
            # Handle case where graph/collection doesn't exist
            if e.error_code == 1203:
                logger.warning(f"Graph/Collection {graph_name}_SOURCE not found. Nothing to retract.")
                return {"status": 200, "message": "Graph not found, nothing to retract."}
            raise e