# MEWA — RAG Knowledge Architecture

## Purpose

This document defines the RAG knowledge architecture for MEWA based strictly on the following ground truth sources:
- `MEWA_report.md` — system design and data sources
- `bangladesh_challenge_core.md` — challenge goals and requirements
- `validation_recommendation.md` — RAG vs. live-fetch split principle
- `GENIE.AI-Installation_hierarchy.md` — hierarchy design methodology
- `GENIE.AI-Data-Labelling-Strategy.md` — labeling pipeline

---

## 1. Data Sources and Routing

Four data sources are established in `MEWA_report.md`. Each is routed to RAG, live-fetch, or both, following the principle from `validation_recommendation.md`: raw telemetry is never ingested into the vector store — only stable, derived documents enter RAG.

| Source | What it provides | RAG or Live-fetch? | Basis |
|--------|-----------------|-------------------|-------|
| **BAMIS** | Daily min/max/avg per meteorological variable; used in `sense_check()` to validate Open-Meteo | Both: advisories/bulletins → RAG; raw daily stats → live-fetch | `MEWA_report.md` §3.1 |
| **Open-Meteo** | Hourly timeseries, up to 7 days; primary short-term forecast source | Live-fetch only — high-frequency telemetry, fetched directly by `ShortTermEWS.evaluate()` | `MEWA_report.md` §3.2 |
| **Copernicus** | Monthly aggregates, up to 7 months; exclusive source for long-term pipeline | Both: raw data → live-fetch via weekly cronjob; derived seasonal summaries → RAG | `MEWA_report.md` §3.3 |
| **Prithvi / Sentinel-2** | Flood segmentation (Sen1Floods11) and crop classification layers | Both: per-scene outputs → live-fetch; derived seasonal profiles → RAG | `MEWA_report.md` §4 |
| **Agricultural guidance documents** | Manuals, handbooks, government extension materials | RAG only — stable documents | `bangladesh_challenge_core.md` |
| **Crop threshold profiles** | Per-variable, per-crop thresholds for EWS evaluation | RAG only — values TBD via expert review | `MEWA_report.md` §6.3 (code: `# THIS SHOULD COME FROM THE RAG`) |

---

## 2. Knowledge Hierarchy — 2-Level Labeling System

### 2.1 Design Principles

From `GENIE.AI-Installation_hierarchy.md`:
- **User-centric naming** — labels reflect what a farmer searches for, not internal source names
- **MECE** — categories mutually exclusive, collectively exhaustive
- **Strict 2-level limit** — Category (Level 1) + Service (Level 2) only
- **No duplicate Service names across Categories**
- **Primary sources must have dedicated labels; tertiary sources grouped into broad reference labels**
- **RAG documents only** — sources that are live-fetched (Open-Meteo, raw BAMIS stats, raw Copernicus, raw Prithvi) produce no ingested documents and carry no label

### 2.2 Complete Hierarchy

| Category (Level 1) | Service (Level 2) | Tier | RAG Document Source |
|---|---|---|---|
| **Weather Forecasts** | Short-term Forecast (1–7 days) | Primary | BAMIS bulletins and advisories |
| | Extended Forecast (8–15 days) | Primary | BAMIS bulletins and advisories |
| | Seasonal Outlook (1–6 months) | Secondary | Derived summaries from Copernicus long-term pipeline output |
| **Extreme Weather Alerts** | Drought Alerts | Primary | Derived summaries from BAMIS |
| | Flood & Waterlogging Alerts | Primary | Derived profiles from Prithvi flood segmentation |
| | Heat Wave Alerts | Primary | BAMIS bulletins |
| | Cold Spell & Frost Alerts | Primary | BAMIS bulletins |
| | Cyclone & Storm Surge Alerts | Primary | BAMIS bulletins |
| | Heavy Rainfall Alerts | Primary | BAMIS bulletins |
| **Crop Alert Thresholds** | Rice Threshold Profiles | Primary | Curated threshold documents — values TBD via expert review |
| | Other Crop Threshold Profiles | Primary | Curated threshold documents — values TBD via expert review |
| **Agricultural Guidance** | Crop Management | Primary | Manuals, handbooks, government extension materials |
| | Irrigation & Water Management | Secondary | Manuals, handbooks, government extension materials |
| | Pest & Disease Management | Secondary | Manuals, handbooks, government extension materials |
| **Geospatial Risk Profiles** | Geospatial Model Interpretation | Secondary | IBM/NASA Prithvi model documentation |
| **General Reference** | Government Information & Schemes | Tertiary | Government publications |

