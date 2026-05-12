# Agricultural taxonomy (v1)

## Design principles

- **Controlled schema:** All LLM output must conform to `LlmTaxonomyOutput` (Pydantic, `extra=forbid`).
- **No arbitrary tags:** Free-text is mapped through **synonym tables** and **allowlists** (where defined) in `agri_metadata/normalize.py` and `vocabularies.py`.
- **Geographic focus:** **Lesotho** and **South Africa** are primary `Location.Country` values. Other countries appear only under `secondaryReferences.countries`.
- **Relevance flag:** `isRelevant` is set false when the document is not materially about the target region/context.

## Top-level structure

- `Location` — Country, Region, District, Village, GeoScope  
- `Environment` — Climate, RainfallPattern, Altitude, TemperatureRange, Soil, WaterAvailability, AgroEcologicalZone  
- `Agriculture` — CropCategory, CropName, Varietal, Livestock, FarmingSystem, IrrigationType, Season, ProductionScale, OrganicStatus  
- `Content` — Topic, SubTopic, DocumentType, UseCase, Audience, Methodology  
- `Risk` — Pest, Disease, ClimateRisk, SoilRisk  
- `Economics` — MarketFocus, ValueChainStage, FinancialTopic  
- `Governance` — PolicyMentioned, NGOs, GovernmentBodies, Programs  

## Synonym examples (non-exhaustive)

| Input (normalized key) | Canonical |
|------------------------|-----------|
| corn, maize | Maize |
| yellow bean | Yellow Beans |
| southern africa | Southern Africa |
| pest infestation | Pest Control (via phrase map) |

## Chunk denormalization

`taxonomy_to_chunk_flat` produces filter-friendly arrays on each SOURCE document:

- `tax_countries`, `tax_crop_names`, `tax_varietals`, `tax_topics`, `tax_climates`, `tax_document_types`, `tax_regions`, `tax_is_relevant`, `tax_version`, `taxonomy_metadata` (full snapshot).

## Retrieval filters

Pass in chat/retrieval `context`:

```json
"taxonomy_filters": {
  "countries": ["Lesotho"],
  "crop_names": ["Maize"],
  "is_relevant": true
}
```

See `genieai_retriever_arangodb.py` (`_taxonomy_filter_inner`).
