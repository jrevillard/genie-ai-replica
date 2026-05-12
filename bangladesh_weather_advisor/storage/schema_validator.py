"""Schema validation for BigQuery indicators and ArangoDB documents."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Dict, List, Tuple

import pandas as pd

from production_pipeline.config import LOG_LEVEL

logger = logging.getLogger(__name__)
logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO))


@dataclass(frozen=True)
class ValidationResult:
    is_valid: bool
    missing_columns: List[str]
    null_critical_counts: Dict[str, int]
    duplicate_count: int


INDICATOR_REQUIRED_COLUMNS = [
    "district_id",
    "record_date",
    "source",
    "extraction_date",
    "ingested_at_utc",
]

DOCUMENT_REQUIRED_COLUMNS = [
    "doc_key",
    "title",
    "record_date",
    "source",
    "text",
]


def validate_dataframe_schema(
    df: pd.DataFrame,
    required_columns: List[str],
    unique_key_cols: List[str],
) -> ValidationResult:
    missing_columns = [c for c in required_columns if c not in df.columns]
    null_critical_counts = {c: int(df[c].isna().sum()) for c in required_columns if c in df.columns}
    duplicate_count = int(df.duplicated(subset=unique_key_cols).sum()) if all(k in df.columns for k in unique_key_cols) else len(df)

    is_valid = not missing_columns and all(v == 0 for v in null_critical_counts.values()) and duplicate_count == 0

    if not is_valid:
        logger.warning(
            "Schema validation failed. missing=%s nulls=%s duplicates=%s",
            missing_columns,
            null_critical_counts,
            duplicate_count,
        )

    return ValidationResult(
        is_valid=is_valid,
        missing_columns=missing_columns,
        null_critical_counts=null_critical_counts,
        duplicate_count=duplicate_count,
    )


def validate_indicator_frame(df: pd.DataFrame) -> ValidationResult:
    return validate_dataframe_schema(
        df=df,
        required_columns=INDICATOR_REQUIRED_COLUMNS,
        unique_key_cols=["district_id", "record_date", "source"],
    )


def validate_document_frame(df: pd.DataFrame) -> ValidationResult:
    return validate_dataframe_schema(
        df=df,
        required_columns=DOCUMENT_REQUIRED_COLUMNS,
        unique_key_cols=["doc_key"],
    )
