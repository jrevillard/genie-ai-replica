# AMINA — CI Eval Gate + Dependency Scan Plan (MODEL-007 / SEC-009)

**Audience:** engineering / pilot operator / security reviewer.
**Status:** 🟡 partial — plan documented (this file). The repo's
existing `.gitlab-ci.yml` only runs SAST + secret detection; the
test gate + eval gate + dependency vuln scan described below are
**not** yet active. Phase 9 deliberately did not modify
`.gitlab-ci.yml` — that change belongs to the engineering owner of
the build pipeline.

---

## 1. What exists today

`/.gitlab-ci.yml` (23 lines) ships:

- `Security/SAST.gitlab-ci.yml` — GitLab's managed SAST template
- `Security/Secret-Detection.gitlab-ci.yml` — secret detection on
  every push; `SECRET_DETECTION_ENABLED: 'true'`
- two stages: `test`, `secret-detection`

What is **not** yet in CI:

- the unit / integration test suites (`_*_test.py`) that this repo
  ships
- the compliance scorecard
- the live HTTP harnesses (`_phase7_live_gate_matrix.py` etc.) — these
  intentionally need the running stack and can stay in staging
- a dependency vulnerability scan (Python deps + npm deps)
- the eval-on-CI gate (`agent_platform_phase3_safety_test.py`,
  caregiver privacy suites)

## 2. The plan

### 2.1 Tests + scorecard gate (closes MODEL-007 partial)

Add a new `gate` stage that runs the canonical unit suites and the
compliance scorecard. Suggested job:

```yaml
gate:
  stage: gate
  image: python:3.12-slim
  script:
    - pip install -r haystack-stack/haystack-chatqna/requirements.txt
    - cd haystack-stack/haystack-chatqna
    - PYTHONIOENCODING=utf-8 python _caregiver_privacy_consent_test.py
    - PYTHONIOENCODING=utf-8 python _caregiver_privacy_warn_test.py
    - PYTHONIOENCODING=utf-8 python _audit_event_store_test.py
    - PYTHONIOENCODING=utf-8 python _retention_test.py
    - PYTHONIOENCODING=utf-8 python _agent_platform_v1_test.py
    - python _agent_platform_v2_native_tools_test.py
    - PYTHONIOENCODING=utf-8 python _agent_platform_phase3_safety_test.py
    - cd ../..
    - python scripts/compliance_scorecard.py
  rules:
    - if: $CI_COMMIT_BRANCH
```

The scorecard is informational (exit 0 on any score), but a low
overall score should block via a separate `compliance` rule:

```yaml
  - python -c "
import json, subprocess, sys
out = subprocess.check_output(['python','scripts/compliance_scorecard.py','--json'])
agg = json.loads(out)
if agg['overall_score_10'] < 6.5:
    print('FAIL: compliance overall score below 6.5'); sys.exit(1)
"
```

Use `6.5` initially (current overall is `6.82` post-Phase-9). Bump
the floor up as gaps close so the score can never regress quietly.

### 2.2 Live HTTP gate (deferred)

The Phase 7 harnesses (`_phase7_live_gate_matrix.py`,
`_phase7_rollback_proof.py`) require a running container with
ArcadeDB / Redis. Running these in the pipeline means standing up
the full compose stack inside CI — practical, but adds CI time and
infra cost. Recommendation: leave these in staging-only for now and
revisit once a CI-resident docker-in-docker runner is available.

### 2.3 Dependency scan (closes SEC-009 partial)

Two layers:

**Python deps:**

```yaml
deps_python:
  stage: gate
  image: python:3.12-slim
  script:
    - pip install pip-audit
    - pip-audit -r haystack-stack/haystack-chatqna/requirements.txt
  allow_failure: true   # advisory while baseline is established;
                        # promote to blocking once known issues are triaged.
```

**npm deps:**

```yaml
deps_node:
  stage: gate
  image: node:20-alpine
  script:
    - cd components/frontend
    - npm ci
    - npm audit --omit=dev --audit-level=high
  allow_failure: true   # same ramp-up posture as deps_python.
```

