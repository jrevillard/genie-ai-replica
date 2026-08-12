# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
#
# ruff: noqa: F405

# ------------------------------------------------------------------
# GENIE.AI custom api protocol
# ------------------------------------------------------------------

# importing all existing models from the original OPEA api protocol

from api_protocol import *  # noqa: F403
from pydantic import BaseModel, Field, NonNegativeFloat, PositiveInt


class RetrievalRequestArangoDB(RetrievalRequest):
    graph_name: str | None = None
    search_start: str | None = None  # "node", "edge", "chunk"
    search_mode: str | None = None  # "vector", "hybrid"
    num_centroids: int | None = None
    distance_strategy: str | None = None  #  # "COSINE", "EUCLIDEAN_DISTANCE"
    use_approx_search: bool | None = None
    enable_traversal: bool | None = None
    enable_summarizer: bool | None = None
    traversal_max_depth: int | None = None
    traversal_max_returned: int | None = None
    traversal_score_threshold: float | None = None
    traversal_query: str | None = None
    context: dict[str, Any] | None = None  # need to update in other files filter --> context


class GenieRetrievalResponse(RetrievalResponse):
    """Marker subclass for retrieval responses (RetrievalRequest path).

    Chunk embeddings for adaptive reranking propagate via the
    SearchedMultimodalDoc metadata list (EmbedDoc path), not here.
    """


class RequestContext(BaseModel):
    """
    A model to hold structured context for metadata filtering during retrieval.
    """

    categoryLabels: list[str] | None = None
    serviceLabels: list[str] | None = None
    language: str | None = None


