# MEWA Potato Profile Enrichment Plan

## Goal

Refine the potato profile so the **long-term pipeline** can use:

- `Copernicus` for district-level seasonal climate outlook
- `bamis_metadata.json` for deterministic potato season, stage, warning, and disease context
- existing RAG memory only as a second-pass explainer, not as the scoring engine

This document focuses on:

- crop: `potato`
- geography: district level
- pipeline: long-term / seasonal planning
- no Prithvi for now

---

## What Changed In `bamis_metadata.json`

The updated potato slice is now strong enough to support a real stage-aware long-term plan.

After reading only the potato subset:

- there are `382` potato records total
- `210` are weekly stage/weather rows
- `172` are knowledge rows with `category`, `name`, `description`
- weekly rows now include:
  - `week_number`
  - `month`
  - `crop_stage`
  - `rainfall_mm`
  - `max_temp_c`
  - `min_temp_c`
  - `rh_max_percent`
  - `rh_min_percent`
- knowledge rows now include three useful categories:
  - `Favorable Condition`
  - `Pest/Disease`
  - `Weather Warning`

This is a big improvement over the earlier version because we no longer need to guess the
potato season or stage progression from RAG at runtime.

---

## What The Updated Potato Metadata Gives Us

### 1. A District-Specific Stage Calendar

The weekly rows now contain explicit stage labels such as:

- `Spouting`
- `Seedling`
- `vegetative growth`
- `Tuber set/initiation`
- `Tuber bulking/development`
- `Maturity`
- `Harvesting`

That means `bamis_metadata.json` can now provide the deterministic answer to:

- what stage potato is expected to be in for a district and week
- whether a user's target time falls inside the modeled potato season
- which stage-specific weather expectations should be used

### 2. A District-Specific Weekly Climate Baseline

The weekly rows also provide observed or reference weather conditions for potato weeks in
each district.

That baseline can be used to answer:

- what is normal rainfall for potato in week 48 in Dhaka
- what is normal min/max temperature during tuber initiation in Bogura
- whether Copernicus is projecting a month that is warmer, drier, or wetter than the
  potato-season baseline

### 3. General Agronomic Rules

The `Favorable Condition` rows contain items like:

- `General Weather Requirements`

These can feed the deterministic crop profile with ideal ranges and preferred conditions.

### 4. Weather Warning Rules

The `Weather Warning` rows contain explicit warning-style thresholds and patterns such as:

- `Rainfall`
- `Duration of wet spell`
- `Cloudy Weather`
- `Drought`
- `Hail storm`

These can be turned into deterministic risk rules where the underlying variable is
available.

### 5. Pest And Disease Context

The `Pest/Disease` rows contain named agronomic risk rules such as:

- `Late Blight`
- `Bacterial wilt`
- `Fusarium wilt`
- `Potato Leaf Roll Virus`
- `Termite`
- `Potato Wire Worm`

These are useful, but not all of them are immediately Copernicus-ready.

---

## What Still Needs Careful Handling

The metadata is much better, but it still needs a normalization pass before we trust it as
deterministic input.

### OCR / Parsing Noise

There are still noisy variants such as:

- `Harves ting` vs `Harvesting`
- `vegetative growth` vs title-cased variants
- `Te rmite` vs `Termite`
- `Potato Leaf Roll` + `Virus` split into separate rows in some districts
- `Duration of wet` + `spell` split into separate rows in some districts

So the profile builder must normalize:

- stage names
- warning names
- disease names
- duplicate / split rows

### Copernicus Variable Mismatch

The blueprint in [MEWA_report.md](/home/athena/Documents/mewa_analysis/MEWA_report.md:710)
expects long-term data like:

- `2m_temperature`
- `total_precipitation`
- `10m_wind_speed`
- `soil_moisture`

But the potato metadata includes:

- weekly rainfall
- weekly min/max temperature
- weekly humidity
- disease descriptions that sometimes require:
  - humidity
  - fog
  - cloudiness
  - soil temperature
  - wet-spell duration

So not every potato rule should be scored from Copernicus v1.

---

## New Design Direction

The earlier version of this plan treated `bamis_metadata.json` mostly as a baseline table.
That is no longer enough.

The updated plan should treat it as the backbone of the long-term potato profile.

The deterministic logic should now be:

1. Resolve the target district.
2. Resolve the user time window.
3. Map that time window to the potato stage calendar from `bamis_metadata.json`.
4. Fetch Copernicus for the district and relevant month(s).
5. Compare Copernicus against:
   - stage-specific potato profile rules
   - district potato weekly baseline
   - general favorable-condition ranges
   - weather-warning thresholds where variable support exists
