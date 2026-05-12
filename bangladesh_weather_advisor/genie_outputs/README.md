# GENIE.AI Output Documents

Pre-generated knowledge documents for GENIE.AI RAG ingestion.

## Structure

```
genie_outputs/
├── markdown_docs/                    # 448 Markdown knowledge documents
│   ├── agriculture/
│   │   └── crop-distribution/        #  64 docs — MAPSPAM crop areas
│   ├── district-profiles/
│   │   ├── administrative-boundaries/ # 64 docs — HDX boundary metadata
│   │   └── soil-properties/          #  64 docs — SoilGrids soil data
│   └── rainfall-climate/
│       ├── daily-rainfall/           #  64 docs — CHIRPS daily rainfall
│       ├── rainfall-climatology/     #  64 docs — 30-year rainfall normals
│       ├── temperature-evaporation/  #  64 docs — ERA5 daily data
│       └── temperature-evaporation-climatology/  # 64 docs — 30-year normals
└── metadata/
    ├── documents_metadata.jsonl      # Document-level metadata (448 records)
    └── arango_documents.jsonl        # ArangoDB-ready document records
```

## Document Count

- **448** structured Markdown documents covering all **64 districts** of Bangladesh
- **7** thematic categories across climate, agriculture, and geography
- Each document is self-contained with source attribution and extraction dates

## Regeneration

To regenerate these documents from updated CSV data:

```bash
python -m production_pipeline.genie_data_converter \
    --input-dir ./data/csv_inputs \
    --output-dir ./genie_outputs
```
