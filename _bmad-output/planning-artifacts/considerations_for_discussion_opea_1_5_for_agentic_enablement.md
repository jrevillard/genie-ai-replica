# OPEA 1.5 Agentic Library Evaluation for GENIEAI

## Purpose

This document outlines a number of observations and considerations that should be investigated before moving forward with porting the **OPEA 1.5 agentic library** to serve as the foundation of agentic enablement within the **GENIEAI** framework. The points below are intended to identify potential technical limitations, architectural considerations, and areas that may require further validation before adopting OPEA as the basis for future agentic workflows.

## Observations and Considerations

* **GenAIComps/comps/agent/src appears to be behind the latest vLLM code.**

  Throughout the repository, there are multiple references to *"the limitations in support for tool calling by TGI and vLLM"*, and OPEA has developed whole sub-categories of agent strategies to work around those limitations.

  * Supported agent types:
    https://github.com/opea-project/GenAIComps/tree/main/comps/agent/src#supported-agent-types

  Some of the files that define these strategies have last been updated in June 2025 (e.g. `GenAIComps/comps/agent/src/integrations/strategy/react`).

  * `planner.py`:
    https://github.com/opea-project/GenAIComps/blob/main/comps/agent/src/integrations/strategy/react/planner.py

  However, the official vLLM documentation states that both **tool calling** and **function calling** have been supported and are considered stable since the **vLLM 0.8.3** release (April 2025). It also documents support for a wide range of models (including Granite) that can be served and configured through custom flags for agentic workflows.

  * vLLM Tool Calling documentation:
    https://docs.vllm.ai/en/stable/features/tool_calling/

---

* **AgentQnA with vLLM-served models has only been validated for Intel and AMD hardware.**

  According to the AgentQnA examples, vLLM-served models have only been validated for **Intel and AMD hardware (not NVIDIA)** and only for **Intel and Meta models**.

  * AgentQnA:
    https://github.com/opea-project/GenAIExamples/tree/main/AgentQnA

  Furthermore, all Docker images and Docker Compose files in the repository appear to use code specific to AMD and Intel hardware.

---

* **Only `react_llama` supports memory and multi-turn conversations.**

  The OPEA 1.5 documentation indicates that only the `react_llama` agent supports memory and multi-turn conversations.

  * Supported agent types:
    https://github.com/opea-project/GenAIComps/tree/main/comps/agent/src#supported-agent-types

  This could become a significant limitation for use cases based on ChatQnA workflows, which are essentially centred around multi-turn exchanges between the user and the application.

---

* **The OPEA agent codebase does not appear to use the LangChain/LangGraph Deep Agents library.**

  At least based on the project requirements, I did not find any reference to the LangChain/LangGraph Deep Agents library.

  * Project requirements:
    https://github.com/opea-project/GenAIComps/blob/main/requirements.txt

  Deep Agents is becoming the de facto state-of-the-art framework for advanced agentic workflows. It significantly improves context management and middleware for ReAct-type agents, which are likely to form the core of agentic workflows in our use cases.
