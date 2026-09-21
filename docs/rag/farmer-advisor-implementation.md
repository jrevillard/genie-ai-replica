# Farmer weather advisor — implementation record

How the PolisenseAI chat path was rebuilt on the `climate_polisense_2-1` branch:
table-aware chunking in the ingestion pipeline, a repaired Copernicus feed, the
removal of the keyword router in favour of a single curated-context LLM call,
and the move from `granite-3.3-8b` to `Qwen3-8B`.

Companion documents:

- [`table-chunking-analysis.md`](table-chunking-analysis.md) — the diagnosis that
  produced the chunking change, with before/after chunk dumps.
- [`../farmer_weather_advisor_test_questions.md`](../farmer_weather_advisor_test_questions.md)
  — the 48-question harness quoted throughout.
- [`farmer-user-journey.md`](farmer-user-journey.md) — the same capabilities
  as a narrative walk-through, from the farmer's side of the screen.

---

## 1. Why any of this changed

A farmer asked _"tell me the pest and diseases for potatoes in dhaka"_ and got 2
of the 6 pests in the source document. Fixing that exposed a second problem:
_"given the 1 week forecast is it ideal to plant potato?"_ produced

> the maximum temperature of **33 °C** mentioned in the one-week forecast exceeds
> the optimal limit

with **no forecast in the request at all**. The document's highest recorded
temperature is 32.0 °C; 33 °C happened to match that week's real forecast, which
is what made the answer look grounded. It was invented.

Both failures came from the same architecture: two sources of knowledge that
could never meet, and a keyword router that chose one of them per message.

---

## 2. Architecture, before and after

### Before

```
                    ┌──────────────────────────────────────────┐
  farmer message ──▶│ isWeatherQuery()  4 keyword tiers + LLM   │
                    └───────────────┬──────────────────────────┘
                        weather ◀───┴───▶ RAG
                            │                │
                            ▼                ▼
              ┌───────────────────────┐  ┌──────────────────────┐
              │ weather-mcp /query    │  │ ChatQnA              │
              │  8 regex branches,    │  │  retrieval + LLM     │
              │  each prints a        │  │  7 potato chunks     │
              │  fixed template       │  │  NO weather at all   │
              │  NO crop knowledge    │  └──────────────────────┘
              │  source_documents: [] │
              └───────────────────────┘
```

Only the last fallback of `weather-mcp /query` involved an LLM at all — a
Gemma-3-4b prompt containing location, a day table and a risk tier, and nothing
about the crop. Its instruction "one practical agriculture tip" was therefore
answered from the model's own parametric knowledge.

### After

```
                    ┌───────────────────────────────────────┐
  farmer message ──▶│ isWeatherCommand()  (2 keyword lists) │
                    └──────────────┬────────────────────────┘
                      command ◀────┴────▶ everything else
                          │                      │
                          ▼                      ▼
          ┌────────────────────────┐   ┌────────────────────────────┐
          │ weather-mcp /query     │   │ GET weather-mcp /context   │
          │ delineation,           │   │  date + season position    │
          │ flood detection,       │   │  7-day forecast            │
          │ bulletin               │   │  crop risk                 │
          │ (launch jobs / images) │   │  seasonal outlook + stages │
          └────────────────────────┘   │  drought, flood, warnings  │
                                       │  "not available" list      │
                                       └─────────────┬──────────────┘
                                                     ▼
                                       ┌────────────────────────────┐
                                       │ ChatQnA                    │
                                       │  retrieved documents       │
                                       │  + context block           │
                                       │  → one Qwen3-8B call       │
                                       └────────────────────────────┘
```

The code's only job is to assemble accurate, labelled context. The model decides
what is relevant and what the answer is. Nothing chooses a template.

### Request shape reaching the model

