# Response to Unified Prototype Testing and Evaluation Framework

**Subject:** GENIE.AI prototype — alignment with unified test questions, scenarios, benchmarking, logging, and facilitated multi-turn evaluation  

**Document type:** Formal response for evaluators and test facilitators  
**Repository:** GENIE.AI (reference implementation)  
**Date:** 12 May 2026  

---

## 1. Purpose of this document

This document is our **single consolidated response** to the described evaluation approach. In the organizers’ terms, the prototype will be tested against a **unified set of test questions and scenarios** that are **designed to reflect the specific requirements of each use case** and **developed with input from technical experts, focus-area experts, and country experts**. That suite is expected to combine:

- **Typical questions** that intended end users are expected to ask;  
- **Multi-turn interaction sequences** representing complex or challenging conversations;  
- **Edge-case scenarios** to assess system robustness;  
- **Extreme or adversarial inquiries** intended to evaluate safety, resilience to jailbreaking attempts, and resistance to other malicious prompt behaviors;  
- **Additional interaction scenarios** where use-case experts judge them relevant.

Under test, **each prototype is evaluated sequentially across all scenarios**. Responses are then compared against **predetermined ideal responses and benchmarks**. Those ideals represent the **desired behavior and expected outputs** of the solution for the **defined test inputs** and serve as the **reference baseline** for performance evaluation and benchmarking; they are **developed and validated by subject matter experts (SMEs)**. **Data logging** captures **all prototype outputs verbatim**. Where **multi-step interaction** is required (for example, a sequence of **dependent** user messages), the **test facilitator follows a predefined script** so that behavior is **consistent across participants**.

We confirm that we **understand these requirements**, that our prototype can be **exercised under them**, and that we will **cooperate** with facilitators and evaluators in the manner described below.

### 1.1 How we use this framework internally (design and prompt clarity)

The competition text above is not only a **declaration** for organizers; it is a **specification** for how we expect the prototype to be **judged**. We therefore read it as imposing several concrete expectations on both **documentation** and **runtime behavior**:

| Organizer intent | What it implies for the prototype |
|------------------|-------------------------------------|
| **Use-case–specific** questions and scenarios | Answers should respect **configured knowledge**, **locale or country scope**, and **domain policy** as deployed—not generic web knowledge—so that comparison to SME **ideal responses** for the **same inputs** is meaningful. |
| **Triangulated** expert input (technical, focus area, country) | Outputs should remain **technically sound**, **domain-appropriate**, and **geographically honest** (including abstaining or clarifying when materials centre on another region), matching the kind of nuance SMEs encode in reference answers. |
| **Typical** user questions | The system should give **direct, usable** replies grounded in approved sources where the rubric expects grounding. |
| **Multi-turn** and **dependent** sequences | **Session coherence** matters: follow-ups that refer to prior turns must not be treated as isolated prompts; this aligns with **scripted facilitator** turns that build on earlier lines. |
| **Edge cases** | **Robust handling** of ambiguity, weak retrieval, out-of-scope requests, and boundary conditions—without fabrication—is part of what “ideal” baselines often encode for RAG systems. |
| **Adversarial** and **jailbreak-style** probes | **Safety boundaries** (refusal, non-compliance with malicious instructions embedded in text, no system-prompt leakage) are first-class evaluation targets; verbatim logs will show whether the prototype **held** those boundaries turn by turn. |
| **Sequential** run through **all** scenarios | We accept **order effects** as shared protocol; we will not assume that shuffling or skipping scenarios is allowed unless organizers say so. |
| **Predetermined ideal responses** | We treat SME baselines as **authoritative** for “what good looks like” on each **defined input**; our role is to produce **faithful, loggable** behavior, not to dispute the reference during the test. |
| **Verbatim logging** | We will **not edit or replace** logged model or application outputs for scoring purposes after generation. |
| **Predefined facilitator script** | We will mirror **exact scripted wording** where required so that **inputs** match other participants; comparability rests on **identical user-side scripts**, not on improvising friendlier paraphrases. |

This table is our **bridge** from competition language to **product and prompt design**: it is why GENIE.AI emphasizes **closed-corpus behaviour**, **abstention when evidence is thin**, **multi-turn continuity**, and **explicit resistance to instruction injection** in the chat service configuration (see `genie-ai-overlay/chatqna/genieai_chatqna.py` and environment-driven prompt overrides in project documentation).

---

## 2. Acknowledgment of the evaluation model

We acknowledge and accept that (see also **§1.1** for the mapping from organizer language to expected prototype behaviour):

