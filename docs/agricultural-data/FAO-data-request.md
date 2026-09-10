# FAO Agricultural Data — Integration Request (El Salvador + Lesotho)

**Branch:** `release/el-salvador-ds-port` (GENIE.AI / AgroGenio)
**Author:** David Forden
**Date:** 2026-06-15
**Status:** Draft — for review before sending to FAO

> **Purpose of this document**
> Part A maps each of the 10 dashboard features to the **exact data we need FAO to serve via API**, framed as **context for AI-driven answers** (the data is ingested by GENIE.AI's RAG system so the assistant can answer farmers' questions with current, localized, citable figures — it is **not** required to mirror the existing chart shapes, which stay as-is).
> Part B lists cross-cutting requirements (geography, frequency, units, formats).
> Part C is the **ready-to-send email to FAO**.

---

## Background (shared with FAO)

GENIE.AI is an open-source, sovereign, Digital Public Good (DPG) RAG framework. The **AgroGenio** deployment for **El Salvador** (and a parallel deployment for **Lesotho**) gives smallholder farmers and extension agents an AI assistant that answers questions about crops, pests, inputs, prices and post-harvest handling.

The dashboard exposes 10 feature areas. Today, two of them are served by **mock data** and eight are served by **World Bank macro indicators used as proxies** (e.g. the "Apiary & Honey" tile currently shows the livestock production index; "Harvest & Storage" shows the rural-population %). These are useful only as placeholders. To make the AI assistant genuinely useful, we need **real, current, country- and market-level data served live from FAO via API**, covering **both El Salvador (ISO3: SLV) and Lesotho (ISO3: LSO)** for 2026.

---

## Part A — Data requirements, by feature

For each feature: the **AI context** the assistant needs, the **data entities**, **geographic granularity**, **temporal granularity / freshness**, **units & currency**, **commodities/items** to cover, and the **likely FAO source(s)**.

Geographic reference:
- **El Salvador** — 14 departments: Ahuachapán, Santa Ana, Sonsonate, Chalatenango, La Libertad, San Salvador, Cuscatlán, La Paz, Cabañas, San Vicente, Usulután, San Miguel, Morazán, La Unión.
- **Lesotho** — 10 districts: Berea, Butha-Buthe, Leribe, Mafeteng, Maseru, Mohale's Hoek, Mokhotlong, Qacha's Nek, Quthing, Thaba-Tseka.

### 1. Crop Health Insights

| Field | Requirement |
|---|---|
| AI context | "How are crops looking in my department/district right now? Is vegetation health improving or stressed vs. normal?" |
| Data entities | NDVI / vegetation condition index, biomass, crop-condition class, anomaly vs. long-term normal (dekadal), Agricultural Stress Index (ASI), crop calendar / phenology |
| Geographic granularity | Per department (SLV) / per district (LSO) — and ideally ADM2 if available |
| Temporal granularity & freshness | **Dekadal (10-day)**, near-real-time; latest dekad + trailing 12–24 months for trend |
| Units | NDVI 0–1; anomaly in % vs. normal; ASI 0–100 |
| Items | Maize, sorghum, beans, coffee, plus general cropland/pasture |
| FAO source(s) | **WaPOR** (dekadal NDVI & biomass, has an API), **FAO ASIS** (Agricultural Stress Index System), **Hand-in-Hand Geospatial Platform** (`data.apps.fao.org`), GIEWS crop prospects |

### 2. Pest Alerts Insights