class ChatCompletionRequest(BaseModel):
    # Ordered by official OpenAI API documentation
    # https://platform.openai.com/docs/api-reference/chat/create
    messages: Union[
        str,
        list[dict[str, str]],
        list[dict[str, Union[str, list[dict[str, Union[str, dict[str, str]]]]]]],
    ]
    model: str | None = None
    modalities: list[Literal["text", "audio"]] = Field(default=["text"])
    frequency_penalty: float | None = 0.0
    logit_bias: dict[str, float] | None = None
    logprobs: bool | None = False
    top_logprobs: int | None = 0
    # OVERRIDE core.genieai_api_protocol.ChatCompletionRequest.max_tokens | disposition: re-graft-to-new-API | reason: mirror v1.5 PositiveInt type | test: tests/test_core.py::TestChatCompletionRequest::test_max_tokens_rejects_zero_and_negative  # noqa: E501
    max_tokens: PositiveInt | None = None  # None = let vLLM decide based on max_model_len
    # OVERRIDE core.genieai_api_protocol.ChatCompletionRequest.n | disposition: re-graft-to-new-API | reason: mirror v1.5 PositiveInt type | test: tests/test_core.py::TestChatCompletionRequest::test_n_rejects_zero_and_negative  # noqa: E501
    n: PositiveInt | None = 1
    presence_penalty: float | None = 0.0
    response_format: ResponseFormat | None = None
    # OVERRIDE core.genieai_api_protocol.ChatCompletionRequest.seed | disposition: re-graft-to-new-API | reason: mirror v1.5 PositiveInt type | test: tests/test_core.py::TestChatCompletionRequest::test_seed_rejects_zero_and_negative  # noqa: E501
    seed: PositiveInt | None = None
    service_tier: str | None = None
    stop: Union[str, list[str], None] = Field(default_factory=list)
    stream: bool | None = False
    stream_options: StreamOptions | None = Field(default=None)  # changed from default_factory=StreamOptions
    # OVERRIDE core.genieai_api_protocol.ChatCompletionRequest.temperature | disposition: re-graft-to-new-API | reason: mirror v1.5 NonNegativeFloat type | test: tests/test_core.py::TestChatCompletionRequest::test_temperature_accepts_zero_rejects_negative  # noqa: E501
    temperature: NonNegativeFloat | None = 0.01  # vllm default 0.7
    # OVERRIDE core.genieai_api_protocol.ChatCompletionRequest.top_p | disposition: re-graft-to-new-API | reason: mirror v1.5 NonNegativeFloat type | test: tests/test_core.py::TestChatCompletionRequest::test_top_p_accepts_zero_rejects_negative  # noqa: E501
    top_p: NonNegativeFloat | None = None  # openai default 1.0, but tgi needs `top_p` must be >= 0.0 and < 1.0, set None
    tools: list[ChatCompletionToolsParam] | None = None
    tool_choice: Union[Literal["none"], ChatCompletionNamedToolChoiceParam] | None = "none"
    parallel_tool_calls: bool | None = True
    user: str | None = None
    context: RequestContext | None = Field(
        default=None, description="Application-specific context for metadata filtering in retrieval."
    )
    language: str = "auto"  # can be "en", "zh"
    image_path: str | None = None
    audio_path: str | None = None

    # Ordered by official OpenAI API documentation
    # default values are same with
    # https://platform.openai.com/docs/api-reference/completions/create
    # OVERRIDE core.genieai_api_protocol.ChatCompletionRequest.best_of | disposition: re-graft-to-new-API | reason: mirror v1.5 PositiveInt type | test: tests/test_core.py::TestChatCompletionRequest::test_best_of_rejects_zero_and_negative  # noqa: E501
    best_of: PositiveInt | None = 1
    suffix: str | None = None

    # vllm reference: https://github.com/vllm-project/vllm/blob/main/vllm/entrypoints/openai/protocol.py#L130
    # OVERRIDE core.genieai_api_protocol.ChatCompletionRequest.repetition_penalty | disposition: re-graft-to-new-API | reason: mirror v1.5 NonNegativeFloat type | test: tests/test_core.py::TestChatCompletionRequest::test_repetition_penalty_accepts_zero_rejects_negative  # noqa: E501
    repetition_penalty: NonNegativeFloat | None = 1.0

    # tgi reference: https://huggingface.github.io/text-generation-inference/#/Text%20Generation%20Inference/generate
    # some tgi parameters in use
    # default values are same with
    # https://github.com/huggingface/text-generation-inference/blob/main/router/src/lib.rs#L190
    # max_new_tokens: Optional[int] = 100 # Priority use openai
    # OVERRIDE core.genieai_api_protocol.ChatCompletionRequest.top_k | disposition: re-graft-to-new-API | reason: mirror v1.5 PositiveInt type | test: tests/test_core.py::TestChatCompletionRequest::test_top_k_rejects_zero_and_negative  # noqa: E501
    top_k: PositiveInt | None = None
    # top_p: Optional[float] = None # Priority use openai
    typical_p: float | None = None
    # repetition_penalty: Optional[float] = None
    # OVERRIDE core.genieai_api_protocol.ChatCompletionRequest.timeout | disposition: re-graft-to-new-API | reason: mirror v1.5 PositiveInt type | test: tests/test_core.py::TestChatCompletionRequest::test_timeout_rejects_zero_and_negative  # noqa: E501
    timeout: PositiveInt | None = None

    # doc: begin-chat-completion-extra-params
    echo: bool | None = Field(
        default=False,
        description=(
            "If true, the new message will be prepended with the last message if they belong to the same role."
        ),
    )
    add_generation_prompt: bool | None = Field(
        default=True,
        description=(
            "If true, the generation prompt will be added to the chat template. "
            "This is a parameter used by chat template in tokenizer config of the "
            "model."
        ),
    )
    add_special_tokens: bool | None = Field(
        default=False,
        description=(
            "If true, special tokens (e.g. BOS) will be added to the prompt "
            "on top of what is added by the chat template. "
            "For most models, the chat template takes care of adding the "
            "special tokens so this should be set to False (as is the "
            "default)."
        ),
    )
    documents: Union[list[dict[str, str]], list[str]] | None = Field(
        default=None,
        description=(
            "A list of dicts representing documents that will be accessible to "
            "the model if it is performing RAG (retrieval-augmented generation)."
            " If the template does not support RAG, this argument will have no "
            "effect. We recommend that each document should be a dict containing "
            '"title" and "text" keys.'
        ),
    )
    chat_template: str | None = Field(
        default=None,
        description=(
            "A template to use for this conversion. "
            "If this is not passed, the model's default chat template will be "
            "used instead. We recommend that the template contains {context} and {question} for rag,"
            "or only contains {question} for chat completion without rag."
        ),
    )
    chat_template_kwargs: dict[str, Any] | None = Field(
        default=None,
        description=("Additional kwargs to pass to the template renderer. Will be accessible by the chat template."),
    )
    # doc: end-chat-completion-extra-params

    # embedding
    input: Union[list[int], list[list[int]], str, list[str]] = None  # user query/question from messages[-]
    encoding_format: str | None = Field("float", pattern="^(float|base64)$")
    dimensions: int | None = None
    embedding: Union[EmbeddingResponse, list[float]] = Field(default_factory=list)
    chunk_embeddings: list[list[float]] = Field(default_factory=list)

    # retrieval
    search_type: str = "similarity_score_threshold"  # "similarity"
    # OVERRIDE core.genieai_api_protocol.ChatCompletionRequest.k | disposition: re-graft-to-new-API | reason: mirror v1.5 PositiveInt type | test: tests/test_core.py::TestChatCompletionRequest::test_k_rejects_zero_and_negative  # noqa: E501
    k: PositiveInt | None = None
    # OVERRIDE core.genieai_api_protocol.ChatCompletionRequest.fetch_k | disposition: re-graft-to-new-API | reason: mirror v1.5 PositiveInt type | test: tests/test_core.py::TestChatCompletionRequest::test_fetch_k_rejects_zero_and_negative  # noqa: E501
    fetch_k: PositiveInt | None = None
    search_start: str | None = None
    enable_traversal: str | None = None
    traversal_max_depth: int | None = None
    traversal_max_returned: int | None = None
    traversal_score_threshold: float | None = None
    distance_threshold: float | None = None
    # OVERRIDE core.genieai_api_protocol.ChatCompletionRequest.lambda_mult | disposition: re-graft-to-new-API | reason: mirror v1.5 NonNegativeFloat type | test: tests/test_core.py::TestChatCompletionRequest::test_lambda_mult_accepts_zero_rejects_negative  # noqa: E501
    lambda_mult: NonNegativeFloat | None = None
    # OVERRIDE core.genieai_api_protocol.ChatCompletionRequest.score_threshold | disposition: re-graft-to-new-API | reason: mirror v1.5 NonNegativeFloat type | test: tests/test_core.py::TestChatCompletionRequest::test_score_threshold_accepts_zero_rejects_negative  # noqa: E501
    score_threshold: NonNegativeFloat | None = None
    retrieved_docs: Union[list[RetrievalResponseData], list[dict[str, Any]]] = Field(default_factory=list)
    index_name: str | None = None

    # reranking
    reranking_strategy: str | None = None
    # OVERRIDE core.genieai_api_protocol.ChatCompletionRequest.top_n | disposition: re-graft-to-new-API | reason: mirror v1.5 PositiveInt type | test: tests/test_core.py::TestChatCompletionRequest::test_top_n_rejects_zero_and_negative  # noqa: E501
    top_n: PositiveInt | None = None
    reranking_threshold: float | None = None
    reranked_docs: Union[list[RerankingResponseData], list[dict[str, Any]]] = Field(default_factory=list)

    # define
    request_type: Literal["chat"] = "chat"


