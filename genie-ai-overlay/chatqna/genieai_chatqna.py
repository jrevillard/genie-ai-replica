# Copyright (C) 2024 Intel Corporation
# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0 Developed by Intel. Adapted by ITU

import argparse
import asyncio
import copy
import json
import os
import re
import time
from datetime import date, datetime

from metrics import (
    chat_rag_duration_seconds,
    chat_requests_total,
    sanitize_attributes,
)

from tracing import get_tracer, setup_trace_logging, setup_tracing

setup_tracing("genieai-chatqna")

import aiohttp  # for async http requests
import httpx
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

HTTPXClientInstrumentor().instrument()

from comps import CustomLogger, MegaServiceEndpoint, MicroService, ServiceOrchestrator, ServiceRoleType, ServiceType
from comps.cores.proto.docarray import LLMParams, RerankerParms, RetrieverParms
from comps.cores.proto.genieai_api_protocol import (
    ChatCompletionRequest,
)
from fastapi import Request
from fastapi.responses import StreamingResponse
from langdetect import detect
from transformers import AutoTokenizer

logger = CustomLogger("GENIE.AI_CHATQNA")
setup_trace_logging("GENIE.AI_CHATQNA")
logflag = os.getenv("LOGFLAG", True)


MEGA_SERVICE_PORT = int(os.getenv("MEGA_SERVICE_PORT", 8888))
GUARDRAIL_SERVICE_HOST_IP = os.getenv("GUARDRAIL_SERVICE_HOST_IP", "0.0.0.0")
GUARDRAIL_SERVICE_PORT = int(os.getenv("GUARDRAIL_SERVICE_PORT", 80))
TRANSLATION_SERVICE_HOST_IP = os.getenv("TRANSLATION_SERVICE_HOST_IP", "0.0.0.0")
TRANSLATION_SERVICE_PORT = int(os.getenv("TRANSLATION_SERVICE_PORT", 80))
TRANSLATION_SERVICE_TIMEOUT = int(
    os.getenv("TRANSLATION_SERVICE_TIMEOUT", 180)
)  # Timeout in seconds for translation service (default: 3 minutes)
TRANSLATION_MODEL_ID = os.getenv("VLLM_TRANSLATION_MODEL_ID", "")
IS_TRANSLATEGEMMA = "translategemma" in TRANSLATION_MODEL_ID.lower()
# Connect directly to vLLM for translation when VLLM_TRANSLATION_ENDPOINT is set,
# bypassing the OPEA translation microservice which reformats payloads and breaks
# TranslateGemma's structured chat template. Falls back to OPEA proxy if not set.
_VLLM_TRANSLATION_ENDPOINT = os.getenv("VLLM_TRANSLATION_ENDPOINT", "")
if _VLLM_TRANSLATION_ENDPOINT:
    TRANSLATION_LLM_URL = f"{_VLLM_TRANSLATION_ENDPOINT}/v1/chat/completions"
    TRANSLATION_COMPLETIONS_URL = f"{_VLLM_TRANSLATION_ENDPOINT}/v1/completions"
else:
    TRANSLATION_LLM_URL = f"http://{TRANSLATION_SERVICE_HOST_IP}:{TRANSLATION_SERVICE_PORT}/v1/chat/completions"
    TRANSLATION_COMPLETIONS_URL = f"http://{TRANSLATION_SERVICE_HOST_IP}:{TRANSLATION_SERVICE_PORT}/v1/completions"
EMBEDDING_SERVER_HOST_IP = os.getenv("EMBEDDING_SERVER_HOST_IP", "0.0.0.0")
EMBEDDING_SERVER_PORT = int(os.getenv("EMBEDDING_SERVER_PORT", 80))
EMBEDDING_SERVER_ENDPOINT = os.getenv("EMBEDDING_SERVER_ENDPOINT", "/v1/embeddings")
RETRIEVER_SERVICE_HOST_IP = os.getenv("RETRIEVER_SERVICE_HOST_IP", "0.0.0.0")
RETRIEVER_SERVICE_PORT = int(os.getenv("RETRIEVER_SERVICE_PORT", 7025))
RERANK_SERVER_HOST_IP = os.getenv("RERANK_SERVER_HOST_IP", "0.0.0.0")
RERANK_SERVER_PORT = int(os.getenv("RERANK_SERVER_PORT", 80))
LLM_SERVER_HOST_IP = os.getenv("LLM_SERVER_HOST_IP", "0.0.0.0")
LLM_SERVER_PORT = int(os.getenv("LLM_SERVER_PORT", 80))
LLM_SERVER_PROTOCOL = "http"
# When VLLM_LLM_ENDPOINT is set (e.g. https://gpu-host/llm for remote GPU node),
# override host/port/protocol so MicroService constructs the correct URL.
_VLLM_LLM_ENDPOINT = os.getenv("VLLM_LLM_ENDPOINT", "")
if _VLLM_LLM_ENDPOINT:
    from urllib.parse import urlparse

    _parsed = urlparse(_VLLM_LLM_ENDPOINT)
    LLM_SERVER_HOST_IP = _parsed.hostname or LLM_SERVER_HOST_IP
    LLM_SERVER_PORT = _parsed.port or 443
    LLM_SERVER_PROTOCOL = _parsed.scheme or "https"
    LLM_SERVER_ENDPOINT_PREFIX = _parsed.path.rstrip("/") or ""
else:
    LLM_SERVER_ENDPOINT_PREFIX = ""
LLM_MODEL = os.getenv("LLM_MODEL", "ibm-granite/granite-3.3-2b-instruct")
LLM_TRANS_MODEL = os.getenv("LLM_TRANS_MODEL", "google/gemma-3-1b-it")


def _auto_detect_model(endpoint_url: str, env_var: str) -> str | None:
    """Auto-detect model ID from remote vLLM /v1/models endpoint."""
    import httpx

    try:
        headers = {}
        api_key = os.getenv("VLLM_API_KEY", "")
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        resp = httpx.get(f"{endpoint_url}/v1/models", headers=headers, timeout=10, verify=False)
        resp.raise_for_status()
        models = resp.json()
        if models.get("data"):
            return models["data"][0]["id"]
        logger.warning(f"Auto-detect {env_var}: no models in response")
    except Exception as e:
        logger.warning(f"Auto-detect {env_var} failed: {e}")
    return None


# Auto-detect LLM and translation models from remote vLLM when GPU_NODE_HOST is set
_GPU_NODE_HOST = os.getenv("GPU_NODE_HOST", "")
if _GPU_NODE_HOST:
    if _VLLM_LLM_ENDPOINT:
        detected = _auto_detect_model(_VLLM_LLM_ENDPOINT, "LLM_MODEL")
        if detected:
            LLM_MODEL = detected
            logger.info(f"Auto-detected LLM_MODEL={LLM_MODEL}")
    if _VLLM_TRANSLATION_ENDPOINT:
        detected = _auto_detect_model(_VLLM_TRANSLATION_ENDPOINT, "VLLM_TRANSLATION_MODEL_ID")
        if detected:
            TRANSLATION_MODEL_ID = detected
            LLM_TRANS_MODEL = detected
            logger.info(f"Auto-detected TRANSLATION_MODEL_ID={TRANSLATION_MODEL_ID}")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", None)

RETRIEVER_SEARCH_START = os.getenv("RETRIEVER_ARANGO_SEARCH_START", "chunk")  # node | edge | chunk
RETRIEVER_K = int(os.getenv("RETRIEVER_ARANGO_K", 4))
RETRIEVER_FETCH_K = int(os.getenv("RETRIEVER_ARANGO_FETCH_K", 20))
RETRIEVER_SCORE_THRESHOLD = float(os.getenv("RETRIEVER_ARANGO_SCORE_THRESHOLD", 0.1))
RETRIEVER_DISTANCE_THRESHOLD = int(os.getenv("RETRIEVER_ARANGO_DISTANCE_THRESHOLD", 1))
RETRIEVER_TRAVERSAL_ENABLED = os.getenv("RETRIEVER_ARANGO_TRAVERSAL_ENABLED", "false")
RETRIEVER_TRAVERSAL_MAX_DEPTH = int(os.getenv("RETRIEVER_ARANGO_TRAVERSAL_MAX_DEPTH", 2))
RETRIEVER_TRAVERSAL_MAX_RETURNED = int(os.getenv("RETRIEVER_ARANGO_TRAVERSAL_MAX_RETURNED", 3))
RETRIEVER_TRAVERSAL_SCORE_THRESHOLD = float(os.getenv("RETRIEVER_ARANGO_TRAVERSAL_SCORE_THRESHOLD", 0.5))
RETRIEVER_LAMBDA_MULT = float(os.getenv("RETRIEVER_ARANGO_LAMBDA_MULT", 0.5))

RERANKING_STRATEGY = os.getenv("RERANKING_STRATEGY", "threshold")  # slice | threshold | knee_threshold
RERANKER_TOP_N = int(os.getenv("RERANKER_TOP_N", 2))  # if RERANKING_STRATEGY set to 'slice'
RERANKING_THRESHOLD = float(os.getenv("RERANKING_THRESHOLD", 0.9))  # if RERANKING_STRATEGY set to 'threshold'

DOC_REPO_URL = os.getenv("DOC_REPO_URL", "http://localhost:3001")  # Document repository URL
BACKEND_SERVICE_URL = os.getenv("BACKEND_SERVICE_URL", "http://backend:3000")  # Backend service URL
LANGUAGE_CODES_FILEPATH = os.getenv("LANGUAGE_CODES_FILEPATH", "language_codes.json")
MAX_MODEL_LEN_TEXTGEN = int(os.getenv("MAX_MODEL_LEN_TEXTGEN", 4096))  # max token length for text generation models

MAX_TRANSLATION_CHARS = int(os.getenv("MAX_TRANSLATION_CHARS", 2000))  # max characters for translation models
USER_MSG_PATTERN = re.compile(r"USER:\s*(.*?)(?:\s*\|<-MSG->\||$)", re.DOTALL)

