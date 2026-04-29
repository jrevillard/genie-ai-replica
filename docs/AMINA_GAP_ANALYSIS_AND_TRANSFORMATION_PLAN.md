# AMINA Agent: Gap Analysis & Transformation Plan

> **Status**: Approved architecture — awaiting staged implementation  
> **Date**: 2026-04-21  
> **Scope**: Haystack/FastAPI agent stack (`haystack-stack/haystack-chatqna/`)  
> **Baseline**: [AMINA_AGENT_BEHAVIOR.md](AMINA_AGENT_BEHAVIOR.md) — 21-stage pipeline, 22 tools, 4 safety layers  
> **Approach**: Additive transformations — no rewrites, no removals, flag-gated

---

## Executive Summary

AMINA's agent pipeline is a **program that occasionally calls an LLM**, not an **LLM that occasionally calls a program**. Every intent-detection decision is made by regex, keyword lists, and deterministic classifiers before the LLM ever sees the message. By the time the model gets the prompt, its job has been pre-defined by ~15 upstream components, its creativity budget has been spent, its context has been assembled from 8 different sources, and its output will be stripped, re-prepended, and reviewed. The model is a **formatter of decisions already made**, not a **thinker making decisions**.

This document identifies 7 architectural gaps ranked by impact, proposes 3 layered transformations that ship independently, and provides a full implementation plan for Transformation 1 (Dialogue State Tracker) — the highest-leverage, lowest-risk starting point.

**Key principle**: the refactoring path forward is **subtractive of control, not additive of features**. Let the model think.

---

## Part 1: Root Diagnosis

### What AMINA Does Well

| Strength | Detail |
|----------|--------|
| Cultural engineering | 7-layer greeting with ethnic language detection, trust tiers, Alkallo/Imam/VHW registers, Jummah/Lumo acknowledgments — genuinely what a real Gambian CHW would do |
| Clinical safety | 4-layer safety stack: medication gate (pre-LLM), emergency detection (pre-LLM), safety supervisor (post-LLM), triage assignment |
| WHO PEN compliance | All 5 protocols embedded in system prompt and enforced by dedicated tools |
| Tool coverage | 22 tools covering the full clinical, cultural, and community support spectrum |
| Memory architecture | 3-tier (Redis → ArcadeDB → ArcadeDB+vectors) with compaction for indefinite conversations |
| Poverty-aware design | Local food names, cheap alternatives, low-literacy optimisation, facility routing by tier |

### What AMINA Gets Wrong

The pipeline re-derives everything from scratch on every turn. There is no persistent representation of "what this conversation is about right now," only a stream of messages and classifications. Watch what happens on a real message:

**Patient types**: *"my mother, she's old, her sugar was 180 yesterday but 220 this morning and she says her head hurts but she doesn't want to go to the hospital, what do i do"*

| Pipeline Step | What Happens | What's Wrong |
|---------------|-------------|-------------|
| Emergency check | Regex scans for keywords → maybe catches "head hurts," maybe doesn't | Keyword miss on context-dependent emergencies |
| Greeting | Fires on first turn regardless of message content | This is a worried-family-member moment, not a greeting moment |
| Vitals extraction | Pulls "180" and "220", records as the patient's glucose | **Bug**: patient is the carer, not the sugar-owner |
| Tool routing | "sugar" → `manage_diabetes`, "head hurts" → `assess_triage`, "hospital" → `find_facility` | 3 tools fire in parallel without reasoning about what's actually needed |
| Emotional classifier | "doesn't want to go" → fear → assertiveness bumped down | Correct detection, but applied to the wrong person |
| Intent classifier | Picks from 8 preset intents → probably WORRIED_ABOUT_OTHER | Correct, but the label doesn't carry enough information |
| Prompt assembly | Greeting + intention hint + tone signals + tool observations + intelligence block | 8 context sources stapled together, no coherent narrative |
| LLM | Generates in 80-word constraint | Clinically correct, templated, sounds like a decision tree |

The output will be clinically correct and will sound like a decision tree. **Because it was one.** The actual human moment — this woman is scared about her mother, she needs someone to help her think — never reaches a reasoning model. It gets sliced into buckets upstream.

---

## Part 2: Industry Comparison

### How State-of-the-Art Agents Solve This (2025-2026)

