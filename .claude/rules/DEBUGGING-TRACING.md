# Debugging with Tracing & Logs

Operational recipes for debugging the dataprep / RAG pipeline using distributed
traces (VictoriaTraces) and the backend ingestion log (ArangoDB). **Not
deployment-specific** — substitute your stack's values (service names, DB name,
file IDs).

See [OBSERVABILITY.md](OBSERVABILITY.md) for the stack architecture; this file is
the **operational "how to query it to debug"** companion.

## 1. Fetch a trace from VictoriaTraces (Jaeger API)

```bash
# 1. Discover the VictoriaTraces service name for your stack
docker service ls | grep -i victoriatrace      # e.g. genieai-<stack>_victoriatraces

# 2. Fetch a trace by ID (from any container on the overlay network)
docker exec <chatqna-or-backend-container> sh -c \
  "curl -s http://<stack>_victoriatraces:10428/select/jaeger/api/traces/<TRACE_ID>" \
  > /tmp/trace.json
```

**Field-name gotchas (cost me real time):**
- Spans use **`startTime`** (microseconds), **NOT** `timestamp`.
- `duration` is in **microseconds** → divide by `1e6` for seconds.
- Always filter `s for s in spans if "startTime" in s` (some spans lack it).
- Trace may be **empty/in-flight** right after an ingest — retry in a minute.

### Per-phase breakdown (find the bottleneck)

```python
import json
from collections import Counter
d = json.load(open("/tmp/trace.json"))
spans = [s for s in d["data"][0]["spans"] if "startTime" in s]
s0 = min(s["startTime"] for s in spans)
s1 = max(s["startTime"] + s["duration"] for s in spans)
print("wall: %.0fs" % ((s1-s0)/1e6))
print(Counter(s["operationName"] for s in spans).most_common(10))
# For a phase, compute its window:
phase = [s for s in spans if "label_batch" in s["operationName"]]
if phase:
    ls = min(x["startTime"] for x in phase); le = max(x["startTime"]+x["duration"] for x in phase)
    print("labeling: %.0fs" % ((le-ls)/1e6))
    # max concurrency (are we actually parallelizing?)
    ev = sorted([(x["startTime"],1) for x in phase] + [(x["startTime"]+x["duration"],-1) for x in phase])
    cur=mx=0
    for _,dd in ev: cur+=dd; mx=max(mx,cur)
    print("max concurrency:", mx)
```

## 2. Dataprep span taxonomy (instrumented in `genieai_dataprep_arangodb.py`)

| Span | Phase | Key attributes |
|------|-------|----------------|
| `dataprep.ingest` | ingest entry | `dataprep.file_type`, `dataprep.file_size_bytes`, `dataprep.file_id` |
| `dataprep.retract` | retract entry | `dataprep.file_id` |
| `dataprep.chunking` | docling + chunk | `dataprep.chunk_count` |
| `dataprep.llm.label_chunk` | single-chunk label call | `dataprep.chunk_index`, `dataprep.llm_attempt`, `dataprep.llm_batched=False`, `dataprep.llm_model`, `dataprep.labels_suggested`, `dataprep.llm.completion_tokens` |
| `dataprep.llm.label_batch` | batched label call | `dataprep.llm_batched=True`, `dataprep.llm_batch_size`, `dataprep.chunk_indices`, `dataprep.llm_model`, `dataprep.labels_suggested`, `dataprep.llm.completion_tokens`, `dataprep.llm.prompt_tokens` |

How to **add** a span (Python): `from tracing import with_span` then
`with with_span("dataprep.<name>", attributes={...}) as span: span.set_attribute(...)`.

## 3. ArangoDB `ingestion_log` queries (label quality, failure reasons)

The dataprep writes per-chunk progress to the backend `ingestion_log` collection
(via `_write_ingestion_log`). This is the **visible** channel — see gotcha §6.1.

