# AMINA Token Compaction Architecture

**Status**: Implemented — core bug fixed, ArcadeDB write-through active  
**Date**: 2026-04-21  
**Scope**: Four-layer context management system across haystack-chatqna backend + React frontend

---

## 1. System Overview

AMINA serves five LLM providers (AMINA LoRA, Gemini 2.5 Flash Lite, Groq/Llama 3.3, Mistral 7B, GPT-4o mini) through a single agent (`amina_agent.py`). Each has radically different context windows (8K → 1M tokens). The compaction system keeps conversations within every model's budget while preserving clinical continuity when users switch models mid-conversation.

### Architecture Diagram

```
                          ┌────────────────────────────┐
                          │     React Frontend         │
                          │  ┌──────────────────────┐  │
                          │  │ Context Ring (ctxPct) │  │
                          │  │ Compact Button        │  │
                          │  │ Toast: "Freed ≈N tok" │  │
                          │  └──────┬───────────────┘  │
                          └─────────┼──────────────────┘
                                    │ POST /agent/compactor/trigger/{sid}
                                    ▼
┌───────────────────────────────────────────────────────────────────────┐
│                         FastAPI Backend                               │
│                                                                       │
│  ┌─────────────────────┐    ┌──────────────────────────────────────┐  │
│  │  agent_routes.py    │    │  amina_agent.py                      │  │
│  │  /compactor/stats   │    │  ┌────────────────────────────────┐  │  │
│  │  /compactor/trigger │    │  │  Prompt Assembly (THE BUG)     │  │  │
│  └────────┬────────────┘    │  │  [sys + summary] + ALL msgs    │  │  │
│           │                 │  │  Summary ADDS tokens, doesn't  │  │  │
│           ▼                 │  │  replace the messages it        │  │  │
│  ┌─────────────────────┐   │  │  summarized.                    │  │  │
│  │ LAYER 1             │   │  └────────────────────────────────┘  │  │
│  │ context_compactor   │   │                                      │  │
│  │ .py                 │   │  ┌──────────────────────┐            │  │
│  │ 75%: bg summary     │──▶│  │ memory.messages      │            │  │
│  │ 90%: hard_cap_trim  │   │  │ (full history, never │            │  │
│  │ Gemini→Groq→GPT    │   │  │  mutated by compact) │            │  │
│  └─────────────────────┘   │  └──────────────────────┘            │  │
│           │                └──────────────────────────────────────┘  │
│           ▼                                                          │
│  ┌─────────────────────┐   ┌──────────────────��───────────────────┐  │
│  │ LAYER 2             │   │ LAYER 3                              │  │
│  │ overflow_guard.py   │   │ agent_tokens_fix.py                  │  │
│  │ Pre-trim + retry    │   │ Dynamic output ceiling               │  │
│  │ Per-model char caps │   │ Plan=1000, Long=600, Short=250      │  │
│  └─────────────────────┘   │ LoRA plan=1500, floor=600            │  │
│                            │ Translator floor=2000                │  │
│  ┌─────────────────────┐   └──────────────────────────────────────┘  │
│  │ LAYER 4             │                                             │
│  │ overflow_guard_     │                                             │
│  │ patch.py            │                                             │
│  │ Monkey-patches      │                                             │
│  │ AminaAgent.__init__ │                                             │
│  │ + caregiver client  │                                             │
│  └─────────────────────┘                                             │
└───────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │       Redis           │
              │  session:{sid}        │  ← full message history (24h TTL)
              │  chat:summary:{sid}   │  ← pinned summary (24h TTL)
              │  chat:summary_ver:{s} │  ← version counter (24h TTL)
              │  chat:compact_infl:{s}│  ← dedup lock (5min TTL)
              └───────────────────────┘
                          │
                          ▼ (consultation save only)
              ┌───────────────────────┐
              │      ArcadeDB         │
              │  ConsultationRecord   │
              │  .messages = JSON str │  ← no standalone Message type
              │  .summary  = STRING   │  ← consultation-level, NOT compaction summary
              └───────────────────────┘
```

---

## 2. Layer-by-Layer Inventory

### Layer 1: Context Compactor
**File**: `haystack-stack/haystack-chatqna/src/services/context_compactor.py` (456 lines)

**Purpose**: Background compression of older conversation turns into a pinned clinical summary.

