---
title: PRD — GENIE.AI Agentic Runtime Layer
status: draft
created: 2026-08-15
updated: 2026-08-15
prd_key: agentic-runtime-layer
initiative: agentic-enablement
branch: feat/agentic-enablement
builds_on:
  - ../prd-agentic-enablement.md
authors: Genie.ai Dev
---

⸻

1. Executive Summary

This draft PRD builds on the PRD — GENIE.AI Agentic Enablement ( ../prd-agentic-enablement.md ) and specifically addresses Pillar 2 (Agentic layer)

The objective is to introduce agentic capabilities that allow applications to execute multi-step, stateful, tool-using workflows rather than being limited to a single request/retrieval/generation interaction.

The proposed GENIEAI Agent Runtime will provide a standardized and extensible execution environment for building and running AI agents while preserving compatibility with the existing GENIEAI/OPEA microservice infrastructure.

The initial implementation is expected to leverage LangChain, LangGraph, and Deep Agents, while ensuring that GENIEAI’s public abstractions do not become unnecessarily coupled to any specific agent framework. The runtime should support simple use cases such as agentic RAG with web search while providing an extensible foundation for significantly more complex agents, workflows, memory architectures, tools, and integrations.

A central design objective is composability. GENIEAI should provide sensible defaults and high-level configuration for common use cases while allowing developers to replace or extend individual components when application requirements exceed the default capabilities.

⸻

2. Background and Context

GENIEAI currently provides capabilities for developing AI applications using an OPEA Microservices architecture.

The existing platform provides, among other capabilities:

* LLM inference through vLLM-based services
* RAG pipelines
* embedding and retrieval services
* reranking
* ArangoDB-based vector and graph storage
* FastAPI-based service interfaces
* Kong-based API gateway infrastructure
* OpenTelemetry-based observability
* service health and readiness mechanisms
* a custom Vue.js frontend

The existing architecture and operational infrastructure represent a significant investment and should remain the foundation for the agentic capabilities.

The introduction of agents should therefore extend the existing GENIEAI platform rather than create a parallel agent infrastructure.

⸻

3. Problem Statement

Current GENIEAI applications are primarily structured around predefined request-processing pipelines. While these pipelines are effective for RAG-oriented use cases, increasingly sophisticated AI applications require the ability to:

* perform multiple steps to solve a task;
* select and invoke tools dynamically;
* reason over intermediate results;
* execute conditional workflows;
* maintain state across long-running executions;
* retrieve and update persistent memory;
* work with files and other artifacts;
* interact with external services;
* pause and resume execution;
* support human-in-the-loop interactions;
* expose execution progress to users and operators.

The rapidly evolving agent ecosystem also makes it difficult to predict the complete set of capabilities that future GENIEAI applications will require.

Consequently, the architecture should avoid imposing a single comprehensive agent model. Instead, it should provide stable abstractions and extension mechanisms that allow individual applications to compose the capabilities they require.

⸻

4. Product Vision

The long-term vision is for GENIEAI to evolve from primarily a RAG application framework into an open, extensible platform for building production-grade AI agents and agentic applications for the public sector.

The Agent Runtime should enable developers to construct applications ranging from simple:

RAG + web search

to substantially more complex systems involving:

planning + multiple tools + persistent memory + files + human approval + long-running workflows + external services + custom business logic.

The platform should make the simple cases easy while not preventing advanced users from implementing sophisticated custom architectures.

GENIEAI Agent Runtime shall support Open Knowledge Format (OKF) as a configurable mechanism for representing, storing, exchanging, and providing structured knowledge and contextual information to agents.

⸻

5. Goals

5.1 Primary Goals

The Agent Runtime shall:

1. Provide a standardized runtime for executing AI agents and agentic workflows.
2. Preserve compatibility with the existing GENIEAI/OPEA microservice infrastructure.
3. Support stateful, multi-step and potentially long-running workflows.
4. Support configurable and extensible memory architectures.
5. Support configurable context management.
6. Support configurable and extensible tools.
7. Support MCP-based integrations.
8. Integrate with existing GENIEAI RAG capabilities.
9. Use existing GENIEAI model-serving infrastructure, including vLLM.
10. Provide execution observability and user-facing workflow status.
11. Support high-level configuration for common use cases.
12. Provide extension mechanisms for advanced/custom use cases.
13. Avoid unnecessary coupling between GENIEAI and a specific agent framework or storage technology.