| Pattern | Industry Practice | AMINA Current State | Gap |
|---------|-------------------|---------------------|-----|
| **Intent understanding** | Small fast LLM call (Haiku-class, ~200ms) does structured intent extraction → drives routing | Regex keyword map (TOOL_ROUTES) decides before any reasoning | Understanding in code, execution in LLM (inverted) |
| **Dialogue state** | Persistent `DialogueState` object updated by model each turn: active topic, open questions, commitments, emotional register | No state. Message queue + per-turn classification pipeline | Re-derives everything from scratch every turn |
| **Response shaping** | Model chooses response shape (greeting, question, advice, empathy) based on state + intent | Deterministic greeting always fires on first turn. 80-word hard cap always applies | Greeting is a pipeline stage, not a choice |
| **Tool orchestration** | Agentic loop: model reasons → calls tool → reasons about result → calls more tools or responds | One-shot: all tools fire before model thinks, capped at 3 | Cannot do multi-step reasoning ("check if pregnant THEN look up meds") |
| **Safety architecture** | Constrained generation with validated schemas. Medication mentions require citation_id from whitelist | Second LLM call (GPT-4o-mini) reviews every response. Fail-open on exception | Band-aid (review LLM) where contract (schema validation) should be |
| **Context compaction** | Extract-and-update structured state from old messages, discard messages. Lossless for facts, lossy for chitchat | Summarize old messages into 300-word prose. Leaks clinical specifics | Summary loses precision. Should be structured extraction |
| **Emotional register** | Persistent across turns, smoothly evolving, mode-dependent response length | Re-classified every turn from scratch. 80-word hard cap regardless of emotional need | Flat emotional arc, truncated empathy |

### Architectural Inversion

The fundamental pattern difference:

```
Industry 2026:
  Message → LLM (understands intent, decides tools, reasons) → Tools → LLM (synthesises) → Response
  
AMINA Current:
  Message → Regex → Classifiers → Tools → Prompt Assembly → LLM (formats) → Strip → Review LLM → Response
```

In the industry pattern, **understanding lives in the LLM, execution lives in code**.
In AMINA, **understanding lives in code, execution lives in the LLM**.

---

## Part 3: The Seven Gaps, Ranked by Impact

### Gap 1 — Intent Understanding is Regex, Not Reasoning
**Impact**: Highest. **Fixability**: Partial fix easy, full fix requires Transformation 2.

`TOOL_ROUTES` keyword map decides what the message is about before any reasoning happens. Real humans don't hit keywords — they express situations.

| Message | Keyword Match | Actual Intent |
|---------|---------------|---------------|
| "My mother's sugar has been climbing" | No match for "blood sugar" | Diabetes conversation about a third party |
| "I'm scared about the thing the nurse told me" | No match | Huge clinical moment — fear + new diagnosis |
| "the doctor changed my pills" | "pills" → `get_medication_info` | Medication change — need to check interactions |
| "I don't feel right" | "feel sick" → `assess_triage` | Could be emotional, could be physical — needs reasoning |

**Fix direction**: A small, fast LLM call (Haiku-class, ~200ms) does intent extraction as structured output — `{primary_intent, secondary_intents, entities, emotional_undertone, who_is_the_patient, urgency}` — and THAT drives routing. Deterministic tools stay; a model, not a regex, decides which ones to call. (Transformation 2.)

### Gap 2 — No Dialogue State Machine
**Impact**: Highest. **Fixability**: Fully addressable. (Transformation 1.)

Every turn, the pipeline re-derives everything from scratch: who the patient is, what the conversation is about, what was agreed, what's pending. Messages are stored, but the *state of the conversation* is not.

**What's missing**: A `DialogueState` object persisted across turns with:
- `active_topic` — what is this conversation about right now?
- `open_questions` — things AMINA asked that the user hasn't answered
- `commitments` — things the user said they'd do
- `pending_decisions` — unresolved choices
- `emotional_register` — persisted, not re-derived each turn
- `subject` — who is the patient (self vs. carer talking about someone else)
- `active_flow` — multi-turn flow in progress (vitals collection, care plan, ritual)
- `last_turn_shape` — what did AMINA's last response do?

This is the single biggest lift toward feeling "alive" — continuity of thought across turns, not just messages.

### Gap 3 — Greeting Logic Kills the Opening
**Impact**: High (first impression). **Fixability**: Requires Transformation 3.

The 7-layer greeting system fires deterministically on the first turn regardless of what the user said. If the first message is a crisis-adjacent worried question, the agent still opens with "Isama jang, Fatou, I be di?" before engaging.