**Constants**:
| Name | Value | Purpose |
|------|-------|---------|
| `_SOFT_THRESHOLD_RATIO` | 0.75 | Triggers background compaction |
| `_HARD_THRESHOLD_RATIO` | 0.90 | Fallback synchronous trim |
| `_COMPACT_KEEP_TAIL` | 4 | Always preserve last 4 turns |
| `_COMPACT_MIN_TURNS` | 8 | Minimum turns before compacting |
| `_SUMMARY_MAX_TOKENS` | 300 | Summary output budget |
| `_SUMMARY_TTL_SECONDS` | 86400 | Redis TTL (24 hours) |

**Call flow**:
```
amina_agent.process_message()
  └→ maybe_schedule_compaction(session_id, messages, char_budget, patient_name)
       ├─ len(messages) < 8? → skip
       ├─ running_chars < 75% of budget? → skip
       ├─ in-flight lock exists? → skip
       ├─ Set in-flight lock (5min TTL)
       └→ asyncio.create_task(compact_session(...))
            ├─ Slice: messages[:-4] = turns to compact
            ├─ Fold in existing summary if any
            ├─ _run_summarizer(transcript) — fallback chain:
            │    ├─ Gemini 2.5 Flash Lite (primary)
            │    ├─ Groq (fallback)
            │    └─ GPT-4o-mini (last resort)
            ├─ _persist_summary() → Redis setex + incr version
            └─ _clear_inflight()
```

**Summarizer system prompt** (line 225): Clinical-focused — preserves patient facts, medications, allergies, vitals, commitments, follow-ups, cultural context. Drops greetings, verbose reasoning, redundant facts. Output: single dense paragraph, no bullets.

**hard_cap_trim()** (line 398): Synchronous fallback. Walks the head from newest backward, keeping what fits within 90% of char_budget. Returns new list — never mutates input.

**Token estimation** (line 89): `len(text) // 4` — Mistral tokenizer heuristic (~3.8 chars/token). Not an actual tokenizer.

---

### Layer 2: Overflow Guard
**File**: `haystack-stack/haystack-chatqna/src/services/overflow_guard.py` (276 lines)

**Purpose**: Last-resort safety net wrapping every `client.chat.completions.create` call. Operates on the in-flight prompt only — never touches `memory.messages` or Redis.

**Per-model character caps**:
| Model key | Char cap | ~Tokens | Server limit |
|-----------|----------|---------|--------------|
| `amina` | 28,000 | 7.3K | 10K (vLLM) |
| `mistral` | 24,000 | 6.3K | 8K |
| `llama` / `groq` | 360,000 | 95K | 128K |
| `gemini` | 3,000,000 | 790K | 1M |
| `gpt-4o` | 360,000 | 95K | 128K |
| (default) | 60,000 | 16K | — |

**Two-phase protection**:
1. **Pre-trim** (`_pretrim`, line 133): Before HTTP request, iteratively drop oldest user/assistant pairs until messages fit within char_cap. Always keeps system head + final user turn (floor of 2 messages). Max 50 iterations.
2. **Retry on overflow** (`guarded_create`, line 211): If server returns context-length error, drop oldest turn and retry. Max 6 retries (`MAX_OVERFLOW_RETRIES`).

**Key invariant**: Never touches `memory.messages` or Redis. Only shrinks the in-flight prompt copy. The compactor picks up the slack on the next turn.

---

### Layer 3: Agent Token Budget Fix
**File**: `haystack-stack/haystack-chatqna/src/services/agent_tokens_fix.py` (390 lines)

**Purpose**: Dynamically raises *output* token ceilings so multi-point clinical answers don't truncate mid-list.

**Output caps** (tunable via env vars):
| Request type | Tokens | LoRA variant | Env var |
|---|---|---|---|
| Plan/list request | 1,000 | 1,500 | `AMINA_MAX_TOKENS_PLAN` |
| Long message (≥250 chars) | 600 | — | `AMINA_MAX_TOKENS_LONG` |
| Standard (80-250 chars) | 400 | — | `AMINA_MAX_TOKENS_STANDARD` |
| Short (<80 chars) | 250 | — | `AMINA_MAX_TOKENS_SHORT` |
| Tiny (<25 chars / acks) | 100 | — | `AMINA_MAX_TOKENS_TINY` |
| LoRA floor (any call) | — | 600 | `AMINA_LORA_MAX_TOKENS_FLOOR` |
| Translator floor | 2,000 | — | `AMINA_TRANSLATOR_MAX_TOKENS_FLOOR` |

