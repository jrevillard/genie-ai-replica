## **What is AgroGenio AI?**

AgroGenio AI is a Retrieval-Augmented Generation (RAG) assistant for agriculture in El Salvador. It combines:

- A curated document base built from **CENTA** (Centro Nacional de Tecnología Agropecuaria y Forestal) publications, **Ministry of Agriculture and Livestock (MAG)** advisories, and FAO/OIRSA reference material for Central America, plus the Open Platform for Enterprise AI (OPEA) services that index and retrieve them.
- Live agricultural data for El Salvador and the region: satellite-derived crop health (NDVI), pest and disease alerts (curated advisories and iNaturalist community observations), commodity market prices (FAO/WFP, USDA, local ministries), post-harvest loss estimates (FAO SDG 12.3.1), and agricultural input prices (US BLS Producer Price Index for pesticides and ag chemicals, fertilizer benchmarks).
- An agricultural AI prediction flow that turns the live data, the document base, and any user-supplied news factors into per-commodity forecasts (3 months, 6 months, 1 year, 2 years) you can read alongside the chart.

You can ask questions in plain language — in English or Spanish — and AgroGenio answers in your selected language. Answers cite the documents they came from and surface the live data they were paired with, so you can always see where a number or a recommendation came from.

## **How can I get the most accurate answers?**

For the best results, give AgroGenio as much specific context as possible.

- **Use the Quick Help buttons on the home screen.** Plant Basic Grains, Diagnose Pest/Disease, Grow Fruits & Veggies, Manage Poultry & Pigs, Fertilizer & Soil Advice, Start/Manage Apiary, Tilapia & Pond Care, and Harvest & Storage are pre-written prompts that pin the document base to the right topic before you type a word.
- **Use the Insights shortcuts.** Crop Health and Pest Alerts cards on the home screen open the live dashboards for El Salvador and let the AI interpret what the numbers mean for your situation.
- **Be specific.** Instead of "Tell me about maize", ask "What maize variety does CENTA recommend for the dry corridor, and how much seed per manzana?".
- **Ask one question at a time.** Multi-part questions confuse retrieval. Break them into single questions, and follow up.
- **Match the language.** AgroGenio answers in the language you selected. If you switch languages mid-conversation, the new answer will be in the new language but the document base is the same.

## **What is in the "Crop Health" data?**

The Crop Health dashboard shows vegetation health (NDVI) for El Salvador's 14 departments, updated roughly monthly. NDVI is a satellite-derived indicator from the **WFP Vulnerability Analysis and Monitoring** programme, distributed via the Humanitarian Data Exchange (CC BY 4.0). Values are normalised against the long-term baseline for each department, so a "good" department means vegetation is at or near its historical norm, not an absolute threshold.

- The number on each department row (for example, `77`) is the department's average NDVI for the latest period, on a 0–100 scale.
- The trend arrow compares the latest reading to the baseline:
  - **Stable** — within a few percent of the baseline.
  - **Rising** — meaningfully above the baseline.
  - **Declining** — meaningfully below the baseline.
- The **Good / Moderate / Warning** badge reflects how far the reading sits from the baseline; it does **not** predict crop failure.
- The **Last updated** timestamp is the server's `meta.fetchedAt` from the API response — it shows when the data was last refreshed, not the current wall-clock time.
- Click any department card to drill into the detail view and ask the AI to interpret the trend.

## **What is in the "Pest Alerts" data?**

Pest Alerts cover El Salvador's most economically important pests and diseases, with the affected departments and the time of year when activity is highest.

- The advisory copy is **curated from MAG/CENTA publications and OIRSA regional alerts**, with community sightings cross-referenced from **iNaturalist** (Creative Commons observations).
- Each alert lists the scientific name, the EPPO code, the affected crops (in English and Spanish), the departments currently affected, and the seasonal window when monitoring is most important.
- The map card on the home screen plots representative dots for the western, central, and eastern regions — the more dots, the more reports in your current data window.
- Like Crop Health, the **Last updated** timestamp is the server's `fetchedAt`. Alerts that have no confirmed report in the current window are dropped, not held over.
- Click an alert to read the full advisory and ask the AI for help interpreting it for your crops.

## **What is in the "Market Prices" data?**

