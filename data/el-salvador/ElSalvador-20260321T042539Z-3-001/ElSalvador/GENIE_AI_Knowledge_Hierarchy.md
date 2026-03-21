# GENIE.AI Knowledge Hierarchy Design
## Agricultural Extension Knowledge Base - El Salvador (CENTA)

---

## 1. Summary

This document defines the knowledge hierarchy for ingesting El Salvador's agricultural
extension library into GENIE.AI. The corpus contains **229 documents** (228 PDFs,
1 DOCX) from CENTA (Centro Nacional de Tecnologia Agropecuaria y Forestal) and
partner organizations, covering crop cultivation, animal production, pest management,
and sustainable farming practices.

**Target users:** Farmers, agricultural extension workers, and agronomists in El Salvador.

**Primary language of source documents:** Spanish (ES).


---

## 2. Domain Analysis 

### 2.1 Information Landscape

```
                    ┌─────────────────────────────────────────────┐
                    │          TERTIARY (Peripheral)              │
                    │  Equipment manuals, product brochures,      │
                    │  weather forecasts, agroforestry refs,      │
                    │  research papers, market/supplier info      │
                    │                                             │
                    │    ┌───────────────────────────────────┐    │
                    │    │      SECONDARY (Supporting)       │    │
                    │    │  Pest & disease bulletins,        │    │
                    │    │  variety/breed bulletins,         │    │
                    │    │  fertilization guides,            │    │
                    │    │  post-harvest handling,           │    │
                    │    │  animal health & disease,         │    │
                    │    │  seed production guides           │    │
                    │    │                                   │    │
                    │    │    ┌───────────────────────┐      │    │
                    │    │    │   PRIMARY (Core)      │      │    │
                    │    │    │                       │      │    │
                    │    │    │  CENTA crop guides    │      │    │
                    │    │    │  Animal production    │      │    │
                    │    │    │  manuals              │      │    │
                    │    │    │  Beekeeping manuals   │      │    │
                    │    │    │  Tilapia/aquaculture  │      │    │
                    │    │    │  manuals              │      │    │
                    │    │    │  Pasture/forage       │      │    │
                    │    │    │  variety guides       │      │    │
                    │    │    └───────────────────────┘      │    │
                    │    └───────────────────────────────────┘    │
                    └─────────────────────────────────────────────┘
```

### 2.2 Data Tier Definitions

**PRIMARY Data (Core) - 56 documents**
The essential cultivation/production guides that directly answer the most frequent
farmer queries: "How do I grow [crop]?" or "How do I raise [animal]?"

- CENTA technical guides for each grain crop (corn, beans, rice, sorghum)
- CENTA technical guides for each fruit tree (avocado, mango, plantain, papaya, etc.)
- CENTA technical guides for each vegetable (tomato, pepper, onion, cabbage, etc.)
- Beekeeping manuals and apiary management guides
- Broiler/laying hen management manuals
- Tilapia cultivation and reproduction manuals
- Pig farming manuals
- Pasture and forage variety bulletins

**SECONDARY Data (Supporting) - 147 documents**
Data that provides necessary context, directly referenced by or supporting the
primary guides. Essential for complete answers.

- Periodic pest and disease alert bulletins (grain, fruit, vegetable, livestock)
- Crop variety bulletins (bean, corn, sorghum, rice varieties)
- Fertilization and soil health recommendations
- Disease identification and control guides
- Post-harvest handling and processing guides
- Seasonal planting and harvest recommendations
- Bee health, disease prevention, and honey harvest guides
- Aquaculture pond/water quality management
- Livestock health and seasonal recommendation bulletins

**TERTIARY Data (Peripheral) - 26 documents**
Supplementary information that enhances understanding but is not essential for
every query. Grouped under broad reference labels.

- Grain cleaner-classifier equipment manuals (4 duplicates)
- Fungicide/pesticide product data sheets and brochures
- Agroforestry system reference documents
- Biochar, vermiculture, and microorganism reproduction guides
- Weather/extreme event forecasts
- Alternative foods for gluten-allergic people
- Research papers (e.g., native corn variety morphology study)
- General brochures (CENTA basic grains brochure)

---

## 3. Two-Level Labeling System

### 3.1 Design Rationale

The hierarchy follows GENIE.AI principles:
- **User-Centric Naming:** Labels reflect farmer intent, not CENTA's internal structure.
- **MECE:** Categories are mutually exclusive with minimal overlap.
- **Strict 2-Level Limit:** No third-level nesting.
- **Unique Service Names:** No service label is repeated across categories.
- **Tier-Based Strategy:** Primary data has dedicated labels; secondary data has its
  own labels; tertiary data is grouped into broad "Reference" labels.

