# Short-Term Implementation Guide (BAMIS + Open Meteo)

## Purpose

This guide explains how to implement the **short-term MEWA process** using:

- **Open Meteo** hourly forecast (up to 7 days)
- **BAMIS** daily min/max/avg (next-day)

It is focused on production implementation details for engineers.

## Scope

This document covers:

- Daily cronjob pipeline for short-term risk evaluation
- `sense_check` logic and tolerance handling (`0.2`)
- Farmer-facing outputs (push alerts and pull responses)
- Fallback behavior

This document intentionally sets the fallback policy to:

- **`bamis_only` only**

No `flag` and no `ensemble` fallback modes are used in this implementation guide.

---

## 1. Data Contracts

### 1.1 Open Meteo (hourly)

Open Meteo is the short-term forecast source.

```python
@dataclass
class HourlyReading:
    timestamp: datetime
    variable: str
    value: float
    unit: str = ""
```

Expected fetch behavior:

```python
class OpenMeteoData(DataSource):
    BASE_URL = "https://api.open-meteo.com/v1/forecast"

    DEFAULT_VARIABLES = [
        "precipitation",
        "temperature_2m",
        "relativehumidity_2m",
        "windspeed_10m",
        "soil_moisture_0_1cm",
    ]

    def fetch(self) -> list[HourlyReading]:
        params = {
            "latitude": self.latitude,
            "longitude": self.longitude,
            "hourly": ",".join(self.variables),
            "forecast_days": self.max_days,
        }
        response = requests.get(self.endpoint, params=params, timeout=30)
        response.raise_for_status()
        raw = response.json()

        readings: list[HourlyReading] = []
        times = raw.get("hourly", {}).get("time", [])
        for var in self.variables:
            values = raw.get("hourly", {}).get(var, [])
            unit = raw.get("hourly_units", {}).get(var, "")
            for t, v in zip(times, values):
                if v is not None:
                    readings.append(HourlyReading(
                        timestamp=datetime.fromisoformat(t),
                        variable=var,
                        value=float(v),
                        unit=unit,
                    ))
        return readings
```

### 1.2 BAMIS (daily)

BAMIS is the validation reference source.

```python
@dataclass
class DailyStats:
    forecast_date: date
    min_values: dict[str, float]
    max_values: dict[str, float]
    avg_values: dict[str, float]
```

Expected fetch behavior:

```python
class BAMISData(DataSource):
    def fetch(self) -> DailyStats:
        params = {
            "location": self.location_id,
            "date": self.forecast_date.isoformat(),
        }
        response = requests.get(self.endpoint, params=params, timeout=30)
        response.raise_for_status()
        raw = response.json()

        return DailyStats(
            forecast_date=self.forecast_date,
            min_values=raw.get("min", {}),
            max_values=raw.get("max", {}),
            avg_values=raw.get("avg", {}),
        )
```

---

## 2. What `sense_check` Is For

`sense_check` is a **reliability gate** before alert evaluation.

- It does **not** create farmer-facing forecast values.
- It does **not** compare BAMIS hourly values (BAMIS is daily only).
- It checks whether Open Meteo day-1 behavior is plausible against BAMIS daily min/max bounds.

If check passes: proceed with normal Open Meteo-based evaluation.

If check fails: switch to `bamis_only` fallback.

---

## 3. Core `sense_check` Logic

```python
def sense_check(
    self,
    open_meteo_data: list[HourlyReading],
    bamis_data: DailyStats,
    tolerance: float = 0.2,
) -> bool:
    target_date = bamis_data.forecast_date
    day1_readings = [
        r for r in open_meteo_data
        if r.timestamp.date() == target_date
    ]

    violations = 0
    total_checked = 0

    for variable in bamis_data.max_values:
        var_readings = [r.value for r in day1_readings if r.variable == variable]
        if not var_readings:
            continue

        om_max = max(var_readings)
        bamis_max = bamis_data.max_values[variable]
        bamis_min = bamis_data.min_values.get(variable, 0.0)

        upper_bound = bamis_max * (1 + tolerance)
        lower_bound = bamis_min * (1 - tolerance)

        total_checked += 1
        if om_max > upper_bound or om_max < lower_bound:
            violations += 1

    if total_checked == 0:
        return True

    violation_rate = violations / total_checked
    return violation_rate < 0.5
```

### Important interpretation

- `0.2` is applied to **BAMIS bounds**:
  - `upper = bamis_max * 1.2`
  - `lower = bamis_min * 0.8`
- Then compare **`om_max`** against those bounds.
- `0.2` is not directly applied to every hourly Open Meteo point.

---

## 4. Worked Example

Assume variable `temperature_2m` for `2026-04-18`:

- Open Meteo hourly values: `[24, 27, 31, 34, 33, 29]`
- `om_max = 34`
- BAMIS min/max: `25 / 32`
- tolerance: `0.2`

Bounds:

- `lower_bound = 25 * 0.8 = 20`
- `upper_bound = 32 * 1.2 = 38.4`

Decision:

- `34` is within `[20, 38.4]` -> no violation for this variable.

Failure example:

- If `om_max = 41`, then `41 > 38.4` -> violation.

Global decision:

- If `violation_rate >= 0.5`, `sense_check` fails and fallback is activated.

---

## 5. Daily Cronjob (Short-Term Push)

Run daily per monitored locality.

1. Fetch Open Meteo hourly data (7-day horizon)
2. Fetch BAMIS daily stats (target day)
3. Run `sense_check(om_data, bamis_data)`
4. If failed, apply fallback (`bamis_only`)
5. Evaluate crop thresholds
6. Classify severity
7. Send push notification if severity is `high` or `critical`

Implementation skeleton:

```python
def run_daily_short_term(locality: LocalityConfig) -> EWReport:
    ews = ShortTermEWS(
        location_id=locality.id,
        crop_types=locality.crop_types,
        thresholds=locality.thresholds,
        open_meteo=OpenMeteoData(locality.lat, locality.lon),
        bamis=BAMISData(locality.bamis_endpoint, locality.id, date.today()),
        prithvi=locality.prithvi,
        fallback_strategy="bamis_only",  # fixed policy
    )
    report = ews.evaluate()
    ews.trigger_push_alert(report)
    return report
```

---

## 6. Fallback Policy (Fixed to `bamis_only`)

### 6.1 Why this fallback

When Open Meteo diverges too much from BAMIS, rely on the more trusted BAMIS daily signal for safety.

### 6.2 How it works

Convert BAMIS daily stats into synthetic readings:

```python
def _bamis_to_hourly(self, bamis_data: DailyStats) -> list[HourlyReading]:
    readings = []
    for variable, value in bamis_data.max_values.items():
        readings.append(HourlyReading(
            timestamp=datetime.combine(
                bamis_data.forecast_date,
                datetime.min.time(),
            ),
            variable=variable,
            value=value,
        ))
    return readings
```

Notes:

- This is not a true hourly curve.
- It produces one synthetic point per variable (using BAMIS max).
- It is only for safe fallback evaluation when reliability is low.

### 6.3 Enforce single fallback mode

Use only:

```python
fallback_strategy: str = "bamis_only"
```

And remove branching for other modes in implementation.

---

## 7. Farmer-Facing Behavior

### 7.1 Push flow

Farmer receives warnings when severity is high enough.

- `high` / `critical` -> push notification
- `low` / `medium` -> no immediate push (log/advisory behavior)

### 7.2 Pull flow (farmer asks in chat)

When farmer asks, for example, "How is the weather today?":

- Return a **daily summary** per variable (min / max / avg) for today.
- If `sense_check` failed for the run, return BAMIS daily stats (`bamis_only` policy).
- Show hourly breakdown only when explicitly requested (for example: "show hourly rain today").
- Do not return `om_max` as the primary weather answer.
- `om_max` is an internal reliability metric used in `sense_check`.

Example daily aggregation helper:

```python
def summarize_today(om_data: list[HourlyReading], target_date: date) -> dict[str, dict[str, float]]:
    grouped: dict[str, list[float]] = {}
    for r in om_data:
        if r.timestamp.date() != target_date:
            continue
        grouped.setdefault(r.variable, []).append(r.value)

    summary: dict[str, dict[str, float]] = {}
    for variable, values in grouped.items():
        summary[variable] = {
            "min": min(values),
            "max": max(values),
            "avg": sum(values) / len(values),
        }
    return summary
```

---

## 8. Normalization and Matching Rules

Current MEWA blueprint does not implement a separate, explicit normalization module for short-term.

Implementation requirements to avoid bad comparisons:

1. Ensure variable naming is aligned between Open Meteo and BAMIS keys.
2. Ensure units are comparable before running `sense_check`.
3. Skip variables with no overlap.
4. Log missing-overlap rate per run for monitoring.

Recommended minimal pre-check:

```python
def ensure_comparable(om_data: list[HourlyReading], bamis: DailyStats) -> None:
    om_vars = {r.variable for r in om_data}
    bamis_vars = set(bamis.max_values.keys())
    overlap = om_vars & bamis_vars
    if not overlap:
        logger.warning("No overlapping variables between OM and BAMIS")
```

---

## 9. End-to-End Evaluate Function (Recommended)

```python
def evaluate(self) -> EWReport:
    if not self.validate():
        raise ValueError("Input validation failed")

    om_data = self.open_meteo.fetch()
    bamis_data = self.bamis.fetch()

    reliable = self.sense_check(om_data, bamis_data, tolerance=0.2)
    fallback_used = False

    if not reliable:
        fallback_used = True
        om_data = self._bamis_to_hourly(bamis_data)  # only fallback path

    variables_triggered = []
    max_deviation = 0.0

    for crop in self.crop_types:
        crop_thresholds = self.thresholds.get(crop, {})
        for reading in om_data:
            var_thresh = crop_thresholds.get(reading.variable)
            if not var_thresh:
                continue
            flood_threshold = var_thresh.get("flood")
            if flood_threshold and reading.value > flood_threshold:
                variables_triggered.append(reading.variable)
                deviation = (reading.value - flood_threshold) / flood_threshold
                max_deviation = max(max_deviation, deviation)

    variables_triggered = list(set(variables_triggered))
    severity = self._classify_severity(len(variables_triggered), max_deviation)

    report = EWReport(
        severity=severity,
        variables_triggered=variables_triggered,
        recommended_actions=self._build_recommendations(variables_triggered, severity),
        confidence=1.0 if not fallback_used else 0.6,
        fallback_used=fallback_used,
    )
    return report
```

---

## 10. Operational Checklist

1. Schedule cron daily per locality (timezone-aware).
2. Persist raw Open Meteo hourly response and BAMIS daily response.
3. Persist `sense_check` metrics (`violations`, `total_checked`, `violation_rate`).
4. Persist whether fallback was used.
5. Monitor mismatch/no-overlap between BAMIS and Open Meteo variables.
6. Recalibrate tolerance `0.2` using historical discrepancy data.

---

## 11. What to Tell Product/Support Teams

- Open Meteo provides hourly short-term forecast data.
- BAMIS provides daily validation bounds and fallback safety data.
- `sense_check` decides whether Open Meteo is reliable enough for that run.
- If unreliable, system switches to BAMIS-only fallback for risk scoring.
- For "today" questions, default response is daily min/max/avg; hourly detail is optional on request.
- Farmers are shown alerts/advice and forecast summaries, not raw `om_max` internals.