**What's right**: The cultural content is excellent. Ethnic-language detection, trust tiers, Alkallo/Imam/VHW registers, Jummah/Lumo acknowledgments — that IS what a real Gambian CHW would do.

**What's wrong**: It **always fires**, instead of being available when the conversation calls for it.

**Fix direction**: Greeting becomes a *response shape the model can choose*, not a pipeline stage. The 7 layers of data are *available context*, not *forced output*. The model picks: GREETING_FULL, GREETING_BRIEF, ACKNOWLEDGE_AND_ENGAGE, STRAIGHT_TO_CONCERN, EMERGENCY. (Transformation 3.)

### Gap 4 — Parallel Tool Execution Without an Agentic Loop
**Impact**: Medium-high. **Fixability**: Requires Transformation 2.

Tools are capped at 3, run in parallel, and all results fed to the model. One-shot tool use.

**What can't happen today**: "First check if she's pregnant (affects which HTN drug to suggest), then look up her meds, then generate care plan" — requires sequential reasoning about tool results.

**Fix direction**: LLM tool router with optional multi-step loop. Keyword map demoted to fast-path for obvious cases (60% of messages). For everything else, model reasons → calls tool → reasons about result → decides if more tools needed. (Transformation 2.)

### Gap 5 — Safety Supervisor is a Band-Aid Where a Contract Should Be
**Impact**: Medium. **Fixability**: Separate workstream, not part of Transformations 1-3.

A second GPT-4o-mini call reviews every response at 300ms latency. Fail-open on exception (safety silently disabled during outages).

**Better pattern**: Constrained generation — structured output with a schema the model must satisfy, validated before response goes out. Medication mentions require citation_id from whitelist or response is regenerated. Emergency keywords in user message force emergency-response schema. Eliminates the review LLM, makes safety deterministic.

**Note**: This is important but orthogonal to the 3 transformations. Addressed separately after Transformation 3 ships.

### Gap 6 — Compaction Summarizes Instead of Extracting
**Impact**: Medium. **Fixability**: Separate workstream.

The compactor reads old messages and generates a 300-word summary. This works but leaks specifics — clinical facts get compressed into prose and lose precision.

**Better pattern**: Extract-and-update. Compactor's job is to update a structured patient state (conditions, medications, vitals history, family context, stated preferences, commitments) from old messages, then discard them. Model reads from state, not from summary. Compaction becomes lossless for facts, lossy only for chitchat.

**Synergy with Transformation 1**: DialogueState is already half of this extraction. Once the state tracker is live, the compactor can delegate clinical-fact extraction to it rather than building its own summarizer.

### Gap 7 — 80-Word Hard Cap Lobotomises the Emotional Register
**Impact**: Medium. **Fixability**: Mode-aware length policy (design separately).

The 80-word MAX was written to prevent preachy LLM prose. It also prevents the model from being *present*. A scared caregiver needs more than 80 words.

**What you actually want** isn't a word limit — it's a **density rule**: no filler, no sign-offs, every sentence earns its place. A 200-word response can satisfy that; an 80-word response can violate it.

**Fix direction**: Mode-dependent length policy. Emergency, advice, and information responses stay tight. Empathy, grief, fear-acknowledgment, and family-dynamic responses get more room. Post-generation compression pass rather than hard pre-generation cap.

**Note**: This requires Transformation 1 (dialogue state tracks emotional register) and Transformation 3 (response-shape decision includes length mode). Designed separately after both ship.

---

## Part 4: Transformation Roadmap

### Dependency Graph

```
                    ┌──────────────────────┐
                    │ Transformation 1     │
                    │ Dialogue State       │
                    │ Tracker              │
                    └──────────┬───────────┘
                               │
                   ┌───────────┴───────────┐
                   │                       │
          ┌────────▼─────────┐   ┌─────────▼────────┐
          │ Transformation 2 │   │ Transformation 3  │
          │ LLM Tool Router  │   │ Response Shape    │
          │                  │   │ Decision          │
          └────────┬─────────┘   └─────────┬────────┘
                   │                       │
                   └───────────┬───────────┘
                               │
                   ┌───────────▼───────────┐
                   │ Post-Transformation   │
                   │ Workstreams           │
                   │ - Safety contracts    │
                   │ - Structured compactor│
                   │ - Mode-aware length   │
                   └───────────────────────┘
```