| Field | Requirement |
|---|---|
| AI context | "Which pests/diseases are active in my area this season, how severe, and what should I do?" |
| Data entities | Pest/disease outbreak records: common + scientific name, severity (high/moderate/low), affected crops, affected geography, first-detected date, seasonal pattern, trend, recommended controls, source/authority |
| Geographic granularity | Per department (SLV) / per district (LSO) |
| Temporal granularity & freshness | Event-based / weekly; active alerts only, with history |
| Units | Severity ordinal; counts by area |
| Items — SLV | Fall Armyworm (*Spodoptera frugiperda*), Coffee Leaf Rust (*Hemileia vastatrix*), Coffee Berry Borer (*Hypothenemus hampei*), Whitefly (*Bemisia tabaci*), Late Blight (*Phytophthora infestans*) |
| Items — LSO | Fall Armyworm, African Armyworm (*Spodoptera exempta*), Brown Locust / African Migratory Locust, Maize Streak Virus, stalk borers (*Busseola fusca*), cutworms, wheat/barley rusts |
| FAO source(s) | **FAMEWS Global Platform** (Fall Armyworm), **FAO DLIS / Locust Watch** (locusts), **EMPRES / NSP** (transboundary plant pests), IPPC. *Note: pest data access is usually via partnership — explicit access request required.* |

### 3. Maize & Grains — market prices

| Field | Requirement |
|---|---|
| AI context | "What is maize/beans/beans/sorghum/rice selling for in my market this week, and is the price rising or falling?" |
| Data entities | Wholesale + retail + farmgate prices, by market; latest value + multi-year time series for trend |
| Geographic granularity | Main market(s) per department (SLV) / per district (LSO) |
| Temporal granularity & freshness | **Weekly or monthly**, current (≤ 1 month lag) + ≥ 5 years history |
| Units & currency | Local currency + USD; per kg, per quintal (100 lb / 45.4 kg), per 50 kg bag |
| Items | White maize, yellow maize, sorghum, rice (paddy & milled), red/black beans, wheat flour |
| FAO source(s) | **GIEWS FPMA** (Food Price Monitoring & Analysis — domestic wholesale/retail), **FAOSTAT Producer Prices (Annual + Monthly)**, **AMIS** (international reference prices) |

### 4. Crop Protection — market prices

| Field | Requirement |
|---|---|
| AI context | "What am I going to pay for the pesticide/fungicide I need, and has it gone up?" |
| Data entities | Input prices for crop-protection products, by active ingredient / product category |
| Geographic granularity | National / per department (SLV) / per district (LSO) |
| Temporal granularity & freshness | Monthly + ≥ 3 years history |
| Units & currency | Local + USD; per litre, per kg, per 50 kg bag |
| Items | Herbicides (glyphosate, atrazine), insecticides (cypermethrin, chlorpyrifos, Bt-based), fungicides (copper, mancozeb, systemic triazoles) |
| FAO source(s) | FAOSTAT has a **Pesticides (use)** domain but **not a price series** — *this is a known gap; request that FAO point us to an input-price monitoring source or partner bulletin (e.g. national MAG/CENTA).* Possibly AMIS/World Bank fertilizer/input indicators as a fallback. |

### 5. Fruits & Vegetables — market prices

| Field | Requirement |
|---|---|
| AI context | "What are tomatoes/peppers/onions worth at market this month?" |
| Data entities | Wholesale + retail prices by market, latest + time series |
| Geographic granularity | Main market(s) per department (SLV) / per district (LSO) |
| Temporal granularity & freshness | Weekly/monthly + ≥ 3 years history |
| Units & currency | Local + USD; per kg, per caja/quintal |
| Items | Tomatoes, sweet peppers, onions, plantain, banana, citrus, papaya, squash (ayote), cucumber (SLV); cabbage, potato, tomato, onion, butternut (LSO) |
| FAO source(s) | **FAOSTAT Producer Prices (Monthly)** for fruits & vegetables; **GIEWS FPMA** (partial); *horticultural retail price data is sparse — flag for FAO/national market information systems.* |

### 6. Livestock — market prices

| Field | Requirement |
|---|---|
| AI context | "What is a live cow / pig / sheep / goat or a dozen eggs selling for, and the trend?" |
| Data entities | Live-animal and meat prices, by market/auction point; egg & milk prices |
| Geographic granularity | Markets / auction points per district (esp. important for LSO) |
| Temporal granularity & freshness | Monthly + ≥ 3 years history |
| Units & currency | Local + USD; per head, per kg liveweight, per kg carcass, per dozen eggs, per litre milk |
| Items — SLV | Cattle, pigs, poultry, eggs, milk |
| Items — LSO | Sheep, goats (incl. wool/mohair), cattle, poultry, eggs — *livestock is central to Lesotho's rural economy* |
| FAO source(s) | **FAOSTAT Producer Prices (livestock & meat)**, GIEWS (limited); *LSO livestock-auction data often held by MAFS/Bureau of Statistics — request routing.* |

