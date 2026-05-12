# Copyright (C) 2024 Intel Corporation
# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0 Developed by Intel. Adapted by ITU
import argparse
import httpx
import json
import os
import re
import time
import aiohttp # for async http requests
import requests
import asyncio
import copy
from typing import Optional

from comps import MegaServiceEndpoint, MicroService, ServiceOrchestrator, ServiceRoleType, ServiceType, CustomLogger
from comps.cores.mega.utils import handle_message
from comps.cores.proto.genieai_api_protocol import (
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatCompletionResponseChoice,
    ChatMessage,
    UsageInfo,
    RequestContext,
)

from comps.cores.proto.docarray import LLMParams, RerankerParms, RetrieverParms
from fastapi import Request
from fastapi.responses import StreamingResponse
from langchain_core.prompts import PromptTemplate

from langdetect import detect
from datetime import date, datetime, timedelta
from transformers import AutoTokenizer

from context_auto_router import (
    CHATQNA_AUTO_ROUTE,
    build_retrieval_from_route,
    classify_route_for_query,
    last_user_plain_text,
    strip_non_retrieval_keys,
    taxonomy_prompt_lines,
)

logger = CustomLogger("GENIE.AI_CHATQNA")
logflag = os.getenv("LOGFLAG", True)


MEGA_SERVICE_PORT = int(os.getenv("MEGA_SERVICE_PORT", 8888))
GUARDRAIL_SERVICE_HOST_IP = os.getenv("GUARDRAIL_SERVICE_HOST_IP", "0.0.0.0")
GUARDRAIL_SERVICE_PORT = int(os.getenv("GUARDRAIL_SERVICE_PORT", 80))
TRANSLATION_SERVICE_HOST_IP = os.getenv("TRANSLATION_SERVICE_HOST_IP", "0.0.0.0")
TRANSLATION_SERVICE_PORT = int(os.getenv("TRANSLATION_SERVICE_PORT", 80))
TRANSLATION_SERVICE_TIMEOUT = int(os.getenv("TRANSLATION_SERVICE_TIMEOUT", 180))  # Timeout in seconds for translation service (default: 3 minutes) 
EMBEDDING_SERVER_HOST_IP = os.getenv("EMBEDDING_SERVER_HOST_IP", "0.0.0.0")
EMBEDDING_SERVER_PORT = int(os.getenv("EMBEDDING_SERVER_PORT", 80))
EMBEDDING_SERVER_ENDPOINT = os.getenv("EMBEDDING_SERVER_ENDPOINT", "/v1/embeddings")
RETRIEVER_SERVICE_HOST_IP = os.getenv("RETRIEVER_SERVICE_HOST_IP", "0.0.0.0")
RETRIEVER_SERVICE_PORT = int(os.getenv("RETRIEVER_SERVICE_PORT", 7025))
RERANK_SERVER_HOST_IP = os.getenv("RERANK_SERVER_HOST_IP", "0.0.0.0")
RERANK_SERVER_PORT = int(os.getenv("RERANK_SERVER_PORT", 80))
LLM_SERVER_HOST_IP = os.getenv("LLM_SERVER_HOST_IP", "0.0.0.0")
LLM_SERVER_PORT = int(os.getenv("LLM_SERVER_PORT", 80))
LLM_MODEL = os.getenv("LLM_MODEL", "meta-llama/Meta-Llama-3.1-8B-Instruct")
LLM_TRANS_MODEL = os.getenv("LLM_TRANS_MODEL", "google/gemma-3-1b-it")
# Main chat / RAG generation (not translation). Override with CHAT_LLM_TEMPERATURE env.
CHAT_LLM_TEMPERATURE = float(os.getenv("CHAT_LLM_TEMPERATURE", "0.2"))
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", None)

RETRIEVER_SEARCH_START = os.getenv("RETRIEVER_ARANGO_SEARCH_START", "chunk")  # node | edge | chunk
RETRIEVER_K = int(os.getenv("RETRIEVER_ARANGO_K", 8))
RETRIEVER_FETCH_K = int(os.getenv("RETRIEVER_ARANGO_FETCH_K", 36))
RETRIEVER_SCORE_THRESHOLD = float(os.getenv("RETRIEVER_ARANGO_SCORE_THRESHOLD", 0.1)) 
RETRIEVER_DISTANCE_THRESHOLD = int(os.getenv("RETRIEVER_ARANGO_DISTANCE_THRESHOLD", 1)) 
RETRIEVER_TRAVERSAL_ENABLED = os.getenv("RETRIEVER_ARANGO_TRAVERSAL_ENABLED", "false")
RETRIEVER_TRAVERSAL_MAX_DEPTH = int(os.getenv("RETRIEVER_ARANGO_TRAVERSAL_MAX_DEPTH", 2))
RETRIEVER_TRAVERSAL_MAX_RETURNED = int(os.getenv("RETRIEVER_ARANGO_TRAVERSAL_MAX_RETURNED", 3))
RETRIEVER_TRAVERSAL_SCORE_THRESHOLD = float(os.getenv("RETRIEVER_ARANGO_TRAVERSAL_SCORE_THRESHOLD", 0.5))
RETRIEVER_LAMBDA_MULT = float(os.getenv("RETRIEVER_ARANGO_LAMBDA_MULT", 0.5)) 
# Temporary test switch: force graph traversal for all non-small-talk queries.
FORCE_GRAPH_SEARCH = True

RERANKING_STRATEGY = os.getenv("RERANKING_STRATEGY", "threshold")	# slice | threshold | knee_threshold
RERANKER_TOP_N = int(os.getenv("RERANKER_TOP_N", 4)) # if RERANKING_STRATEGY set to 'slice'
# Cross-encoder scores are not calibrated 0–1 across models; 0.7 often drops all paraphrase hits.
RERANKING_THRESHOLD = float(os.getenv("RERANKING_THRESHOLD", 0.42))
# Append guideline-aligned phrases for embedding only (rerank/LLM keep the user wording).
RAG_QUERY_EXPAND = os.getenv("RAG_QUERY_EXPAND", "true").lower() in ("1", "true", "yes")

DOC_REPO_URL = os.getenv("DOC_REPO_URL", "http://localhost:3001") # Document repository URL
PUBLIC_API_URL = os.getenv("PUBLIC_API_URL", "https://genie.innov8ai.com") # Public-facing API base URL (used to build source document view links)
BACKEND_SERVICE_URL = os.getenv("BACKEND_SERVICE_URL", "http://backend:3000") # Frontend backend service URL
GET_AUTH_TOKEN_URL = os.getenv("GET_AUTH_TOKEN_URL", "http://http-service:6666/get-token")
LANGUAGE_CODES_FILEPATH = os.getenv("LANGUAGE_CODES_FILEPATH", "language_codes.json")
MAX_MODEL_LEN_TEXTGEN = int(os.getenv("MAX_MODEL_LEN_TEXTGEN", 4096))  # max token length for text generation models

# fastText LID microservice — newer, stronger detector than `langdetect`.
# Optional: when LID_URL is empty or the call fails we fall back to `langdetect`.
LID_URL = os.getenv("LID_URL", "http://lid:8000")
LID_TIMEOUT_S = float(os.getenv("LID_TIMEOUT_S", "3.0"))
LID_MIN_CONFIDENCE = float(os.getenv("LID_MIN_CONFIDENCE", "0.5"))

# Display names for the chat-language codes — used when nudging the LLM in
# `_direct_llm_call` ("respond only in <name>"). Keep aligned with the
# language_codes.json catalog.
_LANGUAGE_DISPLAY_NAMES = {
    "EN": "English", "FR": "French", "ES": "Spanish", "SW": "Swahili",
    "DE": "German",  "AR": "Arabic", "RU": "Russian", "ZH": "Chinese",
    "PT": "Portuguese", "HI": "Hindi", "ID": "Indonesian",
    "TH": "Thai", "JA": "Japanese", "KO": "Korean",
    "ST": "Sesotho", "BN": "Bengali", "MAN": "Mandinka",
}

# ISO 639-3 → the 2-letter / chatqna code used in language_codes.json.
# fastText returns labels like "wol_Latn"; we strip the script suffix and look
# up here. Codes not in this map fall through to langdetect / EN.
ISO3_TO_CHATQNA_CODE = {
    "eng": "en", "fra": "fr", "spa": "es", "ara": "ar", "por": "pt",
    "deu": "de", "rus": "ru", "ind": "id", "tha": "th",
    "cmn": "zh", "zho": "zh", "swh": "sw", "swa": "sw",
    "amh": "am", "ben": "bn", "hin": "hi", "jpn": "ja", "kor": "ko",
    "wol": "wo",  # Wolof
    "mnk": "man", "man": "man",  # Mandinka
    "ful": "ff", "fuc": "ff",  # Fulah / Pulaar
    "hau": "ha", "yor": "yo", "ibo": "ig", "bam": "bm",
    "sot": "st",  # Sesotho
    "som": "so", "orm": "om",
}