5.2 Secondary Goals

The platform should also provide a foundation for:

* human-in-the-loop workflows;
* persistent and resumable execution;
* agent workspaces and files;
* multi-agent workflows;
* domain-specific tools;
* custom workflow logic;
* advanced memory strategies;
* future agent frameworks and orchestration technologies.

⸻

6. Non-Goals

The initial Agent Runtime will not attempt to:

* replace the existing GENIEAI RAG infrastructure;
* provide a universal memory architecture for all possible agents;
* prescribe one universal agent state schema;
* support every possible agent orchestration pattern in the first release;
* expose every underlying framework capability directly through the GENIEAI API;
* provide a fully distributed agent computing platform from the outset;
* solve all possible public-sector AI use cases in the initial release.

The architecture should, however, avoid preventing these capabilities from being added later.

⸻

7. Design Principles

P1. Runtime Compatibility

GENIEAI Agent Runtime shall provide a standardized, extensible execution environment for building and running AI agents while preserving compatibility with the existing GENIEAI/OPEA microservice infrastructure.

The Agent Runtime should use the existing service harness and operational mechanisms wherever practical, including:

* FastAPI;
* Kong;
* OpenTelemetry;
* logging;
* health and readiness mechanisms;
* deployment patterns;
* authentication and authorization mechanisms.

⸻

P2. Composability

Agent capabilities shall be composed from independently configurable components.

An agent should use only the capabilities it requires.

For example:

Simple Agent
├── State
├── Working Memory
└── RAG Tool

while another agent may use:

Complex Agent
├── State
├── Working Memory
├── Semantic Memory
├── Episodic Memory
├── Filesystem
├── Project Database
├── Context Manager
├── Multiple Tools
└── MCP

⸻

P3. Pluggability and Extensibility

Core Agent Runtime components shall expose stable interfaces that allow standard implementations to be replaced or extended. This shall include support for multiple knowledge and memory representations, including database-backed storage, filesystem-based storage, Open Knowledge Format (OKF), and custom implementations.

Potential extension points include:

* workflow engines;
* memory providers;
* context managers;
* state management;
* tools;
* model providers;
* storage providers;
* MCP integrations;
* OKF integrations;
* agent implementations;
* execution policies.

⸻

P4. Configuration-First Customization

Common agent configurations should be achievable through high-level configuration without modifying the Agent Runtime.

Advanced use cases should be able to provide custom implementations through code or plugins.

The intended model is:

Simple use case
    ↓
Configuration
Advanced use case
    ↓
Configuration + custom components

⸻

P5. Technology Independence

GENIEAI’s public interfaces should minimize unnecessary coupling to individual implementation technologies.

LangGraph, LangChain, Deep Agents, ArangoDB, and other technologies should initially be treated as implementation components or supported integrations rather than defining the GENIEAI conceptual model.

⸻

P6. Explicit Resource and Context Management

LLM calls, tool calls, memory retrieval, and context construction should be explicit and observable.

The architecture should avoid unnecessary LLM calls and uncontrolled accumulation of state or conversation history in model context.

⸻

P7. Observability by Design

Agent executions should be observable at the workflow, node, tool, model, memory, and error levels.

Observability should support both:

* technical troubleshooting and monitoring;
* user-facing visualization of agent execution.

⸻

P8. Incremental Complexity

The platform should make simple agentic applications easy to build without requiring developers to configure advanced capabilities.

Complexity should be introduced only when required by the application.

⸻

8. Target Users

The primary users of the Agent Runtime are:

Application Developers

Developers building custom GENIEAI AI applications.

AI/ML Engineers

Developers implementing advanced agents, workflows, memory strategies and tools.

Solution Architects

Users designing complete public-sector AI application architectures.

Platform Administrators

Users responsible for deployment, monitoring, security and operations.