```
[Live weather and farm data, retrieved now]
Today is Sunday 13 September 2026 (UTC), ISO week 37. District: Dhaka.

Potato season calendar for Dhaka (crop profile):
  October 2026: Sprouting, Seedling — seasonal risk Normal
  ...
  The potato season has not started: the first calendar month is October 2026, in 18 days.

7-day forecast for Dhaka (Open-Meteo, cross-checked against BAMIS; ingested ...):
  2026-09-13 (today): 26.4–32.4°C, rain 1.0 mm (49% chance), humidity 93%, wind 7 km/h, soil moisture 0.34 m³/m³ (wet)
  2026-09-14 (tomorrow): 26.2–33.3°C, ...
  Totals over these 7 days: rain 25.9 mm on 7 day(s) ≥1 mm; max 33.3°C, min 25.0°C.

Potato risk today for Dhaka (crop thresholds, assessed 2026-09-13): Warning — Max temperature 33.0°C exceeds Potato limit 30°C.
Seasonal outlook for Dhaka (Copernicus SEAS5, issued September 2026, ...)
Drought assessment for Dhaka (satellite soil moisture and vegetation, ...)
Flood outlook for Dhaka (rainfall + GloFAS river discharge, next 10 days): Normal.
Official BMD warnings in force for Dhaka: none.

Not available in this system: observed rainfall records for past weeks or months,
and alert subscriptions (the assistant cannot notify anyone later).
[End of live data]

Question: <the farmer's message>

Answer only this question. Use the parts of the live data and the retrieved
documents it needs and leave the rest out; do not state weather values that are
not listed above.
```

Data first, question second, instruction last. The ordering is deliberate and is
covered in §6.

---

## 3. Ingestion — table-aware chunking

### The problem

Docling exports PDFs as markdown. The previous pipeline fed that straight into
`RecursiveCharacterTextSplitter`, which counts characters and knows nothing about
table rows. With the old 500-char budget, each row of the crop calendar was
330–491 characters, so the pest/disease table was cut across **7 chunks** and no
single chunk listed more than two pests. Docling also pads every cell to the
column width, which inflated that table from 2 249 to 6 047 characters of mostly
spaces.

### The change

`genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py`

Tables are detected, padding-squeezed, and kept atomic; only genuinely oversized
tables are split, always on row boundaries with the header repeated:

```python
def _squeeze_table_row(row: str) -> str:
    """Collapse Docling's column padding on one markdown row."""
    if _TABLE_SEPARATOR_RE.match(row):
        return _TABLE_DASH_RE.sub("---", row).strip()
    return _TABLE_PAD_RE.sub(" ", row).strip()


def _chunk_markdown_table(rows: list[str], heading: str, chunk_size: int) -> list[str]:
    """Chunk a single markdown table, keeping it atomic when it fits.

    Oversized tables are split on row boundaries, never inside a row, and the
    header rows are repeated on every fragment so each one is self-describing.
    """
    rows = [r for r in (_squeeze_table_row(r) for r in rows) if r]
    budget = max(chunk_size, TABLE_CHUNK_SIZE)
    prefix = heading.strip() if heading else ""

    whole = _compose_table_chunk(prefix, rows)
    if len(whole) <= budget:
        return [whole]

    header = [rows[0]]
    if len(rows) > 1 and _TABLE_SEPARATOR_RE.match(rows[1]):
        header.append(rows[1])
    body = rows[len(header) :]
    head = _compose_table_chunk(prefix, header)

    out: list[str] = []
    current: list[str] = []
    for row in body:
        if current and len(_compose_table_chunk(head, current + [row])) > budget:
            out.append(_compose_table_chunk(head, current))
            current = [row]
        else:
            current.append(row)
    if current:
        out.append(_compose_table_chunk(head, current))
    return out
```

The dispatcher routes tables to that function and everything else to the
unchanged character splitter. A heading directly above a table rides with the
table rather than becoming a content-free chunk:

```python
def _split_markdown_aware(content: str, text_splitter, chunk_size: int) -> list[str]:
    """Split markdown without ever cutting through a table row."""
    lines = content.splitlines()
    chunks: list[str] = []
    pending: list[str] = []

    def flush_text() -> None:
        block = "\n".join(pending).strip()
        pending.clear()
        if not block:
            return
        # create_documents (not split_text) keeps the pre-existing contract for
        # non-table text: same splitter call, same add_start_index behaviour.
        for part in text_splitter.create_documents([block]):
            part = part.page_content if hasattr(part, "page_content") else part
            if part and part.strip():
                chunks.append(part)

    i = 0
    total = len(lines)
    while i < total:
        if not _TABLE_ROW_RE.match(lines[i]):
            pending.append(lines[i])
            i += 1
            continue

        while pending and not pending[-1].strip():
            pending.pop()
        heading = pending.pop() if pending and _HEADING_RE.match(pending[-1]) else ""
        flush_text()

        table: list[str] = []
        while i < total and _TABLE_ROW_RE.match(lines[i]):
            table.append(lines[i].rstrip())
            i += 1
        chunks.extend(_chunk_markdown_table(table, heading, chunk_size))
    flush_text()
    return chunks
```

Call site (`_load_and_chunk`, the non-HTML non-`.md` branch):

```python
else:
    # Docling exports PDF/DOCX/PPTX/XLSX as markdown. Split it
    # table-aware so a row is never cut in half and header rows stay
    # attached to their data.
    plain_chunks = _split_markdown_aware(content, text_splitter, doc_path.chunk_size)
```

### Entity aggregation understands table rows

The synthetic "complete list" chunks were built by heuristics written for the old
PyMuPDF loader (short-line lists, key–value pairs). Neither shape occurs in
Docling markdown, so the pest aggregation never fired. A third case was added:

```python
# Type C: Docling markdown table rows. Every row under a pests/diseases
# heading is an entity, even when the name matches no keyword, which is
# why the heading is checked as well as the name.
if any(_TABLE_ROW_RE.match(ln) for ln in lines):
    pest_section = any(_PEST_SECTION_RE.search(ln) for ln in lines if _HEADING_RE.match(ln))
    for line in lines:
        if not _TABLE_ROW_RE.match(line) or _TABLE_SEPARATOR_RE.match(line):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        name = cells[0] if cells else ""
        if not name or len(name) > 60:
            continue
        if _TABLE_HEADER_CELL_RE.match(name) or _METEO_COLUMN_RE.match(name):
            continue
        if pest_section or _ENTITY_RE.search(name):
            entity_names.add(name)
```

The keyword regex also missed real entries on word boundaries:

```python
# NOTE: "wilt", "termite", "bacterial" and friends are required for Docling
# markdown tables. The original alternatives miss real entries on word
# boundaries: "bacteria" does not match "Bacterial wilt" and "mite" does not
# match "Termite", so 3 of the 6 pest rows in a crop calendar were skipped.
_ENTITY_RE = re.compile(
    r"(?i)\b(pest|worm|aphid|mite|larva|larvae|nematode|insect|blight|"
    r"fungus|fungal|bacteria|bacterial|virus|viral|rust|rot|mould|mold|weevil|"
    r"caterpillar|beetle|fly|moth|bug|thrip|scale|whitefly|leafhopper|disease|"
    r"pathogen|wire\s*worm|wilt|termite|mildew|borer|smut|canker|scab|"
    r"anthracnose)\b"
)
```

Three bugs surfaced only when testing against the real Docling output, not
against mocked splitters, and are worth remembering:

1. `_TABLE_ROW_RE` is anchored (`^\s*\|`), so `.search()` over a multi-line string
   only tests the first line. Every pest chunk starts with a heading, so the check
   never matched. Fixed with `any(... .match(ln) for ln in lines)`.
2. `_ENTITY_RE`'s word boundaries reject the plural headings _"Pests"_ and
   _"Diseases"_, so a dedicated `_PEST_SECTION_RE` with an explicit optional
   plural was added.
3. Docling's cell padding made the "does this table fit" test fail for tables that
   easily fit once squeezed.

### Sizes

| Setting                     | Value                 | Why                                                                                       |
| --------------------------- | --------------------- | ----------------------------------------------------------------------------------------- |
| `DATAPREP_CHUNK_SIZE_PDF`   | `2500`                | one Docling table row is 330–491 chars; at the 500 default every row became its own chunk |
| `DATAPREP_TABLE_CHUNK_SIZE` | `3000` (code default) | floor for the table budget, independent of the prose chunk size                           |
| `RERANKER_TOP_N`            | `5`                   | list questions ("which pests…") need every relevant row in context, not the top 3         |