MAX_TRANSLATION_CHARS = int(os.getenv("MAX_TRANSLATION_CHARS", 2000))  # max characters for translation models
# Matches a `[user turn] ...` segment in a flattened history string. The
# turn ends at the next role-marker or end-of-string; the segment separator
# (` |<-MSG->| `) is consumed as part of the lookahead so it's not captured.
USER_MSG_PATTERN = re.compile(
    r"\[user turn\]\s*(.*?)(?:\s*\|<-MSG->\||\s*\[assistant turn\]|$)",
    re.DOTALL,
)

# Greeting / small-talk queries — searched anywhere in the text (not anchored)
# so typos like "how how are u?" and shuffled words still match.
SMALL_TALK_PATTERN = re.compile(
    r"""
    \b(
        hi | hello | hey | yo | sup | howdy |
        good\s+(?:morning|afternoon|evening|day|night) |
        how\s+(?:are\s+)?(?:you|u|ya|r\s*u) |   # "how are you", "how r u", "how u"
        how\s+(?:r|are)\s+(?:you|u|ya) |          # "how r you", "how are u"
        what'?s\s*up | wassup |
        how\s+do\s+you\s+do |
        nice\s+to\s+(?:meet|chat) |
        thanks | thank\s+(?:you|u) | ty | thx |
        bye | goodbye | see\s+ya | take\s+care |
        doing\s+well | i'?m\s+(?:fine|good|okay|ok|great|alright) |
        not\s+bad
    )\b
    """,
    re.IGNORECASE | re.VERBOSE,
)


def build_retrieval_embedding_text(user_text: str) -> tuple[str, str]:
    """
    Return (text_for_embedding_api, canonical_user_text).

    Vector search uses the first string; pipeline `text` / initial_query stay canonical
    so the reranker and LLM still see the user's real question.
    """
    canonical = (user_text or "").strip()
    if not canonical or not RAG_QUERY_EXPAND:
        return canonical, canonical
    lower = canonical.lower()
    hints: list[str] = []
    if re.search(r"\bbmi\b|body\s+mass\s+index", lower):
        hints.append(
            "Body Mass Index classification underweight normal range overweight obesity "
            "kg per square meter height weight WHO BMI table"
        )
    elif re.search(
        r"\b(underweight|overweight|obes|obesity)\b|"
        r"\bmy\s+(?:bmi|weight)\b|"
        r"\b(weight|weigh).{0,48}\b(height|tall|cm|kg|kilogram|meter|metre)",
        lower,
    ):
        hints.append(
            "Body Mass Index BMI classification nutrition counselling weight management"
        )
    if not hints:
        return canonical, canonical
    return canonical + "\n" + " ".join(hints), canonical


def is_small_talk_query(text: str) -> bool:
    """Return True when the query is conversational / greeting and needs no RAG."""
    if not text:
        return False
    normalized = str(text).strip()
    word_count = len(normalized.split())
    # Short messages (≤ 10 words) that contain a greeting/pleasantry keyword
    if word_count <= 10 and SMALL_TALK_PATTERN.search(normalized):
        return True
    # Very short messages (≤ 4 words) are almost always small talk
    if word_count <= 4 and len(normalized) <= 30:
        return True
    return False