# Two-tier priority: ENV VAR (override) > Hardcoded default
_CHATQNA_SYSTEM_DEFAULT = """You are a friendly and polite information assistant.

Your task is to answer the user's latest question using only the content provided from the knowledge base.

**Instructions:**
- Do not invent or assume information
- If the answer is not in the provided content, inform the user that the information is unavailable
- Use the user's name, gender, age, preferences, and chat history to tailor and personalise your responses
- Keep answers informative but concise; provide detailed explanations
  only when necessary or explicitly requested

In line with the above instructions, generate a reply to the user's latest
message in the chat history based on the relevant content provided."""
CHATQNA_SYSTEM_PROMPT = os.getenv("CHATQNA_SYSTEM_PROMPT", "").strip() or _CHATQNA_SYSTEM_DEFAULT
CHATQNA_ENFORCE_ABSTENTION = os.getenv("CHATQNA_ENFORCE_ABSTENTION", "") or "true"
CHATQNA_ABSTENTION_INSTRUCTIONS = os.getenv("CHATQNA_ABSTENTION_INSTRUCTIONS", "").strip() or None
SENSITIVE_KEYS = set(os.getenv("SENSITIVE_KEYS", "").split(","))


##################################################################################################################################
# CUSTOM DATA SUBCLASSES
##################################################################################################################################
class GenieaiRetrieverParms(RetrieverParms):
    enable_traversal: str = RETRIEVER_TRAVERSAL_ENABLED
    traversal_max_depth: int = RETRIEVER_TRAVERSAL_MAX_DEPTH
    traversal_max_returned: int = RETRIEVER_TRAVERSAL_MAX_RETURNED
    traversal_score_threshold: float = RETRIEVER_TRAVERSAL_SCORE_THRESHOLD


class GenieaiRerankerParms(RerankerParms):
    reranking_strategy: str = RERANKING_STRATEGY
    reranking_threshold: float = RERANKING_THRESHOLD


##################################################################################################################################
# HELPER CLASSES
##################################################################################################################################
class ChatTemplate:
    @staticmethod
    def generate_rag_prompt(question, documents):
        context_str = "\n".join(documents)
        if context_str and len(re.findall("[\u4e00-\u9fff]", context_str)) / len(context_str) >= 0.3:
            # chinese context
            template = """
### 你将扮演一个乐于助人、尊重他人并诚实的助手，你的目标是帮助用户解答问题。
### 有效地利用来自本地知识库的搜索结果。确保你的回答中只包含相关信息。
### 如果你不确定问题的答案，请避免分享不准确的信息。
### 搜索结果：{context}
### 问题：{question}
### 回答：
"""
        else:
            template = """
### You are a helpful, respectful and honest assistant to help the user with questions. \
Please refer to the search results obtained from the local knowledge base. \
But be careful to not incorporate the information that you think is not relevant to the question. \
If you don't know the answer to a question, please don't share false information. \n
### Search results: {context} \n
### Question: {question} \n
### Answer:
"""
        return template.format(context=context_str, question=question)


class GenieUserProfileClient:
    """
    Client for fetching User Profile data from the Backend Service.
    Designed to be used within the ChatQnA orchestrator.

    Auth: Bearer token propagated from the backend (JWKS-validated).
    """

    def __init__(self):
        self._token = None
        logger.info(f"GenieUserProfileClient initialized. Backend: {BACKEND_SERVICE_URL}")

    def set_token(self, token: str):
        self._token = token

    async def get_user_profile(self):
        """
        Fetches the sanitized user profile from the backend for context enrichment.
        Target: GET /api/me/context
        Auth: Bearer token (propagated from backend via Authorization header)
        """
        if not self._token:
            logger.warning("No Bearer token available, skipping profile fetch")
            return None

        # Construct URL
        url = f"{BACKEND_SERVICE_URL}/api/me/context"

        headers = {"Authorization": f"Bearer {self._token}", "Content-Type": "application/json"}

        # Inject W3C traceparent for distributed tracing
        from opentelemetry.propagate import inject

        inject(headers)

        try:
            _timeout = aiohttp.ClientTimeout(total=30)
            async with (
                aiohttp.ClientSession(timeout=_timeout) as session,
                session.get(url, headers=headers) as response,
            ):
                if response.status == 200:
                    profile_data = await response.json()
                    logger.info("Successfully retrieved user profile")
                    return profile_data

                elif response.status == 401:
                    logger.error("Bearer token rejected (401). Check token propagation.")
                    return None

                elif response.status == 404:
                    logger.warning("User profile not found")
                    return None

                else:
                    logger.error(
                        f"Failed to fetch user profile. Status: {response.status}, Body: {await response.text()}"
                    )
                    return None

        except Exception as e:
            logger.error(f"Error connecting to Backend Service for profile: {e}")
            return None


class UserContextBuilder:
    def _sanitize_data(self, data):
        if isinstance(data, dict):
            try:
                keys_to_remove = [k for k in data if k in SENSITIVE_KEYS]
            except Exception:
                logger.info(
                    "Attention: SENSITIVE_KEYS parameter is not defined. "
                    "Proceeding with default information masking instructions"
                )
                sensitive_keys = [
                    "email",
                    "phoneNumber",
                    "currentAddress",
                    "ipAddress",
                    "ssn",
                    "ssb",
                    "dob",
                    "credit_card",
                    "password",
                    "encPassword",
                    "salt",
                    "location",
                    "accessToken",
                    "refreshToken",
                    "_rev",
                    "_key",
                ]
                keys_to_remove = [k for k in data if k in sensitive_keys]

            for k in keys_to_remove:
                del data[k]

            for v in data.values():
                self._sanitize_data(v)

        elif isinstance(data, list):
            for item in data:
                self._sanitize_data(item)

        return data

    def _parse_dob(self, dob_str):
        """
        Supports:
        - YYYY-MM-DD
        - YYYY.MM.DD
        """
        if not isinstance(dob_str, str):
            return None

        dob_str = dob_str.strip()

        for fmt in ("%Y-%m-%d", "%Y.%m.%d"):
            try:
                return datetime.strptime(dob_str, fmt).date()
            except ValueError:
                continue

        return None

    def _calculate_age(self, birth_date):
        if not birth_date:
            return "N/A"

        today = date.today()
        return today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))

    def _extract_primitive_fields(self, data, result=None):
        """
        Recursively extract primitive key/value pairs.
        If dict → recurse inside
        If list → extract primitives or recurse into dict items
        """
        accepted_value_types = (str, int, float, bool)

        if result is None:
            result = {}

        if isinstance(data, dict):
            for k, v in data.items():
                if isinstance(v, accepted_value_types):
                    result[k] = v

                elif isinstance(v, dict):
                    self._extract_primitive_fields(v, result)

                elif isinstance(v, list):
                    # If list of primitives → join into string
                    if all(isinstance(i, accepted_value_types) for i in v):
                        result[k] = ", ".join(map(str, v))
                    else:
                        for item in v:
                            self._extract_primitive_fields(item, result)

        elif isinstance(data, list):
            for item in data:
                self._extract_primitive_fields(item, result)

        return result

    def build_user_context_string(self, user_details):

        user_context_string = ""

        # Work on a copy (avoid mutating original payload)
        sanitized = self._sanitize_data(copy.deepcopy(user_details))

        # Extract primitives
        flat_fields = self._extract_primitive_fields(sanitized)

        # DoB > changed to age (less sensitive)
        age_value = None
        dob_keys = [k for k in flat_fields if k.lower() == "dob"]

        for dob_key in dob_keys:
            dob_raw = flat_fields.pop(dob_key)
            birth_date = self._parse_dob(dob_raw)
            age_value = self._calculate_age(birth_date)

        # Build output string
        lines = []

        for k, v in flat_fields.items():
            lines.append(f"- {k}: {v}")

        if age_value is not None:
            lines.append(f"- Age: {age_value}")

        if lines:
            user_context_string = "\n".join(lines) + "\n        ---\n"

        return user_context_string


##################################################################################################################################
# TOKENIZER
##################################################################################################################################
TOKENIZER = None


def get_tokenizer():
    global TOKENIZER
    if TOKENIZER is None:
        TOKENIZER = AutoTokenizer.from_pretrained(
            LLM_MODEL,
            use_fast=True,
            # local_files_only=True
        )
    return TOKENIZER