class TranslationRequest(BaseModel):
    text: str
    stream: bool | None = False


class ArangoDBDataprepRequestFromDocRepo(ArangoDBDataprepRequest):
    def __init__(
        self,
        file_id: str | None = None,
        file_name: str | None = None,
        storage_path: str | None = None,
        file_path: str | None = None,
        file_type: str | None = None,
        file_labels: list[str] | None = None,
        upload_date: str | None = None,
        files: Union[UploadFile, list[UploadFile]] | None = None,
        link_list: str | None = None,
        chunk_size: int | None = 1500,
        chunk_overlap: int | None = 100,
        process_table: bool | None = False,
        table_strategy: str | None = "fast",
        graph_name: str | None = None,
        insert_async: bool | None = None,
        insert_batch_size: int | None = None,
        embed_nodes: bool | None = None,
        embed_edges: bool | None = None,
        embed_chunks: bool | None = None,
        allowed_node_types: list[str] | None = None,
        allowed_edge_types: list[str] | None = None,
        node_properties: list[str] | None = None,
        edge_properties: list[str] | None = None,
        text_capitalization_strategy: str | None = None,
        include_chunks: bool | None = None,
    ):
        super().__init__(
            files=files,
            link_list=link_list,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            process_table=process_table,
            table_strategy=table_strategy,
            graph_name=graph_name,
            insert_async=insert_async,
            insert_batch_size=insert_batch_size,
            embed_nodes=embed_nodes,
            embed_edges=embed_edges,
            embed_chunks=embed_chunks,
            allowed_node_types=allowed_node_types,
            allowed_edge_types=allowed_edge_types,
            node_properties=node_properties,
            edge_properties=edge_properties,
            text_capitalization_strategy=text_capitalization_strategy,
            include_chunks=include_chunks,
        )

        self.file_id = file_id
        self.file_name = file_name
        self.storage_path = storage_path
        self.file_path = file_path
        self.file_type = file_type
        self.upload_date = upload_date
        self.file_labels = file_labels