### 7. Fertilizer — market prices

| Field | Requirement |
|---|---|
| AI context | "What does urea/DAP/NPK cost this season, and is it a good time to buy?" |
| Data entities | Fertilizer prices by product/grade, retail & wholesale |
| Geographic granularity | National / per department (SLV) / per district (LSO) |
| Temporal granularity & freshness | Monthly + ≥ 3 years history |
| Units & currency | Local + USD; per 50 kg bag, per tonne, per kg of nutrient |
| Items | Urea, DAP, NPK blends, ammonium nitrate, ammonium sulphate, SSP, manure/compost |
| FAO source(s) | **AMIS fertilizers**, **World Bank Pink Sheet** (international, as cross-reference); request national retail fertilizer price series if FAO curates one. |

### 8. Apiary & Honey — market prices

| Field | Requirement |
|---|---|
| AI context | "What can I sell my honey/beeswax for, and how is the market trending?" |
| Data entities | Honey & beeswax prices (and ideally colony health/loss indicators) |
| Geographic granularity | National / per department (SLV) / per district (LSO) |
| Temporal granularity & freshness | Monthly / seasonal + ≥ 3 years history |
| Units & currency | Local + USD; per kg, per litre, per 60 lb drum |
| Items | Raw honey, processed honey, beeswax, propolis |
| FAO source(s) | **FAOSTAT Production/Trade** (honey production volumes & trade values — but not retail prices); *retail honey prices are a gap — request FAO point to national apiculture data.* |

### 9. Aquaculture — market prices

| Field | Requirement |
|---|---|
| AI context | "What is tilapia/shrimp/trout worth, and is demand up or down?" |
| Data entities | Fish & aquaculture prices by species & product form |
| Geographic granularity | National / key markets |
| Temporal granularity & freshness | Monthly + ≥ 3 years history |
| Units & currency | Local + USD; per kg (whole / fillet / head-on) |
| Items — SLV | Tilapia, shrimp (*camarón*), small-scale freshwater fish |
| Items — LSO | Rainbow trout (highland), small-scale freshwater aquaculture |
| FAO source(s) | **FAO FishStatJ / GLOBEFISH** (production/trade & market prices); FPMA (limited). |

### 10. Harvest & Storage — market prices

| Field | Requirement |
|---|---|
| AI context | "How much will I lose if I store vs. sell now, and what does storage cost?" |
| Data entities | Post-harvest loss rates by crop, storage/warehousing costs, grain stock levels, warehouse-receipt prices |
| Geographic granularity | National / per department (SLV) / per district (LSO) |
| Temporal granularity & freshness | Seasonal / annual + multi-year history |
| Units & currency | Loss as % of harvest; storage cost in local + USD per bag/tonne/month; stocks in tonnes |
| Items | Maize, beans, sorghum, rice, wheat |
| FAO source(s) | **FAOSTAT Food Loss** (Food Loss & Waste domain), GIEWS food-balance/stocks data, post-harvest loss studies. *(This tile is genuinely post-harvest economics rather than a "price" — frame accordingly in the UI copy if desired, but the data need is as above.)* |

---

## Part B — Cross-cutting requirements (apply to all 10)

- **Two countries, explicitly:** El Salvador (SLV) and Lesotho (LSO). Please confirm coverage for **both**, including any items FAO does not currently track for one of them.
- **Geographic codes:** ADM1 (departments/districts) and ADM2 (municipalities/community councils) using **FAO GAUL** or ISO/UN codes, plus market identifiers, so the AI can localize answers.
- **Frequency & freshness metadata:** every record must carry `last_updated`/vintage so the assistant can say "as of <date>" and never present stale data as current. Target: market prices ≤ 1 month lag; crop health dekadal; pest alerts event-driven/weekly.
- **Units & currency:** harmonized, machine-readable, with both local currency and USD where possible; unit clearly labeled (kg, quintal, 50 kg bag, head, etc.).
- **Time series depth:** ≥ 5 years for prices/trends so the AI can reason about seasonality.
- **Multilingual labels:** EN + ES for SLV; EN + Sesotho (Sesotho labels best-effort) for LSO.
- **Machine-readable delivery:** JSON (REST), plus bulk CSV/Parquet for backfill. We prefer **OpenAPI/Swagger** specs.
- **Citation/attribution:** each dataset needs a stable source label and license so we can attribute correctly in the UI and in AI answers.