### Why This Order

1. **Transformation 1 first** because every subsequent transformation uses dialogue state. The LLM tool router (T2) makes better decisions with state as input. The response-shape decision (T3) is basically reading from state.

2. **Transformations 2 and 3 can run in parallel** once T1 is stable, because they read from state but don't write to each other.

3. **Post-transformation workstreams** (safety contracts, structured compactor, mode-aware length) depend on T1+T3 being live and are designed separately.

---

## Part 5: Transformation 1 — Dialogue State Tracker

### Objective

Add a `DialogueState` object, updated each turn by a small LLM call, read at the start of every turn, passed into prompt assembly as unified context. The single highest-leverage change to make AMINA feel alive.

### Prime Directives

1. **DO NOT** remove, rewrite, or refactor any existing pipeline stage. DialogueState is a new layer ADDED alongside.
2. **Feature-flagged**: `USE_DIALOGUE_STATE_TRACKER` env var, default `false`. Flag off = byte-identical behavior.
3. **State updates happen asynchronously AFTER response**, not synchronously before. Zero added latency on the response path.
4. **Redis for reads, ArcadeDB for snapshots**. Same pattern as existing 3-tier memory.
5. **Audit-logged**. State transitions visible to reviewers.

### Schema

```python
class DialogueState(BaseModel):
    conversation_id: str
    updated_at: datetime
    turn_count: int

    # What is this conversation about?
    active_topic: str | None                  # e.g. "mother's rising glucose"
    topic_started_at_turn: int | None

    # Who is the patient? (crucial for carer conversations)
    subject: Literal["self", "other_person", "general"]
    subject_description: str | None           # e.g. "speaker's mother, ~70, diabetic"

    # AMINA's unanswered questions
    open_questions: list[OpenQuestion]        # {question, asked_at_turn, still_relevant}

    # User's stated commitments
    commitments: list[Commitment]             # {commitment, made_at_turn, kind}

    # Unresolved decisions
    pending_decisions: list[str]              # e.g. "whether to call 199"

    # Emotional arc (persisted, not re-derived)
    emotional_arc: list[EmotionalMoment]      # last 5, with turn index
    current_register: Literal[
        "calm", "worried", "scared", "confused",
        "frustrated", "hopeful", "resigned"
    ]

    # Multi-turn flow tracking
    active_flow: str | None                   # "collecting_vitals", "care_plan_generation"
    active_flow_step: int | None

    # What did AMINA's last turn do?
    last_turn_shape: Literal[
        "greeting", "question", "advice", "emergency",
        "empathy", "information", "closing"
    ] | None
    last_turn_ended_with_question: bool

    # Topics noticed but not yet addressed
    deferred_topics: list[str]

    # Free-form model-authored observation (~400 chars max)
    notes: str | None
```

### Redis Storage

```
dialogue_state:{conversation_id}        # no TTL, full JSON
dialogue_state:{conversation_id}:lock   # TTL 30s, advisory lock during update
```

ArcadeDB: `DialogueStateSnapshot` document type. Snapshot every 10 turns or every 24h, whichever first.

### Update Mechanism

New service: `src/services/dialogue_state.py`

```python
async def load_state(conversation_id: str) -> DialogueState
async def update_state_async(
    conversation_id: str, user_msg, assistant_response,
    tools_used, triage_level
) -> None
async def render_state_for_prompt(state: DialogueState) -> str
```

`update_state_async` is called AFTER the response is sent (fire-and-forget via `asyncio.create_task`):
1. Load current state from Redis
2. Call fast model (Gemini 2.5 Flash Lite → Groq fallback) with update prompt
3. Input: current state JSON + user message + AMINA response + tools fired + triage level
4. Output: updated state JSON (structured output / JSON mode)
5. Write new state to Redis
6. If `turn_count % 10 == 0`, snapshot to ArcadeDB
7. Append audit log entry

### Update Prompt Design (Critical)