##################################################################################################################################
# CHATQNA ORCHESTRATOR FUNCTIONS
##################################################################################################################################
def align_inputs(self, inputs, cur_node, runtime_graph, llm_parameters_dict, **kwargs):

    if self.services[cur_node].service_type == ServiceType.TRANSLATOR:
        original_text = inputs["text"]
        original_language = kwargs.get("original_language", "auto")

        if original_language and original_language.strip().upper() == "EN":
            target_language = "English"
        else:
            target_language = original_language

        prompt = (
            f"Translate the following text to {target_language}. Only provide "
            f"the translation, with no additional commentary or explanations. "
            f'Text: "{original_text}"'
        )

        # Format the request for the LLM service
        next_inputs = {}
        next_inputs["messages"] = [{"role": "user", "content": prompt}]
        next_inputs["temperature"] = 0  # Use low temperature for deterministic translation
        next_inputs["max_tokens"] = llm_parameters_dict["max_tokens"]
        next_inputs["stream"] = False

        if logflag:
            logger.debug(f"Aligned input to the translator: {next_inputs}")

        return next_inputs

    elif self.services[cur_node].service_type == ServiceType.EMBEDDING:
        inputs["input"] = inputs["text"]
        del inputs["text"]

    elif self.services[cur_node].service_type == ServiceType.RETRIEVER:
        retriever_parameters = kwargs.get("retriever_parameters")
        if retriever_parameters:
            # inputs.update(retriever_parameters.model_dump())
            safe_params = retriever_parameters.model_dump(exclude_unset=True, exclude_none=True)
            inputs.update(safe_params)

        retrieval_context = kwargs.get("retrieval_context", {})
        if retrieval_context:
            inputs["context"] = retrieval_context

    elif self.services[cur_node].service_type == ServiceType.RERANK:
        reranker_parameters = kwargs.get("reranker_parameters")
        if reranker_parameters:
            inputs.update(reranker_parameters.model_dump())
        if logflag:
            logger.debug(f"Aligned input of the reranker: {inputs}")

    elif self.services[cur_node].service_type == ServiceType.LLM:
        # convert TGI/vLLM to unified OpenAI /v1/chat/completions format
        next_inputs = {}
        next_inputs["model"] = LLM_MODEL

        rag_augmented_prompt = inputs["inputs"]
        # Get the full translated history *string* from kwargs
        translated_history_string = kwargs.get("full_chat_history_string", "")

        user_details = kwargs.get("user_details", {})

        user_context_string = ""

        if user_details:
            builder = UserContextBuilder()
            user_context_string = builder.build_user_context_string(user_details)
            logger.info(f"\n[ DEBUG ] user_context_string compiled {user_context_string}\n")

        ##################################
        ###### Token limit handling ######
        ##################################
        system_instructions = CHATQNA_SYSTEM_PROMPT

        # CRITICAL: Inject explicit English language instructions when language is EN
        # This overrides model bias toward Spanish responses
        original_language = kwargs.get("original_language")
        if original_language and original_language.strip() == "EN":
            system_instructions = (
                "\n\nMANDATORY: You MUST respond ONLY in English. "
                "Do NOT respond in Spanish or any other language. "
                "All responses must be in English regardless of the "
                "content language.\n\n" + system_instructions
            )
            if logflag:
                logger.info(
                    f"[LANGUAGE DEBUG] Injected ENGLISH instruction into "
                    f"system prompt (original_language={original_language})"
                )

        # DEBUG: Log the system prompt to verify it's loaded correctly
        if logflag:
            logger.info(
                f"\n[SYSTEM PROMPT DEBUG] CHATQNA_SYSTEM_PROMPT loaded: {'YES' if system_instructions else 'NO'}"
            )
            if system_instructions:
                logger.info(f"[SYSTEM PROMPT DEBUG] System prompt length: {len(system_instructions)} chars")
                logger.info(f"[SYSTEM PROMPT DEBUG] System prompt preview: {system_instructions[:500]}...")
            else:
                logger.error("[SYSTEM PROMPT DEBUG] CHATQNA_SYSTEM_PROMPT IS NONE OR EMPTY!")

        prompt_add_context = (
            f"\n\nUSER INFORMATION:\n{user_context_string}"
            f"\n\nCHAT HISTORY:\n{translated_history_string}"
            f"\n\nCONTENT FROM THE KNOWLEDGE BASE:\nSearch query: \n{rag_augmented_prompt}"
        )

        # FIX: Separate system and user content for proper chat template handling
        user_content = prompt_add_context

        tokenizer = get_tokenizer()
        max_model_tokens = MAX_MODEL_LEN_TEXTGEN
        max_answer_tokens = llm_parameters_dict["max_tokens"]  # Typically 1024
        # Count tokens in full prompt (system + user combined for token limit check)
        full_prompt_tokens = len(tokenizer.encode(system_instructions + user_content))
        # Check if the total token count exceeds the model's limit
        if full_prompt_tokens + max_answer_tokens > max_model_tokens - 200:  # Leave buffer
            # Calculate maximum tokens for history
            prompt_add_context_tokens = len(tokenizer.encode(prompt_add_context))
            translated_history_tokens = len(tokenizer.encode(translated_history_string))

            max_history_tokens = (
                max_model_tokens + translated_history_tokens - max_answer_tokens - prompt_add_context_tokens - 200
            )
            # Split the history into segments
            history_segments = translated_history_string.split(" |<-MSG->| ")
            truncated_history = []
            current_tokens = 0
            # Start from most recent messages
            for segment in reversed(history_segments):
                segment_tokens = len(tokenizer.encode(segment))
                if current_tokens + segment_tokens > max_history_tokens:
                    break
                truncated_history.insert(0, segment)  # Maintain order
                current_tokens += segment_tokens
            # Rebuild truncated history
            translated_history_string = " |<-MSG->| ".join(truncated_history)
            # Reconstruct user content (system instructions stay the same)
            user_content = (
                f"\n\nUSER INFORMATION:\n{user_context_string}"
                f"\n\nCHAT HISTORY:\n{translated_history_string}"
                f"\n\nCONTENT FROM THE KNOWLEDGE BASE:\n{rag_augmented_prompt}"
            )

        # FIX: Send system and user as separate messages for proper chat template handling
        next_inputs["messages"] = [
            {"role": "system", "content": system_instructions},
            {"role": "user", "content": user_content},
        ]
        next_inputs["max_tokens"] = llm_parameters_dict["max_tokens"]
        next_inputs["top_p"] = llm_parameters_dict["top_p"]
        next_inputs["stream"] = inputs["stream"]
        next_inputs["frequency_penalty"] = inputs["frequency_penalty"]
        next_inputs["temperature"] = inputs["temperature"]
        inputs = next_inputs
        if logflag:
            logger.debug(f"Raw input of the llm\n {inputs}\n")
            # DEBUG: Log the messages array being sent to LLM
            logger.info("\n[LLM DEBUG] Messages being sent to LLM:")
            for i, msg in enumerate(inputs["messages"]):
                logger.info(f"  Message {i}: role={msg['role']}, content_length={len(msg['content'])} chars")
                logger.info(f"  Message {i} content preview: {msg['content'][:200]}...")
            logger.info(f"\n[LLM DEBUG] Full messages array: {inputs['messages']}\n")

    return inputs


