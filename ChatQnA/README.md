# GENIE.AI ChatQnA 

This megaservice is derived from the [OPEA ChatQnA](https://github.com/opea-project/GenAIExamples/tree/main/ChatQnA) megaservice.

The ChatQnA megaservice defines the high-level logic for the backend of the RAG application / chatbot. It orchestrates the dataflow through the different microservices (embedding, retriever, reranker, LLM, etc.). Each of the microservices is defined separately by corresponding code directory (see genie-ai/microservices)

## Custom features integrated in GENIE.AI ChatQnA

    handle_request function modified to accept additional context parameters from the frontend;

    allign_inputs function modified to handle modified data between retriever and LLM


```mermaid
graph LR
A[Square Rect] -- Link text --> B((Circle))
A --> C(Round Rect)
B --> D{Rhombus}
C --> D
```


### Key Dependencies and Supporting Modules
**comps package**
Provides the orchestration framework:
- ServiceOrchestrator → Manages execution graph and service dependencies.
- MicroService → Defines an external service (embedding, retriever, reranker, LLM, guardrail).
- MegaServiceEndpoint, ServiceType, ServiceRoleType → Enums/constants for service classification.
**comps.cores.mega.utils.handle_message**
Helper to convert chat messages into a flat input prompt.
**comps.cores.proto.api_protocol**
Defines request/response schemas:
- ChatCompletionRequest, ChatCompletionResponse
- ChatMessage, UsageInfo, ChatCompletionResponseChoice
- Ensures OpenAI API compatibility.
**comps.cores.proto.docarray**
Provides parameter classes for fine-tuning services:
- LLMParams, RetrieverParms, RerankerParms.
**langchain_core.prompts.PromptTemplate**
Used for building and formatting flexible prompt templates.
**fastapi & StreamingResponse**
Underpins the HTTP API and streaming responses.

### Key functions and components
**ChatTemplate.generate_rag_prompt(question, documents)**
- Allows to dynamically define prompts for the LLM using LangChain PromptTemplate.
- Supports user-provided chat_template definitions.
- Ensures answers rely on retrieved knowledge and discourages hallucinations.

**align_inputs**
- Normalises inputs before passing them to each microservice
- Retriever receives retriever-specific parameters
- LLM input is converted into OpenAI-compatible format

**align_outputs**
- Converts outputs of one service into inputs for the next. 
- Could potentially be used to send parallel payloads to the application frontend.

**ChatQnAService.handle_request**
- Serves as a core request handler for the /chatqna endpoint
- Handles configuration for LLM, Retriever, and Reranker macro-parameters
- Schedules the workflow via Service Orchestrator
- Returns a ChatCompletionResponse

**ChatQnAService.add_remote_service()**
- Introduces methods to configure different workflow topologies. 
