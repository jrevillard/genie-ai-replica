"""
Bangladesh Weather Advisor — Production Data Pipeline
=====================================================

A modular data extraction, processing, and ingestion pipeline for the
ITU GENIE.AI GenAI-for-Good Challenge.  The pipeline aggregates climate,
agricultural, and meteorological data from 11 heterogeneous sources and
transforms them into structured knowledge documents ready for
Retrieval-Augmented Generation (RAG).

Subpackages
-----------
extractors
    Data extraction modules for satellite imagery (GEE), government
    portals (BMD, BAMIS), and static reference datasets (HDX, MAPSPAM,
    SoilGrids).
processors
    Computation of drought indices (SPI/SPEI), anomalies, vegetation
    condition indicators, and multi-source data merging.
storage
    Schema validation and optional loading into BigQuery / ArangoDB.
"""

__version__ = "1.0.0"
