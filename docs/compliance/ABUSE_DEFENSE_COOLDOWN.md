# AMINA Abuse Defense — Cool-down Wiring

**Scope:** Phase D + D.5 (enforce mode), revised 2026-05-05 to a 3-rung-per-cycle ladder + frontend session lock. How a user transitions from "warning ladder" → "session-terminate (1st cycle, soft)" → "cool-down lockout (subsequent cycles, timed)" → "back to clean," and what code runs at each step.

**Audience:** anyone touching `src/abuse_defense/` or the chat handlers in `src/api/agent_routes.py` and `src/api/streaming_routes.py`.

**Default config:** `AMINA_ABUSE_DEFENSE_MODE=off`. Everything below is dormant unless a deployer flips that flag to `enforce`. Read the report at the bottom of `src/abuse_defense/__init__.py` for the phase ladder; this doc only covers cool-down.

**Revision history:**
- 2026-05-04 — `state.py` refactored to Redis-backed (was process-local; broke under uvicorn workers=4).
- 2026-05-05 (am) — WARN3 + session_terminate collapsed into a single rung (3 abuses per cycle, not 4). UNICC tester expected WARN3 to be the lock point per its copy. Cool-down ladder unchanged.
- 2026-05-05 (pm) — Frontend `session_action` field + `abuseLock` UI state. Auto-clear behaviour replaced with input-disable + "New Conversation" banner; chat history is preserved.

---

## 1. State shape

One JSON record per user (or session — see §3), stored as a single Redis key with TTL, mirrored to a process-local dict for fail-open.

```text
abuse:cooldown:<key>     SET ex=<ttl>  json={
  "cooldown_until_ts":     <epoch float>,   # > now() ⇒ user is locked out
  "next_cooldown_index":   <int>,           # 0,1,2,3+ — which ladder rung to use NEXT
  "lifetime_terminations": <int>,           # cool-down count (used for admin-flag threshold)
  "last_terminated_ts":    <epoch float>,
  "was_admin_flagged":     <bool>,          # one-shot, never re-fires
  "had_session_terminate": <bool>,          # Phase D.5: true once the user has had the
                                            # SOFT escalation (session-terminate). Sticky;
                                            # the next abuse-past-WARNING-3 jumps to cool-down.
  "session_terminate_ts":  <epoch float>,   # when the soft escalation fired (audit only)
}
```