---

## Part C — Email to FAO (ready to send)

> Replace the bracketed `[ ]` fields before sending. Suggested routing is in the section after the email.

---

**Subject:** Request for API access to FAO agricultural data services — live 2026 market prices, crop health and pest alerts for El Salvador and Lesotho (GENIE.AI / UN ITU digital public good)

**To:**
- **FAO Representation in Lesotho** — `FAO-LS@fao.org` (+266 2222 8000, UN House, 13 UN Road, Maseru) — *primary entry point for the Lesotho use case; they can route to MAFSN and FAO HQ data teams.*
- **FAO Representation in El Salvador** — via `https://www.fao.org/el-salvador` / country profile `https://www.fao.org/countryprofiles/index/en/?iso3=SLV` (country code SV).
- **FAO Statistics Division (ESS) / FAOSTAT API** — via the FAOSTAT "Contact" link on `https://www.fao.org/faostat/en/` and the new API Developer Portal.
- **GIEWS — Food Price Monitoring & Analysis (FPMA)** — via the "Contact Us" link on `https://www.fao.org/giews/food-prices/home/en/`.

**Cc:**
- **CENTA (El Salvador)** — `oir@centa.gob.sv` and `comercializacion@centa.gob.sv` (+503 2397-2200 ext. 243) — El Salvador's national agricultural technology centre; runs **AGROCENTA** input distribution.
- **MAG El Salvador — DGEA / Área de precios de mercado** — via `https://www.mag.gob.sv/servicios/estadisticas-agropecuarias/` — runs the **SIMAGRO** price database and monthly price bulletins.
- **MAFSN Lesotho** (Ministry of Agriculture, Food Security & Nutrition) — +266 22322741, `https://www.gov.ls/government-ministries/agriculture-food-security-and-nutrition/`.
- **WFP VAM** (Economic Explorer) — `https://dataviz.vam.wfp.org/economic/overview` — key complementary market-price source for Lesotho.
- **CABI** — `plantwise@cabi.org`, `compend@cabi.org` — pest/disease data (Fall Armyworm).

Dear colleagues,

I am writing on behalf of the **GENIE.AI** project — an open-source, sovereign, **Digital Public Good (DPG)** Retrieval-Augmented Generation (RAG) framework developed under the **United Nations International Telecommunication Union (ITU)**. GENIE.AI deploys an AI assistant for smallholder farmers and agricultural extension agents, currently live for **El Salvador** (branded *AgroGenio*) with a parallel deployment planned for **Lesotho**.

Our research on data availability for these countries identified **FAO** as the authoritative source for the agricultural data our users need. We are therefore requesting **programmatic API access** to FAO's data services so we can serve **live, online and up-to-date 2026 data** to the assistant, for **both El Salvador and Lesotho**.

### What we are building and how the data is used

The assistant answers farmers' questions in natural language (English and Spanish for El Salvador; English and Sesotho for Lesotho). The FAO data is consumed as **real-time context for AI-generated answers** — e.g. *"What is white maize selling for at San Salvador central market this week, and is the price rising?"*, *"Which pests are active in Usulután / Maseru this season?"*, or *"How are crop conditions in my district right now?"* The data is ingested by our RAG pipeline and cited back to the user with FAO attribution.

The assistant covers **ten feature areas**, which map to the following data needs:

1. **Crop Health** — NDVI / vegetation condition, biomass, Agricultural Stress Index, crop calendars (dekadal). → *WaPOR, ASIS, Hand-in-Hand Geospatial Platform.*
2. **Pest & Disease Alerts** — outbreak records, severity, affected crops/geography, controls. → *FAMEWS (Fall Armyworm), DLIS / Locust Watch, EMPRES/NSP.*
3. **Maize & Grains prices** — wholesale/retail prices of maize, sorghum, rice, beans. → *GIEWS FPMA, FAOSTAT Producer Prices (Annual + Monthly), AMIS.*
4. **Crop Protection prices** — pesticide/herbicide/fungicide input prices.
5. **Fruits & Vegetables prices** — wholesale/retail horticultural prices.
6. **Livestock prices** — live-animal and meat prices, eggs, milk.
7. **Fertilizer prices** — urea, DAP, NPK, etc. → *AMIS fertilizers.*
8. **Apiary & Honey prices** — honey and beeswax prices.
9. **Aquaculture prices** — tilapia/shrimp (El Salvador) and trout (Lesotho). → *FishStatJ / GLOBEFISH.*
10. **Harvest & Storage** — post-harvest loss rates, storage costs, grain stocks. → *FAOSTAT Food Loss, GIEWS food-balance.*

I have attached a detailed, feature-by-feature data specification covering commodities, geographic granularity (department-level for El Salvador; district-level for Lesotho), required frequency, units and currencies.

### What we need from FAO

To integrate this data into production for the El Salvador and Lesotho use cases, we would be grateful for:

1. **API access for the services above**, covering **El Salvador (SLV) and Lesotho (LSO)** specifically. We are aware of the **FAOSTAT API Developer Portal** and the bulk-download option, but the more granular services — in particular the **GIEWS FPMA** domestic wholesale/retail price data, **WaPOR**, the **Hand-in-Hand Geospatial Platform**, **AMIS**, and the pest-surveillance platforms (**FAMEWS**, **DLIS**, **EMPRES**) — do not appear to have publicly documented REST endpoints. We would like to request access where it exists, and to discuss what is possible where it does not.

2. **API keys and registration** — the process for obtaining API keys/credentials for each service, including any application form, approval workflow, and lead time.

3. **Technical specifications** — OpenAPI/Swagger documentation, base URLs and endpoint list, authentication method (API key / OAuth / bearer token), supported query parameters (country, market, commodity, date range, ADM1/ADM2 geography via GAUL codes), response formats (JSON/CSV), and pagination conventions.

4. **Operational details** — rate limits and quotas, data-refresh frequency and freshness (target: market prices ≤ 1 month lag; crop health dekadal; pest alerts event-driven/weekly), historical depth available (ideally ≥ 5 years for trend analysis), service-level expectations, and any sandbox/test environment with sample data and test keys.

5. **Licensing and attribution** — the terms of use, licensing, and required attribution for each dataset, so we can comply fully and credit FAO correctly both in the UI and inside AI-generated answers.

6. **Coverage confirmation** — confirmation of which of the ten data areas are available for **each** country (El Salvador and Lesotho), and identification of any gaps — for example crop-protection input prices, horticultural prices, honey retail prices and livestock-auction data, which we understand may be sparser. Where FAO does not hold a series directly, we would value being pointed to the authoritative national source (e.g. El Salvador's MAG/CENTA, or Lesotho's MAFS / Bureau of Statistics) that FAO may already partner with.

7. **A technical point of contact** at FAO for onboarding and integration support.

### Complementary sources we have already identified (and where we would value FAO's help)

In parallel with FAO data, we have identified the following authoritative national and partner sources, and we would be grateful for FAO's guidance on how best to combine them with FAO datasets (or to be routed to the right unit where FAO already cooperates with them):