6. Produce a deterministic seasonal assessment.
7. Build a focused RAG query from that assessment.
8. Use RAG only to retrieve explanation, not to decide the score.

So the core comparison is:

- **Copernicus climate outlook**
- versus
- **potato stage + potato rules + district baseline**

---

## Recommended `potato_profile_v2.json` Structure

The current `example_crop_profile.json` should become a seed input, not the final runtime
shape.

Recommended structure:

```json
{
  "crop": "potato",
  "region": "dhaka",
  "version": "v2",
  "source_files": [
    "example_crop_profile.json",
    "bamis_metadata.json"
  ],
  "stage_calendar": [],
  "weekly_stage_baseline": [],
  "seasonal_rules": {},
  "general_requirements": {},
  "weather_warnings": {},
  "disease_rules": {},
  "rag_hooks": {},
  "normalization_notes": []
}
```

### 1. `stage_calendar`

This should come primarily from the weekly potato rows.

Example:

```json
[
  { "week_number": 42, "month": "October", "stage": "Spouting" },
  { "week_number": 43, "month": "October", "stage": "Seedling" },
  { "week_number": 45, "month": "November", "stage": "Vegetative Growth" },
  { "week_number": 48, "month": "November", "stage": "Tuber Set/Initiation" },
  { "week_number": 51, "month": "December", "stage": "Tuber Bulking/Development" },
  { "week_number": 2, "month": "January", "stage": "Maturity" },
  { "week_number": 4, "month": "January", "stage": "Harvesting" }
]
```

This becomes the deterministic runtime source for stage lookup.

### 2. `weekly_stage_baseline`

This should preserve the district potato weekly weather values.

Example:

```json
[
  {
    "week_number": 48,
    "month": "November",
    "stage": "Tuber Set/Initiation",
    "rainfall_mm": 4.5,
    "max_temp_c": 28.3,
    "min_temp_c": 16.1,
    "rh_max_percent": 94.3,
    "rh_min_percent": 46.3
  }
]
```

This lets us compute district-normal expectations by stage and by month.

### 3. `general_requirements`

This should parse rows like `General Weather Requirements` into structured agronomic ranges.

Likely fields:

- ideal day temperature
- ideal night temperature
- ideal RH
- ideal soil temperature
- seasonal rainfall / water requirement

This section becomes the source of ideal suitability logic.

### 4. `weather_warnings`

This should parse warning rows into normalized threshold rules, for example:

- rainfall medium / critical
- drought duration
- wind threshold
- min/max temperature warning conditions

If a row is not machine-parseable, keep it as `rag_only` until normalized.

### 5. `disease_rules`

This should preserve named disease triggers, but each rule must carry a support flag:

- `copernicus_ready`
- `copernicus_partial`
- `rag_only`
- `not_evaluable_yet`

Examples:

- `Late Blight` is probably `copernicus_partial` unless humidity is available in the
  normalized seasonal feed
- `Potato Wire Worm` is `not_evaluable_yet` unless soil temperature exists
- `Termite` is `rag_only` or `not_evaluable_yet` if fog/cloudiness is unavailable

### 6. `rag_hooks`

This is where we store search hints for the second-pass retrieval step.

Example:

```json
{
  "keywords": [
    "potato",
    "tuber initiation",
    "late blight",
    "heat stress",
    "irrigation"
  ]
}
```

---

## Long-Term Pipeline Design

This is the refined long-term pipeline for potato.

### Step 1. Normalize Potato Metadata

Build a small metadata normalizer that:

- canonicalizes stage labels
- merges split names like `Potato Leaf Roll` + `Virus`
- merges split warnings like `Duration of wet` + `spell`
- standardizes OCR noise such as `Te rmite`
- records source row references and normalization notes

This step is required before we treat the metadata as deterministic.

### Step 2. Build District Potato Profiles

For each district, generate one structured profile in `crop_profiles`.

Example key:

- `potato__dhaka`

This profile should be built from:

- the current `example_crop_profile.json`
- the normalized potato rows from `bamis_metadata.json`

### Step 3. Fetch And Normalize Copernicus

For each district, fetch Copernicus and store it in `seasonal_forecasts`.

Example key:

- `dhaka__copernicus__long`

Normalized fields should include:

- issue date
- valid month range
- temperature
- precipitation
- wind
- soil moisture if available

### Step 4. Resolve The User's Target Window

For a query like:

- "what about in one month?"
- "how will December look for potato in Dhaka?"
- "will tuber initiation be favorable this season?"

the system should resolve:

- district
- target date or month window
- overlapping potato weeks
- expected stage(s)

This step should use the structured `stage_calendar`, not RAG.

### Step 5. Build A Stage-Aware Seasonal Comparison