The Redis client is opened lazily; on any failure (missing host, timeout, auth error) the module sets a sticky `_redis_failed=True` and falls back to `_INMEM` for the rest of the process lifetime. See [cooldown.py:62](../../haystack-stack/haystack-chatqna/src/abuse_defense/cooldown.py#L62).

The TTL is set on every write to `max(duration + 30 days, 30 days)`. A repeat offender returning after their cool-down expires is still remembered for the lifetime-termination tally (otherwise their next termination would always be 30 min, never 24 h or 7 d).

---

## 2. The ladder

Read fresh from `config.ABUSE_COOLDOWN_*` on every call so test code can edit config without bouncing the module — see [cooldown.py:102](../../haystack-stack/haystack-chatqna/src/abuse_defense/cooldown.py#L102):

| `next_cooldown_index` at the time of termination | Duration used | Source |
|----|----|----|
| `0` | **30 min** | `ABUSE_COOLDOWN_FIRST`  (1800 s) |
| `1` | **24 h**  | `ABUSE_COOLDOWN_SECOND` (86400 s) |
| `2` | **7 d**   | `ABUSE_COOLDOWN_THIRD`  (604800 s) |
| `3+`| **7 d** (clamped) | last entry of the ladder |

Indices that exceed the ladder length clamp to the final entry, so a fourth or fifth termination is still 7 days, not "longer." If config is mis-set with all zeros, the module falls back to a single 30-min ladder so we always do *some* cool-down.

The state field is named `next_cooldown_index` deliberately: the value persisted is the index to use **next** time. `activate()` reads it, uses it, then writes `next_cooldown_index + 1` back so subsequent terminations escalate. See [cooldown.py:196-247](../../haystack-stack/haystack-chatqna/src/abuse_defense/cooldown.py#L196-L247).

---

## 3. The state key

Picked once at the top of `defender.evaluate()`:

```python
# defender.py:156
user_key = user_id or session_id
```

- **Authenticated patient** → `user_id` is set (e.g. `P_a1b2c3`). Cool-down sticks across sessions, browsers, devices.
- **Guest** → `user_id` is None, falls back to `session_id`. Cool-down lasts only as long as the session ID. A guest who burns their session can theoretically come back fresh — that's an accepted trade-off (we don't fingerprint guests).
- **The two namespaces never collide** because session IDs are UUIDs and patient IDs are `P_*`.

---

## 4. Lifecycle: how a user moves through the states

### 4a. Pre-termination (Phases A/B/C, or warn mode)

Cool-down does not exist yet. `cooldown.remaining_s(key)` returns 0 because the JSON record either doesn't exist or has a `cooldown_until_ts` of 0. The user is on the warning ladder owned by `state.py`:

```text
clean → WARNING_1 → WARNING_2 → WARNING_3 (warn mode caps here forever — no termination)
```

In `enforce` mode the cap behaves the same way for warn-mode-equivalent flows. But the moment the ladder *steps to* level 3 (i.e. the user's 3rd abuse in this cycle), the defender enters the termination branch:

- **First lifetime crossing** → soft session-terminate (no time penalty, see §4b1)
- **Subsequent crossings** → cool-down ladder kicks in (see §4b2)

This is the **3-rung-per-cycle** model (revised 2026-05-05). Before that revision, termination only fired on the *4th* abuse (because the check was on `pre_level >= 3`, which required already being at 3 BEFORE another step). The collapse moved the check to `new_level >= 3` (the post-step level) so WARN3 *is* the terminal point.

### 4b1. Session-terminate (Phase D.5 — soft escalation, one-shot per user)

The FIRST time a user steps the ladder TO level 3 in their lifetime (per the cool-down record's `had_session_terminate` flag), the defender fires a softer escalation:

```python
# defender.py inside the abuse branch — runs AFTER state.step has bumped to level 3
if mode == "enforce" and new_level >= 3 and not is_minor:
    if not cooldown.had_session_terminate(user_key):
        cooldown.mark_session_terminate(user_key)   # sticky flag; idempotent
        state.reset(session_id)
        return Decision(
            action="session_terminate",
            response_text=responses.SESSION_TERMINATION_RESPONSE,
            is_session_terminate=True,
            ...
        )
```

What the user sees (text): "I'm ending this conversation now. We've had several unkind exchanges, and I cannot continue this session. You're welcome to start a fresh conversation when you're ready. … If you have an URGENT medical emergency, dial 199."

What the user sees (UI, Phase D.5 frontend wire 2026-05-05):
- Chat input field becomes **disabled**, placeholder switches to "This conversation has ended"
- Send / Symptom / Rx / mic buttons all disabled
- Red banner appears between chat and input row with copy + a **"New Conversation"** button
- Chat history above the input **stays visible**
- Clicking "New Conversation" drops the old session server-side, mints a fresh `session_id`, clears the lock — user can chat again immediately

What the backend does:
- The current session's warning ladder is reset to 0 (`state.reset`) so a new session starts clean.
- `had_session_terminate=True` is persisted on the cool-down record.
- Returns `session_action="session_terminate"` in the `AgentChatResponse` (and the SSE done event) so the frontend knows to lock.
- **No** cool-down is set. The user can immediately start a new conversation and chat normally — they get one more "real" chance after their three warnings (well — two warnings + terminal third).
- `lifetime_terminations` is **not** incremented (session-terminate is a soft step, not a punitive cool-down). Admin flag still fires only after 3 *cool-downs*, not after 3 session-terminates.
- Minors NEVER reach this branch (the `not is_minor` guard at the top of the abuse block).

If the same user later returns and steps the ladder to level 3 again — *in any future session* — the sticky `had_session_terminate=True` flag short-circuits the soft step and `cooldown.activate()` runs (see §4b2).

### 4b2. Termination (the moment a cool-down starts)

Triggered at [defender.py:241](../../haystack-stack/haystack-chatqna/src/abuse_defense/defender.py#L241):

```python
if mode == "enforce" and pre_level >= 3 and not is_minor:
    term = cooldown.activate(user_key)        # 1
    state.reset(session_id)                    # 2
    if term.get("just_admin_flagged"):         # 3
        admin_flag.flag(user_key, ...)
    return Decision(action="terminate", ...)   # 4
```

Concretely:

1. **`cooldown.activate(user_key)`** ([cooldown.py:196](../../haystack-stack/haystack-chatqna/src/abuse_defense/cooldown.py#L196))
   - Reads existing record (`{}` on first termination)
   - `used_idx = min(next_cooldown_index, ladder_len-1)`
   - `duration = ladder[used_idx]`
   - `until = now + duration`
   - `lifetime_terminations += 1`
   - If `lifetime ≥ ABUSE_ADMIN_FLAG_THRESHOLD` and not previously flagged → sets `was_admin_flagged=True` and returns `just_admin_flagged=True` so the caller writes the admin row exactly once
   - Writes new state (Redis + in-mem mirror) with `next_cooldown_index = old + 1`
2. **`state.reset(session_id)`** wipes the warning ladder so when the user returns after the cool-down expires they start at level 0 (a fresh clean slate, but their `lifetime_terminations` and `next_cooldown_index` persist on the cool-down record).
3. **Admin flag** (one-shot) — appends a single JSON line to `var/abuse_defense/admin_flag_<date>.jsonl` at [admin_flag.py:63](../../haystack-stack/haystack-chatqna/src/abuse_defense/admin_flag.py#L63). `was_admin_flagged` ensures repeat terminations never re-fire this.
4. **Decision** — the route handler (§6) renders this as `TERMINATION_FIRST/SECOND/THIRD` ([responses.py:97](../../haystack-stack/haystack-chatqna/src/abuse_defense/responses.py#L97)) and short-circuits the LLM call.

### 4c. Locked-out (the cool-down window)

The next request from this user lands at [defender.py:193](../../haystack-stack/haystack-chatqna/src/abuse_defense/defender.py#L193):

```python
if mode == "enforce":
    remaining = cooldown.remaining_s(user_key)
    if remaining > 0:
        return Decision(action="cooldown", ...)
```

`remaining_s()` is just `max(0, cooldown_until_ts - now())` — there is no scheduled job, no background worker, no cron. The cool-down "expires" the instant `now()` ticks past `cooldown_until_ts`. The next request after that lands in the regular ladder again.

The response text comes from [responses.py:111](../../haystack-stack/haystack-chatqna/src/abuse_defense/responses.py#L111) and renders the remaining time at human granularity (minutes / hours / days) — never a precise countdown, to discourage retry-spam at the exact tick.

**UI behaviour during the lockout** (Phase D.5 frontend wire 2026-05-05):
- The first response of cool-down activation carries `session_action="terminate"` + `cooldown_remaining_s` in the payload. The frontend sets `abuseLock.active=true` with `kind="terminate"` and the friendly duration ("about 30 minutes" / "24 hours" / "7 days").
- Subsequent messages during the lockout window return `session_action="cooldown"` + `cooldown_remaining_s` (decreasing). Lock stays active.
- Banner copy: *"This conversation has ended. AMINA will be available again in about 30 minutes. For urgent emergencies, dial 199."*
- The banner does **NOT** show a "New Conversation" button (unlike the soft session_terminate). The lockout is keyed on `user_id`, not `session_id` — starting a new session would just hit the same cool-down, so showing the button would be misleading. The user has to wait the timer out, or an admin has to release them manually via `POST /api/v1/admin/abuse/user/{key}/release`.
- Even if the user manually starts a new session via the existing Clear / sidebar New-Chat buttons, their first message will return `session_action="cooldown"` and re-trigger the lock. This is intentional — the time penalty actually penalises.

### 4d. Post-cool-down (return to clean)

When the user returns after `cooldown_until_ts` has passed:

- `remaining_s()` returns 0.
- The cool-down branch is skipped.
- Their warning ladder was reset back at termination time (§4b), so they start at level 0 — a fresh slate for warnings.
- The persisted `next_cooldown_index` and `lifetime_terminations` are still intact, so their **next** termination uses the next ladder rung (24 h, then 7 d).

There is no explicit "release" step. State persists; only the timestamp comparison flips.

---

## 5. Order-of-operations inside `defender.evaluate()`

The hot path runs in this exact order. Order matters for safety — the override paths that protect users in distress or emergency must run **before** the cool-down gate so we never withhold crisis info from a locked-out user.

```text
defender.py  ┌──────────────────────────────────────────────────────────┐
             │ 0. mode==off / shadow → log only, return None             │  — Phase B
             │ 1. shadow.log_message  (always, regardless of mode)       │  — audit trail
             │ 2. emergency keyword regex  → action="continue" (PASS)    │  — Phase C
             │ 3. distress classification  → action="crisis"             │  — Phase A+C
             │ 4. cool-down lookup         → action="cooldown"           │  — Phase D
             │ 5. frustration              → action="continue"           │  — Phase C
             │ 6. abuse:                                                 │
             │    pre_level >= 3 and enforce and not minor               │
             │       6a. NOT had_session_terminate                       │
             │           → mark_session_terminate                        │  — Phase D.5
             │           → action="session_terminate" (soft, one-shot)   │
             │       6b. ELSE                                            │
             │           → cooldown.activate + admin_flag                │  — Phase D
             │           → action="terminate" (cool-down lockout)        │
             │    else                                                   │
             │       → state.step → action="warn"                        │  — Phase C
             │ 7. clean                    → action="continue"           │
             └──────────────────────────────────────────────────────────┘
```

Three things will **always** bypass cool-down:

| Path | Why | Code |
|------|-----|------|
| Emergency keywords (199, ambulance, heart attack, can't breathe, stroke, bleeding, unconscious, seizure, choking, overdosed, dying, "help me right now") | Never block a real emergency | [defender.py:162](../../haystack-stack/haystack-chatqna/src/abuse_defense/defender.py#L162) |
| Distress (suicidal ideation, etc.) | Never hide crisis info behind a punishment — return crisis-support copy + 199 + EFSTH + Tanka Tanka | [defender.py:180](../../haystack-stack/haystack-chatqna/src/abuse_defense/defender.py#L180) |
| `is_minor=True` from the route handler | Minors NEVER terminate — ladder caps at WARNING_3 forever; neither session-terminate nor `cooldown.activate` is called for them | [defender.py:241](../../haystack-stack/haystack-chatqna/src/abuse_defense/defender.py#L241) condition `not is_minor` |

---

## 6. The route wires (where the user-visible response comes from)

Two integration points, both of which get a `Decision` from `defender.evaluate()`:

### `agent_routes.py /chat` — [agent_routes.py:322](../../haystack-stack/haystack-chatqna/src/api/agent_routes.py#L322)

```python
if _abuse_decision is not None and _abuse_decision.action in (
    "warn", "crisis", "session_terminate", "terminate", "cooldown",
):
    _strong_actions = {"session_terminate": "session_terminate",
                       "terminate":         "terminate",
                       "cooldown":          "cooldown"}
    return AgentChatResponse(
        response=_abuse_decision.response_text or "",
        session_id=request.session_id,
        is_emergency=False,
        user_role=request.user_role,
        session_action=_strong_actions.get(_abuse_decision.action),
        cooldown_remaining_s=(
            _abuse_decision.cooldown_remaining_s
            if _abuse_decision.action in ("terminate", "cooldown")
            else None
        ),
    )
```

Short-circuits **before** `agent.process_message()`. The agent / LLM is never called for any of those five actions. From the frontend's perspective the response is shaped exactly like a normal AMINA reply, but two extra fields tell the UI when to lock:

- `session_action` — populated for the strong-action rungs (`session_terminate`, `terminate`, `cooldown`); null for `warn` and `crisis` (those just show their text and let the user keep chatting)
- `cooldown_remaining_s` — populated for `terminate` (at activation) and `cooldown` (during the lockout window); null otherwise. Used by the frontend to render the friendly "available again in about N minutes/hours/days" banner.

The frontend's `_finalize()` callback in [App.jsx](../../components/frontend/src/App.jsx) reads these and sets `abuseLock` React state, which gates the input field, all action buttons, and renders the lock banner. See §4b1 / §4c above for the per-rung UI behaviour.

### `streaming_routes.py /chat-stream` — [streaming_routes.py:187](../../haystack-stack/haystack-chatqna/src/api/streaming_routes.py#L187)

Same `action in (...)` check, but emits one `event: token` followed by one `event: done` so the frontend renders the warning/cooldown/termination/crisis text identically to any other streamed reply.

### What's NOT wired (Phase D scope intentionally)

- `routes.py /chat`, `/text-chat`, `/voice-chat`, `/voice-chat-audio` and `agent_routes.py` voice endpoints stay on **Phase B shadow logging only**. They log every classification but never override the response. Reasons:
  - RAG legacy `/chat` and `/text-chat` have no `session_id` field — the ladder can't track per-user.
  - Voice paths would need TTS of the warning copy, which is Phase D.2 work.

---

## 7. Fail-open guarantees

Every public function in `cooldown.py`, `admin_flag.py`, and `defender.py` is wrapped in `try/except`. On internal failure they degrade to safe defaults — the contract is **a broken abuse-defense system must NEVER silence a user**.

Specific failure modes and what happens:

| Failure | Behaviour |
|---------|-----------|
| Redis unreachable on startup | `_get_redis()` returns None, sets sticky `_redis_failed=True`, all subsequent reads/writes use the in-memory dict. No exception escapes to the route handler. ([cooldown.py:62](../../haystack-stack/haystack-chatqna/src/abuse_defense/cooldown.py#L62)) |
| Redis flaps mid-request | Per-call try/except in `_read` / `_write` falls through to in-mem. The mirror copy in `_INMEM` is updated on every successful Redis write so reads stay fast and survive the flap. |
| Disk full when writing admin-flag JSONL | Logged at WARNING, swallowed. Termination still happens; admin just has no notification for that one event. ([admin_flag.py:63](../../haystack-stack/haystack-chatqna/src/abuse_defense/admin_flag.py#L63)) |
| Bug inside `defender.evaluate()` | Outer try/except in `defender.py` returns `None` (passthrough). The user sees normal AMINA, not a 500. |
| `config.ABUSE_DEFENSE_MODE` is unrecognised | Treated as `"off"` (no override). |

Verified by enforce-eval check **E12** ("Redis-down: enforce still works in-memory") in [enforce_eval.py](../../haystack-stack/haystack-chatqna/src/abuse_defense/eval/enforce_eval.py).

---

## 8. Concrete walk-through

User `P_aminata`, session `s_42`. `AMINA_ABUSE_DEFENSE_MODE=enforce`. `ABUSE_ADMIN_FLAG_THRESHOLD=3` (default).

3-rung-per-cycle ladder (revised 2026-05-05). Each cycle = 3 abuses to terminate.

| # | Message | What runs | Visible response (text + UI) |
|---|---------|-----------|------------------------------|
| 1 | "Help with my BP medicine"            | Clean. `state.touch()` ticks decay clock. | Normal AMINA reply |
| 2 | "You stupid AI"                       | `state.step` → level 1                                     | WARNING_1 |
| 3 | "Shut up bot"                         | `state.step` → level 2                                     | WARNING_2 |
| 4 | "You worthless garbage"               | `state.step` → level 3. `mode=enforce` + `not is_minor` + `had_session_terminate=False` → `mark_session_terminate(P_aminata)`. `state.reset(s_42)`. NO cool-down activated. Returns `session_action="session_terminate"`. | SESSION_TERMINATION_RESPONSE + UI lock (input disabled, banner with "**New Conversation**" button, history preserved) |
| 5 | (User clicks "New Conversation" → new `s_43`, lock cleared) | Fresh ladder. Clean question → `state.touch()` | Normal AMINA reply |
| 6 | "Stupid AI"                           | `state.step` → level 1                                     | WARNING_1 |
| 7 | "Useless bot"                         | `state.step` → level 2                                     | WARNING_2 |
| 8 | "Worthless garbage"                   | `state.step` → level 3. `had_session_terminate=True` → `cooldown.activate(P_aminata)` returns `{cooldown_index_used:0, duration_s:1800, lifetime_terminations:1, just_admin_flagged:False}`. `state.reset(s_43)`. Returns `session_action="terminate"` + `cooldown_remaining_s=1800`. | TERMINATION_FIRST (30 min) + UI lock (input disabled, banner with "Available again in about 30 minutes" — **NO** New-Conversation button, since starting a new session would just re-trigger the lock) |
| 9 | "Sorry, what's the dose again?" (1 min later) | `cooldown.remaining_s` returns ~1740 → `session_action="cooldown"` + `cooldown_remaining_s=1740` | "I'm taking a break right now. I will be available again in about 29 minutes…" + UI lock stays |
| 10| "199 my mother is having a heart attack" | Emergency regex matches BEFORE the cool-down gate → `action="continue"` + `is_emergency_passthrough=True` → agent is called normally | Normal AMINA reply (lock would have to be lifted client-side to send this — UI doesn't allow it during cool-down; this is the curl-direct behaviour) |
| 11| "I just want to die"                  | Distress matches BEFORE the cool-down gate → `action="crisis"` | CRISIS_RESPONSE (199 + EFSTH + Tanka Tanka + caregiver offer) — distress always wins, even mid-cooldown |
| 12| "Hello?" (35 min later, cool-down expired)   | `remaining_s` returns 0; clean → `state.touch()` | Normal AMINA reply, lock cleared on next response |
| … later cycle, walks again to level 3, 3rd abuse  | `had_session_terminate=True` already → `cooldown.activate` reads `next_cooldown_index=1` → 24 h, lifetime_terminations=2 | TERMINATION_SECOND + UI lock with "available again in about 24 hours" |
| … and again … | `cooldown.activate` reads `next_cooldown_index=2` → 7 d, lifetime_terminations=3, **`just_admin_flagged=True`**. `admin_flag.flag(...)` appends one row to `var/abuse_defense/admin_flag_<date>.jsonl`. | TERMINATION_THIRD + admin sees the user in tomorrow's review |
| … and again (4th cool-down) | `next_cooldown_index=3` clamps to ladder[2] → 7 d. `was_admin_flagged=True` already, so no re-flag. | TERMINATION_THIRD again |

---

## 9. Where to look for problems

| Symptom | First place to look |
|---------|---------------------|
| User wrongly locked out | `cooldown.snapshot(<user_id>)` — read the JSON record. Check `cooldown_until_ts` vs `time.time()`. |
| Termination wasn't logged for admin | `var/abuse_defense/admin_flag_<date>.jsonl`. If the lifetime threshold was just crossed but no row exists, check the WARNING-level logs from `amina.abuse_defense.admin_flag`. |
| Wrong cool-down duration applied | `cooldown.snapshot(<user_id>)` — check `next_cooldown_index`. Then re-read `_ladder()` to confirm `config.ABUSE_COOLDOWN_*` env vars resolve to expected seconds. |
| User says they got terminated for asking a health question | Check the shadow JSONL (`var/abuse_defense/shadow_<date>.jsonl`) for that session/user. The classifier rationale is in `matched`. If `category==health_frustration` was logged but `action==terminate` was returned, that's a real bug — file it. |
| Redis says it's up but in-memory is being used | Check if `cooldown._redis_failed` is True (sticky after first failure). Process restart will retry. |
| Minor was terminated | The route handler is passing `is_minor=False`. The defender is correct; the wire is missing the patient-age lookup (Phase D.1 follow-up). |

---

## 10. Knobs

All read at call-time from `src/abuse_defense/config.py`:

```bash
# Master flags
AMINA_ABUSE_DEFENSE_ENABLED=true       # off → classifier short-circuits to clean
AMINA_ABUSE_DEFENSE_MODE=enforce       # off | shadow | warn | enforce

# Cool-down ladder (seconds)
AMINA_ABUSE_COOLDOWN_FIRST=1800        # 30 min
AMINA_ABUSE_COOLDOWN_SECOND=86400      # 24 h
AMINA_ABUSE_COOLDOWN_THIRD=604800      # 7 d

# Warning ladder decay (seconds of clean traffic = drop one level)
AMINA_ABUSE_COOLDOWN_DECAY=900         # 15 min

# Coercive abuse fast-tracks (skips one warning level)
AMINA_ABUSE_COERCIVE_FAST_TRACK=true

# Admin flag threshold (lifetime terminations)
AMINA_ABUSE_ADMIN_FLAG_THRESHOLD=3

# Test / dev knobs
AMINA_ABUSE_DEFENSE_DISABLE_REDIS=1    # force in-memory cool-down
AMINA_ABUSE_SHADOW_DIR=/path           # JSONL output directory (shadow + admin-flag)
AMINA_ABUSE_ADMIN_FLAG_DIR=/path       # admin-flag JSONL only (overrides above)
```

---

## 11. Admin reports + endpoints (Phase E)

All admin endpoints are gated by the existing admin JWT (Bearer token, `role=admin`) and never affect the chat hot-path. They live at `/api/v1/admin/abuse/*`:

| Method | Path | Purpose |
|--------|------|---------|
| GET    | `/admin/abuse/status`              | Module config snapshot — mode, ladder seconds, admin-flag threshold |
| GET    | `/admin/abuse/flagged?days_back=30` | List admin-flagged users (newest first) |
| GET    | `/admin/abuse/recent?limit=100&abuse_only=&category=&user_id=&session_id=` | Recent classifications with filters |
| GET    | `/admin/abuse/user/{key}`          | Combined snapshot: cool-down record + warning ladder + recent admin actions + recent admin-flag rows |
| POST   | `/admin/abuse/user/{key}/release`  | Manually clear cool-down. Body: `{"reason": "...", "also_clear_session_terminate": false}`. Reason is required (audit-mandatory). |
| GET    | `/admin/abuse/stats?days_back=7`   | Aggregate counts by category / severity / route / abuse / distress / frustration |

### Audit log

Every mutation an admin performs lands in `var/abuse_defense/admin_audit_<date>.jsonl`:

```text
{
  "ts":       "2026-05-04T19:23:11.482Z",
  "admin_id": "<JWT sub claim>",
  "action":   "release_user",
  "key":      "<user_id or session_id>",
  "reason":   "<free text from request body>",
  "extra":    { "also_clear_session_terminate": false, "snapshot_before": {...} }
}
```

Audit is written **before** the mutation, so even a Redis flap on the clear leaves a trail of who tried to release whom.

### Release semantics

`POST /admin/abuse/user/{key}/release` defaults to a **soft release**:
- Clears `cooldown_until_ts` (user can chat again immediately)
- Resets the warning ladder for the key (if it doubles as a session_id)
- **Preserves** `had_session_terminate`, `lifetime_terminations`, `next_cooldown_index`, `was_admin_flagged`

The intent: a manually released user still gets a cool-down (not session-terminate) on their next abuse-past-WARNING-3, and their next cool-down still uses the next ladder rung. The admin override is a clemency, not a clean slate.

For a full clean slate, pass `"also_clear_session_terminate": true` in the body. Rare — only when the admin has reviewed and decided the user should start fresh from the very first warning.

### What admin endpoints DO NOT do

- They never call `cooldown.activate()` directly. Admins cannot inflict cool-downs from this endpoint surface — only release them. (Inflicting is the defender's job.)
- They never delete shadow / admin_flag / admin_audit JSONL rows. Those logs are append-only and rotate by date; archival is a separate concern.
- They never bypass the JWT gate. Every endpoint calls `_verify_admin(request)`; non-admin tokens get 403, no token gets 401.

## 12. Mandinka response copy (Phase F)

The defender takes a `language` kwarg (default `"en"`). Route handlers thread `request.language` into it; `"ma"` selects Mandinka response copy, anything else falls back to English.

### How translations land

`src/abuse_defense/responses_mn.py` holds an in-memory cache of `English source → Mandinka translation`. On FastAPI startup, `main.py` calls:

```python
@app.on_event("startup")
async def startup_event():
    ...
    from src.abuse_defense import responses_mn
    stats = await responses_mn.bootstrap_async()
```

`bootstrap_async()` calls the existing `translator_v4` Mandinka pipeline (`src.services.translator.get_translator()`) once for each static string, populates the cache, and is idempotent. Failure here is **non-fatal** — the app starts, but Mandinka users get English copy.

### What gets translated

| String | Translated in Phase F? |
|--------|------------------------|
| `WARNING_1` / `WARNING_2` / `WARNING_3`         | Yes |
| `CRISIS_RESPONSE`                                | Yes |
| `SESSION_TERMINATION_RESPONSE`                   | Yes |
| `TERMINATION_FIRST` / `TERMINATION_SECOND` / `TERMINATION_THIRD` | Yes |
| `cooldown_text(remaining_s)`                     | **No — Phase F.1 (deferred)** |

`cooldown_text` embeds a dynamic time string (`"about 5 minutes"` / `"about 24 hours"` / `"about 7 days"`) which needs a parameterised Mandinka template; that lands in F.1. The 199 emergency line is universal in The Gambia, so the safety information still reaches Mandinka users in the cool-down notice — only the framing is English.

### Fail-open semantics

| Situation | What happens |
|-----------|--------------|
| Translator service unreachable at startup | Bootstrap catches the failure, marks itself "done", cache stays empty. Every Mandinka lookup returns English. |
| Translator returns empty string for one entry | That entry stays English; rest of cache is populated normally. |
| `mandinka_text(en)` called before bootstrap | Returns English. NEVER blocks. |
| `responses.warning_text(level, lang="ma")` | Returns Mandinka if cached; English if not. NEVER raises. |
| `defender.evaluate(language="ma")` with empty cache | Decision contains English text. Defender NEVER raises on translation issues. |

### Native-speaker review (Phase F.1, separate gate)

The cache is populated by **machine translation**. Before we enable Mandinka mode in production, native-speaker review must validate:
- Crisis-support copy points to the right hotlines and uses the right register
- Warning copy is firm but not insulting in cultural context
- Termination copy gives the user a clear path forward (199 + caregiver)

Until Phase F.1 ships:
- The cache is populated automatically at startup (machine-translated)
- Strings are usable but flagged in the diagnostic snapshot via `responses_mn.status_snapshot()`
- Native reviewers can override individual entries via `set_translation_for_test()` (will be promoted to a proper config-file override path in F.1)

## 13. Test coverage

The cool-down path is covered by 14 cases in `eval/enforce_eval.py` (Phase D + D.5). Run from `haystack-chatqna/`:

```bash
python -m src.abuse_defense.eval.enforce_eval
```

Critical safety cases (every one of these must stay PASS forever):

- **E2** — third abuse on a fresh user is `session_terminate`, NOT cool-down (revised 2026-05-05 — was "fourth abuse" pre-collapse)
- **E3** — second cycle escalates to cool-down (one-shot is sticky via `had_session_terminate`)
- **E5** — emergency keyword during cool-down → continue (NEVER blocked by abuse handling)
- **E6** — distress during cool-down → crisis text (NEVER hidden behind a punishment)
- **E9** — minor at level 3 + abuse → warn, never `session_terminate`, never cool-down
- **E13** — Redis-down → in-memory fallback still walks the full ladder
- **E14** — `had_session_terminate` flag persists through cool-downs (no replay of the soft escalation)

All eight eval suites must stay green (regression-checked on every Phase D / D.5 / G change). Run individually or via the master runner:

```bash
python -m src.abuse_defense.eval.abuse_defense_eval   # 32/32  (Phase A — classifier; +10 regression cases from live UNICC testing)
python -m src.abuse_defense.eval.shadow_smoke         #  6/6   (Phase B — JSONL logger)
python -m src.abuse_defense.eval.warn_eval            # 13/13  (Phase C — warn ladder; +W13 cross-worker regression)
python -m src.abuse_defense.eval.enforce_eval         # 14/14  (Phase D — enforce + cool-down; E1/E2/E3 rewritten for 3-rung)
python -m src.abuse_defense.eval.admin_eval           # 12/12  (Phase E — admin reports)
python -m src.abuse_defense.eval.mandinka_eval        # 10/10  (Phase F — Mandinka)
python -m src.abuse_defense.eval.phase_g_eval         #  6/6   (Phase G — semantic NLP fallback)
python -m src.abuse_defense.eval.scenarios_eval       # 12/12  (Integration — user journeys; S3/S4/S8 rewritten for 3-rung)
python -m src.abuse_defense.eval.run_all              # 105/105 (combined, single-command)
```

Total: **105 cases across 8 suites.** Cumulative growth from initial 76 (per-phase only) → 88 (added scenarios) → 95 (hard-profanity regressions) → 101 (Phase G semantic) → 105 (advice/conversation AI ref + typo regression cases). Every UNICC-surfaced bug has a permanent regression case so the same input cannot silently regress.