- **El Salvador — CENTA** (`www.centa.gob.sv`; `comercializacion@centa.gob.sv`, `oir@centa.gob.sv`). CENTA's **AGROCENTA** programme distributes fertilizers and crop-protection inputs at subsidized prices — a direct source for our **Crop Protection** and **Fertilizer** tiles (features 4 and 7), where FAO's own series are thin.
- **El Salvador — MAG / DGEA SIMAGRO** (`www.mag.gob.sv/servicios/estadisticas-agropecuarias`). SIMAGRO publishes monthly wholesale price bulletins (notably from the **La Tiendona** central market in San Salvador) — relevant to features 3, 5 and 6.
- **Lesotho — Ministry of Agriculture, Food Security & Nutrition (MAFSN)** and the **Lesotho Bureau of Statistics (BOS)** (`www.bos.gov.ls`) — the national authorities for agricultural and price statistics, including CPI and food-price series.
- **WFP VAM Economic Explorer** (`dataviz.vam.wfp.org/economic/overview`, with a Lesotho-specific view and bulk download on the Humanitarian Data Exchange) — a strong, machine-readable source of Lesotho staple-food market prices that could complement FAO FPMA coverage.
- **FEWS NET** (`fews.net`) — regional market price and food-security analysis for both Central America and Southern Africa.
- **CABI** (`plantwise@cabi.org`, Invasive Species Compendium `compend@cabi.org`) — open-access pest and disease knowledge, including Fall Armyworm distribution and management, to enrich feature 2.

Where FAO already aggregates or partners with any of the above, a single FAO-served feed would be ideal; where it does not, we are happy to ingest the national/partner feeds directly and would value FAO's endorsement or introduction.

### Timeline and nature of use

GENIE.AI is a **non-commercial, public-sector, open-source DPG**. We aim to bring the El Salvador assistant onto live FAO data during **2026**, with Lesotho following shortly after. Data will be used to serve smallholder farmers and government extension services; FAO will be credited as the data source throughout.

We would be very glad to schedule a short call to walk through the integration and the attached specification, and to sign any data-sharing agreement or MoU that FAO requires.

Thank you for considering this request. FAO's data is what will make this assistant genuinely useful to farmers in the field, and we would be proud to attribute it correctly and to support FAO's mission of food security.

With kind regards,

**David Forden**
[Title / Role]
GENIE.AI — UN International Telecommunication Union (ITU)
Email: [your.email@itu.int]
Phone: [+…]
Project: https://opensource.unicc.org/un/itu/genie-ai

*Attachment: GENIE-AI-FAO-data-specification.pdf (the table in Part A above)*

---

### Contacts, portals & complementary data sources (for routing the request)

> Confirmed email addresses are marked ✅; portal/contact-form routes are marked 🌐.

#### FAO country offices (recommended primary entry points)

| Country | Contact | Notes |
|---|---|---|
| **Lesotho** | ✅ `FAO-LS@fao.org` · +266 2222 8000 · UN House, 13 UN Road, Maseru · 🌐 `https://www.fao.org/lesotho/en` | Route via the FAO Representative (FAOR); ask to be connected to the MAFSN data/M&E unit. |
| **El Salvador** | 🌐 `https://www.fao.org/el-salvador` and country profile `https://www.fao.org/countryprofiles/index/en/?iso3=SLV` | Country code SV (e.g. grievance mailbox `FAOSV-QUEJAS@fao.org` confirms the SV convention). Request the FAOR's office data focal point. |

#### FAO HQ data services (route by feature)

| Service | Portal / contact | Feature |
|---|---|---|
| **FAOSTAT / Statistics (ESS)** | 🌐 API Developer Portal + "Contact" on `https://www.fao.org/faostat/en/`; bulk download needs no login | 3, 5, 6, 8, 10 |
| **GIEWS FPMA** (domestic wholesale/retail) | 🌐 "Contact Us" on `https://www.fao.org/giews/food-prices/home/en/`; data via FPMA Tool at `https://www.fao.org/prices/en` | 3, 5, 6 |
| **WaPOR** (NDVI/biomass, has API) | 🌐 `https://www.fao.org/in-action/remote-sensing-for-water-productivity` | 1 |
| **ASIS** (Agricultural Stress Index) | 🌐 via GIEWS | 1 |
| **Hand-in-Hand Geospatial Platform** | 🌐 `https://data.apps.fao.org` | 1 |
| **AMIS** (international prices + fertilizers) | 🌐 `https://www.amis-outlook.org` | 3, 7 |
| **FAMEWS / DLIS / EMPRES-NSP** (pests) | 🌐 `https://www.fao.org/fall-armyworm/en`, `https://www.fao.org/ag/locusts/` — *partnership-based access* | 2 |
| **GLOBEFISH / FishStatJ** | 🌐 `https://www.fao.org/fishery/en` | 9 |
| **FAO licensing / commercial use** | ✅ `publications-sales@fao.org` (rights & licensing enquiries) | All — terms/attribution |