Both jobs go from `allow_failure: true` to blocking once the existing
warnings are triaged. Document the triage outcome in the
[INCIDENT_DRILL_LOG.md](INCIDENT_DRILL_LOG.md) after the first run
(treat the first run as a tabletop drill).

### 2.4 Caching

The Python suite alone is fast (< 60 s on a warm cache); the
non-trivial cost is `pip install`. Cache the wheel directory with:

```yaml
default:
  cache:
    key:
      files:
        - haystack-stack/haystack-chatqna/requirements.txt
    paths:
      - .cache/pip/
```

## 3. Ramp-up posture

Recommended phased rollout — each phase a separate small MR so any
regression bisects cleanly:

| MR | Adds | Promotes |
|---|---|---|
| 1 | `gate` job running the four privacy/audit/retention test suites | none |
| 2 | Add the three agent-platform suites | none |
| 3 | Add `compliance_scorecard.py` with informational floor | none |
| 4 | Add `pip-audit` (allow_failure) | scorecard floor → blocking at ≥ current+0 |
| 5 | Add `npm audit` (allow_failure) | none |
| 6 | After 30 days clean: promote `pip-audit` + `npm audit` to blocking | MODEL-007 → ✅ |

## 4. Why MODEL-007 stays partial after Phase 9

MODEL-007's requirement is "Eval-on-CI gate". Phase 9 documented the
recipe (this file) but did not modify `.gitlab-ci.yml`. The plan is
ready to land but isn't *running*. Honest status: 🟡 partial.

Same applies to SEC-009 (dependency vuln scan in CI) — the plan is
ready, the workflow change is not. Honest status: 🟡 partial.

Both move to ✅ when MR 4 / MR 6 above land in `main`.

## 5. Compliance v1.2 update — MR-1 landed

`.gitlab-ci.yml` now defines a `gate` stage that runs MR-1 of §3:

```yaml
stages:
  - test
  - gate                # NEW
  - secret-detection

gate:
  stage: gate
  image: python:3.12-slim
  before_script:
    - pip install --no-cache-dir 'pyjwt>=2.0,<3'
  script:
    - cd haystack-stack/haystack-chatqna
    - PYTHONIOENCODING=utf-8 python _caregiver_privacy_consent_test.py
    - PYTHONIOENCODING=utf-8 python _caregiver_privacy_warn_test.py
    - PYTHONIOENCODING=utf-8 python _audit_event_store_test.py
    - PYTHONIOENCODING=utf-8 python _retention_test.py
    - cd ../..
    - python scripts/compliance_scorecard.py
    # Floor check fails the pipeline if overall_score_10 regresses
    # below 7.50. Current is 7.91; v1.2 target ramp is 8.0+.
    - python -c "<floor-check>"
  rules:
    - if: $CI_COMMIT_BRANCH
```

Honest status as of v1.2:
- **MR-1 landed** — config in `main`'s `.gitlab-ci.yml`. Closure of
  MODEL-007 still requires *one green CI run on a feature branch*
  + *one red run on a synthetic score regression* — neither is
  visible to the engineering team yet because nothing has been
  pushed since the config landed.
- **MR-2** (agent-platform suites) — not yet merged. Adds
  `_agent_platform_v1_test.py` + `_agent_platform_v2_native_tools_test.py`
  + `_agent_platform_phase3_safety_test.py` to the gate.
- **MR-3** (scorecard floor ratchet) — not yet merged. Bumps the
  `7.50` floor closer to the current `7.91` so future regressions
  fail the pipeline more aggressively.
- **MR-4** (`pip-audit` `allow_failure`) — not yet merged.
- **MR-5** (`npm audit` `allow_failure`) — not yet merged.
- **MR-6** (30-day clean → promote dep scans to blocking) — not
  yet merged.

MODEL-007 + SEC-009 stay 🟡 partial until MR-4 / MR-6 close them.
The v1.2 ramp anchor is real; the rest is operator-merge work.