### 3.2 Knowledge Tree (GENIE.AI Sidebar Layout)

Each top-level node is a **Category (Level 1)**; each child is a **Service/Topic (Level 2)**.

```
Agricultural Extension Knowledge Base (El Salvador - CENTA)
│
├── Grain Crop Cultivation                              [7 services, 70 docs]
│   ├── Corn Planting and Variety Guide                       (12 docs) [P0]
│   ├── Bean Planting and Variety Guide                       (12 docs) [P0]
│   ├── Rice Planting and Variety Guide                        (6 docs) [P0]
│   ├── Sorghum Planting and Variety Guide                     (7 docs) [P0]
│   ├── Grain Pest and Disease Control                        (24 docs) [P1]
│   ├── Grain Fertilization and Soil Health                   (11 docs) [P1]
│   └── Grain Storage and Post-Harvest                         (5 docs) [P2]
│
├── Fruit Tree Cultivation                              [4 services, 33 docs]
│   ├── Fruit Cultivation Guides                               (9 docs) [P0]
│   ├── Fruit Pest Alerts and Recommendations                 (15 docs) [P1]
│   ├── Fruit Post-Harvest and Processing                      (5 docs) [P2]
│   └── Cacao and Chocolate Production                         (4 docs) [P1]
│
├── Vegetable Cultivation                               [3 services, 25 docs]
│   ├── Vegetable Cultivation Guides                          (12 docs) [P0]
│   ├── Vegetable Pest and Disease Alerts                      (6 docs) [P1]
│   └── Vegetable Seed Production                              (7 docs) [P2]
│
├── Beekeeping and Honey                                [3 services, 22 docs]
│   ├── Apiary Management and Honey Harvest                   (10 docs) [P0]
│   ├── Bee Health and Disease Prevention                     (10 docs) [P1]
│   └── Honey Quality and Regulations                          (2 docs) [P2]
│
├── Poultry Production                                  [2 services, 14 docs]
│   ├── Broiler Chicken Management                            (10 docs) [P0]
│   └── Laying Hen and Egg Production                          (4 docs) [P1]
│
├── Aquaculture and Fisheries                           [4 services, 13 docs]
│   ├── Tilapia Farming Guide                                  (4 docs) [P1]
│   ├── Shrimp Farm Setup and Operations                       (2 docs) [P2]
│   ├── Pond and Water Quality Management                      (5 docs) [P1]
│   └── Aquaculture Climate and Seasonal Alerts                (2 docs) [P2]
│
├── Livestock and Forage                                [4 services, 21 docs]
│   ├── Pasture and Cut Grass Varieties                        (3 docs) [P1]
│   ├── Livestock Pest and Health Bulletins                     (8 docs) [P2]
│   ├── Livestock Seasonal Recommendations                     (8 docs) [P2]
│   └── Swine Production Management                            (2 docs) [P2]
│
├── Sustainable Agriculture                             [3 services, 12 docs]
│   ├── Agroecological Crop Practices                          (3 docs) [P3]
│   ├── Agroforestry Systems and Resilience                    (3 docs) [P3]
│   └── Soil Amendments and Biological Inputs                  (6 docs) [P3]
│
└── General Reference                                   [2 services,  5 docs]
    ├── Processing Equipment and Tools                         (1 doc)  [P3]
    └── Product Data Sheets and Climate Forecasts              (4 docs) [P3]
```

**Totals:** 10 Categories | 32 Services/Topics | ~213 unique documents (after dedup)

### 3.3 Strategic Label Prioritization

Not all labels contribute equally to RAG retrieval quality. The priority ranking
below determines **creation order**, **validation rigor**, and **ingestion sequence**
within GENIE.AI. Priority is based on three factors:

1. **Query frequency** -- how often farmers and extension workers ask about this topic
2. **Data tier** -- Primary-tier labels are inherently higher priority
3. **Cross-reference density** -- labels that support many other labels rank higher

#### P0 -- Critical (create and validate first, 8 labels)

These labels cover the core cultivation and production guides that farmers query
most frequently. They must be created, populated, and tested before any other labels.


#### P1 -- Important (create second, 10 labels)

These labels cover secondary data that is frequently cross-referenced by P0 content.
A farmer asking "How do I grow corn?" will almost always follow up with pest or
fertilization questions that land in these labels.


