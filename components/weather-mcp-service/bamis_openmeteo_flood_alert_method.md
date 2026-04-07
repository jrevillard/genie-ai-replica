# BAMIS + Open-Meteo probabilistic flood alert method

## Overview
This approach uses BAMIS station observations to define dynamic lower and upper rainfall boundaries, while Open-Meteo provides the forecast trajectory that is tested against those boundaries.[cite:29][cite:20][cite:12] The goal is not to replace physical flood forecasting, but to create a practical early warning layer for farmers that is free, scalable, and easier to operationalize than a full hydrological model.[cite:75][cite:78]

## Why this approach works
Open-Meteo provides forecast data at hourly and daily resolution from numerical weather models, but it is grid-based rather than station-based, so local bias is expected.[cite:12] BAMIS provides local observed daily weather values from Bangladesh stations, which makes it useful as the local reality anchor.[cite:17][cite:29] Combining them creates a system where the forecast gives lead time and BAMIS gives local context.[cite:75]

## Main idea
The core idea is to compare forecast rainfall against a locally derived “normal range” built from BAMIS observations for the same station and season.[cite:20][cite:29] If the forecast remains inside the expected range, risk stays low; if it rises above the normal upper boundary, the system escalates from green to amber to red.[cite:75][cite:80]

## Step-by-step method

### 1. Select the reference station
Choose the BAMIS or BMD station nearest to the farmer location, or use the nearest 3 stations and combine them with distance weighting if the farms are spread across a large area.[cite:18][cite:17] Open-Meteo should be queried using the farm latitude and longitude for the same area.[cite:12]

### 2. Normalize the variables
Use rainfall as the first hazard variable because it is the clearest flood precursor for farmers.[cite:75][cite:81] Convert Open-Meteo hourly rainfall into daily totals when comparing it to BAMIS daily observed rainfall, because BAMIS is a daily observation dataset and not an hourly series.[cite:12][cite:29]

### 3. Build the BAMIS boundaries
Create a lower and upper boundary from observed BAMIS rainfall history for the same station.[cite:20][cite:29] The preferred method is to compute percentiles, such as P25 and P75 for the normal band, and P90 for the extreme alert band, because rainfall is highly skewed and extreme events distort averages and standard deviations.[cite:10][cite:75][cite:80]

A simple interpretation is:
- P25: lower expected rainfall bound.[cite:10]
- P75: upper expected rainfall bound for normal to elevated rainfall.[cite:10]
- P90: extreme rainfall threshold where only about 10 percent of historical comparable days are wetter.[cite:75]

### 4. Use season-aware windows
Do not compare July monsoon rainfall against January dry-season rainfall.[cite:84][cite:80] Build the percentiles from comparable seasonal windows, such as the same month, same monsoon phase, or a rolling recent window adjusted by a long-term baseline.[cite:20][cite:75]

### 5. Score the Open-Meteo forecast
For each forecast day, compare the Open-Meteo daily rainfall prediction to the station-specific BAMIS boundaries.[cite:12][cite:29] This produces a probabilistic signal rather than a yes or no threshold, which is more robust for agriculture decisions.[cite:75]

### 6. Assign alert colors
Use the following operational logic:
- **Green**: forecast is below or within the normal BAMIS band; rainfall is not unusual for that place and season.[cite:10][cite:20]
- **Amber**: forecast exceeds the upper normal band, such as above P75 but below P90; conditions are elevated and farmers should prepare.[cite:75]
- **Red**: forecast exceeds the extreme band, such as above P90, or exceeds a hard safety floor used by flood agencies; early warning should be issued.[cite:75][cite:78][cite:81]

### 7. Add a hard floor for safety
Percentiles are useful, but they should not be the only rule.[cite:75] Add a hard rainfall floor such as a 3-day accumulation threshold used in flood practice, then trigger red if either the percentile rule or the hard threshold is exceeded.[cite:81][cite:78] This hybrid rule avoids missing floods during already wet years.[cite:75][cite:80]

### 8. Recompute regularly
If only recent BAMIS web data is available, recalculate the short-term adjustment every day and anchor it to a longer baseline dataset such as the Bangladesh multi-station archive released on Mendeley.[cite:20][cite:29] A 2023 archive is still useful for baseline climatology because it captures long-run local behavior, while recent BAMIS data adjusts the boundaries to current-season wetness or dryness.[cite:20][cite:80]

## Issues and fixes