1. **Scenarios align to use-case requirements**, not a generic questionnaire. They are developed with **triangulated expert input**—**technical**, **focus-area**, and **country** perspectives—so that tests reflect how the solution should behave in its **intended deployment context** (policy, domain, and locale as defined by the program). Test material is therefore **not** assumed to be interchangeable across use cases: each **defined test input** is tied to **ideal responses** that SMEs expect for **that** use case.

2. **Test coverage** is expected to span the same categories the framework describes explicitly:
   - **Typical end-user questions** reflecting realistic information needs;
   - **Multi-turn sequences** (including **dependent** follow-ups) that stress coherence, appropriate use of prior turns within policy, and handling of challenging conversational flows;
   - **Edge cases** probing robustness (ambiguous queries, out-of-scope requests, malformed or partial inputs, boundary conditions appropriate to the use case);
   - **Adversarial or extreme prompts** probing **safety**, **resistance to jailbreak-style manipulation**, and **resilience to malicious prompt patterns**, within the rules set by the evaluation organizers;
   - **Supplementary scenarios** that use-case experts may add when they are material to the use case.

3. **Each prototype is run through the full scenario set in a fixed order**—**sequential** execution across **all** scenarios—so every participant is measured under the **same ordered protocol**. That supports **fair comparison** between prototypes and teams.

4. **Scoring or qualitative comparison** uses **predetermined ideal responses and benchmarks**. Those references encode **desired behavior and expected outputs** for each **defined test input**; they are **SME-developed and SME-validated** and form the **authoritative baseline** against which prototype outputs are judged.

5. **Data logging** captures **all prototype outputs verbatim** (and, where the framework includes it, relevant inputs and metadata as specified by organizers). Logs are the **primary factual record** of what the system produced under test.

6. **Multi-step interactions** use a **predefined facilitator script** wherever the protocol requires it—especially when later user turns **depend** on earlier ones—so that **user-side behavior is equivalent** across participants and **sessions remain comparable**.

We treat this framework as **legitimate and appropriate** for public-sector and responsible-AI prototypes, including systems built on **retrieval-augmented generation (RAG)** and **large language models (LLMs)**.

---

## 3. How the GENIE.AI prototype fits this evaluation design

### 3.1 Architecture relevant to fair testing

GENIE.AI is a **modular RAG platform** (web client, backend, document and knowledge services, and configurable AI services). Evaluators can trace the path from **user input** through **retrieval, optional reranking, and generation**, as documented in **`docs/architecture.md`** and summarized in **`ARCHITECTURE_DOCUMENTATION.md`** at the repository root.

That structure supports **transparent testing**: the same external prompt sequence yields a **documented pipeline** (gateway, authentication where enabled, chat service, retrieval, LLM), which aligns with **benchmarking against ideal answers** when those ideals assume grounded, policy-compliant behavior.

### 3.2 Typical and multi-turn use

The prototype is intended for **conversational access** to **approved corpora** and configured policies. **Multi-turn** evaluation is compatible with the system’s session and conversation model; facilitators following a **fixed script**—including sequences where user messages **depend** on prior turns—map cleanly to **repeatable** inputs for comparison across teams.

### 3.3 Edge cases and robustness

Edge-case scenarios (e.g. unclear questions, no relevant documents, mixed languages if configured) are appropriate for a **RAG** system. GENIE.AI supports **configurable system and abstention-related behavior** (including environment-driven prompt overrides described in project configuration documentation). Evaluators should treat **observed behavior** as the combination of **retrieved evidence**, **model behavior**, and **deployment configuration** (models, temperature, prompts, enforced abstention settings).

### 3.4 Safety, jailbreak resistance, and adversarial prompts

We recognize that **adversarial prompts** are a **core** part of modern LLM evaluation. GENIE.AI does not claim **immunity** to all possible attacks; no responsible vendor should. We commit to:

- **Not obstructing** adversarial or red-team style scenarios that fall within the organizer’s ethical and legal rules;
- **Documenting** the deployed configuration (model family, key prompt and safety-related settings that are non-secret) when organizers request it for interpretation of results;
- **Accepting** that SME baselines may define **desired** behavior (for example: refusal, deferral to human channels, or answer strictly from cited sources) that the prototype may or may not meet on every attempt.

Where evaluation compares outputs to **ideal responses**, we understand that **partial credit** or **rubric-based** scoring may apply and that **verbatim logs** are the **authoritative record** of what the system produced under test.

---

## 4. Logging, privacy, and facilitator-led scripts

### 4.1 Verbatim logging

We support **verbatim capture of model and application outputs** as required by the test protocol, subject to:

- **Organizer-supplied** logging mechanisms (e.g. facilitator-controlled recording, platform-side logs, or export of conversation transcripts from the test harness); and  
- **Applicable law**, institutional rules, and **data protection** requirements for any **personal or sensitive** content that might appear in logs during scripted tests.

We will **enable or permit** application- and infrastructure-level logging as agreed with organizers, and will **not alter** logged outputs **after the fact** for evaluation purposes.

### 4.2 Facilitator scripts and consistency

We will **follow facilitator instructions** for:

- **Order** of scenarios (including **sequential** progression through the **full** set where the protocol specifies it);  
- **Exact wording** of scripted user turns where the protocol requires it—especially for **dependent** multi-step flows where later turns must follow a **predefined** sequence;  
- **Pauses, resets, or session boundaries** if specified between scenarios.

**Inputs vs outputs under test:** The organizer model pairs **predefined user-side scripts** (so every prototype sees the **same defined test inputs** in the same order) with **verbatim capture of prototype outputs**. We will not reinterpret mandatory script lines on the inbound side, and we will not rewrite outbound text after the model responds for the purpose of improving scores.

We will **not** substitute ad hoc paraphrases for **mandatory script lines** unless the facilitator explicitly authorizes a deviation (for example accessibility).

---

## 5. Comparison to ideal responses and benchmarks

We understand that:

- **Ideal responses** are the **SME-approved reference** for **defined test inputs**: they state the **desired behavior and expected outputs** (including acceptable refusals, deferrals, or grounded answers with citations, as the rubric specifies), not the model’s unconstrained first draft;
- **Discrepancies** between prototype output and ideal answers will be analyzed against **rubric criteria** (accuracy, grounding in sources, tone, policy compliance, refusal quality, etc.) as defined by organizers;
- **Sequential** testing across the **entire** scenario set may surface **order effects** (for example session length or fatigue); because this applies **uniformly** to participants, we accept it as part of the **shared** evaluation design;
- **Verbatim logs** supply the evidence trail for side-by-side review against those **predetermined** benchmarks.

We will **not** assert that automated metrics alone define “success” where the framework prioritizes **human judgment** against SME baselines.

---

## 6. Practical readiness for evaluation sessions

To run the prototype under test, evaluators typically need:

- A **deployed instance** (or organizer-provided environment) with **documented configuration** (`env` / `.env` patterns as in repository documentation);
- **Clarity** on whether **Keycloak** and full **OPEA** profiles are in scope for the test session (core vs full stack);
- **Test data** or **corpora** aligned with SME baselines, if retrieval-grounded ideals depend on specific documents.

End-to-end procedures for authentication and lifecycle testing exist under **`docs/e2e-tests/`**; organizers may use or adapt these for **operational** readiness checks before benchmark runs.

---

## 7. Limitations and good-faith clarifications

- **Reference implementation:** GENIE.AI is a **framework and reference stack**. Final behavior depends on **models**, **prompts**, **uploaded knowledge**, and **operator policy**. Evaluation should attribute results to the **whole configured system**, not only a single component.
- **Ideal responses vs. stochastic models:** Repeat runs with non-zero temperature may vary. If the protocol requires **strict reproducibility**, organizers should specify **sampling parameters** or **fixed seeds** where the stack supports them.
- **Safety baselines:** SME “ideal” refusals or safe completions remain authoritative; **occasional failures** of the prototype do not invalidate the value of **adversarial** testing — they **document** residual risk for deployers.

---

## 8. Summary statement

We **accept** unified, use-case–grounded evaluation: test material shaped with **technical, focus-area, and country** expert input; a mix of **typical**, **multi-turn** (including **dependent** turns), **edge-case**, and **adversarial** prompts, plus **any additional scenarios** experts deem relevant; **sequential** execution **across all scenarios** for every prototype; **comparison** to SME **predetermined** ideal responses that define **desired behavior and expected outputs** for each input; **verbatim logging** of outputs as specified; and **facilitator-controlled predefined scripts** so multi-step tests stay **consistent across participants**. We will **cooperate** in **good faith**, and we understand that **verbatim logs and rubric-based comparison** to those baselines form the **primary evidence base** for how the prototype performs under **realistic and stressful** conditions.

---

## 9. Contact and document control

| Field | Value |
|--------|--------|
| Document title | Response to unified prototype testing and evaluation framework |
| File location (repository root) | `TESTING_EVALUATION_FRAMEWORK_RESPONSE.md` (source) and `TESTING_EVALUATION_FRAMEWORK_RESPONSE.docx` (Microsoft Word) |
| Word version | `TESTING_EVALUATION_FRAMEWORK_RESPONSE.docx` — same substantive content as this markdown file, for submission portals that require a **.docx** upload. |

*End of document.*
