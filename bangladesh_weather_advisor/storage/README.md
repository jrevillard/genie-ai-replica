# Storage

Schema validation and optional persistence modules.

## Modules

| Module | Purpose |
|--------|---------|
| `schema_validator.py` | Validates DataFrame structure (required columns, nulls, duplicates) before storage |
| `bigquery_loader.py` | Loads indicator DataFrames into time-partitioned BigQuery tables |
| `arango_loader.py` | Stores advisory documents and bulletins in ArangoDB |

## Schema Files

- `../bigquery_schema.sql` — BigQuery table DDL definitions
- `../arango_schema.json` — ArangoDB collection configuration

## Note

BigQuery and ArangoDB are **optional** storage backends. The primary pipeline
output is the generated Markdown documents in `genie_outputs/`, which are
ingested directly into the GENIE.AI platform.