| Issue | Why it matters | Fix |
|---|---|---|
| BAMIS is daily while Open-Meteo can be hourly | Direct comparison can be misleading.[cite:29][cite:12] | Aggregate Open-Meteo hourly rainfall into daily totals before comparing.[cite:12] |
| BAMIS web views often expose only recent days by default | Very small samples make unstable boundaries.[cite:29] | Use a long baseline archive plus the latest BAMIS observations as a short-term adjustment.[cite:20][cite:29] |
| Open-Meteo is grid-based, not station-based | Forecast may not match the farm microclimate exactly.[cite:12] | Use nearest-station correction or multi-station weighted averages.[cite:18] |
| Repeated floods can shift recent rainfall upward | A short recent sample can make abnormal conditions look normal.[cite:75][cite:80] | Keep a fixed long-term baseline and only use recent data as an adjustment factor, not as the sole source of truth.[cite:20][cite:75] |
| Rainfall alone does not equal flood everywhere | Flood also depends on river level, drainage, and soil saturation.[cite:78][cite:74] | Use rainfall alerts as an early warning trigger and add river or water-level feeds later when available.[cite:78][cite:75] |

## Why percentiles are better than only hard thresholds
A fixed threshold such as 100 mm per day is simple, but it ignores local climate and seasonality.[cite:84] The same rainfall amount can be normal in one district during monsoon and dangerous in another place or season.[cite:80][cite:84] Percentiles solve that by describing how unusual the forecast is relative to local history, which is why flood systems often rely on recurrence and exceedance concepts rather than one universal rainfall number.[cite:75][cite:78]

Percentiles are also more robust than averages plus standard deviation because rainfall has a long-tail distribution with many small values and a few very large extremes.[cite:10][cite:80] In that kind of data, standard deviation can become inflated by a few flood events, while percentiles remain interpretable and stable.[cite:10]

## What repeated floods change
Repeated floods in one year can distort a short recent sample, especially if the sample only covers 7 to 30 days.[cite:75][cite:80] That is why the recommended method is not “recent percentiles only,” but “long-term baseline percentiles plus short-term adjustment.”[cite:20][cite:75] In practice, the baseline captures climatology and the recent data captures whether the current season is already wetter than normal.[cite:20][cite:80]

## Recommended operational logic
A practical production rule is:
1. Build station-level baseline percentiles from long historical data.[cite:20]
2. Pull the latest BAMIS observations to estimate current wetness adjustment.[cite:29]
3. Aggregate Open-Meteo rainfall into daily and 3-day totals.[cite:12]
4. Compare forecast totals against both percentile boundaries and a hard floor.[cite:81][cite:75]
5. Assign green, amber, or red status and send farmer guidance accordingly.[cite:75]

## Improved implementation snippet
```python
import numpy as np
import pandas as pd

def compute_dynamic_thresholds(baseline_series, recent_series=None):
    baseline_series = pd.Series(baseline_series).dropna()
    p25 = np.percentile(baseline_series, 25)
    p75 = np.percentile(baseline_series, 75)
    p90 = np.percentile(baseline_series, 90)

    adjustment = 1.0
    if recent_series is not None and len(recent_series) > 0:
        recent_series = pd.Series(recent_series).dropna()
        if len(recent_series) > 0 and baseline_series.median() > 0:
            adjustment = max(0.7, min(1.5, recent_series.median() / baseline_series.median()))

    return {
        "lower": p25 * adjustment,
        "upper": p75 * adjustment,
        "extreme": p90 * adjustment,
    }


def classify_alert(forecast_daily_mm, forecast_3day_mm, thresholds, hard_floor_3day=150):
    if forecast_3day_mm >= hard_floor_3day or forecast_daily_mm >= thresholds["extreme"]:
        return "RED"
    elif forecast_daily_mm >= thresholds["upper"]:
        return "AMBER"
    else:
        return "GREEN"
```

This implementation keeps the boundaries simple and interpretable while protecting against the main failure mode of small recent samples.[cite:20][cite:75]

## Graph interpretation
The graph represents Open-Meteo as the forecast line and BAMIS as the local acceptable envelope around that line.[cite:46] When the forecast line remains inside the BAMIS-derived band, the event is still inside expected local behavior; when it rises above the upper band and approaches the flood threshold, the alert level escalates.[cite:46][cite:75] That framing is suitable for farmer communication because it shows not only the forecast value, but also whether it is unusual for that location.[cite:75]

## Method limits
This method improves weather-triggered alerts, but it does not replace hydrological flood forecasting because rainfall is only one part of flood formation.[cite:74][cite:78] River basin response, upstream rainfall, embankment conditions, and soil saturation all matter.[cite:78][cite:87] For that reason, the best way to position this system is as a farmer-facing early warning layer that later can be enriched with river-stage data or official flood bulletins.[cite:75][cite:78]

## Recommendation
Use a hybrid system: Open-Meteo for forecast lead time, BAMIS for local observational context, percentile bands for anomaly detection, and a hard rainfall floor for safety.[cite:12][cite:29][cite:75][cite:81] That combination is more adaptable than a single hard threshold and more operationally realistic than trying to derive flood warnings from Open-Meteo alone.[cite:80][cite:78]