### Result

The pest/disease table now occupies **one** chunk instead of four to seven, and
the synthetic aggregation chunk lists exactly the six real entries:

```
[AGGREGATED] Pests, diseases, and organisms affecting this crop (complete list from this document):
- Bacterial wilt
- Fusarium wilt
- Late Blight
- Potato Leaf Roll Virus
- Potato Wire Worm
- Termite
```

Previously it contained contaminated entries such as "Normal Phase" and "RH(hr)".
`potato_dhaka.pdf` now yields 7 chunks in `GRAPH_SOURCE`.

---

## 4. Copernicus — four bugs, all latent behind the first

`components/warning_system_engine/app/integrations/copernicus/fetcher.py`

`seasonal_forecasts` held 0 documents, so every long-range question fell back to
the 7-day forecast. The cause was a chain, not a single fault. Bugs 2–4 were
masked because bug 1 meant the download never succeeded — fixing only the first
would have produced a pipeline that still crashed or emitted rainless outlooks.

| #   | Bug                                                                | Evidence                                                                        | Effect                                                             |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | `_SYSTEM = "5"`                                                    | system 5 fails for 2026-07/08/09; system 51 succeeds for the same months        | `MarsNoDataError`, nothing ever stored                             |
| 2   | precipitation looked up as `tp` / `total_precipitation` / `var228` | the monthly-mean product names it **`tprate`**                                  | `_get_var` returned `None`; rainfall silently absent               |
| 3   | parser read `ds.coords["time"]`, else `list(ds.coords)[0]`         | there is no `time` coord; the first coord is **`number`** (51 ensemble members) | iterated 51 fake dates then raised on `isel(time=i)`               |
| 4   | `tprate` treated as m/day (`×1000×days`)                           | units are **m s⁻¹**                                                             | under-reported rain by 86 400× — 9.32 mm/day became 0.003 mm/month |

An earlier hypothesis — that ECMWF simply had not published the current month yet
— was disproved by testing the two systems against the same months. System 51
returns data for the current month; there is no publication lag to work around.

```python
# SEAS5.1. System "5" is no longer produced for current months — CDS answers
# every recent issue month with MarsNoDataError, while "51" returns data for the
# same months (verified against 2026-07/08/09). Override only if ECMWF retires 51.
_SYSTEM  = os.getenv("COPERNICUS_SYSTEM", "51")
```

The file is indexed by `forecast_reference_time` + `forecastMonth`, and
`forecastMonth=1` is the issue month itself. That was established empirically
rather than assumed: an August run gives 28.51 / 28.41 / 26.87 / 23.88 / 21.18 °C
— an Aug→Dec cooling curve matching Dhaka climatology — and its second month
agrees with a September run's first month.

```python
        def ens_mean(candidates: list[str]):
            var = self._get_var(ds, candidates)
            if var is None:
                return None
            return var.mean(dim="number") if "number" in var.dims else var

        precip_rate = ens_mean(["tprate", "tp", "total_precipitation", "var228"])

        # The file is indexed by forecast_reference_time (the issue date) and
        # forecastMonth, NOT by a "time" coordinate. forecastMonth=1 is the issue
        # month itself, so valid_month = issue_month + (forecastMonth - 1).
        if "forecastMonth" in ds.coords:
            lead_numbers = [int(v) for v in ds.coords["forecastMonth"].values]

        # "tprate" is a mean rate in m s-1 → mm for the whole month.
        p_val = at(precip_rate, i, lat, lon)
        if p_val is not None:
            days = self._days_in_month(year, month)
            record["total_precip_mm"] = round(p_val * 1000 * 86400 * days, 1)
```

Also corrected: the request used the deprecated `"format"` key, now `"data_format"`.

### Operational prerequisites

