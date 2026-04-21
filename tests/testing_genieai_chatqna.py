# REFACTORED FOR TESTING

# Copyright (C) 2024 Intel Corporation
# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0 Developed by Intel. Adapted by ITU
import argparse
import httpx
import json
import os
import re
import aiohttp # for async http requests
import requests
import asyncio
import copy

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
from datetime import date, datetime
from transformers import AutoTokenizer


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
RETRIEVER_SERVICE_HOST_IP = os.getenv("RETRIEVER_SERVICE_HOST_IP", "0.0.0.0")
RETRIEVER_SERVICE_PORT = int(os.getenv("RETRIEVER_SERVICE_PORT", 7025))
RERANK_SERVER_HOST_IP = os.getenv("RERANK_SERVER_HOST_IP", "0.0.0.0")
RERANK_SERVER_PORT = int(os.getenv("RERANK_SERVER_PORT", 80))
LLM_SERVER_HOST_IP = os.getenv("LLM_SERVER_HOST_IP", "0.0.0.0")
LLM_SERVER_PORT = int(os.getenv("LLM_SERVER_PORT", 80))
LLM_MODEL = os.getenv("LLM_MODEL", "ibm-granite/granite-3.3-2b-instruct")
LLM_TRANS_MODEL = os.getenv("LLM_TRANS_MODEL", "google/gemma-3-1b-it")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", None)

RETRIEVER_SEARCH_START = os.getenv("RETRIEVER_ARANGO_SEARCH_START", "chunk")  # node | edge | chunk
RETRIEVER_K = os.getenv("RETRIEVER_ARANGO_K", 4)
RETRIEVER_FETCH_K = os.getenv("RETRIEVER_ARANGO_FETCH_K", 20) 
RETRIEVER_SCORE_THRESHOLD = os.getenv("RETRIEVER_ARANGO_SCORE_THRESHOLD", 0.1) 
RETRIEVER_DISTANCE_THRESHOLD = os.getenv("RETRIEVER_ARANGO_DISTANCE_THRESHOLD", None) 
RETRIEVER_LAMBDA_MULT = os.getenv("RETRIEVER_ARANGO_LAMBDA_MULT", 0.5) 

RERANKER_TOP_N = os.getenv("RERANKER_TOP_N", 2)

DOC_REPO_URL = os.getenv("DOC_REPO_URL", "http://localhost:3001") # Document repository URL
BACKEND_SERVICE_URL = os.getenv("BACKEND_SERVICE_URL", "http://backend:3000") # Frontend backend service URL
LANGUAGE_CODES_FILEPATH = os.getenv("LANGUAGE_CODES_FILEPATH", "language_codes.json")
MAX_MODEL_LEN_TEXTGEN = int(os.getenv("MAX_MODEL_LEN_TEXTGEN", 4096))  # max token length for text generation models

MAX_TRANSLATION_CHARS = int(os.getenv("MAX_TRANSLATION_CHARS", 2000))  # max characters for translation models
USER_MSG_PATTERN = re.compile(r"USER:\s*(.*?)(?:\s*\|<-MSG->\||$)", re.DOTALL)