End Users

Users interacting with applications powered by GENIEAI agents.

⸻

9. Expected Capabilities

The Agent Runtime should provide the following high-level capabilities.

9.1 Agent Execution

The runtime shall support:

* creation and registration of agents;
* execution of agents;
* execution identifiers;
* execution status;
* cancellation;
* interruption;
* resumption;
* error handling;
* retries;
* execution persistence.

⸻

9.2 Workflow Orchestration

The runtime shall support workflows containing:

* sequential execution;
* conditional branching;
* loops;
* parallel execution;
* tool invocation;
* LLM invocation;
* deterministic processing;
* intermediate results;
* workflow checkpoints;
* human-in-the-loop steps.

The initial workflow implementation is expected to use LangGraph.

⸻

9.3 State Management

State shall represent information required to execute and resume a workflow.

The platform shall:

* support persistent workflow state;
* support checkpointing;
* support pause/resume;
* allow workflow-specific state schemas;
* avoid imposing a universal GENIEAI state schema;
* allow custom state structures where required.

State should remain conceptually distinct from long-term memory.

⸻

9.4 Memory Management

The Agent Runtime shall provide a modular memory abstraction.

Memory capabilities should be independently configurable and composable.

Potential memory providers include:

* working memory;
* conversation memory;
* semantic memory;
* episodic memory;
* structured databases;
* ArangoDB;
* filesystem-based memory (including OKF integration);
* external memory services.

The platform should not require every agent to use every memory layer.

⸻

9.5 Context Management

A dedicated context-management abstraction should determine what information is provided to the LLM at each execution step.

The context manager may combine:

* current task;
* workflow state;
* recent conversation;
* retrieved memories;
* RAG results;
* tool outputs;
* files and artifacts;
* system instructions.

Context management should be independently configurable and replaceable.

This separation is intended to prevent the workflow state or memory store from becoming an uncontrolled source of LLM context and token consumption.

⸻

9.6 Tools

The runtime shall provide a standard tool abstraction supporting:

* tool registration;
* tool discovery;
* tool schemas;
* input validation;
* execution;
* error handling;
* retries;
* permissions;
* observability;
* configurable timeouts.

Initial tools may include:

* GENIEAI RAG;
* web search;
* calculator;
* file operations.

The architecture should support arbitrary custom tools.

⸻

9.7 MCP Integration

The Agent Runtime should provide an MCP integration layer allowing agents to consume external MCP-based tools and services.

MCP should be treated as an integration mechanism rather than the only supported tool mechanism.

⸻

9.8 Filesystem and Artifacts

The runtime should support agent workspaces for use cases requiring persistent files or intermediate artifacts.

Potential artifacts include:

* documents;
* generated reports;
* datasets;
* code;
* intermediate analysis;
* tool outputs.

The filesystem abstraction should be replaceable to support different deployment environments.

⸻

9.9 Model Integration

Agents shall use the existing GENIEAI model-serving infrastructure.

The initial implementation shall support vLLM-based model serving.

The architecture should provide a model abstraction allowing additional model providers to be supported in the future.

⸻

9.10 RAG Integration

Existing GENIEAI RAG capabilities should be exposed to agents as reusable capabilities/tools.

Agents should be able to invoke RAG as one step within a larger workflow rather than requiring a separate RAG execution path.

Example:

User Question
      ↓
Agent
      ↓
RAG
      ↓
Evaluate evidence
      ↓
Web Search if required
      ↓
Synthesis
      ↓
Answer

⸻

10. High-Level Architecture

The proposed architecture is:

                         GENIEAI
                            │
                         Vue.js
                            │
                          Kong
                            │
              ┌─────────────┴─────────────┐
              │                           │
      Existing GENIEAI              Agent Runtime
        Services                         │
              │                ┌─────────┼─────────┐
              │                │         │         │
              │             Workflow   Memory   Context
              │              Engine    Manager   Manager
              │                │         │         │
              │             LangGraph    │         │
              │                          │         │
              │                ┌─────────┼─────────┐
              │                │         │         │
              │             ArangoDB     OKF    Filesystem
              │
       ┌──────┴───────────────────────────────────────────┐
       │                                                  │
      vLLM                    Existing RAG              MCP
       │                         Services               Services
       └──────────────────────────────────────────────────┘