This is the core long-term comparison.

For the relevant district and window, compare Copernicus against:

- `general_requirements`
- `seasonal_rules`
- `weather_warnings`
- `weekly_stage_baseline`

This yields:

- suitability vs ideal conditions
- deviation vs district-normal potato season
- triggered warning conditions
- supported disease/pest signals

### Step 6. Produce A Deterministic Seasonal Assessment

Write the result to `seasonal_assessments`.

Example key:

- `dhaka__potato__2026_12`

Suggested fields:

- district
- target month / range
- overlapping weeks
- expected stage(s)
- copernicus values used
- baseline values used
- suitability result
- triggered warnings
- triggered disease rules
- unsupported rules
- deterministic reasoning summary
- rag query payload

### Step 7. Use RAG As A Retrieval Layer

Only after the deterministic assessment is produced should we query RAG.

The RAG query should be generated from structured context like:

- crop = potato
- district = Dhaka
- stage = Tuber Set/Initiation
- month = December
- triggers = low rainfall, high temperature
- question type = planning / disease / management

This keeps RAG narrow and much safer.

---

## How `bamis_metadata.json` Enriches `example_crop_profile.json`

The merge should work like this.

### Keep From `example_crop_profile.json`

- explicit existing thresholds
- the current disease list
- manually curated structure
- anything already cleaned and trusted

### Add From `bamis_metadata.json`

- district-specific stage calendar
- district-specific weekly weather baseline
- general agronomic requirements
- normalized weather-warning rules
- additional disease entries and descriptions
- district-specific seasonal timing

### Let `bamis_metadata.json` Override Only Where It Is Stronger

For long-term planning, the metadata is now stronger than the example file for:

- stage timing
- district-specific season structure
- warning categories
- disease catalog completeness

But the example file may still be stronger for:

- already cleaned rule structure
- manually curated threshold format
- support annotations

So the merge should be additive, not destructive.

---

## Deterministic vs RAG Split

This remains the core principle.

### Deterministic Layer Decides

It should decide:

- whether the target period is inside the potato season
- what stage applies
- what baseline weeks apply
- how Copernicus compares to stage-specific and district-specific expectations
- which supported warnings and disease rules are triggered

### RAG Layer Explains

It should provide:

- agronomic explanation
- management actions
- disease control guidance
- narrative explanation of why a stage is sensitive
- additional contextual details already ingested into memory

This keeps the system robust:

- profile + metadata drive the score
- RAG enriches the answer

---

## Recommended Rule Support Strategy

Not every potato rule should be treated the same.

### `copernicus_ready`

Use when the rule can be directly scored from normalized Copernicus variables.

Examples:

- monthly temperature suitability
- monthly precipitation deviation
- wind threshold if wind is normalized
- soil moisture if available

### `copernicus_partial`

Use when the rule is partly supported but still missing one variable.

Examples:

- `Late Blight` if temperature is available but humidity is not
- drought / wet-spell style rules if monthly totals exist but duration does not

### `rag_only`

Use when the rule is valuable for explanation but not yet deterministic.

Examples:

- cloudiness or fog-driven pest notes
- nuanced narrative warnings

### `not_evaluable_yet`

Use when the required variables are missing.

Examples:

- soil temperature rules without soil temperature
- wet-spell duration without daily data

---

## ArangoDB Collections For The Long-Term Potato Flow

### `crop_profiles`

One structured profile per crop and district.

Example key:

- `potato__dhaka`

### `seasonal_forecasts`

Normalized Copernicus by district.

Example key:

- `dhaka__copernicus__long`

### `seasonal_assessments`

Deterministic seasonal outputs.

Example key:

- `dhaka__potato__2026_12`

Optional later:

### `seasonal_reports`

A farmer-facing archive of rendered advisories, if you want persistent long-term report
history separate from machine assessment output.

---

## First Practical Long-Term Version

The minimum useful v1 is:

- district-level only
- potato only
- Copernicus only for climate input
- no Prithvi
- stage resolution from normalized potato metadata
- deterministic comparison against:
  - stage calendar
  - weekly district baseline
  - general requirements
  - warning thresholds
- RAG only for explanation

That version is already much stronger than the old plan because the updated metadata now
contains the pieces we were missing: explicit stage timing and structured agronomic context.

---

## Suggested Next Deliverables

1. Normalize the potato rows from `bamis_metadata.json`
2. Define the exact `potato_profile_v2.json` schema
3. Build the `crop_profiles` document format for ArangoDB
4. Define the `seasonal_assessments` document format
5. Implement the deterministic query-builder payload for RAG
6. Build a small profile-builder that merges:
   - `example_crop_profile.json`
   - normalized potato metadata