**Three monkey-patches applied by `apply()`** (line 310):
1. Replaces `amina_agent._get_max_tokens` with `_patched_get_max_tokens`
2. Wraps `amina_client.chat.completions.create` (LoRA vLLM endpoint) via `_wrap_lora_create`
3. Wraps `translator.client.chat.completions.create` via `_wrap_translator_create`

**Plan detection** (`_looks_like_plan_request`, line 139): Regex for keywords like "care plan", "manage", "how can I", "tips", "guide", "diet", "exercise", etc. Also detects explicit numbered-list hints ("5 things", "bullet points").

**Orthogonal to compaction** — adjusts output budget, not input context.

---

### Layer 4: Overflow Guard Installer
**File**: `haystack-stack/haystack-chatqna/src/services/overflow_guard_patch.py` (136 lines)

**Purpose**: Monkey-patches `AminaAgent.__init__` so every instance gets overflow protection on all five client attributes (`amina_client`, `openai_client`, `gemini_client`, `groq_client`, `mistral_client`, `client`).

Also patches the caregiver service's `AsyncOpenAI` class by subclassing it with `_GuardedAsyncOpenAI` that auto-wraps on construction.

**Imported by**: `main_with_guard.py`, `main_with_training.py`, `main_with_literacy.py` — executes `install()` at import time before any agent instance exists.

---

## 3. Prompt Assembly (The Bug)

**File**: `haystack-stack/haystack-chatqna/src/agent/amina_agent.py`

### Per-model budgets (line 1547):
```python
_MODEL_BUDGETS = {
    "amina":   (20_000, 900,  6),  # char_budget, max_output_tokens, history_turns
    "groq":    (10_000, 500,  4),
    "mistral": (10_000, 500,  4),
    "gemini":  (22_000, 800,  6),
    "base":    (18_000, 400,  6),
}
```

### LoRA branch prompt assembly (lines 1590-1617):
```
1. Fetch pinned summary from Redis
2. If summary exists → APPEND to _LORA_SYS system prompt (capped at 800 chars)
3. Build history: memory.messages[:-1][-6:] → last 6 prior turns, 500 chars each
4. Final prompt = [system + summary] + [last 6 turns] + [current user turn]
```

### Generic branch prompt assembly (lines 1639-1675):
```
1. Fetch pinned summary from Redis
2. If summary exists → APPEND to system prompt (capped at 800 chars)
3. Compute flex budget: char_budget - fixed_chars (sys + current msg)
4. Allocate: 35% patient history, 35% RAG evidence, 30% chat history
5. Build history: memory.messages[:-1][-N:], N = _hist_turns (4 or 6)
6. Final prompt = [system + summary] + [patient + RAG + history turns] + [current user turn]
```

### THE BUG

Both branches do the same thing wrong:

```
[system prompt + summary] + [ALL recent history from memory.messages]
```

The summary is **prepended** but the messages it summarized are **not removed** from the history window. The compactor writes a summary to Redis, but `memory.messages` is never trimmed by the background compaction — only the `/compactor/trigger` endpoint (manual button click) actually trims `session["messages"]` in Redis.

**Net effect of background auto-compaction**: summary ADDS ~800 chars to system prompt. No messages are removed. Token count goes UP, not down.

**Net effect of manual compact button**: The `/trigger` endpoint (agent_routes.py line 71) DOES trim `session["messages"]` down to the last 4. But the next turn's prompt assembly still reads `memory.messages` which may or may not reflect the trimmed Redis state depending on whether the Memory object was rehydrated from Redis after the trim.

### Why the token counter doesn't drop

**Frontend** (App.jsx line 3525):
```javascript
const rawTokens = msgs.reduce((a, m) => a + Math.ceil((m.content || "").length / 3.5), 0);
const estTokens = Math.max(0, rawTokens - freedOffset);
const ctxPct = Math.min(1, estTokens / ctxLimit);
```