def align_outputs(self, data, cur_node, inputs, runtime_graph, llm_parameters_dict, **kwargs):
    next_data = {}

    if self.services[cur_node].service_type == ServiceType.TRANSLATOR:
        if logflag:
            logger.debug(f"Raw output of the translator\n {data}\n")
        translated_text = data["choices"][0]["message"]["content"]

        # Clean up potential LLM conversational artifacts
        translated_text = translated_text.strip().strip('"')

        return {"text": translated_text}

    elif self.services[cur_node].service_type == ServiceType.EMBEDDING:
        if logflag:
            logger.debug(
                f"Raw output of the embedding: {type(data).__name__}, "
                f"keys: {list(data.keys()) if isinstance(data, dict) else 'N/A'}"
            )
        # OPEA embedding microservice returns {"data": [{"index": 0, "embedding": [...]}]}
        if isinstance(data, dict) and "data" in data:
            data = data["data"]
        if not isinstance(data, list):
            raise ValueError(f"Embedding service returned unexpected type: {type(data).__name__}, expected list")
        next_data = {"text": inputs["input"], "embedding": data[0]["embedding"]}

    elif self.services[cur_node].service_type == ServiceType.RETRIEVER:
        if logflag:
            logger.debug(
                f"Raw output of the retriever: {type(data).__name__}, "
                f"keys: {list(data.keys()) if isinstance(data, dict) else 'N/A'}"
            )
        retrieved_docs = data.get("retrieved_docs", [])
        [doc["text"] for doc in retrieved_docs]

        # file_id pairs with retrieved doc id (generated by orchestrator)
        file_id_pairs = {}
        # Get the file ids (all ids in the metadata)
        file_id_list = []

        for item in data.get("metadata", []):
            if "file_ids" in item:
                file_id_list.extend(item["file_ids"])

        # Check if metadata is not None before checking length
        metadata = data.get("metadata")
        if metadata and len(metadata) > 0:
            if RETRIEVER_SEARCH_START == "node" or RETRIEVER_SEARCH_START == "edge":
                related_info_count = sum(
                    1 for doc in retrieved_docs if "\n------\nRELATED INFORMATION:\n------\n" in doc["text"]
                )
                assert len(file_id_list) == related_info_count, (
                    f"Length of file_id_list {len(file_id_list)} is not equal "
                    f"to related_info_count {related_info_count}"
                )
                for retrieved_doc in retrieved_docs:
                    doc_id = retrieved_doc["id"]
                    doc_text = retrieved_doc["text"]
                    if "\n------\nRELATED INFORMATION:\n------\n" in doc_text:
                        file_id_pairs[doc_id] = file_id_list.pop(0) if len(file_id_list) > 0 else ""
                    else:
                        file_id_pairs[doc_id] = ""
            elif RETRIEVER_SEARCH_START == "chunk":
                assert len(file_id_list) == len(retrieved_docs), (
                    f"Length of file_id_list {len(file_id_list)} is not equal "
                    f"to length of retrieved_docs {len(retrieved_docs)}"
                )
                for retrieved_doc in retrieved_docs:
                    doc_id = retrieved_doc["id"]
                    file_id_pairs[doc_id] = file_id_list.pop(0) if len(file_id_list) > 0 else ""
            else:
                logger.error(
                    f"RETRIEVER_SEARCH_START is not set correctly: "
                    f"{RETRIEVER_SEARCH_START}. It should be one of "
                    f"'node', 'edge', or 'chunk'."
                )

        if logflag:
            logger.debug(f"File ID Pairs: {file_id_pairs}")

        downstream_nodes = runtime_graph.downstream(cur_node)
        with_rerank = downstream_nodes and downstream_nodes[0].startswith("rerank")
        if with_rerank and retrieved_docs:
            # prepare inputs for rerank
            next_data["initial_query"] = data["initial_query"]
            next_data["retrieved_docs"] = retrieved_docs
            next_data["file_id_pairs"] = file_id_pairs
            # Preserve query embedding for adaptive reranking
            if "embedding" in data:
                next_data["embedding"] = data["embedding"]
            # Forward chunk_embeddings if available from retriever
            if "chunk_embeddings" in data:
                next_data["chunk_embeddings"] = data["chunk_embeddings"]

            # Expected data format if using tei_reranker directly (bypassing reranker service):
            # next_data["query"] = data["initial_query"]
            # next_data["documents"] = retrieved_docs
            # next_data["texts"] = doc_texts
            # next_data["file_id_pairs"] = file_id_pairs

        else:
            if not retrieved_docs and with_rerank:
                # delete the rerank from retriever -> rerank -> llm
                for ds in reversed(runtime_graph.downstream(cur_node)):
                    for nds in runtime_graph.downstream(ds):
                        runtime_graph.add_edge(cur_node, nds)
                    runtime_graph.delete_node_if_exists(ds)

            # handle template
            received_prompt = data.get("initial_query", inputs.get("text", ""))

            if str(CHATQNA_ENFORCE_ABSTENTION).lower() == "true":
                abstention_instructions = (
                    CHATQNA_ABSTENTION_INSTRUCTIONS
                    if CHATQNA_ABSTENTION_INSTRUCTIONS is not None
                    else (
                        "\n[Returned Documents] The knowledge base search did not "
                        "return any results. State clearly that you cannot answer "
                        "based on available information."
                    )
                )
                received_prompt += abstention_instructions

            prompt = received_prompt

            # System instructions for integration of retrieved documents
            # are already included in the CHATQNA_SYSTEM_PROMPT
            # OPTIONAL:
            # Re-introduce the below code, to dynamically pass custom
            # instructions or to condition them based on retrieved documents
            # chat_template = llm_parameters_dict["chat_template"]
            # if chat_template:
            #     prompt_template = PromptTemplate.from_template(chat_template)
            #     input_variables = prompt_template.input_variables
            #     if sorted(input_variables) == ["context", "question"]:
            #         prompt = prompt_template.format(question=received_prompt, context="\n".join(doc_texts))
            #     elif input_variables == ["question"]:
            #         prompt = prompt_template.format(question=received_prompt)
            #     else:
            #         if logflag:
            #             logger.debug(
            #                 f"{prompt_template} not used, we only support "
            #                 "2 input variables ['question', 'context']"
            #             )
            #         prompt = ChatTemplate.generate_rag_prompt(received_prompt, doc_texts)
            # else:
            #     prompt = ChatTemplate.generate_rag_prompt(received_prompt, doc_texts)

            next_data["inputs"] = prompt

        next_data["retrieved_docs"] = retrieved_docs

    elif self.services[cur_node].service_type == ServiceType.RERANK:
        if logflag:
            logger.info(f"\n[ DEBUG ] MICROSERVICE RERANK OUTPUT: {data}")

        docs = []
        reranked_docs_with_scores = []

        # RECOVERY OF IDs: Create a mapping of text to original document ID
        original_retrieved_docs = inputs.get("retrieved_docs", [])
        text_to_id = {doc.get("text", ""): doc.get("id", "N/A") for doc in original_retrieved_docs}

        # 1. Handle output from custom Genie Python Wrapper
        if isinstance(data, dict):
            if "reranked_docs" in data:
                for doc in data["reranked_docs"]:
                    doc_text = doc.get("text", "")
                    docs.append(doc_text)

                    # Reconstruct the rich document object for the frontend
                    reranked_docs_with_scores.append(
                        {"id": text_to_id.get(doc_text, "N/A"), "text": doc_text, "score": doc.get("score", 0.0)}
                    )
            elif "documents" in data:
                for doc_text in data["documents"]:
                    docs.append(doc_text)
                    reranked_docs_with_scores.append(
                        {"id": text_to_id.get(doc_text, "N/A"), "text": doc_text, "score": 0.0}
                    )

        # 2. Fallback for raw TEI output
        elif isinstance(data, list):
            reranker_parameters = kwargs.get("reranker_parameters")
            top_n = reranker_parameters.top_n if reranker_parameters else 1
            original_docs = inputs.get("documents", [])

            for best_response in data[:top_n]:
                doc_index = best_response.get("index")
                if doc_index is not None and doc_index < len(original_docs):
                    reranked_doc = original_docs[doc_index]
                    reranked_doc["score"] = best_response.get("score")
                    reranked_docs_with_scores.append(reranked_doc)
                    docs.append(reranked_doc.get("text", ""))

        # 3. Build the RAG prompt
        initial_query = inputs.get("initial_query", " ")

        # System instructions for integration of retrieved documents are already included in the CHATQNA_SYSTEM_PROMPT
        # OPTIONAL:
        # Re-introduce the below code, to dynamically pass custom instructions
        # or to condition them based on retrieved documents
        # chat_template = llm_parameters_dict.get("chat_template") if llm_parameters_dict else None

        # if chat_template:
        #     prompt_template = PromptTemplate.from_template(chat_template)
        #     input_variables = prompt_template.input_variables
        #     if sorted(input_variables) == ["context", "question"]:
        #         prompt = prompt_template.format(question=initial_query, context="\n".join(docs))
        #     elif input_variables == ["question"]:
        #         prompt = prompt_template.format(question=initial_query)
        #     else:
        #         prompt = ChatTemplate.generate_rag_prompt(initial_query, docs)
        # else:
        #     prompt = ChatTemplate.generate_rag_prompt(initial_query, docs)

        if not docs and str(CHATQNA_ENFORCE_ABSTENTION).lower() == "true":
            abstention_instructions = (
                CHATQNA_ABSTENTION_INSTRUCTIONS
                if CHATQNA_ABSTENTION_INSTRUCTIONS is not None
                else (
                    "\n[Retrieved Documents] The knowledge base search did not return any results. "
                    "State clearly that you cannot answer based on available information."
                )
            )
            next_data["inputs"] = initial_query + abstention_instructions
        else:
            next_data["inputs"] = initial_query + "".join(
                f"\n[Retrieved Document]: {doc}" for doc in docs
            )  # prompt <- change to 'prompt' if you re-introduce the code above

        next_data["retrieved_docs"] = reranked_docs_with_scores

        # 4. Preserve file mappings for citation:
        if "file_id_pairs" in inputs:
            next_data["file_id_pairs"] = inputs["file_id_pairs"]

    elif self.services[cur_node].service_type == ServiceType.LLM and not llm_parameters_dict["stream"]:
        if "faqgen" in self.services[cur_node].endpoint:
            next_data = data
        else:
            if logflag:
                logger.debug(f"\nRaw output of the llm\n {data}\n")
            next_data["text"] = data["choices"][0]["message"]["content"]
        if logflag:
            logger.debug(f"\nAligned output of the llm\n {next_data}\n")
    else:
        next_data = data

    if logflag:
        logger.debug(
            f"FINAL ALIGNED DATA keys: {list(next_data.keys())}, text length: {len(next_data.get('text', ''))}"
        )

    return next_data


def align_generator(self, gen, **kwargs):
    # OpenAI response format
    # data:{"id":"","object":"text_completion","created":1725530204,
    # "model":"meta-llama/Meta-Llama-3-8B-Instruct","system_fingerprint":"2.0.1-native",
    # "choices":[{"index":0,"delta":{"role":"assistant","content":"?"},"logprobs":null,
    # "finish_reason":null}]}\n\n'
    for line in gen:
        line = line.decode("utf-8")
        chunks = [chunk.strip() for chunk in line.split("\n\n") if chunk.strip()]
        for line in chunks:
            start = line.find("{")
            end = line.rfind("}") + 1
            json_str = line[start:end]
            try:
                # sometimes yield empty chunk, do a fallback here
                json_data = json.loads(json_str)
                if "ops" in json_data and "op" in json_data["ops"][0]:
                    if "value" in json_data["ops"][0] and isinstance(json_data["ops"][0]["value"], str):
                        yield f"data: {repr(json_data['ops'][0]['value'].encode('utf-8'))}\n\n"
                    else:
                        pass
                elif "content" in json_data["choices"][0]["delta"]:
                    yield f"data: {repr(json_data['choices'][0]['delta']['content'].encode('utf-8'))}\n\n"
            except Exception:
                yield f"data: {repr(json_str.encode('utf-8'))}\n\n"
    yield "data: [DONE]\n\n"