```bash
# Get ArangoDB creds from the deployed .env, then query (run on a swarm node)
```
```python
import json, urllib.request, base64
env = {k:v for k,v in (l.strip().split("=",1) for l in open("/opt/<stack>/.env")
       if "=" in l and not l.startswith("#"))}
# values may be quoted — strip
env = {k:v.strip().strip('"').strip("'") for k,v in env.items()}
url = "http://localhost:%s/_db/<DB>/_api/cursor" % env.get("ARANGO_PORT","8529")
auth = base64.b64encode(("%s:%s" % (env.get("ARANGO_USER","root"),
       env.get("ARANGO_PASSWORD",""))).encode()).decode()
def q(aql):
    req = urllib.request.Request(url, data=json.dumps({"query":aql}).encode(),
        headers={"Authorization":"Basic "+auth, "Content-Type":"application/json"})
    return json.load(urllib.request.urlopen(req)).get("result",[])

FILE_ID = "<file_id>"
# Labeling quality: labels-per-chunk distribution
for m in q('FOR d IN ingestion_log FILTER d.file_id=="%s" AND d.message LIKE "%%Final labels%%" '
           'RETURN d.message' % FILE_ID):
    print(m)
# Failure reasons (batch fallbacks, JSONDecodeError, retries)
for m in q('FOR d IN ingestion_log FILTER d.file_id=="%s" AND d.message LIKE "%%failed%%" '
           'RETURN d.message' % FILE_ID):
    print(m)
```

**Gotcha:** the field is **`file_id`**, not `fileId`. The `%%` is escaped `%` in AQL string literals.

## 4. Where data lives

| What | Where |
|------|-------|
| Uploaded source file | document-repository container: `/app/uploads/<file_id>.<ext>` |
| File metadata | ArangoDB `files` collection (has `storage_path`, `file_name`, `dataprep.status`) |
| Chunks / graph source nodes | ArangoDB `<GRAPH>_SOURCE` collection (field `text`) |
| Graph relationships | `<GRAPH>_LINKS_TO`, `<GRAPH>_HAS_SOURCE` |
| Ingestion progress logs | ArangoDB `ingestion_log` collection |
| LLM/embedding traces | VictoriaTraces (see §1) |

## 5. Reliable remote-script pattern (avoids quoting hell)

Nested `ssh → docker exec → sh -c → curl` with embedded JSON/AQL **will** break on
quoting. Use the **base64 pattern**: write the script locally, encode, decode +
run remotely.

```bash
cat > /tmp/analyze.py <<'PYEOF'
# ... your python (uses /tmp/trace.json or queries ArangoDB) ...
PYEOF
B64=$(base64 -w0 /tmp/analyze.py)
ssh <user>@<host> "echo '$B64' | base64 -d > /tmp/analyze.py && python3 /tmp/analyze.py"
```

This is the single most reliable way to run analysis on a remote swarm node.

## 6. Gotchas

1. **Dataprep's Python logger does NOT reach docker stdout / VictoriaLogs** in the
   standard deployment (only uvicorn access logs do). For diagnostics that must be
   visible, route through `_write_ingestion_log(...)` (the backend ingestion_log,
   shown in the UI) — **not** `logger.warning/info`. (This hid exception reasons
   from me for several iterations.)
2. **Image `git_sha` label ≠ commit on the branch.** The deployed image's baked-in
   `git_sha` can lag or differ from the branch tip (build pipeline artifacts).
   Verify deployed code by `docker exec ... grep <marker> <file>` rather than
   trusting the image tag.
3. **VictoriaTraces `startTime` not `timestamp`**, `duration` in µs (see §1).
4. **Trace empty right after ingest** — spans flush at span end; wait/retry.
5. **Table-heavy documents** produce mostly padded table-row chunks (low label
   recall is correct, not a labeling bug). Confirm with a curated (table-free)
   A/B ingest before assuming a labeling regression.
6. **Labeling quality**: a chunk getting `[]` is usually correct (no matching
   taxonomy label). Verify the taxonomy loaded (some chunks DO get specific labels)
   and probe the live vLLM with a representative chunk before blaming the prompt.

## 7. Quick probe of the live vLLM (isolate model vs pipeline)

When a labeling/embedding result is unexpected, bypass the pipeline and call the
vLLM directly to isolate model behavior from code:

```python
# see §5 base64 pattern; call <vllm>/v1/chat/completions with the real system prompt
# + a real chunk; check finish_reason, completion_tokens, parse, and whether the
# output matches expectations at temperature=0 and response_format json_object.
```

This distinguished (multiple times) "model returns bad output" from "pipeline
mishandles good output".