CHATQNA_SYSTEM_PROMPT = os.getenv("CHATQNA_SYSTEM_PROMPT", None)
SENSITIVE_KEYS = set(os.getenv("SENSITIVE_KEYS", "").split(","))


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
    Uses Bearer token (forwarded from incoming request) for authentication.
    """

    def __init__(self):
        self._token = None

        # Log initialization
        logger.info(f"GenieUserProfileClient initialized. Backend: {BACKEND_SERVICE_URL}")


    def set_token(self, token: str):
        self._token = token


    async def get_user_profile(self):
        """
        Fetches the sanitized user profile from the backend for context enrichment.
        Target: GET /api/me/context
        Auth: Authorization Bearer token (forwarded from incoming request)
        """
        if not self._token:
            logger.warning("Bearer token not set, skipping profile fetch")
            return None

        # Construct URL
        url = f"{BACKEND_SERVICE_URL}/api/me/context"

        # Prepare Headers
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json"
        }

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers) as response:

                    if response.status == 200:
                        profile_data = await response.json()
                        logger.info(f"Successfully retrieved user profile")

                        return profile_data

                    elif response.status == 404:
                        logger.warning(f"User profile not found")
                        return None

                    else:
                        logger.error(f"Failed to fetch user profile. Status: {response.status}, Body: {await response.text()}")
                        return None

        except Exception as e:
            logger.error(f"Error connecting to Backend Service for profile: {e}")
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
        inputs["inputs"] = inputs["text"]
        del inputs["text"]


    elif self.services[cur_node].service_type == ServiceType.RETRIEVER:
        retriever_parameters = kwargs.get("retriever_parameters", None)
        if retriever_parameters:
            inputs.update(retriever_parameters.dict())

        retrieval_context = kwargs.get('retrieval_context', {})
        if retrieval_context:
            inputs['context'] = retrieval_context
            
        # Testing optimisations
        # ArangoDB parameter values from payload
        custom_retriever_params = kwargs.get("custom_retriever_params", {})
        if custom_retriever_params:
            inputs.update({k: v for k, v in custom_retriever_params.items() if v is not None})
        if logflag:
            logger.info(f"[ DEBUG - VERBOSE ] Retriever aligned inputs updated with custom params: {inputs}")
        # -----------------------------------------------------------
    
    elif self.services[cur_node].service_type == ServiceType.RERANK:
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
    
        prompt_add_context = (f"\n\nUSER INFORMATION:\n{user_context_string}"
                         f"\n\nCHAT HISTORY:\n{translated_history_string}"
                         f"\n\nCONTENT FROM THE KNOWLEDGE BASE:\n{rag_augmented_prompt}")
        
        final_llm_prompt = f"{system_instructions}{prompt_add_context}"

        tokenizer = get_tokenizer()
        max_model_tokens = MAX_MODEL_LEN_TEXTGEN
        max_answer_tokens = llm_parameters_dict["max_tokens"]  # Typically 1024
        # Count tokens in prompt
        prompt_tokens = len(tokenizer.encode(final_llm_prompt))
        # Check if the total token count exceeds the model's limit
        if prompt_tokens + max_answer_tokens > max_model_tokens - 200:  # Leave buffer
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
            # Reconstruct final prompt
            prompt_add_context = (f"\n\nUSER INFORMATION:\n{user_context_string}"
                         f"\n\nCHAT HISTORY:\n{translated_history_string}"
                         f"\n\nCONTENT FROM THE KNOWLEDGE BASE:\n{rag_augmented_prompt}")
            final_llm_prompt = f"{system_instructions}{prompt_add_context}"
        

        next_inputs["messages"] = [{"role": "user", "content": final_llm_prompt}]
        next_inputs["max_tokens"] = llm_parameters_dict["max_tokens"]
        next_inputs["top_p"] = llm_parameters_dict["top_p"]
        next_inputs["stream"] = inputs["stream"]
        next_inputs["frequency_penalty"] = inputs["frequency_penalty"]
        next_inputs["temperature"] = inputs["temperature"]
        inputs = next_inputs
        if logflag:
            logger.debug(f'Raw input of the llm\n {inputs}\n')

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
        assert isinstance(data, list)
        next_data = {"text": inputs["inputs"], "embedding": data[0]}

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
            
            # Testing optimisations
            # Inject dynamic reranker parameters for downstream processing 
            custom_reranker_params = kwargs.get("custom_reranker_params", {})
            if custom_reranker_params:
                next_data.update({k: v for k, v in custom_reranker_params.items() if v is not None})
            if logflag:
                logger.info(f"[ DEBUG - VERBOSE ] Reranker inputs prepared with custom params: {next_data}")
            # -------------------------------------------------------------------------
            
        else:
            if not retrieved_docs and with_rerank:
                # delete the rerank from retriever -> rerank -> llm
                for ds in reversed(runtime_graph.downstream(cur_node)):
                    for nds in runtime_graph.downstream(ds):
                        runtime_graph.add_edge(cur_node, nds)
                    runtime_graph.delete_node_if_exists(ds)

            # handle template
            # prompt = data["initial_query"]
            prompt = data.get("initial_query", data.get("text"))
            if not prompt:
                prompt = data.get("inputs", "")

            chat_template = llm_parameters_dict["chat_template"]
            if chat_template:
                prompt_template = PromptTemplate.from_template(chat_template)
                input_variables = prompt_template.input_variables
                if sorted(input_variables) == ["context", "question"]:
                    # prompt = prompt_template.format(question=data["initial_query"], context="\n".join(doc_texts))
                    query_text = data.get("initial_query", data.get("text"))
                    prompt = prompt_template.format(question=query_text, context="\n".join(doc_texts)) 

                elif input_variables == ["question"]:
                    # prompt = prompt_template.format(question=data["initial_query"])
                    query_text = data.get("initial_query", data.get("text"))
                    prompt = prompt_template.format(question=query_text)

                else:
                    if logflag:
                        logger.debug(f"{prompt_template} not used, we only support 2 input variables ['question', 'context']")
                    # prompt = ChatTemplate.generate_rag_prompt(data["initial_query"], doc_texts)
                    query_text = data.get("initial_query", data.get("text"))
                    prompt = ChatTemplate.generate_rag_prompt(query_text, doc_texts)

            else:
                # prompt = ChatTemplate.generate_rag_prompt(data["initial_query"], doc_texts)
                query_text = data.get("initial_query", data.get("text"))
                prompt = ChatTemplate.generate_rag_prompt(query_text, doc_texts)


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
        chat_template = llm_parameters_dict.get("chat_template") if llm_parameters_dict else None
        
        if chat_template:
            prompt_template = PromptTemplate.from_template(chat_template)
            input_variables = prompt_template.input_variables
            if sorted(input_variables) == ["context", "question"]:
                prompt = prompt_template.format(question=initial_query, context="\n".join(docs))
            elif input_variables == ["question"]:
                prompt = prompt_template.format(question=initial_query)
            else:
                prompt = ChatTemplate.generate_rag_prompt(initial_query, docs)
        else:
            prompt = ChatTemplate.generate_rag_prompt(initial_query, docs)
            
        next_data["inputs"] = prompt
        next_data["retrieved_docs"] = reranked_docs_with_scores
        
        # 4. Preserve file mappings for citations
        if "file_id_pairs" in inputs:
            next_data["file_id_pairs"] = inputs["file_id_pairs"]

    elif self.services[cur_node].service_type == ServiceType.LLM and not llm_parameters_dict["stream"]:
        if "faqgen" in self.services[cur_node].endpoint:
            next_data = data
        else:
            if logflag:
                logger.debug(f'\nRaw output of the llm\n {data}\n')
            next_data["text"] = data["choices"][0]["message"]["content"]
        if logflag:
            logger.debug(f'\nAligned output of the llm\n {next_data}\n')
    else:
        next_data = data

    if logflag:
        logger.info(f"\n[ DEBUG ] FINAL ALIGNED DATA FOR NEXT NODE:\n{json.dumps(next_data, indent=2, default=str)}\n")

    return next_data
        
def align_generator(self, gen, **kwargs):
    # OpenAI response format
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

        service_token = self.user_profile_client._token
        if not service_token:
            logger.error("Bearer token not set.")
            return None

        file_get_metadata_url = f"{DOC_REPO_URL}/api/files/{file_id}"
        headers = {"Authorization": f"Bearer {service_token}"}

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(file_get_metadata_url, headers=headers) as response:
                    if response.status == 200:
                        file_metadata = await response.json()
                        if logflag:
                            logger.debug(f"Fetched metadata for file ID {file_id}: {file_metadata}")
                        if file_metadata['success']:
                            return file_metadata['data']
                        else:
                            logger.error(f"Failed to fetch metadata for file ID {file_id}. Response indicates failure.")
                    else:
                        logger.error(f"Failed to fetch metadata for file ID {file_id}. HTTP Status: {response.status}")
        except Exception as e:
            logger.error(f"An error occurred while fetching metadata for file ID {file_id}: {e}")

        return None

    def add_remote_service(self):

        embedding = MicroService(
            name="embedding",
            host=EMBEDDING_SERVER_HOST_IP,
            port=EMBEDDING_SERVER_PORT,
            endpoint="/embed",
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
            endpoint="/embed",
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
            endpoint="/embed",
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
            endpoint="/embed",
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
            endpoint="/embed",
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
        A helper that:
        1. Truncates history to stay within a token limit.
        2. Flattens the history into a single string.
        3. Sends the string to the translation LLM.
        """
        
        max_translation_chars = MAX_TRANSLATION_CHARS
        current_chars = 0
        messages_to_process = []
        if logflag:
            logger.debug(f'Processing translation for history with {len(history)} messages.')

        for message in reversed(history):
            if logflag:
                logger.debug(f'Examining message: {message}')
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

        # --- Simple Translation API Call ---
        prompt = f"Translate the following chat history to {target_language}. Preserve the role markers (e.g., 'USER:', 'ASSISTANT:').\n\nHISTORY:\n{flattened_history_string}"

        payload = {
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0,
            "stream": False
        }

        if logflag:
            logger.debug(f"Payload for translation service: {payload}")

        try:
            async with httpx.AsyncClient(timeout=TRANSLATION_SERVICE_TIMEOUT) as client:
                response = await client.post(
                    f"http://{TRANSLATION_SERVICE_HOST_IP}:{TRANSLATION_SERVICE_PORT}/v1/chat/completions",
                    json=payload,
                    headers={"Authorization": f"Bearer {OPENAI_API_KEY}"}
                )
                response.raise_for_status()
                response_data = response.json()
                translated_blob = response_data["choices"][0]["message"]["content"]
                if logflag:
                    logger.debug(f"Translated chat history: {translated_blob.strip()}")
                return translated_blob.strip()

        except httpx.TimeoutException as e:
            logger.error(f"History translation timeout after {TRANSLATION_SERVICE_TIMEOUT} seconds. Returning history in original language. Error: {e}")
            return flattened_history_string
        except Exception as e:
            logger.error(f"Translation error: {e}")
            return flattened_history_string


    def load_language_codes(self, filepath: str) -> dict:
        """Load language codes from a JSON file."""
        try:
            with open(filepath, 'r') as file:
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

        if logflag:
            logger.info(f"Translating {len(text)} chars in {len(chunks)} chunks to {target_lang}")

        # Translate chunks concurrently
        translated_chunks = await asyncio.gather(
            *[self._translate_text_chunk(chunk, target_lang, iso_code) for chunk in chunks]
        )

        return " ".join(translated_chunks)

    async def handle_request(self, request: Request):
        data = await request.json()

        # --- LOGGING THE FULL REQUEST FROM THE FRONTEND FOR DEBUGGING---
        logger.info(f"\n\nFRONTEND PAYLOAD: \n{data}\n\n")

        user_details = {}

        try:
            user_details = await self.user_profile_client.get_user_profile()
        except Exception as e:
            logger.error(f"USER PROFILE ERROR: {e}")

        # -----------------------------------------------

        chat_request = ChatCompletionRequest.parse_obj(data)
        
        # --- LOGGING FOR DEBUGGING CHAT REQUEST ---
        logger.info(f"Parsed chat request: {chat_request}")
        
        retrieval_context = {}
        
        if chat_request.context:
            try:
                retrieval_context = chat_request.context.model_dump(exclude_unset=True)
            except:
                retrieval_context = chat_request.context.dict(exclude_unset=True)
        logger.info(f"Context: {retrieval_context}")
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

        if logflag:
            logger.info(f"Language from frontend - context.language: {chat_request.context.language if chat_request.context else None}, direct language: {chat_request.language}, final: {original_language}")
            logger.info(f"Language debug - type: {type(original_language)}, repr: {repr(original_language)} if original_language else None")

        # Re-enabled language detection as fallback ---
        try:
            if logflag:
                logger.info(f"Language detection check - original_language is None: {original_language is None}, is empty string: {original_language == '' if original_language else 'N/A'}")

            if not original_language or original_language.strip() == "":
                if logflag:
                    logger.info(f"Triggering auto-detection because original_language is falsy or empty")

                # Attempt to detect language from the last user message
                last_user_content = ""
                for msg in reversed(full_chat_history):
                    if msg.get("role") == "user":
                        last_user_content = msg.get("content", "")
                        break

                if logflag:
                    logger.info(f"Last user content for detection (first 100 chars): {last_user_content[:100] if last_user_content else 'None'}")

                if last_user_content:
                    detected_lang = detect(last_user_content)
                    if logflag:
                        logger.info(f"langdetect result: '{detected_lang}' (will convert to uppercase: '{detected_lang.upper()}')")

                    # Load supported languages to validate the detection
                    language_codes = self.load_language_codes(LANGUAGE_CODES_FILEPATH)

                    # Only use detected language if it's in our supported list OR if it's 'en'
                    is_supported = detected_lang and (detected_lang.lower() in language_codes or detected_lang.lower() == 'en')

                    if logflag:
                        logger.info(f"Language validation - detected '{detected_lang}', supported: {is_supported}, in language_codes: {detected_lang.lower() in language_codes if detected_lang else 'N/A'}")

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

        translated_history_string = ""
        if original_language and original_language.strip() != "EN":
            if logflag:
                logger.debug(f"Original language detected: {original_language}. Proceeding with translation of chat history.")
            translated_history_string = await self._get_translated_history_string(full_chat_history, "English")
        else:
            # If already English, flatten without translation
            parts = [f"{msg.get('role', '').upper()}: {msg.get('content', '')}" for msg in full_chat_history]
            translated_history_string = " |<-MSG->| ".join(parts)

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

        # Extract the retrieval context if it is provided in the request.
        # Set to empty dict as a default if it is missing.
        retrieval_context = {}
        if chat_request.context:
            try:
                # If Pydantic is v2+
                retrieval_context = chat_request.context.model_dump(exclude_unset=True)
            except:
                # Backup - can be removed later
                logger.warning(".model_dump method not supported")
                retrieval_context = chat_request.context.dict(exclude_unset=True)
        if logflag:
            logger.debug(f'Retrieval Context: {retrieval_context}')

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
        retriever_parameters = RetrieverParms(
            # in the current implementation, search_type should always be set to similarity_score_threshold, 
            # otherwise not possible to calculate confidence scores
            search_type=chat_request.search_type if chat_request.search_type else "similarity_score_threshold",
            k=chat_request.k if chat_request.k is not None else RETRIEVER_K,
            distance_threshold=chat_request.distance_threshold if chat_request.distance_threshold is not None else RETRIEVER_DISTANCE_THRESHOLD,
            fetch_k=chat_request.fetch_k if chat_request.fetch_k is not None else RETRIEVER_FETCH_K,
            lambda_mult=chat_request.lambda_mult if chat_request.lambda_mult is not None else RETRIEVER_LAMBDA_MULT,
            score_threshold=chat_request.score_threshold if chat_request.score_threshold is not None else RETRIEVER_SCORE_THRESHOLD,
        )
        reranker_parameters = RerankerParms(
            top_n=chat_request.top_n if chat_request.top_n is not None else RERANKER_TOP_N,
        )

        # Testing optimisations 
        # Extract parameters from payload for testing --------------
        custom_retriever_params = {
            "graph_name": chat_request.graph_name,
            "search_start": chat_request.search_start,
            "search_mode": chat_request.search_mode,
            "num_centroids": chat_request.num_centroids,
            "distance_strategy": chat_request.distance_strategy,
            "use_approx_search": chat_request.use_approx_search,
            "enable_traversal": chat_request.enable_traversal,
            "enable_summarizer": chat_request.enable_summarizer,
            "traversal_max_depth": chat_request.traversal_max_depth,
            "traversal_max_returned": chat_request.traversal_max_returned,
            "traversal_score_threshold": chat_request.traversal_score_threshold,
            "traversal_query": chat_request.traversal_query,
        }
        
        custom_reranker_params = {
            "reranking_strategy": chat_request.reranking_strategy,
            "reranking_threshold": chat_request.reranking_threshold,
            "reranker_top_n": chat_request.reranker_top_n,
        }
        # -----------------------------------------------------------

        result_dict, runtime_graph = await self.megaservice.schedule(
            initial_inputs={"text": last_translated_message_content},
            llm_parameters=parameters,
            retriever_parameters=retriever_parameters,
            reranker_parameters=reranker_parameters,
            full_chat_history_string=translated_history_string,
            retrieval_context=retrieval_context,
            original_language=original_language,
            user_details = user_details,
            # Pass extracted test configurations downstream
            custom_retriever_params=custom_retriever_params,
            custom_reranker_params=custom_reranker_params,
        )

        if logflag:
            logger.debug(f'\nResult Dict: {result_dict}')
            logger.debug(f'\nRuntime Graph: {runtime_graph}')

        for node, response in result_dict.items():
            if isinstance(response, StreamingResponse):
                return response
        
        llm_response = result_dict.get(self._find_node_key("llm", result_dict), {}).get("text", "Sorry, I could not generate a response.")
        
        if original_language and original_language.strip() != "EN":
            if logflag:
                logger.info(f"Translation requested - original_language: '{original_language}' (type: {type(original_language).__name__})")

            # Load Language Codes
            language_codes = self.load_language_codes(LANGUAGE_CODES_FILEPATH)

            if logflag:
                logger.info(f"Language codes loaded - keys: {list(language_codes.keys())[:10]}... (total: {len(language_codes)})")

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
                logger.warning(f"Warning: Language '{original_language}' not found in language codes (lookup key: '{lookup_key}'). Attempting to translate using code directly.")

            if logflag:
                logger.debug(f"LLM response to be translated into: {target_lang_name}")

            try:
                final_text_response = await self._translate_with_chunking(llm_response, target_lang_name, original_language)
                if logflag:
                    logger.info(f"Translation completed successfully")
            except Exception as e:
                logger.error(f"Translation failed: {e}, returning original response")
                final_text_response = llm_response
        else:
            final_text_response = llm_response
        
        if logflag:
            logger.debug(f'\nFinal Text Response: {final_text_response}')

        rerank_key = self._find_node_key("rerank", result_dict)
        retriever_key = self._find_node_key("retriever", result_dict)
        
        source_node_key = rerank_key if rerank_key else retriever_key

        source_node_output = result_dict.get(source_node_key, {}) # reranker microservice output or retriever microservice output
        retrieved_docs_with_scores = source_node_output.get("retrieved_docs", []) # downstream_black_list, id, text, score

        retriever_node_output = result_dict.get(retriever_key, {})
        file_id_pairs = retriever_node_output.get("file_id_pairs", {})

        # Format the source documents list
        source_documents_formatted = []
        scores = []
        source_documents_file_ids = []

        if logflag:
            logger.info(f"\n\n[ DEBUG ] retrieved docs with scores: {retrieved_docs_with_scores}\n")

        for item in retrieved_docs_with_scores:
            doc_id_by_orchestrator = item.get("id", "N/A")
            if doc_id_by_orchestrator not in file_id_pairs:
                logger.warning(f"Warning: Document ID {doc_id_by_orchestrator} not found in file_id_pairs mapping.")
                continue
            else:
                file_id = file_id_pairs[doc_id_by_orchestrator]
                if not file_id:
                    logger.warning(f"Warning: No File ID mapped for Document ID {doc_id_by_orchestrator}.")
                    continue
                else:
                    if file_id in source_documents_file_ids:
                        logger.info(f"Note: Duplicate File ID {file_id} found. Skipping duplicate.")
                        score = item.get("score", 0.0)
                        scores.append(score)
                        continue
                    else:
                        logger.info(f"Document ID {doc_id_by_orchestrator} mapped to File ID {file_id}.")
                        source_documents_file_ids.append(file_id)

                        score = item.get("score", 0.0)
                        # Construct the file read URL (assuming a standard pattern)
                        file_read_url = f"https://<HOST>/<PORT>/api/files/{file_id}/viewbrowser" if file_id else ""

                        labels = []
                        file_name = ''
                        if file_id:
                            file_metadata = await self.fetch_file_metadata(file_id)
                            if file_metadata and isinstance(file_metadata, dict):
                                labels = file_metadata['labels']
                                file_name = file_metadata['file_name'] if 'file_name' in file_metadata else ''
                                logger.info(f"Labels for file ID {file_id}: {labels}")
                                logger.info(f"File name for file ID {file_id}: {file_name}")
                                author = file_metadata['author'] if 'author' in file_metadata else ''
                                if author == 'crawler' and file_name.endswith('.html'):
                                    # If the author is 'crawler' and the file is an HTML, we can assume it's a web page
                                    file_read_url = file_metadata['source_url'] if 'source_url' in file_metadata else file_read_url
                                    logger.info(f"Updated file read URL for crawled HTML: {file_read_url}")
                            else:
                                logger.warning(f"Skipping metadata for file ID {file_id} due to fetch failure.")
                                # Assigning error values to avoid service crashing [to be optimised]
                                labels = "error" 
                                file_id = "error"
                                file_name = "error"
                                file_read_url = "error"
                                score = 0

                        source_documents_formatted.append({
                            "document_id": file_id,
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
            "metadata": {
                "source_documents": source_documents_formatted,
                "confidence_score": round(confidence_score, 2),
                }
            }

        # Return as a JSONResponse
        if logflag:
            logger.info(f'Megaservice output payload: {final_response_payload}')
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