### 2.3 Summary

| Metric | Count |
|--------|-------|
| Categories (Level 1) | 6 |
| Services (Level 2) | 16 |
| Primary | 9 |
| Secondary | 5 |
| Tertiary | 1 |

**Notes on design decisions:**
- **Crop Alert Thresholds** is a dedicated category because `MEWA_report.md` explicitly requires threshold values to be retrieved from RAG at evaluation time rather than hardcoded
- **Agricultural Guidance** sources are TBD — category is confirmed as required by `bangladesh_challenge_core.md` but specific documents not yet identified
- Service names and category count should be validated against actual documents collected before ingestion begins

---

## 3. Labeling Pipeline

From `GENIE.AI-Data-Labelling-Strategy.md`, every ingested document goes through:

```
1. Domain schema applied
   └─ Labels drawn only from the predefined hierarchy above
   └─ LLM cannot assign labels outside this schema

2. Chunking
   └─ Document split into semantic chunks

3. Label assignment
   └─ LLM (Phase 1) or embedding (Phase 2) assigns Category + Service labels

4. Entity extraction
   └─ LLM detects named entities: crops, locations, hazard types,
      institutions, growth stages, meteorological variables
   └─ Entities linked to Knowledge Graph nodes

5. Knowledge Graph update
   └─ Edges: chunk → label, chunk → entity, entity ↔ entity
```

At query time, three signals combine:
- **Vector similarity** — semantic match to the query
- **Graph affinity** — KG traversal finds linked chunks not matched by vector
- **Label filtering** — restricts to the relevant Category/Service

### 3.1 Phases

**Phase 1 — Discovery**
`LABELING_STRATEGY=llm`
- Ingest a small sample from each category
- Watch for new label suggestions in logs — each indicates a hierarchy gap
- Iterate until hierarchy stabilises

**Phase 2 — Production**
`LABELING_STRATEGY=embedding`
- Switch once hierarchy is stable
- Re-ingest all documents under the locked schema

---

## 4. Hierarchy Import JSON

```json
{
  "hierarchy": [
    {
      "category": "Weather Forecasts",
      "services": [
        "Short-term Forecast (1-7 days)",
        "Extended Forecast (8-15 days)",
        "Seasonal Outlook (1-6 months)"
      ]
    },
    {
      "category": "Extreme Weather Alerts",
      "services": [
        "Drought Alerts",
        "Flood & Waterlogging Alerts",
        "Heat Wave Alerts",
        "Cold Spell & Frost Alerts",
        "Cyclone & Storm Surge Alerts",
        "Heavy Rainfall Alerts"
      ]
    },
    {
      "category": "Crop Alert Thresholds",
      "services": [
        "Rice Threshold Profiles",
        "Other Crop Threshold Profiles"
      ]
    },
    {
      "category": "Agricultural Guidance",
      "services": [
        "Crop Management",
        "Irrigation & Water Management",
        "Pest & Disease Management"
      ]
    },
    {
      "category": "Geospatial Risk Profiles",
      "services": [
        "Geospatial Model Interpretation"
      ]
    },
    {
      "category": "General Reference",
      "services": [
        "Government Information & Schemes"
      ]
    }
  ]
}
```

After import, generate Bengali translations:

```bash
cd components/gov-chat-backend/scripts/new-schema-scripts
node create-translations.js BN --translation-engine=internal
```

Bengali translations must be reviewed by a domain-aware speaker before going live — `bangladesh_challenge_core.md` requires Bengali as the primary output language.