The Agent Runtime should remain operationally consistent with existing GENIEAI microservices.

⸻

11. Key Architectural Components

11.1 Agent Runtime

The Agent Runtime is the primary execution service.

Responsibilities include:

* receiving agent execution requests;
* loading agent configuration;
* initializing execution state;
* invoking the workflow engine;
* coordinating tools and memory;
* managing execution lifecycle;
* emitting execution events;
* handling errors and interruptions;
* exposing execution status.

The runtime should not contain application-specific agent logic.

⸻

11.2 Agent Definition

An agent definition describes how an agent is configured.

It may specify:

Agent
├── Model
├── Workflow
├── State
├── Memory
├── Context Strategy
├── Tools
├── MCP integrations
├── Filesystem
└── Execution policies

The definition should support high-level configuration as well as custom implementations.

⸻

11.3 Workflow Engine

The workflow engine executes agent workflows.

The initial implementation is expected to use LangGraph.

The workflow abstraction should support:

* nodes;
* transitions;
* conditional routing;
* loops;
* parallelism;
* state;
* checkpoints;
* interruption;
* resumption.

The GENIEAI architecture should avoid exposing LangGraph-specific concepts unnecessarily through public platform APIs.

⸻

11.4 State Manager

The State Manager is responsible for execution state persistence and recovery.

Responsibilities include:

* state persistence;
* checkpointing;
* retrieval;
* recovery;
* execution resumption.

The state schema should be defined by the workflow/agent rather than imposed globally by GENIEAI.

⸻

11.5 Memory Manager

The Memory Manager provides a common abstraction for persistent agent memory.

Responsibilities include:

* registering memory providers;
* routing memory operations;
* retrieving relevant memories;
* storing memories;
* managing memory lifecycle.

The Memory Manager should support multiple providers within a single agent.

Example:

Memory Manager
├── Working Memory
├── ArangoDB
├── Filesystem
└── Custom Database

⸻

11.6 Context Manager

The Context Manager transforms available state and memory into the context provided to the LLM.

Responsibilities may include:

* context selection;
* relevance filtering;
* memory retrieval;
* summarization;
* compression;
* token-budget management;
* ordering and prioritization;
* task-specific context construction.

The Context Manager should be independently replaceable.

⸻

11.7 Tool Manager

The Tool Manager provides standardized tool registration and invocation.

It should manage:

* tool discovery;
* schemas;
* permissions;
* invocation;
* error handling;
* retries;
* observability.

⸻

11.8 MCP Layer

The MCP layer provides connectivity to external MCP servers and tools.

It should allow MCP-based capabilities to be presented to agents through the same general tool abstraction where practical.

⸻

11.9 Model Adapter

The Model Adapter provides a standardized interface between agents and LLM services.

The initial implementation should integrate with GENIEAI’s vLLM infrastructure.

⸻

11.10 Filesystem / Artifact Manager

The Artifact Manager provides controlled access to agent workspaces and persistent files.

It should support:

* creation;
* reading;
* writing;
* modification;
* deletion;
* artifact metadata;
* access control;
* persistence.

⸻

11.11 Execution Event and Observability Layer

The runtime should emit structured events representing execution progress.

Examples:

RUN_STARTED
NODE_STARTED
LLM_STARTED
LLM_COMPLETED
TOOL_STARTED
TOOL_COMPLETED
MEMORY_READ
MEMORY_WRITE
NODE_COMPLETED
INTERRUPTED
ERROR
RUN_COMPLETED

Operational telemetry should integrate with the existing GENIEAI OpenTelemetry infrastructure.

⸻

12. Frontend Requirements

The GENIEAI frontend should be extended to support agentic execution.

The UI should provide:

* execution status;
* workflow progress;
* current activity;
* tool invocation status;
* errors;
* interruptions;
* human approval requests;
* completion status.

Where appropriate, users should be able to expand execution steps to inspect additional information.