#### P2 -- Standard (create third, 9 labels)

Remaining secondary and some primary labels with moderate query potential. Important
for completeness but lower urgency than P0/P1.


#### P3 -- Low (create last, 5 labels)

Tertiary and cross-cutting reference labels. Grouped broadly to avoid sidebar
clutter. Valuable for enriching answers but rarely the primary target of a query.




Use these sample queries to validate each phase. Each query should retrieve
relevant documents from the indicated label.


| # | Test Query (in Spanish) | Translated Test Query (in English) | Expected Primary Label |
|---|------------------------|-------------------------------------|----------------------|
| 1 | "Como sembrar maiz en El Salvador?" | "How to plant corn in El Salvador?" | Corn Planting and Variety Guide |
| 2 | "Variedades de frijol resistentes a la sequia" | "Drought-resistant bean varieties" | Bean Planting and Variety Guide |
| 3 | "Guia tecnica para cultivar arroz" | "Technical guide for growing rice" | Rice Planting and Variety Guide |
| 4 | "Mejor variedad de sorgo para grano" | "Best sorghum variety for grain" | Sorghum Planting and Variety Guide |
| 5 | "Como cultivar aguacate" | "How to grow avocado" | Fruit Cultivation Guides |
| 6 | "Guia para sembrar tomate" | "Guide for planting tomato" | Vegetable Cultivation Guides |
| 7 | "Como iniciar con la apicultura" | "How to get started with beekeeping" | Apiary Management and Honey Harvest |
| 8 | "Manejo de pollos de engorde" | "Broiler chicken management" | Broiler Chicken Management |
| 9 | "Como controlar el gusano cogollero en el maiz" | "How to control fall armyworm in corn" | Grain Pest and Disease Control |
| 10 | "Fertilizacion recomendada para maiz" | "Recommended fertilization for corn" | Grain Fertilization and Soil Health |
| 11 | "Plagas que afectan los frutales" | "Pests that affect fruit trees" | Fruit Pest Alerts and Recommendations |
| 12 | "Como hacer chocolate artesanal de cacao" | "How to make artisanal chocolate from cacao" | Cacao and Chocolate Production |
| 13 | "Enfermedades del tomate causadas por bacterias" | "Tomato diseases caused by bacteria" | Vegetable Pest and Disease Alerts |
| 14 | "Enfermedades de las abejas en las colmenas" | "Bee diseases in hives" | Bee Health and Disease Prevention |
| 15 | "Produccion de huevos gallina ponedora" | "Egg production from laying hens" | Laying Hen and Egg Production |
| 16 | "Como cultivar tilapia" | "How to farm tilapia" | Tilapia Farming Guide |
| 17 | "Calidad del agua en estanques de peces" | "Water quality in fish ponds" | Pond and Water Quality Management |
| 18 | "Variedades de pasto de corte para ganado" | "Cut grass varieties for livestock" | Pasture and Cut Grass Varieties |
| 19 | "Como almacenar granos en silos metalicos" | "How to store grains in metal silos" | Grain Storage and Post-Harvest |
| 20 | "Manejo postcosecha del mango" | "Mango post-harvest handling" | Fruit Post-Harvest and Processing |
| 21 | "Como producir semilla de tomate" | "How to produce tomato seeds" | Vegetable Seed Production |
| 22 | "Norma de calidad para miel de abeja" | "Quality standard for bee honey" | Honey Quality and Regulations |
| 23 | "Como instalar una granja camaronera" | "How to set up a shrimp farm" | Shrimp Farm Setup and Operations |
| 24 | "Recomendaciones para ganaderia en epoca seca" | "Recommendations for livestock in dry season" | Livestock Seasonal Recommendations |
| 25 | "Manual de crianza de cerdos" | "Pig farming manual" | Swine Production Management |
| 26 | "Opciones agroecologicas para cultivos" | "Agroecological options for crops" | Agroecological Crop Practices |
| 27 | "Sistemas agroforestales para resiliencia" | "Agroforestry systems for resilience" | Agroforestry Systems and Resilience |
| 28 | "Como producir biocarbon para el suelo" | "How to produce biochar for soil" | Soil Amendments and Biological Inputs |
---

*This document was prepared following the GENIE.AI Step 1: Data Curation and
Knowledge Hierarchy methodology. Version 2.0 includes finalized tree layout,
strategic prioritization, concrete curation actions, and ingestion-ready
configuration. It should be reviewed by agricultural subject matter experts
before proceeding to data ingestion.*

t