The frontend counts tokens from the **display message array** (`msgs`), then subtracts a local `freedOffset` that's set when the user clicks Compact. This is purely cosmetic — it makes the ring appear to drop, but:
1. `msgs` (the display array) is never mutated — all messages stay visible
2. `freedOffset` resets to 0 on page refresh
3. The backend's actual prompt size is not reflected anywhere in the UI

The ring drop is an animation trick, not a measurement of real prompt size.

---

## 4. Data Model (Current State)

### ArcadeDB Schema

There is **no standalone Message type** in ArcadeDB. Messages are embedded as a JSON string inside `ConsultationRecord`:

```sql
-- setup_schema.py
CREATE VERTEX TYPE ConsultationRecord IF NOT EXISTS
CREATE PROPERTY ConsultationRecord.id IF NOT EXISTS STRING
CREATE PROPERTY ConsultationRecord.patient_id IF NOT EXISTS STRING
CREATE PROPERTY ConsultationRecord.session_id IF NOT EXISTS STRING
CREATE PROPERTY ConsultationRecord.started_at IF NOT EXISTS STRING
CREATE PROPERTY ConsultationRecord.ended_at IF NOT EXISTS STRING
CREATE PROPERTY ConsultationRecord.messages IF NOT EXISTS STRING      -- JSON array
CREATE PROPERTY ConsultationRecord.symptoms_reported IF NOT EXISTS STRING
CREATE PROPERTY ConsultationRecord.triage_level IF NOT EXISTS STRING
CREATE PROPERTY ConsultationRecord.tools_used IF NOT EXISTS STRING
CREATE PROPERTY ConsultationRecord.recommendations IF NOT EXISTS STRING
CREATE PROPERTY ConsultationRecord.followup_scheduled IF NOT EXISTS STRING
CREATE PROPERTY ConsultationRecord.summary IF NOT EXISTS STRING       -- consultation summary, NOT compaction summary
```

### Python Message Dataclass

**`src/agent/memory.py`** (line 7):
```python
@dataclass
class Message:
    role: str           # "user" or "assistant"
    content: str
    timestamp: datetime
    tools_used: List[str]
```

### Redis Keys

| Key pattern | TTL | What it stores | Written by |
|---|---|---|---|
| `session:{session_id}` | 24h | Full session dict including `messages[]` array | `memory_manager.save_session()` |
| `chat:summary:{session_id}` | 24h | Pinned compact summary text | `context_compactor._persist_summary()` |
| `chat:summary_version:{session_id}` | 24h | Monotonic version counter | `context_compactor._persist_summary()` |
| `chat:compact_inflight:{session_id}` | 5min | Dedup lock ("1") | `context_compactor.maybe_schedule_compaction()` |
| `lora:summary:{session_id}` | 24h | Legacy key (pre-Phase B) — read-only fallback | Never written (compat only) |

### What's missing

1. **No link between summary and messages it replaced** — summary is a standalone Redis string, not connected to any message range
2. **No compaction audit trail** — when a summary was generated, which messages it covered, what the token delta was
3. **No ArcadeDB persistence of summaries** — Redis 24h TTL is the only storage. After TTL expires, summary is gone, original messages in Redis session are also gone (same 24h TTL), but ConsultationRecord in ArcadeDB has the full messages blob from when the session was saved
4. **No is_active_in_prompt flag** — no way to distinguish "in the model's prompt" from "visible to the user"

---

## 5. Frontend Compact UI

**File**: `components/frontend/src/App.jsx`

### Context usage badge (line 3523-3533)

Per-model token limits hardcoded in frontend:
```javascript
const TOKEN_LIMITS = { amina: 10240, groq: 128000, mistral: 32768, gemini: 1000000, base: 128000 };
```

Token estimate: `Math.ceil((m.content || "").length / 3.5)` per message, summed across all `msgs`.

The `freedOffset` state variable is subtracted from raw token count to simulate a drop after compaction. This value is purely local — not synced with backend, lost on refresh.

### Compact button behavior (line 3537-3578)

```
1. Guard: msgs.length <= 4 → "Nothing to compact"
2. Estimate freed tokens locally from msgs[0 .. -4]
3. If newlyFreed < 1 → "Already compacted"
4. POST /agent/compactor/trigger/{sessionId}
5. Read server response (dropped count)
6. Set freedOffset → ring drops
7. Show toast: "Context Compacted — Freed ≈N tokens · M messages compacted"
```