class ChatQnAService:
    def __init__(self, host="0.0.0.0", port=8888):
        self.host = host
        self.port = port
        ServiceOrchestrator.align_inputs = align_inputs
        ServiceOrchestrator.align_outputs = align_outputs
        ServiceOrchestrator.align_generator = align_generator
        self.megaservice = ServiceOrchestrator()
        self.endpoint = str(MegaServiceEndpoint.CHAT_QNA)
        self.user_profile_client = GenieUserProfileClient()

    def _find_node_key(self, service_name: str, result_dict: dict) -> str | None:
        """Helper to find the full key for a service in the result_dict."""
        for key in result_dict:
            if key.startswith(service_name):
                return key
        return None

    async def fetch_file_metadata(self, file_id: str) -> dict:
        """
        Fetch metadata for a file by calling the relevant API.

        Args:
            file_id (str): The ID of the file to fetch metadata for.

        Returns:
            dict: A dictionary containing metadata, including labels.
        """
        if not file_id:
            return {"categoryLabel": None, "serviceLabels": []}

        token = self.user_profile_client._token
        if not token:
            logger.error("No Bearer token available for document-repository call.")
            return None

        file_get_metadata_url = f"{DOC_REPO_URL}/api/files/{file_id}"
        headers = {"Authorization": f"Bearer {token}"}

        # Inject W3C traceparent for distributed tracing
        from opentelemetry.propagate import inject

        inject(headers)

        try:
            async with (
                aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as session,
                session.get(file_get_metadata_url, headers=headers) as response,
            ):
                if response.status == 200:
                    file_metadata = await response.json()
                    if logflag:
                        logger.debug(f"Fetched metadata for file ID {file_id}: {file_metadata}")
                    if file_metadata["success"]:
                        return file_metadata["data"]
                    else:
                        logger.error(f"Failed to fetch metadata for file ID {file_id}. Response indicates failure.")
                else:
                    logger.error(f"Failed to fetch metadata for file ID {file_id}. HTTP Status: {response.status}")
        except Exception as e:
            logger.error(f"An error occurred while fetching metadata for file ID {file_id}: {e}")

        return None
        # return []

    async def _assemble_source_documents(self, result_dict: dict) -> tuple[list, float, bool]:
        """Build the source-document list, confidence, and grounding flag from the graph output.

        Source documents reflect the **reranker's verdict**, not the retriever's raw cosine
        hits (which are always moderate-high for same-domain text and would surface
        irrelevant references with a misleading confidence whenever the reranker found
        nothing relevant).

        Grounding (``is_grounded``):
          - With a reranker in the pipeline: True iff at least one doc passed the relevance
            threshold (i.e. the LLM had document backing for its answer).
          - Without a reranker: True iff the retriever returned at least one doc.
        When not grounded, no source documents are returned and confidence is 0.0; the
        frontend flags the response as AI-generated rather than showing a score.

        Args:
            result_dict: The megaservice orchestrator output keyed by node name.

        Returns:
            (source_documents, confidence_score, is_grounded)
        """
        rerank_key = self._find_node_key("rerank", result_dict)
        retriever_key = self._find_node_key("retriever", result_dict)

        retriever_node_output = result_dict.get(retriever_key, {})
        file_id_pairs = retriever_node_output.get("file_id_pairs", {})
        # Retriever docs carry the orchestrator id + text + similarity score (metadata.score).
        retrieved_docs = retriever_node_output.get("retrieved_docs", [])

        # The reranker's verdict. NOTE: align_outputs (RERANK branch) stores the reranked
        # docs under the "retrieved_docs" key — with id + reranker score already
        # reconstructed — NOT under "reranked_docs" (that key is empty in the orchestrator
        # output). Each verdict doc is {id, text, score} where score is the reranker score.
        reranker_node_output = result_dict.get(rerank_key, {}) if rerank_key else {}
        rerank_verdict = reranker_node_output.get("retrieved_docs", []) if rerank_key else []

        # Normalize the documents to display into (id, score) tuples.
        if rerank_key:
            display_docs = [{"id": doc.get("id", "N/A"), "score": doc.get("score", 0.0)} for doc in rerank_verdict]
        else:
            display_docs = [
                {
                    "id": doc.get("id", "N/A"),
                    "score": (doc.get("metadata") or {}).get("score", doc.get("score", 0.0)),
                }
                for doc in retrieved_docs
            ]
        is_grounded = bool(display_docs)
        logger.info(
            f"Grounding decision: is_grounded={is_grounded} "
            f"(reranker_present={bool(rerank_key)}, "
            f"rerank_verdict={len(rerank_verdict)}, retriever_docs={len(retrieved_docs)})"
        )

        source_documents_formatted = []
        scores = []
        source_documents_file_ids = []

        if logflag:
            logger.debug(f"display docs count: {len(display_docs)}, scores: {[d.get('score') for d in display_docs]}")

        for item in display_docs:
            doc_id_by_orchestrator = item.get("id", "N/A")
            if doc_id_by_orchestrator not in file_id_pairs:
                logger.warning(f"Warning: Document ID {doc_id_by_orchestrator} not found in file_id_pairs mapping.")
                continue

            file_id = file_id_pairs[doc_id_by_orchestrator]
            if not file_id:
                logger.warning(f"Warning: No File ID mapped for Document ID {doc_id_by_orchestrator}.")
                continue
            if file_id in source_documents_file_ids:
                logger.info(f"Note: Duplicate File ID {file_id} found. Skipping duplicate.")
                scores.append(item.get("score", 0.0))
                continue

            logger.info(f"Document ID {doc_id_by_orchestrator} mapped to File ID {file_id}.")
            source_documents_file_ids.append(file_id)

            score = item.get("score", 0.0)
            # Clients (web + mobile) build the view URL from their own public base + file_id.
            # Emitting the internal BACKEND_SERVICE_URL here would give the browser an
            # unreachable hostname (DNS_PROBE_FINISHED_NXDOMAIN), so leave it empty for
            # normal files. Crawled HTML pages carry a real external source_url (set below).
            file_read_url = ""

            labels = []
            file_name = ""
            if file_id:
                file_metadata = await self.fetch_file_metadata(file_id)
                if file_metadata and isinstance(file_metadata, dict):
                    labels = file_metadata["labels"]
                    file_name = file_metadata.get("file_name", "")
                    logger.info(f"Labels for file ID {file_id}: {labels}")
                    logger.info(f"File name for file ID {file_id}: {file_name}")
                    author = file_metadata.get("author", "")
                    if author == "crawler" and file_name.endswith(".html"):
                        # If the author is 'crawler' and the file is an HTML, we can assume it's a web page
                        file_read_url = file_metadata.get("source_url", file_read_url)
                        logger.info(f"Updated file read URL for crawled HTML: {file_read_url}")
                else:
                    logger.warning(f"Skipping metadata for file ID {file_id} due to fetch failure.")
                    # Assigning error values to avoid service crashing [to be optimised]
                    labels = "error"
                    file_id = "error"
                    file_name = "error"
                    file_read_url = "error"
                    score = 0

            source_documents_formatted.append(
                {
                    "document_id": file_id,
                    "document_name": file_name,
                    "url": file_read_url,
                    "categoryLabel": labels,
                    "serviceLabels": [],
                    "score": score,
                }
            )
            scores.append(score)
            logger.debug(f"appending document conf score: {score} ")

        # Average of the displayed (reranker) scores; 0.0 when not grounded.
        confidence_score = sum(scores) / len(scores) if scores else 0.0
        logger.debug(f"document confidence scores: {scores}")

        return source_documents_formatted, confidence_score, is_grounded

    async def _stream_with_metadata(self, body_iterator, result_dict):
        """Forward the LLM token stream, then append a `metadata` SSE event.

        The metadata event carries the reranker-grounded source documents, confidence,
        and ``is_grounded`` flag, emitted as plain JSON **before** the terminal ``[DONE]``
        so downstream consumers (backend → web/mobile) receive document backing for the
        streamed answer instead of re-running retrieval themselves.

        Token chunks are forwarded verbatim (they are Python-repr-encoded by the
        orchestrator's ``align_generator``); the terminal ``[DONE]`` is suppressed and
        re-emitted after the metadata. Metadata is computed **after** the token stream so
        it never delays Time-To-First-Token (it does up to N ``fetch_file_metadata`` calls).
        """
        async for chunk in body_iterator:
            text = chunk.decode("utf-8") if isinstance(chunk, (bytes, bytearray)) else str(chunk)
            if text.strip() == "data: [DONE]":
                # Suppress the terminal [DONE]; re-emit it after the metadata event.
                continue
            yield text

        # Compute metadata after tokens so TTFT is unaffected by the doc-metadata fetches.
        source_documents, confidence_score, is_grounded = await self._assemble_source_documents(result_dict)
        yield (
            "data: "
            + json.dumps(
                {
                    "type": "metadata",
                    "source_documents": source_documents,
                    "confidence_score": round(confidence_score, 2),
                    "is_grounded": is_grounded,
                }
            )
            + "\n\n"
        )
        yield "data: [DONE]\n\n"

    def add_remote_service(self):

        embedding = MicroService(
            name="embedding",
            host=EMBEDDING_SERVER_HOST_IP,
            port=EMBEDDING_SERVER_PORT,
            endpoint=EMBEDDING_SERVER_ENDPOINT,
            use_remote_service=True,
            service_type=ServiceType.EMBEDDING,
        )

        retriever = MicroService(
            name="retriever",
            host=RETRIEVER_SERVICE_HOST_IP,
            port=RETRIEVER_SERVICE_PORT,
            endpoint="/v1/retrieval",
            use_remote_service=True,
            service_type=ServiceType.RETRIEVER,
        )

        rerank = MicroService(
            name="rerank",
            host=RERANK_SERVER_HOST_IP,
            port=RERANK_SERVER_PORT,
            endpoint="/v1/reranking",
            use_remote_service=True,
            service_type=ServiceType.RERANK,
        )

        llm = MicroService(
            name="llm",
            host=LLM_SERVER_HOST_IP,
            port=LLM_SERVER_PORT,
            protocol=LLM_SERVER_PROTOCOL,
            endpoint=f"{LLM_SERVER_ENDPOINT_PREFIX}/v1/chat/completions",
            use_remote_service=True,
            service_type=ServiceType.LLM,
        )
        self.megaservice.add(embedding).add(retriever).add(rerank).add(llm)
        self.megaservice.flow_to(embedding, retriever)
        self.megaservice.flow_to(retriever, rerank)
        self.megaservice.flow_to(rerank, llm)

    def add_remote_service_without_rerank(self):

        embedding = MicroService(
            name="embedding",
            host=EMBEDDING_SERVER_HOST_IP,
            port=EMBEDDING_SERVER_PORT,
            endpoint=EMBEDDING_SERVER_ENDPOINT,
            use_remote_service=True,
            service_type=ServiceType.EMBEDDING,
        )

        retriever = MicroService(
            name="retriever",
            host=RETRIEVER_SERVICE_HOST_IP,
            port=RETRIEVER_SERVICE_PORT,
            endpoint="/v1/retrieval",
            use_remote_service=True,
            service_type=ServiceType.RETRIEVER,
        )

        llm = MicroService(
            name="llm",
            host=LLM_SERVER_HOST_IP,
            port=LLM_SERVER_PORT,
            protocol=LLM_SERVER_PROTOCOL,
            endpoint=f"{LLM_SERVER_ENDPOINT_PREFIX}/v1/chat/completions",
            use_remote_service=True,
            service_type=ServiceType.LLM,
        )
        self.megaservice.add(embedding).add(retriever).add(llm)
        self.megaservice.flow_to(embedding, retriever)
        self.megaservice.flow_to(retriever, llm)

    def add_remote_service_faqgen(self):

        embedding = MicroService(
            name="embedding",
            host=EMBEDDING_SERVER_HOST_IP,
            port=EMBEDDING_SERVER_PORT,
            endpoint=EMBEDDING_SERVER_ENDPOINT,
            use_remote_service=True,
            service_type=ServiceType.EMBEDDING,
        )

        retriever = MicroService(
            name="retriever",
            host=RETRIEVER_SERVICE_HOST_IP,
            port=RETRIEVER_SERVICE_PORT,
            endpoint="/v1/retrieval",
            use_remote_service=True,
            service_type=ServiceType.RETRIEVER,
        )

        rerank = MicroService(
            name="rerank",
            host=RERANK_SERVER_HOST_IP,
            port=RERANK_SERVER_PORT,
            endpoint="/v1/reranking",
            use_remote_service=True,
            service_type=ServiceType.RERANK,
        )

        llm = MicroService(
            name="llm",
            host=LLM_SERVER_HOST_IP,
            port=LLM_SERVER_PORT,
            protocol=LLM_SERVER_PROTOCOL,
            endpoint=f"{LLM_SERVER_ENDPOINT_PREFIX}/v1/faqgen",
            use_remote_service=True,
            service_type=ServiceType.LLM,
        )
        self.megaservice.add(embedding).add(retriever).add(rerank).add(llm)
        self.megaservice.flow_to(embedding, retriever)
        self.megaservice.flow_to(retriever, rerank)
        self.megaservice.flow_to(rerank, llm)

    def add_remote_service_without_translation(self):
        """
        Builds the full RAG pipeline wrapped with input and output translation.
        Flow: translator_in -> embedding -> retriever -> rerank -> llm -> translator_out
        """

        embedding = MicroService(
            name="embedding",
            host=EMBEDDING_SERVER_HOST_IP,
            port=EMBEDDING_SERVER_PORT,
            endpoint=EMBEDDING_SERVER_ENDPOINT,
            use_remote_service=True,
            service_type=ServiceType.EMBEDDING,
        )

        retriever = MicroService(
            name="retriever",
            host=RETRIEVER_SERVICE_HOST_IP,
            port=RETRIEVER_SERVICE_PORT,
            endpoint="/v1/retrieval",
            use_remote_service=True,
            service_type=ServiceType.RETRIEVER,
        )

        rerank = MicroService(
            name="rerank",
            host=RERANK_SERVER_HOST_IP,
            port=RERANK_SERVER_PORT,
            endpoint="/v1/reranking",
            use_remote_service=True,
            service_type=ServiceType.RERANK,
        )

        llm = MicroService(
            name="llm",
            host=LLM_SERVER_HOST_IP,
            port=LLM_SERVER_PORT,
            protocol=LLM_SERVER_PROTOCOL,
            endpoint=f"{LLM_SERVER_ENDPOINT_PREFIX}/v1/chat/completions",
            use_remote_service=True,
            service_type=ServiceType.LLM,
        )

        self.megaservice.add(embedding).add(retriever).add(rerank).add(llm)
        self.megaservice.flow_to(embedding, retriever)
        self.megaservice.flow_to(retriever, rerank)
        self.megaservice.flow_to(rerank, llm)

    def add_remote_service_genieai(self):
        """
        Builds the full RAG pipeline wrapped with input and output translation.
        Flow: translator_in -> embedding -> retriever -> rerank -> llm -> translator_out
        """

        embedding = MicroService(
            name="embedding",
            host=EMBEDDING_SERVER_HOST_IP,
            port=EMBEDDING_SERVER_PORT,
            endpoint=EMBEDDING_SERVER_ENDPOINT,
            use_remote_service=True,
            service_type=ServiceType.EMBEDDING,
        )

        retriever = MicroService(
            name="retriever",
            host=RETRIEVER_SERVICE_HOST_IP,
            port=RETRIEVER_SERVICE_PORT,
            endpoint="/v1/retrieval",
            use_remote_service=True,
            service_type=ServiceType.RETRIEVER,
        )

        rerank = MicroService(
            name="rerank",
            host=RERANK_SERVER_HOST_IP,
            port=RERANK_SERVER_PORT,
            endpoint="/v1/reranking",
            use_remote_service=True,
            service_type=ServiceType.RERANK,
        )

        llm = MicroService(
            name="llm",
            host=LLM_SERVER_HOST_IP,
            port=LLM_SERVER_PORT,
            protocol=LLM_SERVER_PROTOCOL,
            endpoint=f"{LLM_SERVER_ENDPOINT_PREFIX}/v1/chat/completions",
            use_remote_service=True,
            service_type=ServiceType.LLM,
        )

        self.megaservice.add(embedding).add(retriever).add(rerank).add(llm)
        self.megaservice.flow_to(embedding, retriever)
        self.megaservice.flow_to(retriever, rerank)
        self.megaservice.flow_to(rerank, llm)

    @staticmethod
    def _build_translategemma_prompt(
        text: str,
        source_lang_code: str,
        target_lang_code: str,
        source_lang_name: str = "English",
        target_lang_name: str = "English",
    ) -> str:
        """Build a prompt for TranslateGemma using the completions API.

        Duplicated in document-translation/genieai_pdf_translator.py — keep in sync.
        """
        return (
            f"<bos><start_of_turn>user\n"
            f"You are a professional {source_lang_name} ({source_lang_code}) to "
            f"{target_lang_name} ({target_lang_code}) translator. Your goal is to "
            f"accurately convey the meaning and nuances of the original {source_lang_name} "
            f"text while adhering to {target_lang_name} grammar, vocabulary, and cultural "
            f"sensitivities.\n"
            f"CRITICAL: You MUST output ONLY in {target_lang_name} ({target_lang_code}). "
            f"Do NOT output in Nepali, Hindi, Bengali, or any other language. "
            f"Do NOT use Devanagari, Bengali, or any non-Latin script. "
            f"{target_lang_name} uses the LATIN alphabet only.\n"
            f"Produce only the {target_lang_name} translation, without any additional "
            f"explanations or commentary. Please translate the following {source_lang_name} "
            f"text into {target_lang_name}:\n\n\n{text}"
            f"<end_of_turn>\n<start_of_turn>model\n"
        )

    async def _get_translated_history_string(
        self, history: list, target_language: str, source_lang_code: str = "en"
    ) -> str:
        """
        A helper that:
        1. Truncates history to stay within a token limit.
        2. Flattens the history into a single string.
        3. Sends the string to the translation LLM.

        Automatically uses TranslateGemma structured format or generic prompt format
        based on the configured VLLM_TRANSLATION_MODEL_ID.

        Args:
            history: Chat history as list of dicts or plain string (single-message mode).
            target_language: Target language name (e.g. "English").
            source_lang_code: Source ISO language code (e.g. "st") for TranslateGemma.
        """

        # Single-message mode sends history as a plain string — translate it
        if isinstance(history, str):
            return await self._translate_text_chunk(
                history, target_language, source_lang_code=source_lang_code, iso_code="en"
            )

        max_translation_chars = MAX_TRANSLATION_CHARS
        current_chars = 0
        messages_to_process = []
        if logflag:
            logger.debug(f"Processing translation for history with {len(history)} messages.")

        for message in reversed(history):
            if logflag:
                logger.debug(f"Examining message: {message}")
            message_chars = len(message["content"])
            if current_chars + message_chars > max_translation_chars:
                break
            messages_to_process.append(message)
            current_chars += message_chars
        messages_to_process.reverse()

        flattened_history_parts = []
        for message in messages_to_process:
            role = message.get("role", "unknown").upper()
            content = message.get("content", "")
            flattened_history_parts.append(f"{role}: {content}")

        flattened_history_string = " |<-MSG->| ".join(flattened_history_parts)

        # Build payload based on model type
        if IS_TRANSLATEGEMMA:
            # Use completions API with pre-formatted prompt (vLLM v0.10.0 cannot
            # pass structured content through chat completions to TranslateGemma's template)
            prompt = self._build_translategemma_prompt(
                text=flattened_history_string,
                source_lang_code=source_lang_code,
                target_lang_code="en",
                source_lang_name=source_lang_code.upper(),
                target_lang_name="English",
            )
            payload = {
                "model": TRANSLATION_MODEL_ID,
                "prompt": prompt,
                "temperature": 0.0,
                "max_tokens": min(max(len(flattened_history_string) // 2, 512), 4096),
                "repetition_penalty": 1.2,
            }
            url = TRANSLATION_COMPLETIONS_URL
        else:
            prompt = (
                f"Translate the following chat history to {target_language}. "
                f"Preserve the role markers (e.g., 'USER:', 'ASSISTANT:')."
                f"\n\nHISTORY:\n{flattened_history_string}"
            )
            payload = {"messages": [{"role": "user", "content": prompt}], "temperature": 0, "stream": False}
            url = TRANSLATION_LLM_URL

        if logflag:
            svc = "TranslateGemma" if IS_TRANSLATEGEMMA else "generic"
            logger.debug(f"Payload for translation service ({svc}): {payload}")

        try:
            async with httpx.AsyncClient(timeout=TRANSLATION_SERVICE_TIMEOUT) as client:
                response = await client.post(
                    url,
                    json=payload,
                    headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                )
                response.raise_for_status()
                response_data = response.json()
                if IS_TRANSLATEGEMMA:
                    translated_blob = response_data["choices"][0]["text"]
                else:
                    translated_blob = response_data["choices"][0]["message"]["content"]
                if logflag:
                    logger.debug(f"Translated chat history: {translated_blob.strip()}")
                return translated_blob.strip()

        except httpx.TimeoutException as e:
            logger.error(
                f"History translation timeout after "
                f"{TRANSLATION_SERVICE_TIMEOUT} seconds. Returning history "
                f"in original language. Error: {e}"
            )
            return flattened_history_string
        except Exception as e:
            logger.error(f"Translation error: {e}")
            return flattened_history_string

    def load_language_codes(self, filepath: str) -> dict:
        """Load language codes from a JSON file."""
        try:
            with open(filepath) as file:
                language_codes = json.load(file)
            return language_codes
        except Exception as e:
            logger.error(f"Error loading language codes from {filepath}: {e}")
            return {}

    def _split_text_into_chunks(self, text: str, max_chars: int = 2000) -> list:
        """Split text into chunks, trying to break at sentence boundaries."""
        if len(text) <= max_chars:
            return [text]

        chunks = []
        current_chunk = ""
        sentences = text.replace("\n\n", "\n").split(". ")

        for sentence in sentences:
            if len(current_chunk) + len(sentence) + 2 <= max_chars:
                current_chunk += sentence + ". "
            else:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                current_chunk = sentence + ". "

        if current_chunk:
            chunks.append(current_chunk.strip())

        return chunks

    async def _translate_text_chunk(
        self, text: str, target_lang: str, iso_code: str = None, source_lang_code: str = "en"
    ) -> str:
        """Translate a single chunk of text.

        Automatically uses TranslateGemma completions API (with pre-formatted prompt)
        or generic chat completions format based on the configured VLLM_TRANSLATION_MODEL_ID.

        Args:
            text: Text to translate.
            target_lang: Target language name (e.g. "Sesotho").
            iso_code: Target ISO language code (e.g. "st").
            source_lang_code: Source ISO language code (e.g. "en"). Defaults to "en".
        """
        if IS_TRANSLATEGEMMA:
            target_lang_code = iso_code.lower() if iso_code else target_lang.lower()
            prompt = self._build_translategemma_prompt(
                text=text,
                source_lang_code=source_lang_code,
                target_lang_code=target_lang_code,
                source_lang_name=source_lang_code.upper(),
                target_lang_name=target_lang,
            )
            payload = {
                "model": TRANSLATION_MODEL_ID,
                "prompt": prompt,
                "temperature": 0.0,
                "max_tokens": min(max(len(text) // 2, 512), 4096),
                "repetition_penalty": 1.2,
            }
            url = TRANSLATION_COMPLETIONS_URL
        else:
            language_notes = {
                "Sesotho": "NOTE: Sesotho is spoken in Lesotho and South Africa. It is NOT Afrikaans.",
                "Bengali": "NOTE: Bengali is spoken in Bangladesh and India. It is NOT Hindi.",
                "Mandinka": "NOTE: Mandinka is spoken in West Africa (Gambia, Senegal, Mali).",
            }
            note = language_notes.get(target_lang, "")
            if iso_code:
                prompt = (
                    f"Translate the following text to {target_lang} "
                    f"(ISO 639-1 code: {iso_code}). {note} "
                    f"Only output the translated text, nothing else."
                    f"\n\nText: {text}\n\nTranslation:"
                )
            else:
                prompt = (
                    f"Translate the following text to {target_lang}. "
                    f"{note} Only output the translated text."
                    f"\n\nText: {text}\n\nTranslation:"
                )
            payload = {"messages": [{"role": "user", "content": prompt}], "temperature": 0, "stream": False}
            url = TRANSLATION_LLM_URL

        if logflag:
            logger.debug(f"Translation payload ({'TranslateGemma' if IS_TRANSLATEGEMMA else 'generic'}): {payload}")

        try:
            async with httpx.AsyncClient(timeout=TRANSLATION_SERVICE_TIMEOUT) as client:
                response = await client.post(
                    url,
                    json=payload,
                    headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                )
                response.raise_for_status()
                response_data = response.json()
                if IS_TRANSLATEGEMMA:
                    return response_data["choices"][0]["text"].strip()
                else:
                    return response_data["choices"][0]["message"]["content"].strip()
        except Exception as e:
            logger.warning(f"Failed to translate chunk, returning original: {type(e).__name__}: {e}")
            return text

    async def _translate_with_chunking(
        self, text: str, target_lang: str, iso_code: str = None, source_lang_code: str = "en"
    ) -> str:
        """Translate long text by splitting into chunks and translating separately."""
        chunks = self._split_text_into_chunks(text, max_chars=2000)

        if logflag:
            logger.info(f"Translating {len(text)} chars in {len(chunks)} chunks to {target_lang}")

        # Translate chunks concurrently
        translated_chunks = await asyncio.gather(
            *[
                self._translate_text_chunk(chunk, target_lang, iso_code, source_lang_code=source_lang_code)
                for chunk in chunks
            ]
        )

        return " ".join(translated_chunks)

    async def handle_request(self, request: Request):
        data = await request.json()

        # Extract and validate propagated Bearer token from Authorization header
        authorization = request.headers.get("Authorization")
        if authorization and authorization.startswith("Bearer "):
            token_str = authorization[7:]

            # Defense-in-depth: validate token via JWKS
            from keycloak_token_validator import validate_token

            claims = await validate_token(token_str)
            if claims is None:
                logger.warning("Incoming Bearer token failed JWKS validation — rejecting request")
                return {"error": "Unauthorized", "message": "Token validation failed"}

            self.user_profile_client.set_token(token_str)
        else:
            logger.warning("No Authorization header in request — service-to-service calls will fail")

        # --- LOGGING THE FULL REQUEST FROM THE FRONTEND FOR DEBUGGING---
        logger.debug(f"\n\nFRONTEND PAYLOAD: \n{data}\n\n")

        user_details = {}

        try:
            user_details = await self.user_profile_client.get_user_profile()
        except Exception as e:
            logger.error(f"USER PROFILE ERROR: {e}")

        # -----------------------------------------------

        chat_request = ChatCompletionRequest.model_validate(data)

        # --- LOGGING FOR DEBUGGING CHAT REQUEST ---
        logger.debug(f"Parsed chat request: {chat_request}")

        retrieval_context = {}

        if chat_request.context:
            try:
                retrieval_context = chat_request.context.model_dump(exclude_unset=True)
            except Exception:
                retrieval_context = chat_request.context.model_dump(exclude_unset=True)
        logger.debug(f"Context keys: {list(retrieval_context.keys())}")
        # -----------------------------------------------

        if logflag:
            logger.debug(f"Incoming Chat Request: {chat_request}")

        full_chat_history = chat_request.messages
        # Check both context.language and the direct language field
        original_language = None
        if chat_request.context and chat_request.context.language:
            original_language = chat_request.context.language
        elif chat_request.language and chat_request.language != "auto":
            original_language = chat_request.language

        if logflag:
            logger.info(
                f"Language from frontend - context.language: "
                f"{chat_request.context.language if chat_request.context else None}, "
                f"direct language: {chat_request.language}, "
                f"final: {original_language}"
            )
            logger.info(
                f"Language debug - type: {type(original_language)}, "
                f"repr: {repr(original_language)} "
                "if original_language else None"
            )

        # Re-enabled language detection as fallback ---
        try:
            if logflag:
                logger.info(
                    f"Language detection check - original_language is None: "
                    f"{original_language is None}, is empty string: "
                    f"{original_language == '' if original_language else 'N/A'}"
                )

            if not original_language or original_language.strip() == "":
                if logflag:
                    logger.info("Triggering auto-detection because original_language is falsy or empty")

                # Attempt to detect language from the last user message
                last_user_content = ""
                if isinstance(full_chat_history, str):
                    last_user_content = full_chat_history
                else:
                    for msg in reversed(full_chat_history):
                        if msg.get("role") == "user":
                            last_user_content = msg.get("content", "")
                            break

                if logflag:
                    logger.info(
                        f"Last user content for detection (first 100 chars): "
                        f"{last_user_content[:100] if last_user_content else 'None'}"
                    )

                if last_user_content:
                    detected_lang = detect(last_user_content)
                    if logflag:
                        logger.info(
                            f"langdetect result: '{detected_lang}' "
                            f"(will convert to uppercase: '{detected_lang.upper()}')"
                        )

                    # Load supported languages to validate the detection
                    language_codes = self.load_language_codes(LANGUAGE_CODES_FILEPATH)

                    # Only use detected language if it's in our supported list OR if it's 'en'
                    is_supported = detected_lang and (
                        detected_lang.lower() in language_codes or detected_lang.lower() == "en"
                    )

                    if logflag:
                        logger.info(
                            f"Language validation - detected '{detected_lang}', "
                            f"supported: {is_supported}, in language_codes: "
                            f"{detected_lang.lower() in language_codes if detected_lang else 'N/A'}"
                        )

                    if is_supported:
                        if detected_lang.upper() != "EN":
                            original_language = detected_lang.upper()
                            logger.info(f"Auto-detected language: {original_language}")
                    else:
                        msg = (
                            f"Detected language '{detected_lang}' is not in "
                            "supported languages list. Ignoring auto-detection. "
                            "Falling back to EN."
                        )
                        logger.warning(msg)
                        original_language = "EN"
        except Exception as e:
            logger.warning(f"Language detection failed: {e}")
            # Fallback to English if detection fails
            if not original_language:
                original_language = "EN"

        translated_history_string = ""
        if original_language and original_language.strip() != "EN":
            if logflag:
                logger.debug(
                    f"Original language detected: {original_language}. Proceeding with translation of chat history."
                )
            translated_history_string = await self._get_translated_history_string(
                full_chat_history, "English", source_lang_code=original_language.lower()
            )
        else:
            # If already English, flatten without translation
            if isinstance(full_chat_history, str):
                translated_history_string = full_chat_history
            else:
                parts = [f"{msg.get('role', '').upper()}: {msg.get('content', '')}" for msg in full_chat_history]
                translated_history_string = " |<-MSG->| ".join(parts)

        if logflag:
            logger.debug(f"Translated History String: {translated_history_string}")

        # RegEx-based extraction for last user message in the array
        last_translated_message_content = ""
        user_messages = USER_MSG_PATTERN.findall(translated_history_string)
        if user_messages:
            last_translated_message_content = user_messages[-1].strip()

        # If regex fails for some reason, we have a simple fallback
        if not last_translated_message_content:
            # Fallback to just using the whole blob (less accurate for retrieval but safe)
            last_translated_message_content = translated_history_string

        if logflag:
            logger.debug(f"Last_translated_message_content: {last_translated_message_content}")

        # Extract the retrieval context if it is provided in the request.
        # Set to empty dict as a default if it is missing.
        retrieval_context = {}
        if chat_request.context:
            try:
                # If Pydantic is v2+
                retrieval_context = chat_request.context.model_dump(exclude_unset=True)
            except Exception:
                # Backup - can be removed later
                logger.warning(".model_dump method not supported")
                retrieval_context = chat_request.context.dict(exclude_unset=True)
        if logflag:
            if isinstance(retrieval_context, dict):
                ctx_desc = list(retrieval_context.keys())
            else:
                ctx_desc = type(retrieval_context).__name__
            logger.debug(f"Retrieval Context: {ctx_desc}")

        parameters = LLMParams(
            max_tokens=chat_request.max_tokens if chat_request.max_tokens else 1024,
            top_k=chat_request.top_k if chat_request.top_k else 10,
            top_p=chat_request.top_p if chat_request.top_p else 0.95,
            temperature=chat_request.temperature if chat_request.temperature else 0.01,
            frequency_penalty=chat_request.frequency_penalty if chat_request.frequency_penalty else 0.0,
            presence_penalty=chat_request.presence_penalty if chat_request.presence_penalty else 0.0,
            repetition_penalty=chat_request.repetition_penalty if chat_request.repetition_penalty else 1.03,
            stream=chat_request.stream if chat_request.stream else False,
            chat_template=chat_request.chat_template if chat_request.chat_template else None,
            model=chat_request.model if chat_request.model else None,
        )
        retriever_parameters = GenieaiRetrieverParms(
            # in the current implementation, search_type should always be set to similarity_score_threshold,
            # otherwise not possible to calculate confidence scores
            # this is currently enforced by the genieai_api_protocol (ChatCompletionRequest model)
            search_type=chat_request.search_type if chat_request.search_type else "similarity_score_threshold",
            k=chat_request.k if chat_request.k is not None else RETRIEVER_K,
            fetch_k=chat_request.fetch_k if chat_request.fetch_k is not None else RETRIEVER_FETCH_K,
            search_start=chat_request.search_start if chat_request.search_start is not None else RETRIEVER_SEARCH_START,
            enable_traversal=chat_request.enable_traversal
            if chat_request.enable_traversal is not None
            else RETRIEVER_TRAVERSAL_ENABLED,
            traversal_max_depth=chat_request.traversal_max_depth
            if chat_request.traversal_max_depth is not None
            else RETRIEVER_TRAVERSAL_MAX_DEPTH,
            traversal_max_returned=chat_request.traversal_max_returned
            if chat_request.traversal_max_returned is not None
            else RETRIEVER_TRAVERSAL_MAX_RETURNED,
            traversal_score_threshold=chat_request.traversal_score_threshold
            if chat_request.traversal_score_threshold is not None
            else RETRIEVER_TRAVERSAL_SCORE_THRESHOLD,
            distance_threshold=chat_request.distance_threshold
            if chat_request.distance_threshold is not None
            else RETRIEVER_DISTANCE_THRESHOLD,
            lambda_mult=chat_request.lambda_mult if chat_request.lambda_mult is not None else RETRIEVER_LAMBDA_MULT,
            score_threshold=chat_request.score_threshold
            if chat_request.score_threshold is not None
            else RETRIEVER_SCORE_THRESHOLD,
        )

        reranker_parameters = GenieaiRerankerParms(
            reranking_strategy=chat_request.reranking_strategy
            if chat_request.reranking_strategy is not None
            else RERANKING_STRATEGY,
            top_n=chat_request.top_n if chat_request.top_n is not None else RERANKER_TOP_N,
            reranking_threshold=chat_request.reranking_threshold
            if chat_request.reranking_threshold is not None
            else RERANKING_THRESHOLD,
        )

        # RAG orchestration with tracing span
        tracer = get_tracer("chatqna.orchestrate")
        with tracer.start_as_current_span("chatqna.orchestrate") as span:
            span.set_attribute("rag.query_length", len(last_translated_message_content))
            span.set_attribute("rag.model_id", LLM_MODEL)

            _rag_start = time.time()
            try:
                result_dict, runtime_graph = await self.megaservice.schedule(
                    initial_inputs={"text": last_translated_message_content},
                    llm_parameters=parameters,
                    retriever_parameters=retriever_parameters,
                    reranker_parameters=reranker_parameters,
                    full_chat_history_string=translated_history_string,
                    retrieval_context=retrieval_context,
                    original_language=original_language,
                    user_details=user_details,
                )
                _rag_duration = time.time() - _rag_start

                # Count retrieved documents from result
                chunk_count = 0
                for _key, val in result_dict.items():
                    if hasattr(val, "retrieved_docs"):
                        chunk_count = len(val.retrieved_docs)
                        break
                span.set_attribute("rag.chunk_count", chunk_count)

                # Record custom application metrics
                response_type = "streaming" if chat_request.stream else "sync"
                _metric_attrs = sanitize_attributes(
                    {
                        "response_type": response_type,
                        "abstained": "false",
                        "error": "false",
                        "retrieval_source": getattr(retriever_parameters, "search_type", "hybrid"),
                    }
                )
                chat_requests_total.add(1, _metric_attrs)
                chat_rag_duration_seconds.record(_rag_duration, _metric_attrs)

            except Exception as e:
                from opentelemetry.trace import StatusCode

                # Record error metric
                _err_duration = time.time() - _rag_start
                _err_attrs = sanitize_attributes(
                    {
                        "response_type": "streaming" if chat_request.stream else "sync",
                        "abstained": "false",
                        "error": "true",
                        "retrieval_source": getattr(retriever_parameters, "search_type", "hybrid"),
                    }
                )
                chat_requests_total.add(1, _err_attrs)
                chat_rag_duration_seconds.record(_err_duration, _err_attrs)

                span.set_status(StatusCode.ERROR)
                span.record_exception(e)
                raise

        if logflag:
            logger.debug(
                f"Result Dict: "
                f"{list(result_dict.keys()) if isinstance(result_dict, dict) else type(result_dict).__name__}"
            )
            logger.debug(f"\nRuntime Graph: {runtime_graph}")

        for _node, response in result_dict.items():
            if isinstance(response, StreamingResponse):
                # Wrap the token stream so the reranker-grounded metadata (source docs,
                # confidence, is_grounded) is emitted before [DONE]. Without this the
                # backend would re-run retrieval without the category filter / reranker.
                return StreamingResponse(
                    self._stream_with_metadata(response.body_iterator, result_dict),
                    media_type="text/event-stream",
                )

        llm_response = result_dict.get(self._find_node_key("llm", result_dict), {}).get(
            "text", "Sorry, I could not generate a response."
        )

        # Strip leaked conversation markers from LLM response.
        # The LLM sometimes echoes back the |<-MSG->| delimiters and
        # USER:/ASSISTANT: role markers that are used internally to
        # format chat history in the prompt.
        llm_response = re.sub(r"\s*\|<-MSG->\|\s*", "\n", llm_response)
        llm_response = re.sub(r"^(USER|ASSISTANT):\s*", "", llm_response, flags=re.MULTILINE)

        if original_language and original_language.strip() != "EN":
            if logflag:
                lang_type = type(original_language).__name__
                logger.info(f"Translation requested - original_language: '{original_language}' (type: {lang_type})")

            # Load Language Codes
            language_codes = self.load_language_codes(LANGUAGE_CODES_FILEPATH)

            if logflag:
                keys_preview = list(language_codes.keys())[:10]
                logger.info(f"Language codes loaded - keys: {keys_preview}... (total: {len(language_codes)})")

            # Fallback logic for language codes. If not in map, use the original code.
            target_lang_name = original_language
            lookup_key = original_language.lower()

            if logflag:
                logger.info(f"Looking up language code: '{lookup_key}' in language_codes")

            if lookup_key in language_codes:
                target_lang_name = language_codes[lookup_key]
                if logflag:
                    logger.info(f"Found language code mapping: '{lookup_key}' -> '{target_lang_name}'")
            else:
                msg = (
                    f"Warning: Language '{original_language}' not found in "
                    f"language codes (lookup key: '{lookup_key}'). "
                    "Attempting to translate using code directly."
                )
                logger.warning(msg)

            if logflag:
                logger.debug(f"LLM response to be translated into: {target_lang_name}")

            try:
                final_text_response = await self._translate_with_chunking(
                    llm_response, target_lang_name, original_language
                )
                if logflag:
                    logger.info("Translation completed successfully")
            except Exception as e:
                logger.error(f"Translation failed: {e}, returning original response")
                final_text_response = llm_response
        else:
            final_text_response = llm_response

        if logflag:
            logger.debug(f"\nFinal Text Response: {final_text_response}")

        # Assemble source documents + confidence + grounding flag. Reflects the reranker's
        # verdict; not grounded (is_grounded=False) when the reranker found nothing relevant.
        source_documents_formatted, confidence_score, is_grounded = await self._assemble_source_documents(result_dict)

        # Construct the final JSON payload
        final_response_payload = {
            "response": final_text_response,
            "metadata": {
                "source_documents": source_documents_formatted,
                "confidence_score": round(confidence_score, 2),
                # Whether the answer is backed by retrieved document chunks (true) or
                # generated from the LLM's parametric knowledge (false). Frontend uses
                # this to flag responses that have no document basis.
                "is_grounded": is_grounded,
            },
        }

        # Return as a JSONResponse
        if logflag:
            logger.info(f"Megaservice output payload: {final_response_payload}")
        return final_response_payload

    def start(self):

        self.service = MicroService(
            self.__class__.__name__,
            service_role=ServiceRoleType.MEGASERVICE,
            host=self.host,
            port=self.port,
            endpoint=self.endpoint,
            input_datatype=ChatCompletionRequest,
        )

        self.service.add_route(self.endpoint, self.handle_request, methods=["POST"])

        # FastAPI auto-instrumentation is handled globally by tracing.py
        # setup_tracing() → FastAPIInstrumentor().instrument() runs before
        # OPEA comps creates the FastAPI app, so traceparent extraction works.

        self.service.start()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--without-rerank", action="store_true")
    parser.add_argument("--faqgen", action="store_true")
    # Added --with-translation to prevent crash on unknown argument if CHATQNA_DAVID is used
    parser.add_argument("--with-translation", action="store_true")
    parser.add_argument("--without-translation", action="store_true")
    parser.add_argument("--genieai", action="store_true")
    args = parser.parse_args()

    chatqna = ChatQnAService(port=MEGA_SERVICE_PORT)
    if args.without_rerank:
        chatqna.add_remote_service_without_rerank()
    elif args.faqgen:
        chatqna.add_remote_service_faqgen()
    elif args.without_translation:
        chatqna.add_remote_service_without_translation()
    elif args.genieai:
        chatqna.add_remote_service_genieai()
    else:
        chatqna.add_remote_service()

    chatqna.start()