Example:

Research Agent
✓ Understand request
✓ Search GENIEAI knowledge base
✓ Search web
⟳ Analyse evidence
○ Generate response

The UI architecture should allow future visualization of more complex workflows without requiring major changes to the Agent Runtime.

⸻

13. Configuration and Customization

The Agent Runtime should support high-level configuration for common agents.

Conceptually:

agent:
  name: research_assistant
model:
  provider: vllm
  model: configured-model
workflow:
  engine: langgraph
  definition: research_workflow
memory:
  providers:
    - working
    - arangodb
context:
  strategy: default
tools:
  - rag
  - web_search

Advanced agents should be able to provide custom implementations.

For example:

memory:
  strategy:
    type: custom
    implementation: custom_memory.MyMemoryManager

The exact configuration format is a technical design decision and is outside the scope of this PRD.

⸻

14. Extensibility Requirements

The Agent Runtime shall provide extension points for at least:

* agents;
* workflows;
* workflow engines;
* state management;
* memory providers;
* memory routing;
* context management;
* tools;
* MCP integrations;
* model providers;
* artifact storage;
* execution policies.

Extensions should not require modification of the GENIEAI Agent Runtime core wherever practical.

⸻

15. Initial Use Cases

The first implementation should focus on a limited set of representative use cases.

UC-1: Agentic RAG

The agent answers questions using GENIEAI RAG.

Question
   ↓
Agent
   ↓
RAG
   ↓
Answer

⸻

UC-2: Agentic RAG + Web Search

The agent can determine that available internal knowledge is insufficient and invoke web search.

Question
   ↓
RAG
   ↓
Evidence sufficient?
   ├── Yes → Answer
   │
   └── No → Web Search
                 ↓
               Answer

⸻

UC-3: Multi-Step Research

The agent decomposes a research task into multiple steps, executes tools, and synthesizes the results.

⸻

UC-4: Human-in-the-Loop

The agent pauses execution and requests user approval before continuing.

⸻

UC-5: Stateful / Resumable Execution

The agent performs a long-running task that can be interrupted and resumed.

⸻

16. Non-Functional Requirements

The Agent Runtime should meet the following high-level requirements.

Performance

* Minimize unnecessary LLM calls.
* Avoid uncontrolled context growth.
* Support configurable execution and tool timeouts.
* Support parallel execution where appropriate.

Reliability

* Support retries for recoverable failures.
* Support checkpointing.
* Support recovery from interrupted executions.
* Fail gracefully when external services are unavailable.

Observability

* Integrate with OpenTelemetry.
* Provide structured execution events.
* Provide sufficient telemetry for debugging individual executions.

Security

* Support authentication and authorization through existing GENIEAI mechanisms.
* Apply access control to tools, memory and files.
* Prevent unauthorized access between agent executions.
* Provide appropriate controls for external tool integrations.

Maintainability

* Maintain clear interfaces between runtime components.
* Minimize coupling between implementation technologies.
* Support independent evolution of components.

Portability

* Preserve the existing GENIEAI/OPEA deployment model.
* Support containerized deployment.
* Avoid unnecessary dependencies on specific cloud providers.

⸻

17. Success Criteria

The initial Agent Runtime should be considered successful when:

1. A developer can implement a simple agentic RAG application without modifying the runtime core.
2. An agent can use existing GENIEAI RAG capabilities as a tool.
3. An agent can use at least one external tool such as web search.
4. Agent executions can be monitored through the existing observability infrastructure.
5. Users can observe meaningful execution status through the GENIEAI UI.
6. Agents can persist and resume workflow state.
7. Agents can use configurable memory providers.
8. Developers can implement a custom memory provider without modifying the runtime core.
9. Developers can implement a custom context-management strategy.
10. Developers can define custom workflows.
11. The runtime continues to use the existing GENIEAI/OPEA service infrastructure.
12. The architecture does not prevent future support for substantially more complex agentic applications.

⸻

18. Initial Technology Direction

The initial implementation is expected to use:

Component	Initial technology/direction
Service framework	FastAPI / existing GENIEAI-OPEA harness
API Gateway	Kong
Observability	OpenTelemetry
LLM serving	vLLM
Workflow engine	LangGraph
Agent abstractions	LangChain / Deep Agents where appropriate
Vector / graph storage	ArangoDB
RAG	Existing GENIEAI RAG services
Frontend	Existing Vue.js application
External tools	MCP + custom tool abstraction
Agent filesystem	New configurable filesystem/artifact layer

These technologies should be considered initial implementation choices rather than permanent architectural constraints.

⸻

19. Proposed Initial Delivery Phases

Phase 1 — Agent Runtime Foundation

* Agent Runtime microservice
* existing OPEA/GENIEAI service harness integration
* vLLM integration
* basic LangGraph workflow execution
* basic agent configuration
* execution lifecycle
* OpenTelemetry integration

Phase 2 — Agentic RAG

* RAG tool
* web-search tool
* basic agentic workflow
* workflow execution events
* frontend execution status

Phase 3 — State and Memory

* persistent state
* checkpointing
* basic Memory Manager
* ArangoDB memory provider
* working memory
* basic Context Manager

Phase 4 — Extensibility

* custom tools
* custom memory providers
* custom context strategies
* filesystem/artifacts
* MCP integration
* advanced configuration

Phase 5 — Advanced Agent Capabilities

Potential future capabilities include:

* human-in-the-loop workflows
* long-running agents
* advanced memory architectures
* multi-agent workflows
* subagents
* complex planning
* advanced workflow visualization
* additional model providers
* additional persistence backends

⸻

20. Open Architectural Questions

The following questions should be resolved during technical design and prototyping rather than prematurely fixed in the PRD:

1. How much of LangGraph should be exposed through GENIEAI’s public abstractions?
2. Should the workflow-engine interface support alternative engines from the first release?
3. What should constitute the minimum GENIEAI state contract?
4. How should checkpoints be persisted?
5. How should Memory Manager routing be configured?
6. How should memory retrieval and context construction interact?
7. How should token budgets be enforced?
8. How should agent filesystem/workspaces be isolated?
9. What execution events should be exposed to the frontend?
10. Should execution events use a streaming protocol such as SSE or WebSockets?
11. How should long-running executions be managed?
12. How should human-in-the-loop interruptions be represented?
13. How should permissions be applied to tools and MCP services?
14. How should agents be packaged and distributed?
15. What should the boundary between LangChain, LangGraph, Deep Agents and GENIEAI abstractions be?
16. What degree of distributed execution should be supported?
17. How should multi-agent workflows be represented?
18. How should agent evaluation and testing be integrated into the platform?

⸻

21. Architectural North Star

The Agent Runtime should ultimately provide the following model:

                         GENIEAI
                            │
                ┌───────────┴───────────┐
                │                       │
          Existing RAG             Agent Runtime
          Infrastructure                 │
                │              ┌─────────┼─────────┐
                │              │         │         │
                │          Workflow    Memory   Context
                │           Engine     Manager   Manager
                │              │         │         │
                │           LangGraph    │         │
                │                        │         │
                │                ┌───────|─────────┐
                │                │       |         │
                │             ArangoDB   OKF      Filesystem
                │
                └──────────────┬──────────────────────┐
                               │                      │
                              vLLM                   MCP
                               │                      │
                               └──────────┬───────────┘
                                          │
                                       Agent
                                          │
                                     Vue.js UI




                         Agent
                           │
                ┌──────────┴──────────┐
                │                     │
              State              Context Manager
                │                     │
                │              ┌──────┴───────┐
                │              │              │
                │           Memory         Knowledge
                │           sources        sources
                │              │              │
                │       ┌──────┼──────┐       │
                │       │      │      │       │
                │     Arango  Files  Custom   OKF
                │
                └──────────────┬────────────────┘
                               │
                         Context Assembly
                               │
                              vLLM

The central architectural principle is:

GENIEAI should provide the platform and the contracts; individual agents should define the architecture they need.

The Agent Runtime should make the common case simple, while preserving enough composability and extensibility to accommodate agent architectures that cannot yet be predicted.