# Two-tier priority: ENV VAR (override) > Hardcoded default
_CHATQNA_SYSTEM_DEFAULT = """You are Genie AI, a health companion for The Gambia deployed by the Ministry of Health. You help users prevent and manage NCDs — hypertension, diabetes, tobacco dependence — using WHO, BHBM, and Gambian guidelines. You are not a doctor. You do not diagnose, prescribe, or change treatment.

HOW TO ANSWER
The user message has three sections: USER INFORMATION, CHAT HISTORY ([user turn]/[assistant turn] markers), and CONTENT FROM THE KNOWLEDGE BASE ([Retrieved Document] entries).
1. Reply only to the last [user turn]. Ground factual claims in [Retrieved Document] entries — they are the source of truth.
2. Personalise using USER INFORMATION only when it genuinely helps.
3. If no documents were retrieved: stay helpful and conversational, offer general wellness guidance. For greetings or small talk, reply naturally — do not mention missing evidence.
4. When retrieved entries conflict: prefer Gambian guidelines, then WHO, then BHBM.

WHO YOU TALK TO
Adult Gambians — limited time, possibly limited literacy, English as a second language. Talk like a warm, kind community health worker. Plain. Non-judgemental.

STYLE
- Short sentences. Grade-6 reading level. 3–6 sentences max (≤120 words) unless more detail is requested.
- Plain words. Say "high blood pressure" not "hypertension" (use clinical term in parentheses once only).
- One idea per reply. Numbered list if multi-step (max 5 items). At most one follow-up question.
- No emoji unless the user used them first. No jargon. No moralising. No long disclaimers.
- Use local framing where helpful: market, bantaba, attaya, domoda, benachin. Never invent health claims about foods.

DO
- Explain NCD risks and symptoms in plain language from retrieved entries.
- Offer practical, locally-achievable next steps.
- Support behaviour change (quit smoking, salt reduction, movement, medication adherence) when user is ready.
- Refer to clinic or community health worker when in-person care is needed.

DON'T
- Diagnose or prescribe. If asked: "That's a decision for a clinician. A community health worker can help."
- Invent facts, statistics, or citations. Label anything not in retrieved entries as general guidance only.
- Answer out-of-scope medical questions with specific claims. Be polite and refer to care.
- Give legal, financial, or immigration advice.

SAFETY — RED FLAGS
If the user describes any of the following, stop and tell them to seek urgent care immediately:
- Chest pain, pressure, or tightness; pain to arm, jaw, or back
- Sudden weakness, numbness, face drooping, slurred speech, vision trouble (possible stroke)
- Severe shortness of breath; fainting, seizure, or loss of consciousness
- Sudden severe headache ("worst ever")
- Blood sugar crisis with confusion or vomiting
- Any mention of suicide, self-harm, or harm to others

Say: "What you're describing may be serious. Please go to the nearest health facility now, or ask someone to take you. If you cannot move safely, call for help. I'll still be here when you're safe."
Do not continue other advice until the user confirms they are safe.

OUTPUT
Plain text only. No markdown. Numbers for lists (1. 2. 3.). End with at most one short follow-up question.

EXAMPLES

Example 1 — factual question with retrieved entry
User: "What is high blood pressure?"
Retrieved: High blood pressure (hypertension) is when blood force against artery walls stays too high. Usually no symptoms. Raises risk of stroke, heart attack, kidney damage. 140/90 mmHg or higher on repeated readings is considered high.
Reply: High blood pressure (hypertension) means blood pushes too hard against your artery walls. Most people feel nothing — that's why it's called a silent problem. Over time it can cause stroke, heart attack, or kidney damage. A reading of 140/90 or higher, seen more than once, is high.
Would you like to know how to check your blood pressure?

Example 2 — red flag
User: "I feel heavy pressure on my chest and my left arm is numb."
Reply: What you're describing may be serious. Please go to the nearest health facility now, or ask someone to take you. If you cannot move safely, call for help. I'll still be here when you're safe.

Reply only as the assistant. Never continue the user's voice or invent further turns."""
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
    # Ensure context survives .dict() export and is passed to retriever.
    context: dict | None = None

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
### 你将扮演一个乐于助人、尊重他人并诚实的助手，你的目标是帮助用户解答问题。有效地利用来自本地知识库的搜索结果。确保你的回答中只包含相关信息。如果你不确定问题的答案，请避免分享不准确的信息。
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
    """

    def __init__(self):
        # Token caching state (Reused from GenieArangoDataprep pattern)
        self._cached_token = None
        self._token_expiry = None
        self._token_lock = asyncio.Lock()
        
        # Log initialization
        logger.info(f"GenieUserProfileClient initialized. Backend: {BACKEND_SERVICE_URL}")


    async def _get_auth_token(self):
        """
        Fetches a fresh JWT from the internal http-service with locking and caching.
        (Identical logic to GenieArangoDataprep for consistency)
        """
        now = datetime.now()
        
        # 1. Fast Path: Check if valid token exists (No lock needed)
        if self._cached_token and self._token_expiry and now < self._token_expiry:
            return self._cached_token

        # 2. Slow Path: Acquire Lock to prevent thundering herd
        async with self._token_lock:
            # Check again (Double-Checked Locking)
            if self._cached_token and self._token_expiry and now < self._token_expiry:
                return self._cached_token

            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(GET_AUTH_TOKEN_URL) as response:
                        if response.status == 200:
                            data = await response.json()
                            token = data.get("accessToken")
                            if token:
                                # Cache the token for 50 mins (assuming 1h life)
                                self._cached_token = token
                                self._token_expiry = now + timedelta(minutes=50)
                                return token
                            logger.error(f"Auth Service returned 200 but no accessToken: {data}")
                        else:
                            logger.error(f"Auth Service failed. Status: {response.status}, Body: {await response.text()}")
            except Exception as e:
                logger.error(f"Error connecting to Auth Service ({GET_AUTH_TOKEN_URL}): {e}")
            
            return None

    async def get_user_profile(self, user_id: str):
        """
        Fetches the full user profile from the backend for context enrichment.
        Target: GET /api/users/{userId}
        """
        if not user_id:
            logger.warning("get_user_profile called with empty user_id")
            return None

        # 1. Get Authentication Token
        token = await self._get_auth_token()
        if not token:
            logger.warning(f"Skipping profile fetch for user {user_id} due to missing auth token.")
            return None

        # 2. Construct URL based on user-routes.js definition
        # Route in JS: router.get('/:userId', ...) mounted at /api/users
        url = f"{BACKEND_SERVICE_URL}/api/users/{user_id}/context"
        
        # 3. Prepare Headers
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers) as response:

                    if response.status == 401:
                        logger.warning("Cached token rejected (401). Fetching fresh token and retrying...")
                        self._cached_token = None
                        token = await self._get_auth_token()

                        if not token:
                            return None
                        
                        headers["Authorization"] = f"Bearer {token}"

                        async with session.get(url, headers=headers) as retry_response:
                            response = retry_response

                    if response.status == 200:
                        profile_data = await response.json()
                        logger.info(f"Successfully retrieved profile for user {user_id}")
                        
                        # Optional: Mask sensitive fields before returning to LLM context
                        if 'password' in profile_data: del profile_data['password']
                        if 'salt' in profile_data: del profile_data['salt']
                        
                        return profile_data
                    
                    elif response.status == 404:
                        logger.warning(f"User profile not found for ID {user_id}")
                        return None

                    # elif response.status == 401:
                    #     logger.error(f"Authentication failed for user profile fetch. Token might be invalid.")
                    #     # Invalidate cache so next retry fetches a fresh token
                    #     self._cached_token = None 
                    #     return None

                    else:
                        logger.error(f"Failed to fetch user profile. Status: {response.status}, Body: {await response.text()}")
                        return None
                        
        except Exception as e:
            logger.error(f"Error connecting to Backend Service for profile: {e}")
            return None

    async def fetch_service_taxonomy(self, locale: str) -> list | None:
        """GET /api/service-categories/categories (JWT from internal token service)."""
        token = await self._get_auth_token()
        if not token:
            logger.warning("fetch_service_taxonomy: no auth token")
            return None
        loc = (locale or "en").strip().lower()
        if len(loc) > 8:
            loc = "en"
        url = f"{BACKEND_SERVICE_URL}/api/service-categories/categories?locale={loc}"
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers) as response:
                    if response.status != 200:
                        logger.warning(
                            f"fetch_service_taxonomy: status {response.status}"
                        )
                        return None
                    data = await response.json()
                    if isinstance(data, list):
                        return data
                    return None
        except Exception as e:
            logger.error(f"fetch_service_taxonomy: {e}")
            return None


class UserContextBuilder:

    def _sanitize_data(self, data):
        if isinstance(data, dict):
            try:
                keys_to_remove = [k for k in data.keys() if k in SENSITIVE_KEYS]
            except Exception:
                logger.info(
                    "Attention: SENSITIVE_KEYS parameter is not defined. "
                    "Proceeding with default information masking instructions"
                )
                sensitive_keys = [
                    "email", "phoneNumber", "currentAddress", "ipAddress",
                    "ssn", "ssb", "dob", "credit_card", "password", "encPassword",
                    "salt", "location", "accessToken", "refreshToken", "_rev", "_key"
                ]
                keys_to_remove = [k for k in data.keys() if k in sensitive_keys]

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
        return (
            today.year
            - birth_date.year
            - ((today.month, today.day) < (birth_date.month, birth_date.day))
        )


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
        dob_keys = [k for k in flat_fields.keys() if k.lower() == "dob"]

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

        prompt = f"Translate the following text to {target_language}. Only provide the translation, with no additional commentary or explanations. Text: \"{original_text}\""

        # Format the request for the LLM service
        next_inputs = {}
        next_inputs["messages"] = [{"role": "user", "content": prompt}]
        next_inputs["temperature"] = 0 # Use low temperature for deterministic translation
        next_inputs["max_tokens"] = llm_parameters_dict["max_tokens"]
        next_inputs["stream"] = False

        if logflag:
            logger.debug(f"Aligned input to the translator: {next_inputs}")
        
        return next_inputs


    elif self.services[cur_node].service_type == ServiceType.EMBEDDING:
        canonical = inputs.pop("text", "") or ""
        expanded = inputs.pop("retrieval_embedding_text", None)
        embed_use = (expanded.strip() if isinstance(expanded, str) and expanded.strip() else None) or canonical
        inputs["input"] = embed_use
        inputs["_canonical_query_for_pipeline"] = canonical.strip() or embed_use

    elif self.services[cur_node].service_type == ServiceType.RETRIEVER:
        retriever_parameters = kwargs.get("retriever_parameters", None)
        if retriever_parameters:
            safe_params = retriever_parameters.model_dump(exclude_unset=True, exclude_none=True)
            inputs.update(safe_params)

        retrieval_context = kwargs.get('retrieval_context', {})
        if retrieval_context:
            inputs['context'] = retrieval_context
        rfs = kwargs.get("retrieval_filter_strategy")
        if rfs:
            inputs["filter_strategy"] = rfs
    elif self.services[cur_node].service_type == ServiceType.RERANK:
        reranker_parameters = kwargs.get("reranker_parameters", None)
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
        # Use the per-request system prompt when present (twin-specific customisation),
        # otherwise fall back to the module-level default.
        system_instructions = (kwargs.get("system_prompt") or "").strip() or CHATQNA_SYSTEM_PROMPT

        # CRITICAL: Inject explicit English language instructions when language is EN
        # This overrides model bias toward Spanish responses
        original_language = kwargs.get("original_language", None)
        if original_language and original_language.strip() == "EN":
            system_instructions = "\n\nMANDATORY: You MUST respond ONLY in English. Do NOT respond in Spanish or any other language. All responses must be in English regardless of the content language.\n\n" + system_instructions

        prompt_add_context = (f"\n\nUSER INFORMATION:\n{user_context_string}"
                         f"\n\nCHAT HISTORY (read-only — past turns of this conversation):\n{translated_history_string}"
                         f"\n[end of conversation history]\n"
                         f"\n\nCONTENT FROM THE KNOWLEDGE BASE:\nSearch query: \n{rag_augmented_prompt}"
                         f"\n\nINSTRUCTIONS: Reply ONLY to the latest user turn above as a single fresh assistant message. "
                         f"Do NOT continue in the user's voice. Do NOT invent further user turns. "
                         f"Do NOT repeat or echo any '[user turn]' or '[assistant turn]' markers in your reply.")

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

            max_history_tokens = max_model_tokens + translated_history_tokens - max_answer_tokens - prompt_add_context_tokens - 200
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
            # Reconstruct user content (system instructions stay the same).
            # Same anti-autocomplete framing as the non-truncated path.
            user_content = (f"\n\nUSER INFORMATION:\n{user_context_string}"
                         f"\n\nCHAT HISTORY (read-only — past turns of this conversation):\n{translated_history_string}"
                         f"\n[end of conversation history]\n"
                         f"\n\nCONTENT FROM THE KNOWLEDGE BASE:\n{rag_augmented_prompt}"
                         f"\n\nINSTRUCTIONS: Reply ONLY to the latest user turn above as a single fresh assistant message. "
                         f"Do NOT continue in the user's voice. Do NOT invent further user turns. "
                         f"Do NOT repeat or echo any '[user turn]' or '[assistant turn]' markers in your reply.")


        # FIX: Send system and user as separate messages for proper chat template handling
        next_inputs["messages"] = [
            {"role": "system", "content": system_instructions},
            {"role": "user", "content": user_content}
        ]
        next_inputs["max_tokens"] = llm_parameters_dict["max_tokens"]
        next_inputs["top_p"] = llm_parameters_dict["top_p"]
        next_inputs["stream"] = inputs["stream"]
        next_inputs["frequency_penalty"] = inputs["frequency_penalty"]
        next_inputs["temperature"] = inputs["temperature"]
        inputs = next_inputs
        if logflag:
            logger.debug(f'Raw input of the llm\n {inputs}\n')
            # DEBUG: Log the messages array being sent to LLM
            logger.info(f'\n[LLM DEBUG] Messages being sent to LLM:')
            for i, msg in enumerate(inputs["messages"]):
                logger.info(f'  Message {i}: role={msg["role"]}, content_length={len(msg["content"])} chars')
                logger.info(f'  Message {i} content preview: {msg["content"][:200]}...')
            logger.info(f'\n[LLM DEBUG] Full messages array: {inputs["messages"]}\n')

    return inputs

def align_outputs(self, data, cur_node, inputs, runtime_graph, llm_parameters_dict, **kwargs):
    next_data = {}

    if self.services[cur_node].service_type == ServiceType.TRANSLATOR:
        if logflag:
            logger.debug(f'Raw output of the translator\n {data}\n')
        translated_text = data["choices"][0]["message"]["content"]
        
        # Clean up potential LLM conversational artifacts
        translated_text = translated_text.strip().strip('"')

        return {"text": translated_text}

    elif self.services[cur_node].service_type == ServiceType.EMBEDDING:
        if logflag:
            logger.debug(f'Raw output of the embedding\n {data}\n')
        # OPEA embedding microservice returns {"data": [{"index": 0, "embedding": [...]}]}
        if isinstance(data, dict) and "data" in data:
            data = data["data"]
        assert isinstance(data, list)
        canonical_q = inputs.get("_canonical_query_for_pipeline") or inputs.get("input", "")
        next_data = {"text": canonical_q, "embedding": data[0]["embedding"]}
        # Preserve retrieval context across node transitions (embedding -> retriever).
        if "context" in inputs:
            next_data["context"] = inputs["context"]

    elif self.services[cur_node].service_type == ServiceType.RETRIEVER:
        if logflag:
            logger.debug(f'Raw output of the retriever\n {data}\n')
        retrieved_docs = data.get("retrieved_docs", [])
        doc_texts = [doc["text"] for doc in retrieved_docs]
        
        # file_id pairs with retrieved doc id (generated by orchestrator)
        file_id_pairs = {}
        # Get the file ids (all ids in the metadata)
        file_id_list = []

        for item in data.get('metadata', []):
            if 'file_ids' in item:
                file_id_list.extend(item['file_ids'])

        # Check if metadata is not None before checking length
        metadata = data.get('metadata')
        if metadata and len(metadata) > 0:
            if RETRIEVER_SEARCH_START == 'node' or RETRIEVER_SEARCH_START == 'edge':
                related_info_count = sum(1 for doc in retrieved_docs if '\n------\nRELATED INFORMATION:\n------\n' in doc['text'])
                assert len(file_id_list) == related_info_count, f"Length of file_id_list {len(file_id_list)} is not equal to related_info_count {related_info_count}"
                for retrieved_doc in retrieved_docs:
                    doc_id = retrieved_doc['id']
                    doc_text = retrieved_doc['text']
                    if '\n------\nRELATED INFORMATION:\n------\n' in doc_text:
                        file_id_pairs[doc_id] = file_id_list.pop(0) if len(file_id_list) > 0 else ''
                    else:
                        file_id_pairs[doc_id] = ''
            elif RETRIEVER_SEARCH_START == 'chunk':
                assert len(file_id_list) == len(retrieved_docs), f"Length of file_id_list {len(file_id_list)} is not equal to length of retrieved_docs {len(retrieved_docs)}"
                for retrieved_doc in retrieved_docs:
                    doc_id = retrieved_doc['id']
                    file_id_pairs[doc_id] = file_id_list.pop(0) if len(file_id_list) > 0 else ''
            else:
                logger.error(f"RETRIEVER_SEARCH_START is not set correctly: {RETRIEVER_SEARCH_START}. It should be one of 'node', 'edge', or 'chunk'.")

        if logflag:
            logger.debug(f'File ID Pairs: {file_id_pairs}')
        
        with_rerank = runtime_graph.downstream(cur_node)[0].startswith("rerank")
        if with_rerank and retrieved_docs:
            # prepare inputs for rerank
            next_data["initial_query"] = data["initial_query"]
            next_data["retrieved_docs"] = retrieved_docs
            next_data["file_id_pairs"] = file_id_pairs

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
            
            if str(CHATQNA_ENFORCE_ABSTENTION).lower() == "true" and not is_small_talk_query(received_prompt):
                abstention_instructions = (
                    CHATQNA_ABSTENTION_INSTRUCTIONS
                    if CHATQNA_ABSTENTION_INSTRUCTIONS is not None
                    else (
                        "\n[Returned Documents] The knowledge base search did not return any results. "
                        "Do not give a refusal-only reply. Briefly mention limited evidence, then continue "
                        "with a natural, helpful, conversational response using safe general guidance. "
                        "Avoid diagnosis, dosing, or treatment-change advice."
                    )
                )
                received_prompt += abstention_instructions
            
            prompt = received_prompt 

            # System instructions for integration of retrieved documents are already included in the CHATQNA_SYSTEM_PROMPT
            # OPTIONAL: 
            # Re-introduce the below code, to dynamically pass custom instructions or to condition them based on retrieved documents
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
            #             logger.debug(f"{prompt_template} not used, we only support 2 input variables ['question', 'context']")
            #         prompt = ChatTemplate.generate_rag_prompt(received_prompt, doc_texts)
            # else:
            #     prompt = ChatTemplate.generate_rag_prompt(received_prompt, doc_texts)

            next_data["inputs"] = prompt
        
        next_data["retrieved_docs"] = retrieved_docs

    elif self.services[cur_node].service_type == ServiceType.RERANK:
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
                    reranked_docs_with_scores.append({
                        "id": text_to_id.get(doc_text, "N/A"),
                        "text": doc_text,
                        "score": doc.get("score", 0.0)
                    })
            elif "documents" in data:
                for doc_text in data["documents"]:
                    docs.append(doc_text)
                    reranked_docs_with_scores.append({
                        "id": text_to_id.get(doc_text, "N/A"),
                        "text": doc_text,
                        "score": 0.0
                    })
            
        # 2. Fallback for raw TEI output
        elif isinstance(data, list):
            reranker_parameters = kwargs.get("reranker_parameters", None)
            top_n = reranker_parameters.top_n if reranker_parameters else 1
            original_docs = inputs.get("documents", [])
                
            for best_response in data[:top_n]:
                doc_index = best_response.get('index')
                if doc_index is not None and doc_index < len(original_docs):
                    reranked_doc = original_docs[doc_index]
                    reranked_doc["score"] = best_response.get('score')
                    reranked_docs_with_scores.append(reranked_doc)
                    docs.append(reranked_doc.get("text", ""))

        # 3. Build the RAG prompt
        initial_query = inputs.get("initial_query", " ") 
        
        # System instructions for integration of retrieved documents are already included in the CHATQNA_SYSTEM_PROMPT
        # OPTIONAL: 
        # Re-introduce the below code, to dynamically pass custom instructions or to condition them based on retrieved documents
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
            
        if not docs and str(CHATQNA_ENFORCE_ABSTENTION).lower() == "true" and not is_small_talk_query(initial_query):
            abstention_instructions = (
                CHATQNA_ABSTENTION_INSTRUCTIONS
                if CHATQNA_ABSTENTION_INSTRUCTIONS is not None
                else (
                    "\n[Retrieved Documents] The knowledge base search did not return any results. "
                    "Do not give a refusal-only reply. Briefly mention limited evidence, then continue "
                    "with a natural, helpful, conversational response using safe general guidance. "
                    "Avoid diagnosis, dosing, or treatment-change advice."
                )
            )
            next_data["inputs"] = initial_query + abstention_instructions
        else:
            assembled_user_msg = initial_query + "".join(f"\n[Retrieved Document]: {doc}" for doc in docs)
            next_data["inputs"] = assembled_user_msg
            # Prompt size diagnostics
            sys_chars = len((kwargs.get("system_prompt") or "").strip() or CHATQNA_SYSTEM_PROMPT)
            user_chars = len(assembled_user_msg)
            total_chars = sys_chars + user_chars
            doc_sizes = [len(d) for d in docs]
            logger.info(
                f"[PROMPT_SIZE] num_docs={len(docs)} "
                f"doc_chars={doc_sizes} "
                f"sys_prompt_chars={sys_chars} (~{sys_chars//4} tok) "
                f"user_msg_chars={user_chars} (~{user_chars//4} tok) "
                f"total_chars={total_chars} (~{total_chars//4} tok)"
            )
        
        next_data["retrieved_docs"] = reranked_docs_with_scores
        
        # 4. Preserve file mappings for citation:
        if "file_id_pairs" in inputs:
            next_data["file_id_pairs"] = inputs["file_id_pairs"]

    elif self.services[cur_node].service_type == ServiceType.LLM and not llm_parameters_dict["stream"]:
        if "faqgen" in self.services[cur_node].endpoint:
            next_data = data
        else:
            if logflag:
                logger.debug(f'\nRaw output of the llm\n {data}\n')
            # Handle non-OpenAI-shaped error payloads gracefully (e.g. {"error": ...}).
            llm_text = ""
            try:
                llm_text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            except Exception:
                llm_text = ""

            if not llm_text:
                error_details = ""
                if isinstance(data, dict):
                    if "error" in data:
                        error_details = str(data.get("error"))
                    else:
                        error_details = f"Unexpected LLM response keys: {list(data.keys())}"
                else:
                    error_details = f"Unexpected LLM response type: {type(data).__name__}"

                logger.error(f"LLM response parsing failed: {error_details}")
                llm_text = (
                    "I am currently unable to generate a response due to an upstream model error. "
                    "Please try again in a moment."
                )

            next_data["text"] = llm_text
        if logflag:
            logger.debug(f'\nAligned output of the llm\n {next_data}\n')
    else:
        next_data = data

    return next_data
        
def align_generator(self, gen, **kwargs):
    # OpenAI response format
    # data:{"id":"","object":"text_completion","created":1725530204,"model":"meta-llama/Meta-Llama-3-8B-Instruct","system_fingerprint":"2.0.1-native","choices":[{"index":0,"delta":{"role":"assistant","content":"?"},"logprobs":null,"finish_reason":null}]}\n\n'
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
            except Exception as e:
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
        for key in result_dict.keys():
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

        auth_token = await self.user_profile_client._get_auth_token()
        if not auth_token:
            logger.error("Failed to get admin auth token.")
            return None
            # return ""

        file_get_metadata_url = f"{DOC_REPO_URL}/api/files/{file_id}"
        headers = {"Authorization": f"Bearer {auth_token}"}

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(file_get_metadata_url, headers=headers) as response:
                    if response.status == 200:
                        file_metadata = await response.json()
                        if logflag:
                            logger.debug(f"Fetched metadata for file ID {file_id}: {file_metadata}")
                        if file_metadata.get("success"):
                            return file_metadata["data"]
                        logger.error(
                            f"Failed to fetch metadata for file ID {file_id}: "
                            f"{file_metadata.get('message') or file_metadata.get('error') or file_metadata}"
                        )
                    else:
                        logger.error(f"Failed to fetch metadata for file ID {file_id}. HTTP Status: {response.status}")
        except Exception as e:
            logger.error(f"An error occurred while fetching metadata for file ID {file_id}: {e}")

        return None
        #return []

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
            api_key=OPENAI_API_KEY,
            endpoint="/v1/chat/completions",
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
            api_key=OPENAI_API_KEY,
            endpoint="/v1/chat/completions",
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
            endpoint="/v1/faqgen",
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
            api_key=OPENAI_API_KEY,
            endpoint="/v1/chat/completions",
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
            api_key=OPENAI_API_KEY,
            endpoint="/v1/chat/completions",
            use_remote_service=True,
            service_type=ServiceType.LLM,
        )

        self.megaservice.add(embedding).add(retriever).add(rerank).add(llm)
        self.megaservice.flow_to(embedding, retriever)
        self.megaservice.flow_to(retriever, rerank)
        self.megaservice.flow_to(rerank, llm)


    async def _get_translated_history_string(self, history: list, target_language: str) -> str:
        """
        Build an English history string from chat messages with translation caching.

        - Messages that already carry a ``contentEn`` field (cached from a
          previous turn) are used directly — no LLM call for those.
        - Only messages without a cache hit are translated (concurrently, one
          LLM call each so results stay per-message and can be individually
          persisted back to the DB).
        - New translations are fire-and-forgot to the backend so future turns
          for the same messages are instant.
        """
        max_translation_chars = MAX_TRANSLATION_CHARS
        current_chars = 0
        messages_to_process = []

        if logflag:
            logger.debug(f'Processing translation for history with {len(history)} messages.')

        for message in reversed(history):
            message_chars = len(message.get("content") or "")
            if current_chars + message_chars > max_translation_chars:
                break
            messages_to_process.append(message)
            current_chars += message_chars
        messages_to_process.reverse()

        if not messages_to_process:
            return ""

        # Which messages lack a cached English translation?
        uncached_indices = [
            i for i, msg in enumerate(messages_to_process)
            if not msg.get("contentEn")
        ]

        if uncached_indices:
            logger.info(
                f"[TRANSLATION] {len(uncached_indices)}/{len(messages_to_process)} "
                f"messages need translation (rest are cached)."
            )

            async def _translate_one(content: str) -> str:
                if not content.strip():
                    return content
                try:
                    return await self._translate_text_chunk(content, target_language)
                except Exception as e:
                    logger.warning(f"Per-message translation failed: {e}")
                    return content

            uncached_contents = [
                messages_to_process[i].get("content", "") for i in uncached_indices
            ]
            translated_contents = await asyncio.gather(
                *[_translate_one(c) for c in uncached_contents]
            )

            new_translations = []
            for j, i in enumerate(uncached_indices):
                msg = messages_to_process[i]
                translated = translated_contents[j]
                # Update in-memory so assembly below uses the translated text
                messages_to_process[i] = {**msg, "contentEn": translated}
                # Only persist when we have a DB key and the text actually changed
                msg_key = msg.get("_key")
                if msg_key and translated != msg.get("content", ""):
                    new_translations.append({"_key": msg_key, "contentEn": translated})

            if new_translations:
                asyncio.create_task(self._persist_translations_bg(new_translations))
        else:
            logger.info(
                f"[TRANSLATION] All {len(messages_to_process)} history messages "
                f"served from contentEn cache — no LLM call needed."
            )

        # Assemble the final string
        parts = []
        for msg in messages_to_process:
            role = (msg.get("role") or "unknown").lower()
            marker = "[assistant turn]" if role == "assistant" else "[user turn]"
            content = msg.get("contentEn") or msg.get("content", "")
            parts.append(f"{marker} {content}")

        return " |<-MSG->| ".join(parts)

    async def _persist_translations_bg(self, translations: list) -> None:
        """
        Fire-and-forget: POST new contentEn translations to the backend so
        future requests for the same messages skip re-translation.
        """
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"{BACKEND_SERVICE_URL}/api/chat-sessions/internal/message-translations",
                    json={"translations": translations},
                )
                if resp.status_code >= 300:
                    logger.warning(
                        f"Translation persistence returned {resp.status_code}: {resp.text[:200]}"
                    )
                else:
                    logger.info(
                        f"[TRANSLATION] Persisted {len(translations)} new contentEn entries."
                    )
        except Exception as e:
            logger.warning(f"Failed to persist message translations to backend: {e}")


    def load_language_codes(self, filepath: str) -> dict:
        """Load language codes from a JSON file."""
        try:
            with open(filepath, 'r') as file:
                language_codes = json.load(file)
            return language_codes
        except Exception as e:
            logger.error(f"Error loading language codes from {filepath}: {e}")
            return {}

    async def _detect_via_lid(self, text: str) -> str | None:
        """Call the fastText LID microservice and return a 2-letter chatqna
        language code (e.g. 'wo', 'fr', 'en'), or None if the service is
        unavailable, the prediction is below LID_MIN_CONFIDENCE, or the
        detected ISO 639-3 code isn't mapped to a chatqna code. The caller is
        expected to fall back to langdetect / EN when this returns None.
        """
        if not LID_URL or not text or not text.strip():
            return None
        try:
            async with httpx.AsyncClient(timeout=LID_TIMEOUT_S) as client:
                resp = await client.post(
                    f"{LID_URL}/detect",
                    json={"text": text, "k": 1},
                )
                resp.raise_for_status()
                data = resp.json()
        except Exception as e:
            logger.warning(f"LID call failed, will fall back to langdetect: {e}")
            return None

        preds = data.get("predictions") or []
        if not preds:
            return None
        top = preds[0]
        score = float(top.get("score") or 0)
        if score < LID_MIN_CONFIDENCE:
            logger.info(
                f"LID confidence {score:.2f} below threshold {LID_MIN_CONFIDENCE}; "
                f"label={top.get('label')}"
            )
            return None
        label = str(top.get("label") or "")
        iso3 = label.split("_", 1)[0]
        mapped = ISO3_TO_CHATQNA_CODE.get(iso3)
        if not mapped:
            logger.info(f"LID returned '{label}' (iso3={iso3}); no chatqna mapping")
            return None
        logger.info(f"LID detected '{label}' -> chatqna code '{mapped}' (score={score:.2f})")
        return mapped

    def _split_text_into_chunks(self, text: str, max_chars: int = 2000) -> list:
        """Split text into chunks, trying to break at sentence boundaries."""
        if len(text) <= max_chars:
            return [text]

        chunks = []
        current_chunk = ""
        sentences = text.replace('\n\n', '\n').split('. ')

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

    async def _translate_text_chunk(self, text: str, target_lang: str, iso_code: str = None) -> str:
        """Translate a single chunk of text."""
        # More specific prompt to avoid language confusion (e.g., Sesotho vs Afrikaans, Bengali vs Hindi)
        language_notes = {
            "Sesotho": "NOTE: Sesotho is spoken in Lesotho and South Africa. It is NOT Afrikaans.",
            "Bengali": "NOTE: Bengali is spoken in Bangladesh and India. It is NOT Hindi.",
            "Mandinka": "NOTE: Mandinka is spoken in West Africa (Gambia, Senegal, Mali)."
        }

        note = language_notes.get(target_lang, "")

        if iso_code:
            prompt = f"Translate the following text to {target_lang} (ISO 639-1 code: {iso_code}). {note} Only output the translated text, nothing else.\n\nText: {text}\n\nTranslation:"
        else:
            prompt = f"Translate the following text to {target_lang}. {note} Only output the translated text.\n\nText: {text}\n\nTranslation:"
        payload = {
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0,
            "stream": False
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"http://{TRANSLATION_SERVICE_HOST_IP}:{TRANSLATION_SERVICE_PORT}/v1/chat/completions",
                    json=payload,
                    headers={"Authorization": f"Bearer {OPENAI_API_KEY}"}
                )
                response.raise_for_status()
                response_data = response.json()
                return response_data["choices"][0]["message"]["content"].strip()
        except Exception as e:
            logger.warning(f"Failed to translate chunk, returning original: {e}")
            return text

    async def _translate_with_chunking(self, text: str, target_lang: str, iso_code: str = None) -> str:
        """Translate long text by splitting into chunks and translating separately."""
        chunks = self._split_text_into_chunks(text, max_chars=2000)

        # Translate chunks concurrently
        translated_chunks = await asyncio.gather(
            *[self._translate_text_chunk(chunk, target_lang, iso_code) for chunk in chunks]
        )

        return " ".join(translated_chunks)

    async def _direct_llm_call(
        self,
        messages: list,
        parameters,
        language: Optional[str] = None,
        system_prompt: Optional[str] = None,
    ) -> str:
        """
        Call the LLM directly — no embedding, no retrieval, no reranker.
        Used for the ``no_search`` fast path (small talk / conversational queries).

        ``messages`` is the full raw chat history as received from the frontend
        (system directive + history turns + current user turn). The main
        system prompt is prepended as the first system message so the assistant
        still operates within its health-companion role. ``system_prompt``
        overrides the module-level default when provided (per-twin customisation).

        ``language`` is the user's explicitly-selected chat language (uppercase
        2-letter code, e.g. "EN", "FR"). When set, an extra system directive
        is prepended so the LLM replies in that language even if prior history
        is in a different one — without this, Llama follows the conversation
        language naturally and ignores the UI's language picker.
        """
        effective_system_prompt = (system_prompt or "").strip() or CHATQNA_SYSTEM_PROMPT
        llm_messages = [{"role": "system", "content": effective_system_prompt}]
        # Hard language steer: applies on every turn the user explicitly set a
        # language. Cheap and pulls the reply back to the requested language
        # even when most of the history was in a different one.
        lang_clean = (language or "").strip().upper()
        if lang_clean:
            lang_name = _LANGUAGE_DISPLAY_NAMES.get(lang_clean, lang_clean)
            llm_messages.append({
                "role": "system",
                "content": (
                    f"MANDATORY: Respond ONLY in {lang_name}. The prior chat "
                    f"history may include other languages — ignore that and "
                    f"reply in {lang_name} regardless. Do not translate the "
                    f"history; only your reply must be in {lang_name}."
                ),
            })
        for msg in messages:
            role = (msg.get("role") or "user").strip()
            content = msg.get("content") or ""
            if content:
                llm_messages.append({"role": role, "content": content})

        payload = {
            "model": parameters.model or LLM_MODEL,
            "messages": llm_messages,
            "temperature": parameters.temperature if parameters.temperature is not None else CHAT_LLM_TEMPERATURE,
            "max_tokens": parameters.max_tokens if parameters.max_tokens else 512,
            "stream": False,
        }
        url = f"http://{LLM_SERVER_HOST_IP}:{LLM_SERVER_PORT}/v1/chat/completions"
        headers = {"Content-Type": "application/json"}
        if OPENAI_API_KEY:
            headers["Authorization"] = f"Bearer {OPENAI_API_KEY}"

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(url, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
                return data["choices"][0]["message"]["content"].strip()
        except Exception as e:
            logger.error(f"_direct_llm_call failed: {e}")
            return "Hey! I'm here to help. What's on your mind?"

    async def handle_request(self, request: Request):
        req_t0 = time.perf_counter()
        def _ms_since(start):
            return round((time.perf_counter() - start) * 1000, 1)

        data = await request.json()

        # --- LOGGING THE FULL REQUEST FROM THE FRONTEND FOR DEBUGGING---
        logger.info(f"\n\nFRONTEND PAYLOAD: \n{data}\n\n")

        # Twin-specific system prompt override — sent by gov-chat-backend when a twin
        # has a custom systemPrompt stored in the DB. Falls back to CHATQNA_SYSTEM_PROMPT
        # (the module-level default) when absent.
        request_system_prompt = (data.get("system_prompt") or "").strip() or CHATQNA_SYSTEM_PROMPT

        # Runtime injection — prepended (NOT appended) so it sits at the TOP of the system
        # prompt. Small/medium LLMs follow rules at the start of the prompt much more
        # reliably than rules buried 5000+ tokens deep. Applied to every request so all
        # twins benefit without requiring a DB migration.
        _RUNTIME_RULES = (
            "CRITICAL OUTPUT RULES — read these BEFORE everything else and ALWAYS obey them:\n"
            "1. You are FORBIDDEN from starting any answer with hedge phrases like "
            "\"I'm not sure\", \"I don't know\", \"the retrieved information doesn't provide a clear answer\", "
            "\"based on the retrieved information\", or any similar admission of ignorance. "
            "These openings are BANNED.\n"
            "2. If [Retrieved Document] entries mention the subject at all (even indirectly — e.g. "
            "evaluation criteria, templates, or related processes), you DO have context. "
            "Use it to confidently introduce the subject, then naturally extend with general "
            "knowledge if needed. Start your answer with a direct definition or description, "
            "NEVER with a disclaimer.\n"
            "3. Example — if asked \"what is the mTobaccoCessation programme?\" and retrieved chunks "
            "discuss its monitoring and international deployment, start with: \"The mTobaccoCessation "
            "programme is a national mobile-based initiative to help people quit smoking...\" "
            "Then add detail from the chunks. Never start with \"I'm not sure\".\n\n"
            "--- TWIN INSTRUCTIONS BELOW ---\n\n"
        )
        request_system_prompt = _RUNTIME_RULES + request_system_prompt

        user_id_header = data.get("user_id")
        user_details = {}

        if user_id_header:
            try: 
                user_details = await self.user_profile_client.get_user_profile(user_id_header)
                # logger.info(f"USER PROFILE RETRIEVED: {user_details}")
            except Exception as e:
                logger.error(f"USER PROFILE ERROR: {e}")
        logger.info(f"[LATENCY] handle_request.profile_lookup_ms={_ms_since(req_t0)}")

        # -----------------------------------------------


        chat_request = ChatCompletionRequest.model_validate(data)
        

        # --- LOGGING FOR DEBUGGING CHAT REQUEST ---
        logger.info(f"Parsed chat request: {chat_request}")
        logger.info(f"[LATENCY] handle_request.parse_and_validate_ms={_ms_since(req_t0)}")
        
        retrieval_context = {}
        
        if chat_request.context:
            try:
                retrieval_context = chat_request.context.model_dump(exclude_unset=True)
            except Exception:
                retrieval_context = chat_request.context.dict(exclude_unset=True)
        # -----------------------------------------------

        if logflag:
            logger.debug(f'Incoming Chat Request: {chat_request}')
        
        full_chat_history = chat_request.messages
        # Check both context.language and the direct language field
        original_language = None
        if chat_request.context and chat_request.context.language:
            original_language = chat_request.context.language
        elif chat_request.language and chat_request.language != "auto":
            original_language = chat_request.language

            logger.info(f"Language debug - type: {type(original_language)}, repr: {repr(original_language)} if original_language else None")

        # Re-enabled language detection as fallback ---
        lang_t0 = time.perf_counter()
        try:
            if not original_language or original_language.strip() == "":
                # Attempt to detect language from the last user message
                last_user_content = ""
                for msg in reversed(full_chat_history):
                    if msg.get("role") == "user":
                        last_user_content = msg.get("content", "")
                        break

                if last_user_content:
                    # Prefer the fastText LID microservice when available — it
                    # supports African languages (Wolof, Mandinka, Fulah, etc.)
                    # that langdetect can't recognise. Falls back to langdetect
                    # if the service is down or its top prediction is unmapped
                    # / below the confidence threshold.
                    detected_lang = await self._detect_via_lid(last_user_content)
                    if not detected_lang:
                        detected_lang = detect(last_user_content)

                    language_codes = self.load_language_codes(LANGUAGE_CODES_FILEPATH)
                    is_supported = detected_lang and (detected_lang.lower() in language_codes or detected_lang.lower() == 'en')

                    if is_supported:
                        if detected_lang.upper() != "EN":
                            original_language = detected_lang.upper()
                            logger.info(f"Auto-detected language: {original_language}")
                    else:
                        logger.warning(f"Detected language '{detected_lang}' is not in supported languages list. Ignoring auto-detection. Falling back to EN.")
                        original_language = "EN"
        except Exception as e:
            logger.warning(f"Language detection failed: {e}")
            # Fallback to English if detection fails
            if not original_language:
                original_language = "EN"
        logger.info(f"[LATENCY] handle_request.language_resolution_ms={_ms_since(lang_t0)}")

        # Normalize to uppercase so 'en', 'EN', 'En' all compare equal
        if original_language:
            original_language = original_language.strip().upper()

        translated_history_string = ""
        translation_t0 = time.perf_counter()
        if original_language and original_language != "EN":
            if logflag:
                logger.debug(f"Original language detected: {original_language}. Proceeding with translation of chat history.")
            translated_history_string = await self._get_translated_history_string(full_chat_history, "English")
        else:
            # If already English, flatten without translation. Bracketed role
            # markers (instead of "USER:" / "ASSISTANT:") break the autocomplete
            # pattern Llama would otherwise follow when it sees a repeated
            # USER/ASSISTANT sequence and continues in the user's voice.
            parts = []
            for msg in full_chat_history:
                role = (msg.get('role') or '').lower()
                marker = '[assistant turn]' if role == 'assistant' else '[user turn]'
                parts.append(f"{marker} {msg.get('content', '')}")
            translated_history_string = " |<-MSG->| ".join(parts)
        logger.info(f"[LATENCY] handle_request.history_prepare_ms={_ms_since(translation_t0)}")

        if logflag:
            logger.debug(f'Translated History String: {translated_history_string}')

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
            logger.debug(f'Last_translated_message_content: {last_translated_message_content}')

        raw_ctx: dict = {}
        if chat_request.context:
            try:
                raw_ctx = chat_request.context.model_dump(exclude_unset=True)
            except Exception:
                logger.warning(".model_dump method not supported")
                raw_ctx = chat_request.context.dict(exclude_unset=True)

        skip_ar = bool(raw_ctx.get("skipAutoRoute"))
        client_svcs = raw_ctx.get("serviceLabels") or []
        if not isinstance(client_svcs, list):
            client_svcs = []
        manual = skip_ar or len(client_svcs) > 0

        routing_filter_strategy = None
        routing_meta: dict = {"mode": "pass_through"}
        lang_for_ctx = (original_language or raw_ctx.get("language") or "EN").strip().upper()
        retrieval_context: dict = {}

        # ── Query intent: detect search mode ──────────────────────────────────
        # Fast-path (regex, free): small talk → skip router + megaservice entirely
        # LLM-based classifier: for real queries, decides vector_search vs deep_search
        #   while also picking the best taxonomy category (replaces old auto-router).
        qtext = last_user_plain_text(full_chat_history) or last_translated_message_content

        search_mode: str  # "no_search" | "vector_search" | "deep_search"
        if is_small_talk_query(qtext):
            search_mode = "no_search"
        else:
            search_mode = "deep_search" if FORCE_GRAPH_SEARCH else "vector_search"

        routing_t0 = time.perf_counter()

        if search_mode == "no_search":
            # Small talk / conversational — skip routing and megaservice entirely
            routing_meta = {"mode": "no_search", "search_mode": "no_search", "reason": "small_talk"}
            logger.info(f"[LATENCY] handle_request.routing_stage_ms={_ms_since(routing_t0)} mode=no_search")

        elif manual:
            rc = dict(raw_ctx)
            rc.pop("skipAutoRoute", None)
            retrieval_context = strip_non_retrieval_keys(rc)
            if not retrieval_context.get("categoryLabel"):
                retrieval_context["categoryLabel"] = "General"
            retrieval_context.setdefault("language", lang_for_ctx)
            retrieval_context.setdefault("serviceLabels", [])
            routing_meta = {
                "mode": "manual",
                "search_mode": search_mode,
                "categoryLabel": retrieval_context.get("categoryLabel"),
                "serviceLabels": retrieval_context.get("serviceLabels") or [],
            }
            logger.info(
                f"[LATENCY] handle_request.routing_stage_ms={_ms_since(routing_t0)} "
                f"mode=manual strategy=none ctx_services={len(retrieval_context.get('serviceLabels') or [])}"
            )

        elif CHATQNA_AUTO_ROUTE:
            taxonomy_t0 = time.perf_counter()
            tax = await self.user_profile_client.fetch_service_taxonomy(lang_for_ctx)
            logger.info(f"[LATENCY] handle_request.fetch_taxonomy_ms={_ms_since(taxonomy_t0)} has_taxonomy={bool(tax)}")
            tlines = taxonomy_prompt_lines(tax) if tax else ""
            if tax and tlines.strip() and qtext.strip():
                classify_t0 = time.perf_counter()
                route = await classify_route_for_query(
                    question=qtext,
                    taxonomy_lines=tlines,
                    llm_host=LLM_SERVER_HOST_IP,
                    llm_port=LLM_SERVER_PORT,
                    api_key=OPENAI_API_KEY,
                )
                # Extract search_mode from classifier output unless graph is forced for testing.
                if not FORCE_GRAPH_SEARCH:
                    search_mode = route.get("search_mode", "vector_search") or "vector_search"
                logger.info(
                    f"[LATENCY] handle_request.auto_router_classify_ms={_ms_since(classify_t0)} "
                    f"search_mode={search_mode}"
                )
                base_ctx = {
                    "categoryLabel": raw_ctx.get("categoryLabel") or "General",
                    "serviceLabels": [],
                    "language": lang_for_ctx,
                }
                retrieval_context, routing_meta, routing_filter_strategy = build_retrieval_from_route(
                    base_context=base_ctx, route=route
                )
                routing_meta["question_excerpt"] = qtext[:200]
                routing_meta["search_mode"] = search_mode
            else:
                retrieval_context = strip_non_retrieval_keys({**raw_ctx, "language": lang_for_ctx})
                if not retrieval_context.get("categoryLabel"):
                    retrieval_context["categoryLabel"] = "General"
                retrieval_context.setdefault("serviceLabels", [])
                routing_meta = {"mode": "auto_skipped", "search_mode": "vector_search", "reason": "no_taxonomy_or_question"}
            logger.info(
                f"[LATENCY] handle_request.routing_stage_ms={_ms_since(routing_t0)} "
                f"mode={routing_meta.get('mode')} search_mode={search_mode} "
                f"strategy={routing_filter_strategy or 'none'} "
                f"ctx_services={len(retrieval_context.get('serviceLabels') or [])}"
            )

        else:
            retrieval_context = strip_non_retrieval_keys({**raw_ctx, "language": lang_for_ctx})
            if not retrieval_context.get("categoryLabel"):
                retrieval_context["categoryLabel"] = "General"
            retrieval_context.setdefault("serviceLabels", [])
            routing_meta = {"mode": "auto_route_disabled", "search_mode": "vector_search"}
            logger.info(
                f"[LATENCY] handle_request.routing_stage_ms={_ms_since(routing_t0)} "
                f"mode=auto_route_disabled"
            )

        if logflag:
            logger.debug(f"Retrieval Context (final): {retrieval_context}  search_mode={search_mode}")

        parameters = LLMParams(
            max_tokens=chat_request.max_tokens if chat_request.max_tokens else 1024,
            top_k=chat_request.top_k if chat_request.top_k else 10,
            top_p=chat_request.top_p if chat_request.top_p else 0.95,
            temperature=chat_request.temperature
            if chat_request.temperature is not None
            else CHAT_LLM_TEMPERATURE,
            frequency_penalty=chat_request.frequency_penalty if chat_request.frequency_penalty else 0.0,
            presence_penalty=chat_request.presence_penalty if chat_request.presence_penalty else 0.0,
            repetition_penalty=chat_request.repetition_penalty if chat_request.repetition_penalty else 1.03,
            stream=chat_request.stream if chat_request.stream else False,
            chat_template=chat_request.chat_template if chat_request.chat_template else None,
            model=chat_request.model if chat_request.model else None,
        )

        # ── Branch on search_mode ──────────────────────────────────────────────
        if search_mode == "no_search":
            # Fast path: call LLM directly, skip embedding / retrieval / reranker
            direct_t0 = time.perf_counter()
            llm_response = await self._direct_llm_call(
                full_chat_history, parameters, language=original_language,
                system_prompt=request_system_prompt,
            )
            logger.info(f"[LATENCY] handle_request.direct_llm_ms={_ms_since(direct_t0)} (no_search fast path)")
            # No retrieved docs → empty source list & zero confidence
            source_documents_formatted = []
            confidence_score = 0.0
        else:
            # Normal path: full megaservice (embedding → retriever → reranker → LLM)
            # For vector_search, disable graph traversal AND strip all category/service
            # filters — pure cosine similarity over all embeddings. Filters only make
            # sense for graph traversal (deep_search), where they pick the subgraph.
            force_no_traversal = (search_mode == "vector_search")
            if search_mode == "vector_search":
                retrieval_context = {"language": lang_for_ctx}
                routing_filter_strategy = None

            retriever_parameters = GenieaiRetrieverParms(
                # search_type must stay similarity_score_threshold for confidence scoring
                search_type=chat_request.search_type if chat_request.search_type else "similarity_score_threshold",
                k=chat_request.k if chat_request.k is not None else RETRIEVER_K,
                fetch_k=chat_request.fetch_k if chat_request.fetch_k is not None else RETRIEVER_FETCH_K,
                search_start=chat_request.search_start if chat_request.search_start is not None else RETRIEVER_SEARCH_START,
                enable_traversal=(
                    "false" if force_no_traversal
                    else (chat_request.enable_traversal if chat_request.enable_traversal is not None else RETRIEVER_TRAVERSAL_ENABLED)
                ),
                traversal_max_depth=chat_request.traversal_max_depth if chat_request.traversal_max_depth is not None else RETRIEVER_TRAVERSAL_MAX_DEPTH,
                traversal_max_returned=chat_request.traversal_max_returned if chat_request.traversal_max_returned is not None else RETRIEVER_TRAVERSAL_MAX_RETURNED,
                traversal_score_threshold=chat_request.traversal_score_threshold if chat_request.traversal_score_threshold is not None else RETRIEVER_TRAVERSAL_SCORE_THRESHOLD,
                distance_threshold=chat_request.distance_threshold if chat_request.distance_threshold is not None else RETRIEVER_DISTANCE_THRESHOLD,
                lambda_mult=chat_request.lambda_mult if chat_request.lambda_mult is not None else RETRIEVER_LAMBDA_MULT,
                score_threshold=chat_request.score_threshold if chat_request.score_threshold is not None else RETRIEVER_SCORE_THRESHOLD,
                context=retrieval_context if retrieval_context else None,
            )

            reranker_parameters = GenieaiRerankerParms(
                reranking_strategy=chat_request.reranking_strategy if chat_request.reranking_strategy is not None else RERANKING_STRATEGY,
                top_n=chat_request.top_n if chat_request.top_n is not None else RERANKER_TOP_N,
                reranking_threshold=chat_request.reranking_threshold if chat_request.reranking_threshold is not None else RERANKING_THRESHOLD,
            )

            embed_q, canonical_q = build_retrieval_embedding_text(last_translated_message_content)
            initial_inputs = {"text": canonical_q}
            if embed_q != canonical_q:
                initial_inputs["retrieval_embedding_text"] = embed_q
            if retrieval_context:
                initial_inputs["context"] = retrieval_context

            schedule_t0 = time.perf_counter()
            result_dict, runtime_graph = await self.megaservice.schedule(
                initial_inputs=initial_inputs,
                llm_parameters=parameters,
                retriever_parameters=retriever_parameters,
                reranker_parameters=reranker_parameters,
                full_chat_history_string=translated_history_string,
                retrieval_context=retrieval_context,
                retrieval_filter_strategy=routing_filter_strategy,
                original_language=original_language,
                user_details=user_details,
                system_prompt=request_system_prompt,
            )
            logger.info(f"[LATENCY] handle_request.megaservice_schedule_ms={_ms_since(schedule_t0)}")

            if logflag:
                logger.debug(f'\nResult Dict: {result_dict}')
                logger.debug(f'\nRuntime Graph: {runtime_graph}')

            for node, response in result_dict.items():
                if isinstance(response, StreamingResponse):
                    return response

            llm_response = result_dict.get(self._find_node_key("llm", result_dict), {}).get("text", "Sorry, I could not generate a response.")

            # Source documents and confidence (only available from megaservice)
            rerank_key = self._find_node_key("rerank", result_dict)
            retriever_key = self._find_node_key("retriever", result_dict)
            source_node_key = rerank_key if rerank_key else retriever_key
            source_node_output = result_dict.get(source_node_key, {})
            retrieved_docs_with_scores = source_node_output.get("retrieved_docs", [])
            retriever_node_output = result_dict.get(retriever_key, {})
            file_id_pairs = retriever_node_output.get("file_id_pairs", {})

        # Strip leaked conversation markers from the LLM response. The LLM
        # sometimes echoes the internal delimiters and turn markers used
        # in the prompt; they're prompt scaffolding, not part of the reply.
        llm_response = re.sub(r'\s*\|<-MSG->\|\s*', '\n', llm_response)
        llm_response = re.sub(r'^(USER|ASSISTANT):\s*', '', llm_response, flags=re.MULTILINE)
        llm_response = re.sub(r'\[(?:user|assistant)\s+turn\]\s*', '', llm_response, flags=re.IGNORECASE)
        # If the model autocompleted into a "[user turn] ..." block (the bug
        # this format change is meant to prevent), drop everything from that
        # leak onward — keep only the assistant turn that came first.
        llm_response = re.split(
            r'\n\s*\[user\s+turn\]', llm_response, maxsplit=1, flags=re.IGNORECASE
        )[0].strip()
        logger.info(f"[LATENCY] handle_request.total_ms={_ms_since(req_t0)}")
        
        if original_language and original_language != "EN":
            # Load Language Codes
            language_codes = self.load_language_codes(LANGUAGE_CODES_FILEPATH)

            # Fallback logic for language codes. If not in map, use the original code.
            target_lang_name = original_language
            lookup_key = original_language.lower()

            if lookup_key in language_codes:
                target_lang_name = language_codes[lookup_key]
            else:
                logger.warning(f"Warning: Language '{original_language}' not found in language codes (lookup key: '{lookup_key}'). Attempting to translate using code directly.")

            if logflag:
                logger.debug(f"LLM response to be translated into: {target_lang_name}")

            try:
                final_text_response = await self._translate_with_chunking(llm_response, target_lang_name, original_language)
            except Exception as e:
                logger.error(f"Translation failed: {e}, returning original response")
                final_text_response = llm_response
        else:
            final_text_response = llm_response
        
        if logflag:
            logger.debug(f'\nFinal Text Response: {final_text_response}')

        # Format source documents (only populated for vector_search / deep_search paths)
        scores = []
        source_documents_file_ids = []
        source_documents_formatted = source_documents_formatted if search_mode == "no_search" else []
        # retrieved_docs_with_scores / file_id_pairs only exist on the megaservice path
        _retrieved_docs = retrieved_docs_with_scores if search_mode != "no_search" else []
        _file_id_pairs = file_id_pairs if search_mode != "no_search" else {}
        # RAG chunks may still reference file_id values deleted from doc-repo; skip citing those.
        omitted_sources_file_ids: set[str] = set()

        for item in _retrieved_docs:
            doc_id_by_orchestrator = item.get("id", "N/A")
            if doc_id_by_orchestrator not in _file_id_pairs:
                logger.warning(f"Warning: Document ID {doc_id_by_orchestrator} not found in file_id_pairs mapping.")
                continue

            file_id = _file_id_pairs[doc_id_by_orchestrator]
            if not file_id:
                logger.warning(f"Warning: No File ID mapped for Document ID {doc_id_by_orchestrator}.")
                continue

            score = item.get("score", 0.0)

            if file_id in source_documents_file_ids:
                logger.info(f"Note: Duplicate File ID {file_id} found. Skipping duplicate.")
                scores.append(score)
                logger.info(f"\n\n[ DEBUG ] appendding document conf score: {score} ")
                continue

            if file_id in omitted_sources_file_ids:
                scores.append(score)
                logger.info(f"\n\n[ DEBUG ] appendding document conf score: {score} ")
                continue

            logger.info(f"Document ID {doc_id_by_orchestrator} mapped to File ID {file_id}.")

            file_metadata = await self.fetch_file_metadata(file_id)
            if not file_metadata or not isinstance(file_metadata, dict):
                logger.warning(
                    f"Skipping source citation for file ID {file_id}: "
                    "metadata not available or file missing in document repository (orphan vector chunk?)."
                )
                omitted_sources_file_ids.add(file_id)
                scores.append(score)
                logger.info(f"\n\n[ DEBUG ] appendding document conf score: {score} ")
                continue

            source_documents_file_ids.append(file_id)
            real_file_id = file_id
            file_read_url = f"{PUBLIC_API_URL}/api/files/{real_file_id}/viewbrowser"

            raw_labels = file_metadata.get("labels")
            labels: list = raw_labels if isinstance(raw_labels, list) else []
            file_name = file_metadata.get("file_name") or ""
            logger.info(f"Labels for file ID {real_file_id}: {labels}")
            logger.info(f"File name for file ID {real_file_id}: {file_name}")
            author = file_metadata.get("author") or ""
            if author == "crawler" and file_name.endswith(".html"):
                file_read_url = file_metadata.get("source_url") or file_read_url
                logger.info(f"Updated file read URL for crawled HTML: {file_read_url}")

            source_documents_formatted.append({
                "document_id": real_file_id,
                "document_name": file_name,
                "url": file_read_url,
                "categoryLabel": labels,
                "serviceLabels": [],
                "score": score,
            })

            scores.append(score)
            logger.info(f"\n\n[ DEBUG ] appendding document conf score: {score} ")

        # Calculate overall confidence score (e.g., average of top documents)
        confidence_score = sum(scores) / len(scores) if scores else 0.0
        logger.info(f"\n\n[ DEBUG ] document confidence scores: {scores} ")

        # Construct the final JSON payload
        final_response_payload = {
            "response": final_text_response,
            # Include the raw English LLM output so the backend can cache it as
            # contentEn on the assistant message (avoids re-translating history).
            "response_en": llm_response if original_language and original_language != "EN" else None,
            "metadata": {
                "source_documents": source_documents_formatted,
                "confidence_score": round(confidence_score, 2),
                "routing": routing_meta,
            },
        }

        # Return as a JSONResponse
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