### Summary message rendering (line 886-910)

Messages with `role === "summary"` render as a centered divider with "Previous context" label and compacted count. The summary is injected into the `msgs` array by the handleCompact function after a successful compact.

---

## 6. Issues Identified and Fixed

### Issue 1: Background compaction never trimmed session messages — FIXED

**Root cause**: `compact_session()` wrote summary to Redis but never removed the summarized messages from `session["messages"]`. The prompt assembly read `memory.messages` which still had everything. Summary was additive — it made prompts larger, not smaller.

**Fix**: `compact_session()` now calls `_trim_session_messages()` after generating the summary. This removes the first N messages (the ones covered by the summary) from the Redis session. On the next turn, `memory.messages` is naturally shorter because it's loaded from the trimmed Redis session.

**Result**: The prompt assembly in `amina_agent.py` doesn't need changes — it already reads `memory.messages[:-1][-N:]`. After trimming, that slice only contains post-compaction turns. The summary is prepended to the system prompt as before, and the history window now contains only uncovered messages.

### Issue 2: Redis as sole persistence for summaries — FIXED

**Fix**: `compact_session()` now writes through to ArcadeDB via `_persist_to_arcadedb()`. A `CompactionSummary` vertex stores the summary text, range_count, token deltas, trigger type, and summarizer model used. Redis remains the hot cache (24h TTL); ArcadeDB is the durable audit trail.

On Redis cache miss, `get_summary_meta()` falls back to `_load_meta_from_arcadedb()` which queries the latest CompactionSummary for the session and rehydrates the Redis cache.

### Issue 3: Token counter lost on page refresh — FIXED

**Fix**: `freedOffset` in the frontend is now backed by `sessionStorage` (keyed by sessionId). Survives page refresh within the browser tab. The backend also returns `tokens_reduced` (not "freed_tokens") with the real delta computed from actual char counts.

### Issue 4: "Freed tokens" language is misleading — FIXED

**Fix**: API response field renamed to `tokens_reduced`. `freed_tokens` kept as deprecated alias for one release cycle. Frontend toast changed from "Freed ≈N tokens" to "Reduced ≈N tokens". Compact button title changed from "Click to compact" to "Click to reduce context".

### Issue 5: No tokenizer — all counts are char-based estimates — OPEN

Token estimation still uses `len(text) // 4` (backend) and `len(text) / 3.5` (frontend). This is a Mistral tokenizer heuristic that will be wrong for Mandinka text by 30-50%. Fixing this requires integrating the actual model tokenizer — deferred to a future step.

### Issue 6: No compaction metadata or audit trail — FIXED

**Fix**: `_persist_summary_meta()` stores range_count, tokens_before/after, chars_before/after, trigger_type, summarizer_model, and timestamp in Redis (`chat:summary_meta:{sid}`). Same data persisted to ArcadeDB `CompactionSummary` vertex. `get_compaction_stats()` returns the full metadata in its response.

---

## 7. What Was Implemented

### Mental model (unchanged)

Every conversation has **two views** of its history:

1. **Display history** — every message ever sent. Shown to the user in the frontend `msgs` array. Never mutated by compaction.
2. **Prompt history** — what we actually send to the LLM on the next turn. Stored in Redis `session:{sid}.messages`. After a compact, this is trimmed to only the tail turns. The summary is prepended to the system prompt.

Compaction does not "free" anything. It **replaces** a range of messages with a shorter synthetic summary when building the model prompt.

### Implemented changes

**1. `context_compactor.py` — background compaction now trims session messages**

`compact_session()` after generating the summary:
1. Calls `_trim_session_messages(session_id, compacted_count)` to remove the first N messages from the Redis session
2. Calls `_persist_summary_meta()` to store range_count, token deltas, trigger type, summarizer model
3. Calls `_update_active_tokens()` to cache the new active token count
4. Calls `_persist_to_arcadedb()` to write a durable `CompactionSummary` vertex (non-fatal on failure)

`_run_summarizer()` now returns `(summary_text, model_used)` tuple instead of just the text.

New public functions:
- `get_summary_meta(session_id)` — returns compaction metadata (with ArcadeDB fallback on Redis miss)
- `get_active_token_count(session_id)` — cached active token count (recomputes on miss)