#### El Salvador — national sources (complementary)

| Source | Contact | Feature |
|---|---|---|
| **CENTA** | ✅ `comercializacion@centa.gob.sv`, ✅ `oir@centa.gob.sv` · +503 2397-2200 ext. 243 · `https://www.centa.gob.sv` | 4, 7 (AGROCENTA input prices), 1, 2 (research/transfer) |
| **MAG / DGEA — SIMAGRO** | 🌐 `https://www.mag.gob.sv/servicios/estadisticas-agropecuarias/` (monthly price bulletins, La Tiendona market) | 3, 5, 6 |

#### Lesotho — national sources (complementary)

| Source | Contact | Feature |
|---|---|---|
| **MAFSN** | +266 22322741 · `https://www.gov.ls/government-ministries/agriculture-food-security-and-nutrition/` | 1, 2, 6 (livestock/auctions) |
| **Lesotho Bureau of Statistics (BOS)** | 🌐 `https://www.bos.gov.ls/Publications.htm` (Agriculture & Food Security; Foreign Trade & Price Statistics) | 3, 5, 6, 10 |
| **WFP VAM Economic Explorer** | 🌐 `https://dataviz.vam.wfp.org/economic/overview` (Lesotho view + HDX bulk CSV) | 3, 5 |

#### International — partner / cross-reference sources

| Source | Contact | Feature |
|---|---|---|
| **CABI** (pests & invasives) | ✅ `plantwise@cabi.org`, ✅ `compend@cabi.org` | 2 |
| **FEWS NET** | 🌐 `https://fews.net` (Central America & Caribbean; Southern Africa) | 3, 5 |
| **World Bank Pink Sheet** | 🌐 `https://www.worldbank.org/commodities` | 7 (fertilizer cross-ref) |
| **WOAH WAHIS** (animal disease) | 🌐 `https://wahis.woah.org` | 2, 6 (livestock disease) |

> **Practical tip:** the fastest concrete inroads are (1) the **FAO Lesotho office** at `FAO-LS@fao.org` (confirmed, staffed, can broker MAFSN + HQ), and (2) **CENTA** in El Salvador (`comercializacion@centa.gob.sv`) for the input-price tiles where FAO itself has no series. GIEWS/FPMA and FAOSTAT are best approached via their portal contact links and the API Developer Portal rather than a generic mailbox.

---

## Appendix — FAO services mapped to the 10 features

| # | Feature | Primary FAO service | API documented? |
|---|---|---|---|
| 1 | Crop Health | WaPOR, ASIS, Hand-in-Hand Geospatial Platform | WaPOR: yes (API exists); HiH: partial |
| 2 | Pest Alerts | FAMEWS, DLIS/Locust Watch, EMPRES/NSP | No public API — request access |
| 3 | Maize & Grains prices | GIEWS FPMA, FAOSTAT Producer Prices (PP) | FAOSTAT: yes; FPMA: **no public API** — request |
| 4 | Crop Protection prices | FAOSTAT Pesticides (use only) | **No price series** — request/gap |
| 5 | Fruits & Vegetables prices | FAOSTAT Producer Prices (Monthly) | Partial; sparse horticulture |
| 6 | Livestock prices | FAOSTAT Producer Prices (livestock/meat) | Partial; LSO auctions via MAFS |
| 7 | Fertilizer prices | AMIS fertilizers | Partial; cross-ref World Bank |
| 8 | Apiary & Honey prices | FAOSTAT Production/Trade (volumes) | **No retail price series** — gap |
| 9 | Aquaculture prices | FishStatJ / GLOBEFISH | Partial market prices |
| 10 | Harvest & Storage | FAOSTAT Food Loss, GIEWS | Partial |