The update prompt instructs the model to:
- Carry forward state that hasn't changed (don't re-derive)
- Mark `open_questions` as answered when the user addressed them
- Add new commitments when the user says they'll do something
- Evolve `emotional_arc` smoothly (don't thrash between turns)
- Move `active_topic` only when the user genuinely changes subjects
- Write terse, observation-quality `notes` (not verbose summary)
- Detect `subject` shifts (carer vs self) from conversational cues

### Prompt Injection Point

In `amina_agent.py` Step 6b (prompt assembly), after the existing intelligence block, add:

```
[Dialogue State — what we both know right now]
{render_state_for_prompt(state)}
```

Example rendered output (~150 tokens):

```
Subject: speaker's mother (~70, diabetic)
Active topic: mother's rising glucose (since turn 2)
Register: worried → scared (last 2 turns)
Open question: did you check her feet for wounds? (asked turn 3, unanswered)
Commitment: you said you'd measure her BP tonight (turn 4)
Pending: whether she goes to clinic tonight or waits until morning
Last turn: I asked a question; you're likely about to answer.
Notes: She seems alone in the decision — family conversation may need to be suggested.
```

This is NOT a summary of messages (the compactor does that). It's state — crisp, active, forward-looking.

### Implementation Steps

| Step | Scope | Deliverable | Dependencies |
|------|-------|-------------|--------------|
| **0** | Inventory (no code) | `DIALOGUE_STATE_INVENTORY.md` — quote integration points, confirm Redis/ArcadeDB patterns, confirm async task pattern, confirm JSON mode support per model | None |
| **1** | Schema + Redis layer | `src/services/dialogue_state.py` with Pydantic model, Redis load/save, lock semantics, unit tests | Step 0 reviewed |
| **2** | Update prompt + model call | `update_state_async` with model fallback, unit tests with mocked responses covering 6 scenarios | Step 1 |
| **3** | Bootstrap for existing conversations | Lazy bootstrap from last 10 messages when no state exists. Fixture tests varying length | Step 2 |
| **4** | Prompt injection | `render_state_for_prompt`, integrated into Step 6b flag-gated. Diff-test flag-off = byte-identical | Step 3 |
| **5** | Update hook | Fire `update_state_async` as background task after Step 11 persist. Latency tests confirm zero impact | Step 4 |
| **6** | ArcadeDB snapshots | `DialogueStateSnapshot` document type, periodic snapshot every 10 turns / 24h | Step 5 |
| **7** | Evaluation harness | Replay 30 conversations flag-off vs flag-on, side-by-side diff viewer for qualitative review | Step 6 |
| **8** | Flag flip + observability | Metrics (update latency, fallback rate, state size, failure rate). Canary rollout: dev → staging → 10% → 100% | Step 7 reviewed |

### Success Criteria

| Criterion | Measurement |
|-----------|-------------|
| Flag OFF = identical behavior | Test suite proves byte-identical outputs |
| Carries topic across turns | 30 conversation review shows AMINA maintaining topic context |
| Open questions re-raised | Unanswered questions naturally re-appear in subsequent turns |
| Carer/patient distinction maintained | When carer speaks about patient, AMINA doesn't address patient directly after turn 2 |
| Emotional arc smooth | Register transitions gradually, not thrashing per-turn |
| Zero response latency impact | State update fully off response path (p50, p95 unchanged) |
| Safety unaffected | Supervisor rewrite rate does not increase |

---

## Part 6: Transformation 2 — LLM Tool Router (After T1 Ships)

### Objective

Replace keyword-based tool routing with an LLM-driven router that reads dialogue state to make smarter tool selection decisions. Enable multi-step agentic loops.

### Architecture

```
Message + DialogueState
      │
      ▼
┌─────────────────────────────┐
│ Fast-path check             │
│ (TOOL_ROUTES keyword map)   │──── 60% of messages: obvious matches
│ If confident match + simple │     route directly (same as today)
│ message → use deterministic │
└──────────┬──────────────────┘
           │ No confident match, or complex message
           ▼
┌─────────────────────────────┐
│ LLM Tool Router             │
│ (Haiku-class, ~200ms)       │
│                             │
│ Input:                      │
│  - User message             │
│  - DialogueState            │
│  - Available tool list      │
│  - Patient context          │
│                             │
│ Output (structured):        │
│  {                          │
│    tools: [{name, params,   │
│      reason}],              │
│    requires_sequential: bool│
│    reasoning: string        │
│  }                          │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Agentic Loop (optional)     │
│ If requires_sequential:     │
│  Execute tool 1 → feed      │
│  result back to router →    │
│  decide tool 2 → execute →  │
│  decide if done → respond   │
│ Max 3 iterations            │
└─────────────────────────────┘
```

### What Changes

| Component | Before | After |
|-----------|--------|-------|
| Tool selection | `_route_tools()` keyword map, always fires | Keyword fast-path for obvious cases; LLM router for the rest |
| Tool execution | All tools parallel, one-shot | Sequential when reasoning requires it |
| Tool cap | Hard 3 | 3 per loop iteration, max 3 iterations |
| Chitchat filter | Keyword list | Model recognises chitchat natively |
| Affirmative filter | Hardcoded word list | Model understands "yes" in context |

### What Doesn't Change

- All 22 tools stay as-is
- Tool implementations unchanged
- Emergency detection stays pre-LLM (safety-critical, must be deterministic)
- Medication safety gate stays pre-LLM
- Feature-flagged: `USE_LLM_TOOL_ROUTER`, default `false`

### Key Design Decisions

1. **Keyword map is demoted, not removed**. It becomes the fast-path for the 60% of messages with clear keyword signals. This preserves latency for simple cases.
2. **Agentic loop is optional**. Most messages still get one-shot routing. Sequential execution only when the router explicitly says `requires_sequential: true`.
3. **Router reads DialogueState** — this is why T1 must ship first. "She mentioned her mother's glucose is rising" in state means the router knows to route to `manage_diabetes` even if the current message says "what should I tell her?"

---

## Part 7: Transformation 3 — Response Shape Decision (After T1 Ships)

### Objective

Remove the hard first-turn greeting injection. Keep all 7 layers of greeting data. Let the model choose the response shape based on dialogue state, intent, and emotional register.

### Architecture

```
Message + DialogueState + Greeting Context (7 layers)
      │
      ▼
┌─────────────────────────────┐
│ Response Shape Selector      │
│ (integrated into main LLM   │
│  prompt, not a separate call)│
│                              │
│ Available shapes:            │
│  GREETING_FULL    — full     │
│    cultural greeting         │
│  GREETING_BRIEF   — short    │
│    salaam + engage           │
│  ACKNOWLEDGE_ENGAGE — skip   │
│    greeting, acknowledge     │
│    concern, engage directly  │
│  STRAIGHT_TO_CONCERN — no    │
│    greeting, address worry   │
│  EMERGENCY — emergency       │
│    protocol only             │
│  EMPATHY_FIRST — emotional   │
│    acknowledgment before     │
│    clinical content          │
│  CLOSING — warm goodbye      │
│    with follow-up plan       │
└──────────┬──────────────────┘
           │
           ▼
   Model generates response
   in chosen shape, using
   greeting data when the
   shape calls for it
```

### What Changes

| Component | Before | After |
|-----------|--------|-------|
| First-turn greeting | Always fires, deterministic, prepended | Model chooses shape; greeting data is context, not forced output |
| Greeting stripping | 40+ fragments stripped from LLM output, template prepended | Unnecessary — model generates the right shape from the start |
| 80-word cap | Hard, all responses | Mode-dependent: tight for advice/info, relaxed for empathy/grief |
| Response shaping | Post-processing (strip + prepend + capitalise) | Pre-generation (model knows the shape before it starts) |

### What Doesn't Change

- All 7 layers of greeting data still computed (they become context, not commands)
- Cultural content preserved — Mandinka greetings, trust tiers, role registers all available
- Emergency greeting bypass still works (now as EMERGENCY shape)

### Mode-Aware Length Policy

| Response Shape | Max Words | Rationale |
|----------------|-----------|-----------|
| GREETING_FULL | 80 | Cultural ritual, keep tight |
| GREETING_BRIEF | 60 | Quick opener |
| ACKNOWLEDGE_ENGAGE | 80 | Standard clinical |
| STRAIGHT_TO_CONCERN | 100 | Worried carer needs more room |
| EMERGENCY | 120 | Full protocol required |
| EMPATHY_FIRST | 150 | Emotional presence needs space |
| CLOSING | 80 | Warm but brief |

### Density Rule (Replaces Hard Word Cap)

The real constraint is not word count but **information density**:
- No filler phrases (existing rule, preserved)
- No sign-offs (existing rule, preserved)
- Every sentence earns its place
- Post-generation compression pass if over mode budget (rather than pre-generation hard cap)

---

## Part 8: Post-Transformation Workstreams

These become actionable after Transformations 1-3 are live.

### Workstream A: Safety Contracts (Replace Safety Supervisor)

| Current | Target |
|---------|--------|
| GPT-4o-mini reviews every response (~300ms) | Constrained generation with validated schemas |
| Fail-open on exception | Deterministic validation — regenerate if invalid |
| Medication check is string matching | Citation_id whitelist — medication mentions must reference approved source |
| Emergency miss is LLM judgment | Emergency keywords in input force emergency-response schema |

**Dependency**: Transformation 3 (response shapes define which schema to validate against).

### Workstream B: Structured Compactor (Replace Summary-Based Compaction)

| Current | Target |
|---------|--------|
| Summarize old messages into 300-word prose | Extract structured state from old messages |
| Summary leaks clinical specifics | Lossless for facts, lossy only for chitchat |
| Separate from dialogue state | Compactor delegates clinical-fact extraction to DialogueState |

**Dependency**: Transformation 1 (dialogue state is already half the extraction).

### Workstream C: Mode-Aware Response Length

| Current | Target |
|---------|--------|
| 80-word hard cap, all responses | Mode-dependent caps (60-150 words) |
| Pre-generation constraint in system prompt | Post-generation density check + compression |
| Same length for advice and empathy | Empathy gets more room, advice stays tight |

**Dependency**: Transformations 1 (emotional register in state) + 3 (response shape selection).

---

## Part 9: Risk Assessment

### Per-Transformation Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **T1: State update model hallucinates** — invents commitments or topics | Medium | Low (state is prompt context, not action trigger) | Validate state schema strictly. Audit log enables review. Garbage state = no state = current behavior |
| **T1: State update adds latency** | Low | High | Fully async (fire-and-forget after response). If update fails, next turn gets stale state, which is still better than no state |
| **T1: Bootstrap from 10 messages is inaccurate** | Medium | Low | Bootstrap is one-time, lazy. Bad bootstrap gets corrected on next update. No clinical decisions depend solely on bootstrapped state |
| **T2: LLM router slower than keyword map** | High (by design: ~200ms) | Medium | Keyword fast-path handles 60% of messages at current speed. Only ambiguous messages pay the 200ms |
| **T2: LLM router selects wrong tools** | Medium | Medium | Existing safety layers (emergency detection, med gate) are pre-router and unchanged. Wrong tool selection produces wrong observations but safety supervisor still reviews |
| **T3: Model chooses wrong response shape** | Medium | Medium | Greeting data still available as fallback. If shape selection degrades, revert to deterministic greeting with flag |
| **T3: Removing word cap causes verbose output** | High | Medium | Density rule + post-generation compression. Monitor output length distribution during canary |

### Rollback Plan

Every transformation is feature-flagged. Rollback = set flag to `false`. No data migration needed. State data in Redis/ArcadeDB is inert when flags are off.

---

## Part 10: Timeline & Sequencing

### Transformation 1: Dialogue State Tracker

| Step | Estimated Effort | Cumulative |
|------|------------------|------------|
| Step 0: Inventory | 1 session | 1 session |
| Step 1: Schema + Redis | 1 session | 2 sessions |
| Step 2: Update prompt + model | 2 sessions | 4 sessions |
| Step 3: Bootstrap | 1 session | 5 sessions |
| Step 4: Prompt injection | 1 session | 6 sessions |
| Step 5: Update hook | 1 session | 7 sessions |
| Step 6: ArcadeDB snapshots | 1 session | 8 sessions |
| Step 7: Evaluation harness | 1 session | 9 sessions |
| Step 8: Flag flip + observability | 1 session | 10 sessions |

### Transformation 2: LLM Tool Router
**Prerequisite**: T1 flag-on in production, stable for 1 week.  
**Estimated**: 8 sessions (similar structure).

### Transformation 3: Response Shape Decision
**Prerequisite**: T1 flag-on in production, stable for 1 week.  
**Can run in parallel with T2**.  
**Estimated**: 6 sessions.

### Post-Transformation Workstreams
**Prerequisite**: T1 + T3 both flag-on, stable.  
**Estimated**: 5-8 sessions each, can run in parallel.

---

## Part 11: What Not to Touch

These are explicitly out of scope for all transformations:

| Component | Why It Stays |
|-----------|-------------|
| 22 tool implementations | Working correctly. Tools don't need to change; only the router changes |
| WHO PEN protocols in system prompt | Clinically validated content. Any change requires clinical review |
| 3-tier memory architecture | Sound design. DialogueState is a 4th layer, not a replacement |
| ArcadeDB patient schema | Stable. DialogueState is a new document type, not a modification |
| Emergency detection (pre-LLM) | Safety-critical, must remain deterministic and fast |
| Medication safety gate (pre-LLM) | Safety-critical, must remain deterministic |
| Token compaction (4-layer) | Recently fixed. Structured compactor (Workstream B) is a future evolution |
| Cultural greeting content | The greetings themselves are excellent. Only when/whether they fire changes |
| Caregiver workflow | Separate pipeline, separate concerns |

---

## Appendix A: Before/After Examples

### Example 1: Carer Asking About Mother's Glucose

**User**: "my mother, she's old, her sugar was 180 yesterday but 220 this morning and she says her head hurts but she doesn't want to go to the hospital, what do i do"

**Current Output** (pipeline-derived):
> Isama jang! I be di? Your sugar reading of 220 is high. Target is 70-130 fasting. Please visit the nearest health post today for a check. If her headache gets worse or she feels confused, call 199.

Problems: greeting on a crisis message, addresses the carer as the patient, records vitals against wrong person, generic facility advice.

**Target Output** (with dialogue state + response shaping):
> Your mother's sugar climbing from 180 to 220 in one day is concerning, especially with the headache. This needs attention today — not necessarily EFSTH, but the health post in your area can check her properly. I know she doesn't want to go. Would it help if the CHW came to your compound instead? They can check her sugar and BP at home. In the meantime, make sure she drinks water and rests. If the headache gets worse, her vision changes, or she becomes confused — that is 199, don't wait.

Differences: no greeting (STRAIGHT_TO_CONCERN shape), addresses carer about mother (subject: other_person), offers CHW as alternative to hospital (reads the barrier), specific next step, emergency escalation criteria.

### Example 2: Returning Patient, Emotional Moment

**User**: "i just found out i have diabetes and i don't know what to do"

**Current Output** (pipeline-derived):
> Salaam aleikum, Fatou. I be di? Diabetes can be managed. Your fasting glucose target is 70-130 mg/dL. Start with reducing rice portions and walking 30 minutes daily. Tap the Symptom button for a full assessment.

Problems: greeting on an emotional message, jumps to numbers, offers form instead of presence.

**Target Output** (with dialogue state + empathy shape):
> I hear you, Fatou. Finding out is the hardest part, and you're allowed to feel whatever you're feeling right now. Here's what I want you to know: diabetes is manageable. Many people in your community live well with it. You don't have to figure everything out today. When you're ready, we'll talk about small changes — food, walking, checking your sugar. One step at a time. I'm here.

Differences: EMPATHY_FIRST shape (150 words allowed), no numbers (not the moment), no form suggestion, emotional presence, "when you're ready" respects pace.

---

## Appendix B: Glossary

| Term | Definition |
|------|-----------|
| **Agentic loop** | Model reasons → calls tool → reasons about result → calls more tools or responds. Multi-step reasoning |
| **Constrained generation** | LLM output must satisfy a schema; validated before delivery |
| **Dialogue state** | Structured representation of the current conversation's live state (not message history, not patient records) |
| **Density rule** | Every sentence must earn its place. No filler. Replaces hard word cap |
| **Fast-path** | Deterministic keyword routing for obvious messages (~60% of traffic) |
| **Response shape** | The structural form of a response: greeting, question, advice, empathy, emergency, etc. |
| **Trust tier** | STRANGER → ACQUAINTANCE → COMPANION → FAMILY progression based on interaction history |

---

## Appendix C: File Impact Map

### New Files (Transformation 1)

| File | Purpose |
|------|---------|
| `src/services/dialogue_state.py` | DialogueState model, Redis CRUD, update logic, render for prompt |
| `src/db/dialogue_state_schema.py` | ArcadeDB DialogueStateSnapshot document type |
| `docs/DIALOGUE_STATE_INVENTORY.md` | Step 0 inventory of integration points |

### Modified Files (Transformation 1)

| File | Change |
|------|--------|
| `src/agent/amina_agent.py` | Step 6b: inject rendered state into prompt (flag-gated). Step 11: fire update_state_async as background task |
| `src/db/setup_schema.py` | Call `setup_dialogue_state_schema()` (same pattern as compaction_schema) |
| `docker-compose*.yml` | Add `USE_DIALOGUE_STATE_TRACKER` env var (default false) |

### Unchanged Files (Explicitly)

All tool implementations, all safety modules, all existing services, all prompts, all frontend code.