An API token alone is not enough. Both licences ("Additional licence to use
non-European contributions" and "CC-BY") must be accepted on the dataset's
download page or every request returns **HTTP 403**. The form fields on that page
are irrelevant — only the two Accept buttons matter.

```bash
CDSAPI_URL=https://cds.climate.copernicus.eu/api
CDSAPI_KEY=<personal access token from cds.climate.copernicus.eu/profile>
```

Result: `{'stored': 20, 'skipped': 0, 'error': None}` — 20 districts. This
unlocked `LongTermPotatoEWS`, which was already written and had never had input:
it maps each forecast month to the crop's growth stages, compares against the
crop thresholds, and writes `seasonal_assessments` (4 rows for Dhaka = the four
potato-season months). Only Dhaka has a crop profile, so the other 19 districts
are skipped by design, not by fault.

---

## 5. The context provider

`components/weather-mcp-service/main.py` gained one read-only endpoint that
composes existing storage readers. No new pipeline and no new data source.

```python
def _build_weather_context(district: str, days: int = 7, crop: str = "potato") -> str:
    """Plain-text context block for ``district``; "" when nothing is stored."""
    if storage_layer is None:
        return ""
    now = datetime.now(timezone.utc)
    today = now.date()
    sections: list[str] = [
        f"Today is {now:%A %d %B %Y} (UTC), ISO week {today.isocalendar()[1]}. District: {district}."
    ]
    ...
```

Two details in that block exist because the model got them wrong without them:

```python
            # "today"/"tomorrow"/weekday next to the date: the model does not
            # reliably work out which row "tomorrow" is from the date alone.
            offset = (_date.fromisoformat(d.date) - today).days
            when = {0: "today", 1: "tomorrow"}.get(offset, _date.fromisoformat(d.date).strftime("%A"))

            if d.soil_moisture is not None:
                # Same wet/moist/dry banding the forecast strip shows the user;
                # without it the LLM guessed 0.34 m³/m³ (field capacity) was "low".
                band = WeatherAgent._soil_emoji(d.soil_moisture).split()[0]
```

Season position is derived from the stored assessments rather than a hardcoded
date range, so it follows the crop profile:

```
The potato season has not started: the first calendar month is October 2026, in 18 days.
```

`storage.py` gained the one reader that did not exist — the crop-aware seasonal
assessments were being written by the engine and read by nobody:

```python
    def get_seasonal_assessments(
        self, location: str, crop: str = "potato"
    ) -> list[dict]:
        """
        Monthly crop risk assessments for a district, oldest month first.

        Written by LongTermPotatoEWS, which compares the Copernicus outlook
        against the crop thresholds and growth stages. Returns [] when the
        seasonal pipeline has not run for this district.
        """
```

### Backend wiring

`components/gov-chat-backend/services/query-service.js`

The four-tier router, the LLM classifier and ~150 lines of keyword lists were
deleted. What remains is a command test and a context fetch:

```javascript
// Commands weather-mcp-service executes itself: the bulletin returns images,
// GEO_KEYWORDS launch satellite inference. Everything else is a question.
const BULLETIN_KEYWORDS = ['bulletin', 'agrometeorological', 'agromet', 'agri advisory'];

/** True when weather-mcp-service must run the message as a command. */
function isWeatherCommand(message) {
  if (process.env.WEATHER_ENABLED !== 'true') return false;
  const variants = routingVariants(message);
  const has = (list) => variants.some((text) => list.some((kw) => kwMatches(text, kw)));
  return has(GEO_KEYWORDS) || has(BULLETIN_KEYWORDS);
}
```

```javascript
async function fetchWeatherContext(message) {
  if (process.env.WEATHER_ENABLED !== 'true') return '';
  const weatherMcpUrl = process.env.WEATHER_MCP_URL || 'http://weather-mcp-service:8000';
  try {
    const resp = await axios.get(`${weatherMcpUrl}/context`, { params: { location: message }, timeout: 5000 });
    return String(resp.data?.text || '');
  } catch (err) {
    logger.warn(`[WEATHER] context fetch failed (${err.message}) - answering without it`);
    return '';
  }
}
```

```javascript
function withWeatherContext(opeaPayload, backendMode, queryText, weatherContext) {
  if (!weatherContext) return opeaPayload;
  // Data first, question after it, instruction last: the instruction that
  // follows the question is the one the model weights most, so it is not
  // buried under the data block.
  const wrap = (question) =>
    `[Live weather and farm data, retrieved now]\n${weatherContext}\n[End of live data]\n\n` +
    `Question: ${question}\n\n` +
    'Answer only this question. Use the parts of the live data and the retrieved documents it needs ' +
    'and leave the rest out; do not state weather values that are not listed above.';
  if (backendMode === 'single-message') {
    return { ...opeaPayload, messages: wrap(queryText) };
  }
  const msgs = [...opeaPayload.messages];
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    if (msgs[i]?.role === 'user') {
      msgs[i] = { ...msgs[i], content: wrap(msgs[i].content) };
      break;
    }
  }
  return { ...opeaPayload, messages: msgs };
}
```

Only the OPEA payload is enriched. The stored query and the text shown to the
user are untouched.

### A routing bug found along the way

`has()` used `text.includes(kw)`, so `"suitable"` contains `"table"` and every
_"is potato **suitable** given the forecast"_ question was classified as a
document-only query. `"drainage"` likewise matched `"rain"`. Only the **leading**
boundary can be required, because several keywords are deliberate stems:

```javascript
const kwMatches = (text, kw) => new RegExp(`(?:^|[^a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text);
```

A full word-boundary match would have broken `delineat` → `delineate`,
`plant` → `planting`, `humid` → `humidity`, `field boundar` → `field boundaries`.

---

## 6. Prompting

`CHATQNA_SYSTEM_PROMPT` and `CHATQNA_ABSTENTION_INSTRUCTIONS` are set in `.env`
(the repo's two-tier prompt design: env overrides the built-in default). The
built-in default says _"answer using only the content provided from the knowledge
base"_, which would make the model ignore the live block — so it must be
overridden, not extended.

The rules that exist because of an observed failure:

| Rule                                                                                                               | Failure it fixes                                                                 |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| "Answer only the question asked… leave the rest out"                                                               | a plain weather question returned forecast + potato + seasonal + drought + flood |
| "Bring in crop information only when the user asks about a crop…"                                                  | same                                                                             |
| "Do not call a value high, low, normal, or above or below average unless the sources give a threshold or baseline" | invented "above the historical average"                                          |
| "treat it as a hypothetical: say what the forecast actually shows, then answer for the case they describe"         | "if there is no rain for two weeks" was accepted as fact                         |
| "The live data block lists what this system does not have; when a question depends on it, say so first"            | invented past-rainfall comparisons                                               |

Ordering matters as much as wording. With the instruction _before_ a 2 700-character
data block, an 8B model follows the data; moving the instruction after the
question fixed the "report everything" behaviour that prompt wording alone had not.

---

## 7. Model upgrade

`granite-3.3-8b` could not reliably follow "answer only what is asked", and on
two of three runs answered _"no maximum exceeds 30 °C"_ about a forecast whose
every row read 31–33 °C. That is not fixable by wording.

```bash
VLLM_LLM_MODEL_ID=Qwen/Qwen3-8B
VLLM_TOOL_PARSER=hermes
VLLM_EXTRA_ARGS=--chat-template /vllm-templates/qwen3-no-think.jinja --reasoning-parser qwen3
# Previous model, kept for a quick rollback:
# VLLM_LLM_MODEL_ID=ibm-granite/granite-3.3-8b-instruct
```

Three things this required:

1. **Non-thinking mode.** Qwen3 emits `<think>` blocks by default and vLLM 0.10.0
   has no flag to disable them. `configs/vllm/qwen3-no-think.jinja` is the model's
   own template with one condition inverted, mounted read-only at
   `/vllm-templates`. Verified: "Is 32.4 greater than 30?" costs 15 completion
   tokens with no reasoning block.
2. **Tool parser.** `granite` → `hermes` for Qwen models.
3. **Guided JSON must still work** — dataprep labelling sends
   `response_format={"type":"json_object"}` per chunk. Verified working.

Two compose hooks were added to make this configurable rather than hardcoded:

```yaml
${VLLM_EXTRA_ARGS:-}
```

```yaml
# Chat-template overrides (e.g. Qwen3 with thinking off), selected via VLLM_EXTRA_ARGS.
- ./configs/vllm:/vllm-templates:ro
```

> **Deployment gotcha.** This stack runs with **two** compose files. The second
> grants `runtime: nvidia`. A plain `docker compose up` recreates vLLM without a
> GPU and it dies with `Failed to infer device type`:
>
> ```bash
> docker compose -f docker-compose.yaml -f docker-compose.local-gpu.yaml \
>   --profile gpu-models --profile opea up -d --force-recreate vllm
> ```
>
> Also: `--force-recreate` alone reuses the existing **image**. Any change to
> backend JS or service Python needs `docker compose build <service>` first.

### Measured difference — 48 questions, identical inputs

|                               | granite-3.3-8b                      | Qwen3-8B                                   |
| ----------------------------- | ----------------------------------- | ------------------------------------------ |
| Median answer length          | 1 332 chars                         | **509**                                    |
| "Will it rain tomorrow?"      | wrong day + potato/seasonal padding | "Yes, 74 % chance, 1.3 mm"                 |
| "Extreme heat this week?"     | "none exceed 30 °C" (2 of 3 runs)   | "32.4 °C exceeds 30 °C, up to 33.3 °C"     |
| "Rainfall lower than normal?" | invented a historical average       | "no historical rainfall data is available" |
| "No rain for several days"    | accepted the false premise          | "that is inconsistent with the forecast"   |

---

## 8. Confidence badge

After the switch the badge read **8 %** on well-grounded answers. The obvious
suspicion — that the large context block was diluting the reranker query — is
**wrong**. Measured on the same document:

| query                                  | reranker score |
| -------------------------------------- | -------------- |
| bare question (47 chars)               | 0.0000128      |
| question + context block (3 214 chars) | 0.0054         |

The block _raises_ the score. Stored query history also shows 0.08 / 0.01 / 0.03
for RAG answers long before these changes.

The real cause: the reranker is `cross-encoder/ms-marco-MiniLM-L-12-v2`, trained
on MS MARCO prose. The crop calendar's pipe-delimited tables are far outside that
distribution, so it rates them near-irrelevant whatever is asked. The badge was
reporting the cross-encoder's confusion, not the answer's quality.

Fixed with an existing, fully-wired feature — one env var, no code:

```bash
LLM_SELF_CONFIDENCE_ENABLED=1
```

The model grades its own reply against the retrieved documents via a `[[CONF:nn]]`
sentinel, stripped on both the streaming and non-streaming paths, with fallback
to the reranker score if the sentinel is missing so the badge never disappears.
Badge now reads 0.85–0.90; `retrieval_confidence_score` is still emitted
separately for admin and evaluation.

**Caveat:** Qwen3 grades ~0.85 flatly, including for deliberately off-topic
questions. The badge now reads "plausible" rather than "alarming", but it is a
weak discriminator. A sharper badge means changing the reranker model
(`BAAI/bge-reranker-v2-m3` handles structured text far better), which has not
been done.

---

## 9. Files changed

| File                                                                           | Change                                                                                                      |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py`                       | table-aware chunking, squeeze, Type C aggregation, entity regex (+178)                                      |
| `genie-ai-overlay/tests/test_dataprep.py`                                      | 13 tests across 2 new classes (+146)                                                                        |
| `components/warning_system_engine/app/integrations/copernicus/fetcher.py`      | system 51, `tprate`, `forecastMonth` parser, m s⁻¹ conversion                                               |
| `components/weather-mcp-service/main.py`                                       | `/context` + `_build_weather_context`; removed 6 template branches and their builders (1 965 → 1 443 lines) |
| `components/weather-mcp-service/storage.py`                                    | `get_seasonal_assessments()` (+30)                                                                          |
| `components/weather-mcp-service/agent.py`                                      | default district, crop-grounded advisory tip (+64)                                                          |
| `components/gov-chat-backend/services/query-service.js`                        | tier router and classifier removed; command test + context injection (2 258 → 2 053 lines)                  |
| `components/gov-chat-backend/__tests__/services/query-service-weather.test.js` | 15 tests (new file)                                                                                         |
| `configs/vllm/qwen3-no-think.jinja`                                            | Qwen3 template, thinking off (new file)                                                                     |
| `docker-compose.yaml`                                                          | `VLLM_EXTRA_ARGS`, template mount, `CHATQNA_ABSTENTION_INSTRUCTIONS`                                        |
| `.env`                                                                         | model, prompts, chunk/rerank sizes, confidence, CDS key                                                     |

Net: **code shrank**. Two services lost more lines than the whole change added.

### Configuration reference

| Variable                          | Value                            | Purpose                                       |
| --------------------------------- | -------------------------------- | --------------------------------------------- |
| `VLLM_LLM_MODEL_ID`               | `Qwen/Qwen3-8B`                  | chat + labelling model                        |
| `VLLM_TOOL_PARSER`                | `hermes`                         | required for Qwen                             |
| `VLLM_EXTRA_ARGS`                 | chat template + reasoning parser | non-thinking mode                             |
| `CHATQNA_SYSTEM_PROMPT`           | advisor prompt                   | must override the KB-only default             |
| `CHATQNA_ABSTENTION_INSTRUCTIONS` | custom                           | answer from live data when retrieval is empty |
| `LLM_SELF_CONFIDENCE_ENABLED`     | `1`                              | badge from the model, not the reranker        |
| `DATAPREP_CHUNK_SIZE_PDF`         | `2500`                           | Docling table rows are 330–491 chars          |
| `RERANKER_TOP_N`                  | `5`                              | keep every relevant row for list questions    |
| `WEATHER_ENABLED`                 | `true`                           | gates the whole advisor path                  |
| `DEFAULT_LOCATION` / `DEFAULT_LAT` / `DEFAULT_LON` | unset → `Naogaon` | shared fallback for every climate service and the web banner |
| `CDSAPI_KEY`                      | token                            | **requires both dataset licences accepted**   |
| `COPERNICUS_SYSTEM`               | unset → `51`                     | SEAS5.1                                       |

---

## 10. Results

48 questions, before and after the whole change:

|                                                 | baseline | now   |
| ----------------------------------------------- | -------- | ----- |
| Refused for missing location                    | 10       | **0** |
| "Long-range outlook not available"              | 1        | **0** |
| Answers using today's date / season position    | 0        | 38    |
| Answers citing live forecast or outlook figures | ~8       | 35    |
| Live figures attributed to "the document"       | common   | **0** |
| Errors                                          | 0        | 0     |

Tests: **1 715** backend (15 new), **727** overlay pytest, ruff and eslint clean.

### What is still wrong

Honest residue, all reasoning rather than plumbing:

- The document's `>25 mm/day` **warning** threshold is read as a rainfall
  **requirement** ("106.7 mm is above the 25 mm/day required").
- Irrigation advice is improvised — the source document contains none, and the
  model fills the gap instead of saying so.
- "Above/below normal" still appears occasionally where no baseline was supplied.
- The confidence badge does not discriminate (§8).

The first two are documentation gaps: the crop calendar states warning thresholds
but never requirements, and has no irrigation section. Better source material
fixes them; more prompt text will not.

### Genuine data limits, not defects

- No observed or historical rainfall anywhere in the system — _"has rainfall been
  lower than normal this month?"_ is unanswerable and the system now says so.
- No notification or subscription capability — _"notify me if…"_ cannot be
  fulfilled.
- Only potato has a crop profile, and only for Dhaka.

### Verification caveat

The 48-question runs replay exactly what the backend sends to ChatQnA, and the
backend path is covered by unit tests plus a grep of the running container. They
were **not** driven through the browser with a logged-in user, because no test
credentials exist in `.env` and obtaining a token means temporarily enabling ROPC
in Keycloak. One question through the UI remains the real end-to-end confirmation.
Bengali was not tested; it goes through the existing translation path with an
English context block.