Market Prices is the live commodity tracker. There are eight categories: **Maize, Beans & Grains**, **Crop Protection**, **Fruits & Veggies**, **Livestock**, **Fertilizer**, **Apiary & Honey**, **Aquaculture**, and **Harvest & Storage**. Each category has its own unit, its own data sources, and its own conventions, summarised below.

- **Maize, Beans & Grains (USD/quintal)** — Quintal is the Central American farm-gate measure: 1 quintal ≈ 46 kg. Source data in USD/kg is converted to USD/quintal at 45.97 kg. Sources include FAO/WFP, the Salvadoran Ministry of Agriculture, and regional wholesale markets. The series includes white maize, yellow maize, beans, rice, sorghum, wheat and others — both domestic and international benchmark series are shown side by side so you can see whether a local price moves with or against the regional benchmark.
- **Crop Protection (Producer Price Index)** — The US Bureau of Labor Statistics Producer Price Index for **pesticide and agricultural chemical manufacturing**, plus a **pesticide import parity** index. Index values are relative to a base period (for example 2016 = 100), not absolute prices — the trend shows input-cost direction, not a price level.
- **Fruits & Veggies (USD/kg, USD/lb, USD/dozen)** — Wholesale-market series from MAG/CENTA and FAO. Tomatoes, onions, cucumbers, potatoes, and similar staples. Prices vary by variety and season; the chart shows whichever series the data feed returned for that week.
- **Livestock (USD/kg)** — Cattle (BEEF) and broiler chicken (CHICKEN) farm-gate prices. Sources include the Salvadoran livestock exchanges and FAO regional series.
- **Fertilizer (USD/short ton or USD/metric tonne)** — Urea (URE), DAP, TSP, MOP and similar. Series follow US Gulf and Brazil benchmark prices; the unit depends on which benchmark is selected for each series.
- **Apiary & Honey (USD/kg)** — Honey wholesale series, both Salvadoran and regional benchmarks.
- **Aquaculture (USD/lb or USD/kg)** — Tilapia farm-gate and wholesale series from regional producers and FAO. Very large numbers are formatted as thousands (for example `12.5K`).
- **Harvest & Storage (% of harvest)** — A modelled regional statistic from **FAO SDG 12.3.1** — the share of the Central American food harvest, by mass, lost between harvest and retail. This is **not** a price; it is a loss indicator. A reading of `8.3` means about 8 of every 100 kg of food grown never reaches a consumer.

All series share the same chart conventions: zoom (pinch or the [−] [+] [Fit] buttons) only affects the X axis; the Y axis always tops out 20% above the highest rendered point in the visible window, with sparse tick marks so the chart stays readable.

## **What are "Estimated" and "Actual" markers in the chart?**

Some series carry a quality marker per point.

- **Actual** — the price or value was published by a primary source for that period.
- **Estimated** — the value is modelled or back-filled because the primary source has not published yet for that period (common for the most recent weeks of weekly or monthly series). Estimated points are drawn as a dashed warning-coloured line so you can see at a glance which segment of the curve is uncertain.

The legend at the top of the chart shows the quality markers; the table view and CSV export include a Quality column with the per-point marker.

## **What are the caveat chips above the chart?**

Caveat chips flag data limitations so you can interpret the chart honestly. They appear above every chart dialog and summarise things like:

- **Bundled snapshot** — the data is a curated bundle that doesn't refresh in real time (for example, the regional SDG 12.3.1 loss estimate).
- **Saved data X old** — the API returned data that hasn't refreshed in X days; the chart is still drawn but you should treat it as a snapshot.
- **Updated X ago** — the timestamp of the most recent successful refresh, paired with a confidence tint (warning if the freshness is poor, success if it's current).

If multiple caveats apply to the same series, the chart shows them once — duplicates are collapsed.

## **How does the "Get AI Predictions" button work?**

Click **Get AI Predictions** in any Market Prices chart to ask AgroGenio to forecast each commodity in the active scope. The prediction flow:

1. Loads the active commodity list, the latest data, and any news factors you have selected in the **Add from recent news** picker.
2. Builds a per-commodity prompt that asks the AI to forecast that one commodity (never aggregate across categories), incorporate the news factors explicitly, and treat values marked `(est.)` as estimates.
3. Streams the answer back into the dialog. The forecast window you choose (3 months, 6 months, 1 year, or 2 years) is passed to the model so the timeline matches what you asked for.

Use the AI Predictions dialog to:

- Sanity-check whether a current price trend is likely to continue, reverse, or stall.
- Ask how a specific event (a hurricane, a regional drought, a tariff change, an El Niño forecast) is likely to move a particular commodity.
- Get a per-commodity narrative you can share with a colleague, an extension worker, or a buyer.

The prediction is grounded in the same data shown on the chart — it is not a generic AI answer. When the AI is uncertain, it tells you what it is uncertain about, and points at the supporting series.

## **How do the news factors work?**

In the **Get AI Predictions** dialog, the **Add from recent news** picker lets you insert one or two recent news items as context for the forecast. There are two sources:

- **El Salvador News Factors** — local events: regulations, weather, road closures, market announcements from MAG.
- **World News Factors** — global events: supply-chain disruptions, trade policy, regional harvest reports, climate events.

The forecast prompt you receive from AgroGenio is built around the news factors you select — if you do not select any, the prediction is grounded only on the price history. If you select one or two, the AI is required to weave them into its analysis for each commodity (for example, "given the regional drought, beef prices are likely to rise because cattle movements out of the affected areas tighten supply").

## **What is the "Confidence" score?**

Confidence is the AI's own assessment of how well the source documents matched your question. A higher score (for example, `95%`) means the retrieval step found documents that were clearly relevant; a lower score (for example, `40%`) means the documents were topically adjacent rather than on point. Confidence reflects retrieval quality, not the truth of the answer — a high-confidence answer is one the AI is well-grounded in, not necessarily one that is correct.

When confidence is low, treat the answer as a starting point: rephrase, add context, or select a Quick Help button to narrow the document base.

## **Can I trust the answers from AgroGenio?**

Yes, with the same caveat any AI assistant carries. AgroGenio's answers are grounded in:

- The curated CENTA / MAG / FAO / OIRSA / OPEA document base.
- The live Crop Health, Pest Alerts, and Market Prices data feeds.

When AgroGenio uses one of those sources, it surfaces the source in the related documents and chart caveats. When it cannot ground an answer, it tells you. It is designed to refuse to invent a number it cannot ground — if it does not know, it says so rather than making something up.

For agricultural decisions, treat AgroGenio as an expert assistant, not as a substitute for a CENTA extension officer or a licensed agronomist. Always verify a recommendation that affects inputs, planting, harvest, or animal health with the relevant local authority.

## **Why does the chatbot sometimes answer "I don't have enough information"?**

AgroGenio is configured to refuse to answer when it cannot ground the answer in the document base or the live data feeds. You will see this when:

- You ask a question outside the agricultural domain.
- The question is too vague for the retriever to find matching documents.
- The selected Quick Help / service context doesn't include any documents on the topic you asked about.

If you see this, narrow the question, select a different Quick Help, or drop the context and ask in general.

## **What languages does AgroGenio speak?**

The mobile and web apps expose the full 14-locale list that ships in the configuration: English, Spanish, Arabic, Bengali, French, German, Indonesian, Mandarin Chinese, Portuguese, Russian, Sesotho, Swahili, Thai, and Mandinka. AgroGenio answers in your selected language regardless of the language of the document; the retrieved text is summarised in the answer language. The active locale list is configurable per deployment via `VUE_APP_AVAILABLE_LOCALES` (web) and `KEYCLOAK_SUPPORTED_LOCALES` (Keycloak login).

## **Where is my data stored?**

- Your conversation history is stored in ArangoDB, linked to your authenticated user. You can clear it from the user profile screen.
- Crop health, pest alerts, and market price snapshots are cached for offline viewing on the mobile app.
- AgroGenio does not share your conversations with any third party. Source documents are public, aggregated data is the public feeds cited above.

## **How do I report a problem or suggest a feature?**

If you find a chart whose numbers look wrong, a FAQ answer that is out of date, or a feature that would help you in the field, mention it in your next chat session — AgroGenio forwards feedback to the project maintainers. For access, account, or login issues, contact your MAG/CENTA administrator or the project deployment team.
