# Farmer Weather Advisor — Test Questions

A single pass through what one farmer asks across a season, in the order they
would ask it. Stages move from single-source lookups to judgment calls that
combine sources. 16 questions, one idea each.

See [`farmer-user-journey.md`](farmer-user-journey.md) for the same stages
told as a narrative, from the farmer's side of the screen.

## Scope of this MVP

- **Crops**: Aman rice, mango, eggplant. Nothing else has a crop profile.
- **Place**: Naogaon district / Sapahar sub-district (the default location).
- **Sources the answer may use**: the ingested crop documents (calendar, pests,
  thresholds) and the live context block (today's date, season position, 7-day
  forecast, crop risk, seasonal outlook, drought, flood).
- **Not in the system**: observed or historical rainfall, notifications and
  subscriptions, the agromet bulletin (no `bulletin.md` shipped), the flood-map
  image (`flood` command doesn't render), official BMD warnings (not answered
  correctly), any crop outside the three above.

## How to read the table

`Must use` says where the answer has to come from. `Pass when` is the check —
an answer that is fluent but sources a number from the wrong place is a fail.
Any live figure presented as coming from "the document" is a fail everywhere.

---

## Stage 1 — Basic lookups (initial capabilities)

Single-source, deterministic retrieval. No comparison, no judgment call — the
kind of question that should never come back wrong or ambiguous.

| #   | Question                                                     | Must use       | Pass when                                                    |
| --- | ------------------------------------------------------------- | ---------------- | --------------------------------------------------------------- |
| 1   | What are the months for Aman rice in Naogaon?                | Crop calendar   | Months come from the calendar, not the model's own knowledge  |
| 2   | Tell me the crop calendar for eggplant.                      | Crop calendar   | Stages and months listed; no weather figures mixed in          |
| 3   | What's today's date, and where are we in the rice season?    | Live context    | Uses today's date and the season position line for rice        |

## Stage 2 — Deciding what to plant

Judgment questions that combine the calendar with the seasonal outlook.
Phrasing like "is the season late" is inherently comparative — it needs a
baseline and can read differently depending on which one is picked, so it
belongs here, not in the basic-lookup stage.

| #   | Question                                                      | Must use                | Pass when                                                       |
| --- | --------------------------------------------------------------| ------------------------ | ------------------------------------------------------------------ |
| 4   | When should I plant eggplant this year?                       | Calendar + live context  | Names the calendar's Kharif window (May); recognizes it has already passed — today (week 38) is the calendar's own harvesting stage — instead of inventing a September window |

| 6   | If the rains come late, is rice or eggplant the safer choice?  | Calendar + outlook       | Compares the two crops actually grown here                          |
| 7   | What should I do to get ready for this planting season?        | Crop documents           | Practices come from the documents; says so when they contain none  |

## Stage 3 — The week ahead

| #   | Question                                          | Must use                  | Pass when                                                          |
| --- | -------------------------------------------------- | -------------------------- | -------------------------------------------------------------------- |
| 8   | What is the weather for the next week in my region?                            | Seasonal outlook + date  | States the baseline it's comparing against; says so if it canno             | 7-day forecast             | Quotes forecast days and totals, with the district named             |
| 9   | Should I irrigate my eggplant this week?          | Forecast + soil moisture   | Uses the soil moisture band; says when the documents give no irrigation guidance |

## Stage 4 — Looking after the crop

| #   | Question                                        | Must use        | Pass when                                          |
| --- | ------------------------------------------------ | ---------------- | ----------------------------------------------------- |
| 11  | What are the pests and diseases of Aman rice?   | Crop documents   | Complete list from the document, not a partial two    |
| 12  | Will this week's weather damage my rice?        | Risk + forecast  | Links a specific forecast value to a crop threshold    |

## Stage 5 — Drought, flood, and field maps

| #   | Question                                                  | Must use            | Pass when                                          |
| --- | ----------------------------------------------------------| ---------------------- | ------------------------------------------------------ |
| 13  | Is there a drought risk in Naogaon next week?             | Drought assessment  | Uses the stored assessment, not the forecast alone     |
| 14  | Is my area at risk of flooding in the next ten days?      | Flood outlook       | Uses the flood outlook horizon as given                |
| 15  | Show me my field boundaries on the map.                   | `delineate` command | Delineation job runs; image returned                   |

## Stage 6 — What the system must refuse

| #   | Question                                      | Expected                                            |
| --- | ------------------------------------------------| ------------------------------------------------------ |
| 16  | Is the weather good for planting potato here? | Says potato has no crop profile; does not invent one   |
