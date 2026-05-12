"""BigQuery loader for indicator records.

Colab setup:
    !pip install google-cloud-bigquery pandas-gbq

Example:
    from production_pipeline.storage.bigquery_loader import BigQueryIndicatorLoader
    loader = BigQueryIndicatorLoader()
    loader.ensure_dataset()
    loader.load_dataframe(df, table_name="district_indicators")
"""

from __future__ import annotations

import logging
from typing import Optional

import pandas as pd

from production_pipeline.config import BIGQUERY_DATASET, BIGQUERY_PROJECT, LOG_LEVEL
from production_pipeline.storage.schema_validator import validate_indicator_frame

logger = logging.getLogger(__name__)
logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO))


class BigQueryIndicatorLoader:
    """Load indicator DataFrames into partition-ready BigQuery tables."""

    def __init__(self, project_id: str = BIGQUERY_PROJECT, dataset_id: str = BIGQUERY_DATASET) -> None:
        self.project_id = project_id
        self.dataset_id = dataset_id
        self._client = self._init_client()

    @staticmethod
    def _init_client():
        try:
            from google.cloud import bigquery

            return bigquery.Client(project=BIGQUERY_PROJECT)
        except Exception as exc:  # pragma: no cover
            logger.warning("BigQuery client unavailable. Install google-cloud-bigquery. Details: %s", exc)
            return None

    def ensure_dataset(self) -> None:
        if self._client is None:
            logger.warning("Skipping ensure_dataset: BigQuery client not initialized")
            return

        from google.cloud import bigquery

        dataset_ref = bigquery.Dataset(f"{self.project_id}.{self.dataset_id}")
        dataset_ref.location = "US"
        self._client.create_dataset(dataset_ref, exists_ok=True)
        logger.info("Dataset ensured: %s.%s", self.project_id, self.dataset_id)

    def load_dataframe(self, df: pd.DataFrame, table_name: str, write_disposition: str = "WRITE_APPEND") -> None:
        """Validate and load DataFrame into BigQuery table."""
        validation = validate_indicator_frame(df)
        if not validation.is_valid:
            raise ValueError(f"Indicator schema validation failed: {validation}")

        if self._client is None:
            logger.warning("BigQuery client unavailable. Dry-run only; no load executed.")
            logger.info("Dry-run rows=%d table=%s", len(df), table_name)
            return

        from google.cloud import bigquery

        table_id = f"{self.project_id}.{self.dataset_id}.{table_name}"

        config = bigquery.LoadJobConfig(
            write_disposition=write_disposition,
            source_format=bigquery.SourceFormat.PARQUET if False else bigquery.SourceFormat.CSV,
            autodetect=True,
            time_partitioning=bigquery.TimePartitioning(
                type_=bigquery.TimePartitioningType.DAY,
                field="record_date",
            ),
            clustering_fields=["district_id", "source"],
        )

        job = self._client.load_table_from_dataframe(df, table_id, job_config=config)
        result = job.result()
        logger.info("Loaded %d rows into %s. Job=%s", len(df), table_id, result.job_id)

    def merge_upsert_sql(self, table_name: str, staging_table_name: str) -> str:
        """Return MERGE SQL for idempotent upserts."""
        target = f"`{self.project_id}.{self.dataset_id}.{table_name}`"
        source = f"`{self.project_id}.{self.dataset_id}.{staging_table_name}`"
        return f"""
        MERGE {target} T
        USING {source} S
        ON T.district_id = S.district_id AND T.record_date = S.record_date AND T.source = S.source
        WHEN MATCHED THEN UPDATE SET *
        WHEN NOT MATCHED THEN INSERT ROW
        """.strip()