New internal functions:
- `_trim_session_messages()` — removes compacted messages from Redis session
- `_persist_summary_meta()` — stores metadata in Redis
- `_update_active_tokens()` — caches active token count
- `_recompute_active_tokens()` — recomputes from Redis session state
- `_persist_to_arcadedb()` — writes CompactionSummary vertex
- `_load_meta_from_arcadedb()` — loads latest meta on Redis miss

**2. `compaction_schema.py` — new ArcadeDB vertex type**

```sql
CompactionSummary {
  id, session_id, summary_text, version,
  range_count, tokens_before, tokens_after,
  chars_before, chars_after, trigger_type,
  summarizer_model, created_at
}
HasCompaction edge type (for future ConsultationRecord → CompactionSummary linking)
```

Auto-created on startup via `setup_schema.py`.

**3. `agent_routes.py` — updated API endpoints**

`POST /compactor/trigger/{session_id}` response:
```json
{
  "tokens_before": 4200,
  "tokens_after": 1100,
  "tokens_reduced": 3100,
  "messages_summarized": 12,
  "messages_kept_verbatim": 4,
  "freed_tokens": 3100,     // deprecated alias
  "dropped": 12,            // deprecated alias
  "kept": 4                 // deprecated alias
}
```

`GET /compactor/stats/{session_id}` now includes:
- `active_tokens`, `compacted_message_count`, `tokens_before`, `tokens_after`
- `trigger_type`, `last_compact_at`, `summarizer_model`

`POST /compactor/undo/{session_id}` — new endpoint, clears summary + meta from Redis.

**4. `App.jsx` — frontend fixes**

- `freedOffset` persisted in `sessionStorage` (keyed by sessionId) — survives page refresh
- `handleCompact` reads `messages_summarized` and `tokens_reduced` from new response fields (backward compat with old fields)
- Toast text: "Reduced ≈N tokens" not "Freed"
- Button title: "Click to reduce context" not "Click to compact"

### Remaining work (future steps)

1. **Tokenizer correctness** — replace `len(text) // 4` with actual model tokenizer. Critical for Mandinka accuracy.
2. **Badge reads from backend** — frontend badge should poll `/compactor/stats` for `active_tokens` instead of local char estimate. Current `freedOffset` approach is correct-enough but doesn't account for system prompt / RAG overhead.
3. **Undo with message restoration** — current `/undo` only clears the summary. Full undo requires reading original messages from ArcadeDB `ConsultationRecord` and restoring them to Redis.
4. **HasCompaction edge linking** — link `ConsultationRecord → CompactionSummary` for graph traversal.
5. **Observability dashboard** — compact rate/day, reduction ratio, fallback chain hits, undo rate.

---

## 8. Model Budget Reference

### Input budgets (char_budget → what the agent sends to the LLM)

| Model | char_budget | ~tokens | Server context | History turns | Soft trigger (75%) | Hard trigger (90%) |
|---|---|---|---|---|---|---|
| AMINA LoRA | 20,000 | 5.3K | 8,192 (vLLM) | 6 | 15,000 chars | 18,000 chars |
| Groq | 10,000 | 2.6K | 128K | 4 | 7,500 chars | 9,000 chars |
| Mistral | 10,000 | 2.6K | 8K | 4 | 7,500 chars | 9,000 chars |
| Gemini | 22,000 | 5.8K | 1M | 6 | 16,500 chars | 19,800 chars |
| GPT-4o mini | 18,000 | 4.7K | 128K | 6 | 13,500 chars | 16,200 chars |

**Note**: The char_budgets are extremely conservative relative to server context windows (especially Groq at 2.6K of 128K). This is intentional — the LoRA budget constrains the lowest common denominator, and cross-model session continuity requires all models to work with similar context sizes.

### Output budgets (max_tokens → what the LLM returns)

| Condition | Tokens | LoRA override |
|---|---|---|
| Plan/list request | 1,000 | 1,500 |
| Long message (≥250 chars) | 600 | 600 (floor) |
| Standard (80-250 chars) | 400 | 600 (floor) |
| Short (<80 chars) | 250 | 600 (floor) |
| Tiny (<25 chars) | 100 | 600 (floor) |
| Translator | 2,000 (floor) | — |

---

## 9. Redis Key Inventory

