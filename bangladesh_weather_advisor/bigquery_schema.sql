-- BigQuery schema for GENIE.AI Bangladesh climate/agriculture pipeline
-- Dataset placeholder: replace `${PROJECT_ID}.${DATASET}` with your target dataset.

-- ======================================================
-- 1) drought_monitoring
-- ======================================================
CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.${DATASET}.drought_monitoring` (
  doc_id STRING NOT NULL,
  district_id STRING NOT NULL,
  district_name STRING,
  record_date DATE,
  period STRING,
  spi_1 FLOAT64,
  spi_3 FLOAT64,
  spi_6 FLOAT64,
  spei_1 FLOAT64,
  spei_3 FLOAT64,
  spei_6 FLOAT64,
  drought_class STRING,
  data_quality STRING,
  category_label STRING,
  service_label STRING,
  source_file STRING,
  source STRING,
  extraction_date DATE,
  ingested_at_utc TIMESTAMP,
  metadata JSON,
  created_at_utc TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE_TRUNC(COALESCE(record_date, DATE(created_at_utc)), MONTH)
CLUSTER BY district_id, district_name, drought_class;

-- ======================================================
-- 2) rainfall_climate
-- ======================================================
CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.${DATASET}.rainfall_climate` (
  doc_id STRING NOT NULL,
  district_id STRING,
  district_name STRING,
  record_date DATE,
  period STRING,
  rainfall_mm FLOAT64,
  rainfall_30d_mean FLOAT64,
  rainfall_30d_total FLOAT64,
  rainfall_status STRING,
  temperature_c FLOAT64,
  evaporation_mm FLOAT64,
  temperature_30d_mean FLOAT64,
  evaporation_30d_mean FLOAT64,
  climatology_mean_mm FLOAT64,
  climatology_temperature_mean FLOAT64,
  climatology_evaporation_mean FLOAT64,
  category_label STRING,
  service_label STRING,
  source_file STRING,
  source STRING,
  extraction_date DATE,
  ingested_at_utc TIMESTAMP,
  metadata JSON,
  created_at_utc TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE_TRUNC(COALESCE(record_date, DATE(created_at_utc)), MONTH)
CLUSTER BY district_id, district_name;

-- ======================================================
-- 3) agriculture_monitoring
-- ======================================================
CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.${DATASET}.agriculture_monitoring` (
  doc_id STRING NOT NULL,
  district_id STRING,
  district_name STRING,
  record_date DATE,
  period STRING,
  crop STRING,
  season STRING,
  area_ha FLOAT64,
  yield_t_ha FLOAT64,
  advisory_priority STRING,
  category_label STRING,
  service_label STRING,
  source_file STRING,
  source STRING,
  extraction_date DATE,
  ingested_at_utc TIMESTAMP,
  metadata JSON,
  created_at_utc TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE_TRUNC(COALESCE(record_date, DATE(created_at_utc)), MONTH)
CLUSTER BY district_id, district_name, crop;

-- ======================================================
-- 4) district_profiles
-- ======================================================
CREATE TABLE IF NOT EXISTS `${PROJECT_ID}.${DATASET}.district_profiles` (
  doc_id STRING NOT NULL,
  district_id STRING NOT NULL,
  district_name STRING,
  profile_type STRING, -- boundary | soil | combined
  soil_region STRING,
  ph FLOAT64,
  clay_pct FLOAT64,
  sand_pct FLOAT64,
  silt_pct FLOAT64,
  soc_g_kg FLOAT64,
  cec_cmol_kg FLOAT64,
  nitrogen_g_kg FLOAT64,
  geometry_wkt STRING,
  geometry_type STRING,
  category_label STRING,
  service_label STRING,
  source_file STRING,
  source STRING,
  extraction_date DATE,
  ingested_at_utc TIMESTAMP,
  metadata JSON,
  created_at_utc TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE_TRUNC(COALESCE(extraction_date, DATE(created_at_utc)), MONTH)
CLUSTER BY district_id, district_name, profile_type;

-- Optional helper views (uncomment if needed)
-- CREATE OR REPLACE VIEW `${PROJECT_ID}.${DATASET}.latest_drought_by_district` AS
-- SELECT * EXCEPT(rn)
-- FROM (
--   SELECT *, ROW_NUMBER() OVER(PARTITION BY district_id ORDER BY record_date DESC, created_at_utc DESC) AS rn
--   FROM `${PROJECT_ID}.${DATASET}.drought_monitoring`
-- )
-- WHERE rn = 1;