| Key pattern | TTL | Purpose | Read by | Written by |
|---|---|---|---|---|
| `session:{sid}` | 24h | Session (messages TRIMMED after compact) | `memory_manager.get_session()` | `memory_manager.save_session()`, `_trim_session_messages()` |
| `chat:summary:{sid}` | 24h | Compaction summary text (cached) | `get_summary_for_session()` | `_persist_summary()` |
| `chat:summary_version:{sid}` | 24h | Version counter (monotonic) | `get_summary_version()` | `_persist_summary()` |
| `chat:summary_meta:{sid}` | 24h | Compaction metadata (range_count, deltas) | `get_summary_meta()` | `_persist_summary_meta()` |
| `conv:{sid}:active_tokens` | none | What the LLM sees next turn | `get_active_token_count()` | `_update_active_tokens()` |
| `chat:compact_inflight:{sid}` | 5min | Dedup lock | `maybe_schedule_compaction()` | `maybe_schedule_compaction()` |
| `lora:summary:{sid}` | 24h | Legacy key (read-only compat) | `get_summary_for_session()` | Never (pre-Phase B) |
| `patient:{pid}:active_session` | — | Maps patient to current session | `memory_manager` | `memory_manager` |
| `careplan:{sid}` | 7d | Cached care plan | `get_care_plan()` | `save_care_plan()` |

---

## 10. Call Graph: User Message → LLM Response

```
User sends message
  │
  ▼
Frontend: POST /api/v1/agent/chat
  │
  ▼
agent_routes.py: agent_chat()
  │
  ▼
amina_agent.py: process_message(session_id, message, ...)
  │
  ├─ memory_manager.get_session(session_id)     ← Redis read
  ├─ Load Memory object with messages[], patient_context
  │
  ├─ Determine model preference → _MODEL_BUDGETS[pref]
  │    → (char_budget, max_output_tokens, history_turns)
  │
  ├─ [LAYER 1] get_summary_for_session(session_id)  ← Redis read
  │    → Prepend to system prompt if exists
  │
  ├─ Build chat_messages:
  │    [system + summary] + [history[-N:]] + [user turn]
  │    After compaction, memory.messages is TRIMMED in Redis,
  │    so history[-N:] only contains post-compact turns.
  │
  ├─ [LAYER 3] _get_max_tokens(message)  ← patched by agent_tokens_fix
  │    → Dynamic output ceiling
  │
  ├─ [LAYER 2+4] client.chat.completions.create(messages, max_tokens)
  │    → Wrapped by overflow_guard (pre-trim + retry)
  │    → Wrapped by agent_tokens_fix (LoRA: output ceiling bump)
  │
  ├─ Process response, extract clinical content
  │
  ├─ [LAYER 1] maybe_schedule_compaction(session_id, messages, char_budget)
  │    → Background task if 75% threshold exceeded
  │    → compact_session() generates summary + TRIMS Redis session
  │    → Writes CompactionSummary to ArcadeDB
  │
  ├─ memory_manager.save_session(session_id, updated_session)  ← Redis write
  │
  └─ Return response to frontend
```

---

## 11. Existing Tests

No dedicated test files found for the compaction system. The four service files (`context_compactor.py`, `overflow_guard.py`, `agent_tokens_fix.py`, `overflow_guard_patch.py`) have no corresponding test modules.

**Testing gap**: No unit tests for:
- Threshold logic (75%/90% triggers)
- Summary generation + persistence
- hard_cap_trim correctness
- Pre-trim + retry behavior
- Token estimation accuracy
- Prompt assembly with/without summary

---

## 12. Success Criteria

1. **Click Compact → token counter drops and stays dropped on refresh** (freedOffset persisted in sessionStorage)
2. **Background compaction at 75% → next prompt is actually smaller** (Redis session trimmed, memory.messages shorter)
3. **Redis wiped → summaries survive in ArcadeDB**, metadata rehydrated via `_load_meta_from_arcadedb()`
4. **All four layers remain intact** — no regressions in overflow guard, token budgets, or monkey-patches
5. **Display history is never mutated** — frontend `msgs` array keeps every message for the user
6. **No "freed tokens" language** in new UI strings (deprecated alias retained in API for backward compat)
7. **Audit trail**: every compaction writes a `CompactionSummary` vertex with trigger type, token delta, range count, summarizer model
