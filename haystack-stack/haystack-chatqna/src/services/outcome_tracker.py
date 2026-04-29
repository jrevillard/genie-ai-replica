"""
Tier 6 — Longitudinal Outcome Tracker
======================================
Stores CRI snapshots over time and computes trajectory deltas (30 / 90 / 180 days)
to evaluate whether patients are improving, stable, or deteriorating under CHW care.

Also aggregates population-level outcome statistics across a caregiver's panel.

Redis key layout
----------------
  cri_snapshots:{patient_id}   sorted-set   score = unix_ts,  member = JSON snapshot
  outcome_cache:{patient_id}   string        JSON OutcomeSummary   TTL = 12 h
  pop_outcome_cache:{cid}      string        JSON PopOutcome       TTL = 6 h

Public API
----------
record_cri_snapshot(patient_id, cri, enriched_ctx, redis_client) -> None
get_patient_outcomes(patient_id, redis_client, today) -> OutcomeSummary | None
get_population_outcomes(caregiver_id, panel_records, redis_client, today) -> PopulationOutcome
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, asdict
from datetime import date, datetime, timedelta
from typing import Any, Optional

import redis as redis_lib

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
_SNAP_KEY   = "cri_snapshots:{pid}"
_CACHE_KEY  = "outcome_cache:{pid}"
_POP_KEY    = "pop_outcome_cache:{cid}"
_SNAP_TTL   = 365 * 24 * 3600   # keep 1 year of snapshots
_CACHE_TTL  = 12 * 3600
_POP_TTL    = 6 * 3600

_DELTA_WINDOWS = [30, 90, 180]   # days

# Trajectory labels
_TRAJ_IMPROVED   = "improving"
_TRAJ_STABLE     = "stable"
_TRAJ_DECLINING  = "declining"
_TRAJ_CRITICAL   = "critical"
_TRAJ_NEW        = "insufficient_data"

# Thresholds
_IMPROVE_DELTA   = -5.0    # CRI dropped ≥ 5 → improving
_DECLINE_DELTA   = +5.0    # CRI rose   ≥ 5 → declining
_CRITICAL_CRI    = 80


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class CRISnapshot:
    patient_id:       str
    recorded_at:      str        # ISO datetime
    cri:              float
    cri_label:        str
    escalation_prob:  float
    adherence_decay:  float
    flags:            list[str]
    sdoh_score:       float
    season:           str        # e.g. "rainy_season+lean_season"

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class DeltaWindow:
    days:           int
    baseline_cri:   Optional[float]
    current_cri:    float
    delta:          float
    trajectory:     str
    baseline_date:  Optional[str]


@dataclass
class SparklinePoint:
    date:  str      # ISO date
    cri:   float


@dataclass
class OutcomeSummary:
    patient_id:         str
    computed_at:        str
    current_cri:        float
    current_label:      str
    overall_trajectory: str    # best available window trajectory
    deltas:             list[DeltaWindow]
    sparkline:          list[SparklinePoint]   # last 90 days, weekly granularity
    snapshot_count:     int
    first_recorded:     Optional[str]
    interpretation:     str

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class PopulationOutcomeGroup:
    label:        str
    count:        int
    proportion:   float
    avg_cri:      float


@dataclass
class PopulationOutcome:
    caregiver_id:       str
    computed_at:        str
    total_patients:     int
    avg_cri:            float
    trajectory_groups:  list[PopulationOutcomeGroup]
    improving_count:    int
    stable_count:       int
    declining_count:    int
    critical_count:     int
    new_count:          int
    improvement_rate:   float   # improving / (improving + declining), excludes stable/new
    best_outcome_pid:   Optional[str]   # patient with largest CRI drop (anonymised)
    worst_outcome_pid:  Optional[str]   # patient with largest CRI rise
    recommendations:    list[str]

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# Snapshot storage
# ---------------------------------------------------------------------------

def record_cri_snapshot(
    patient_id:   str,
    cri:          float,
    redis_client: redis_lib.Redis,
    enriched_ctx: Any = None,
    today:        Optional[datetime] = None,
) -> None:
    """
    Persist a CRI snapshot for a patient.
    Call this after every `enrich_patient_context()` run.
    """
    now = today or datetime.utcnow()

    # Extract optional enrichment fields
    cri_label        = "moderate"
    escalation_prob  = 0.0
    adherence_decay  = 0.0
    flags: list[str] = []
    sdoh_score       = 0.5
    season           = "unknown"

    if enriched_ctx is not None:
        pr = getattr(enriched_ctx, "predictive_risk", None)
        if pr:
            cri_label       = getattr(pr, "cri_label",       cri_label)
            escalation_prob = getattr(pr, "escalation_prob", escalation_prob)
            adherence_decay = getattr(pr, "adherence_decay", adherence_decay)
            flags           = getattr(pr, "warnings",        flags) or []

        sd = getattr(enriched_ctx, "sdoh_score", None)
        if sd:
            sdoh_score = getattr(sd, "overall_score", sdoh_score)
            seasonal   = getattr(sd, "seasonal", None)
            if seasonal:
                active = [
                    k for k, v in {
                        "rainy_season": getattr(seasonal, "is_rainy_season", False),
                        "lean_season":  getattr(seasonal, "is_lean_season",  False),
                        "ramadan":      getattr(seasonal, "is_ramadan",       False),
                        "harvest":      getattr(seasonal, "is_harvest",       False),
                    }.items() if v
                ]
                season = "+".join(active) if active else "dry_season"

    snap = CRISnapshot(
        patient_id      = patient_id,
        recorded_at     = now.isoformat(),
        cri             = round(cri, 1),
        cri_label       = cri_label,
        escalation_prob = round(escalation_prob, 3),
        adherence_decay = round(adherence_decay, 3),
        flags           = flags,
        sdoh_score      = round(sdoh_score, 3),
        season          = season,
    )

    key = _SNAP_KEY.format(pid=patient_id)
    redis_client.zadd(key, {json.dumps(snap.to_dict()): now.timestamp()})
    redis_client.expire(key, _SNAP_TTL)

    # Invalidate patient outcome cache
    redis_client.delete(_CACHE_KEY.format(pid=patient_id))


# ---------------------------------------------------------------------------
# Delta computation helpers
# ---------------------------------------------------------------------------

def _nearest_snapshot_before(
    snapshots: list[tuple[float, dict]],   # (unix_ts, snap_dict) sorted oldest-first
    cutoff_ts: float,
    tolerance_days: int = 7,
) -> Optional[dict]:
    """Return the snapshot closest to cutoff_ts (within tolerance)."""
    tolerance_sec = tolerance_days * 86400
    best: Optional[tuple[float, dict]] = None
    for ts, snap in snapshots:
        if ts <= cutoff_ts + tolerance_sec:
            if best is None or abs(ts - cutoff_ts) < abs(best[0] - cutoff_ts):
                best = (ts, snap)
    return best[1] if best else None


def _compute_trajectory(delta: float) -> str:
    if delta <= _IMPROVE_DELTA:
        return _TRAJ_IMPROVED
    if delta >= _DECLINE_DELTA:
        return _TRAJ_DECLINING
    return _TRAJ_STABLE


def _compute_deltas(
    snapshots: list[tuple[float, dict]],
    current_cri: float,
    current_ts: float,
    today: date,
) -> list[DeltaWindow]:
    windows: list[DeltaWindow] = []
    for days in _DELTA_WINDOWS:
        cutoff_ts  = current_ts - days * 86400
        baseline   = _nearest_snapshot_before(snapshots, cutoff_ts)
        if baseline:
            b_cri      = float(baseline["cri"])
            delta      = current_cri - b_cri
            trajectory = _compute_trajectory(delta)
            b_date     = baseline.get("recorded_at", "")[:10]
        else:
            b_cri      = None
            delta      = 0.0
            trajectory = _TRAJ_NEW
            b_date     = None

        windows.append(DeltaWindow(
            days           = days,
            baseline_cri   = round(b_cri, 1) if b_cri is not None else None,
            current_cri    = round(current_cri, 1),
            delta          = round(delta, 1),
            trajectory     = trajectory,
            baseline_date  = b_date,
        ))
    return windows


def _build_sparkline(
    snapshots: list[tuple[float, dict]],
    today: date,
    days: int = 90,
) -> list[SparklinePoint]:
    """Weekly granularity sparkline for the last `days` days."""
    cutoff_ts  = (datetime.combine(today, datetime.min.time()) - timedelta(days=days)).timestamp()
    recent     = [(ts, s) for ts, s in snapshots if ts >= cutoff_ts]

    if not recent:
        return []

    # Bucket by week
    buckets: dict[str, list[float]] = {}
    for ts, snap in recent:
        week_start = (datetime.utcfromtimestamp(ts) - timedelta(days=datetime.utcfromtimestamp(ts).weekday())).date().isoformat()
        buckets.setdefault(week_start, []).append(float(snap["cri"]))

    return [
        SparklinePoint(date=wk, cri=round(sum(cris) / len(cris), 1))
        for wk, cris in sorted(buckets.items())
    ]


def _best_trajectory(deltas: list[DeltaWindow]) -> str:
    """Pick the most informative window trajectory (prefer 90d > 30d > 180d)."""
    order = [90, 30, 180]
    by_days = {d.days: d for d in deltas}
    for preferred in order:
        if preferred in by_days and by_days[preferred].trajectory != _TRAJ_NEW:
            return by_days[preferred].trajectory
    # All windows insufficient data
    return _TRAJ_NEW


def _interpret(
    current_cri:  float,
    trajectory:   str,
    delta_30:     Optional[float],
) -> str:
    if trajectory == _TRAJ_NEW:
        return "Not enough historical data yet — outcomes will appear after the first 30-day window."
    direction = ""
    if trajectory == _TRAJ_IMPROVED:
        direction = f"improving (CRI dropped {abs(delta_30 or 0):.1f} pts in 30 days)"
    elif trajectory == _TRAJ_DECLINING:
        direction = f"declining (CRI rose {abs(delta_30 or 0):.1f} pts in 30 days)"
    else:
        direction = "stable"

    severity = ""
    if current_cri >= _CRITICAL_CRI:
        severity = " — patient remains in critical range and requires urgent intervention"
    elif current_cri >= 65:
        severity = " — patient is still high-risk"

    return f"Patient outcome is {direction}{severity}."


# ---------------------------------------------------------------------------
# Patient outcome summary
# ---------------------------------------------------------------------------

def get_patient_outcomes(
    patient_id:   str,
    redis_client: redis_lib.Redis,
    today:        Optional[date] = None,
    force:        bool = False,
) -> Optional[OutcomeSummary]:
    today = today or date.today()

    # Check cache
    cache_key = _CACHE_KEY.format(pid=patient_id)
    if not force:
        cached = redis_client.get(cache_key)
        if cached:
            try:
                return _dict_to_outcome_summary(json.loads(cached))
            except Exception:
                pass

    # Load snapshots
    snap_key = _SNAP_KEY.format(pid=patient_id)
    raw_snaps = redis_client.zrangebyscore(snap_key, 0, "+inf", withscores=True)
    if not raw_snaps:
        return None

    snapshots: list[tuple[float, dict]] = []
    for member, score in raw_snaps:
        try:
            snapshots.append((score, json.loads(member)))
        except Exception:
            pass

    if not snapshots:
        return None

    # Current = most recent snapshot
    latest_ts, latest_snap = snapshots[-1]
    current_cri = float(latest_snap["cri"])
    current_label = latest_snap.get("cri_label", "moderate")

    deltas     = _compute_deltas(snapshots, current_cri, latest_ts, today)
    sparkline  = _build_sparkline(snapshots, today)
    trajectory = _best_trajectory(deltas)

    delta_30 = next((d.delta for d in deltas if d.days == 30), None)

    first_snap = snapshots[0][1]
    first_date = first_snap.get("recorded_at", "")[:10] or None

    summary = OutcomeSummary(
        patient_id          = patient_id,
        computed_at         = datetime.utcnow().isoformat(),
        current_cri         = round(current_cri, 1),
        current_label       = current_label,
        overall_trajectory  = trajectory,
        deltas              = deltas,
        sparkline           = sparkline,
        snapshot_count      = len(snapshots),
        first_recorded      = first_date,
        interpretation      = _interpret(current_cri, trajectory, delta_30),
    )

    # Cache result
    try:
        redis_client.setex(cache_key, _CACHE_TTL, json.dumps(summary.to_dict()))
    except Exception:
        pass

    return summary


def _dict_to_outcome_summary(d: dict) -> OutcomeSummary:
    """Re-hydrate from cached dict (shallow, for API response purposes)."""
    d["deltas"] = [DeltaWindow(**w) for w in d.get("deltas", [])]
    d["sparkline"] = [SparklinePoint(**p) for p in d.get("sparkline", [])]
    return OutcomeSummary(**d)


# ---------------------------------------------------------------------------
# Population outcome aggregation
# ---------------------------------------------------------------------------

def get_population_outcomes(
    caregiver_id:  str,
    panel_records: list[dict],
    redis_client:  redis_lib.Redis,
    today:         Optional[date] = None,
    force:         bool = False,
) -> PopulationOutcome:
    today = today or date.today()

    # Check cache
    pop_key = _POP_KEY.format(cid=caregiver_id)
    if not force:
        cached = redis_client.get(pop_key)
        if cached:
            try:
                return PopulationOutcome(**json.loads(cached))
            except Exception:
                pass

    improving = stable = declining = critical = new_data = 0
    all_cris: list[float] = []
    traj_cri_map: dict[str, list[float]] = {
        _TRAJ_IMPROVED: [], _TRAJ_STABLE: [],
        _TRAJ_DECLINING: [], _TRAJ_CRITICAL: [], _TRAJ_NEW: [],
    }

    best_pid: Optional[str]  = None
    worst_pid: Optional[str] = None
    best_delta  = 0.0
    worst_delta = 0.0

    for rec in panel_records:
        pid = rec.get("patient_id", rec.get("id", ""))
        if not pid:
            continue
        summary = get_patient_outcomes(pid, redis_client, today)
        cri     = float(rec.get("cri", rec.get("cri_score", 50)))
        all_cris.append(cri)

        if summary is None:
            new_data += 1
            traj_cri_map[_TRAJ_NEW].append(cri)
            continue

        traj = summary.overall_trajectory
        delta_30 = next((d.delta for d in summary.deltas if d.days == 30), 0.0) or 0.0

        if cri >= _CRITICAL_CRI:
            critical += 1
            traj_cri_map[_TRAJ_CRITICAL].append(cri)
        elif traj == _TRAJ_IMPROVED:
            improving += 1
            traj_cri_map[_TRAJ_IMPROVED].append(cri)
            if delta_30 < best_delta or best_pid is None:
                best_delta = delta_30
                best_pid   = pid[:8] + "…"
        elif traj == _TRAJ_DECLINING:
            declining += 1
            traj_cri_map[_TRAJ_DECLINING].append(cri)
            if delta_30 > worst_delta or worst_pid is None:
                worst_delta = delta_30
                worst_pid   = pid[:8] + "…"
        elif traj == _TRAJ_NEW:
            new_data += 1
            traj_cri_map[_TRAJ_NEW].append(cri)
        else:
            stable += 1
            traj_cri_map[_TRAJ_STABLE].append(cri)

    total     = len(panel_records)
    avg_cri   = round(sum(all_cris) / total, 1) if all_cris else 0.0

    # Improvement rate excludes stable + new
    contest = improving + declining
    improvement_rate = round(improving / contest, 3) if contest > 0 else 0.0

    # Build trajectory groups
    def _avg(lst: list[float]) -> float:
        return round(sum(lst) / len(lst), 1) if lst else 0.0

    groups = [
        PopulationOutcomeGroup("improving", improving,  round(improving  / max(1,total), 3), _avg(traj_cri_map[_TRAJ_IMPROVED])),
        PopulationOutcomeGroup("stable",    stable,     round(stable     / max(1,total), 3), _avg(traj_cri_map[_TRAJ_STABLE])),
        PopulationOutcomeGroup("declining", declining,  round(declining  / max(1,total), 3), _avg(traj_cri_map[_TRAJ_DECLINING])),
        PopulationOutcomeGroup("critical",  critical,   round(critical   / max(1,total), 3), _avg(traj_cri_map[_TRAJ_CRITICAL])),
        PopulationOutcomeGroup("new_data",  new_data,   round(new_data   / max(1,total), 3), _avg(traj_cri_map[_TRAJ_NEW])),
    ]

    recs = _population_recommendations(improvement_rate, declining, critical, total)

    result = PopulationOutcome(
        caregiver_id      = caregiver_id,
        computed_at       = datetime.utcnow().isoformat(),
        total_patients    = total,
        avg_cri           = avg_cri,
        trajectory_groups = groups,
        improving_count   = improving,
        stable_count      = stable,
        declining_count   = declining,
        critical_count    = critical,
        new_count         = new_data,
        improvement_rate  = improvement_rate,
        best_outcome_pid  = best_pid,
        worst_outcome_pid = worst_pid,
        recommendations   = recs,
    )

    try:
        redis_client.setex(pop_key, _POP_TTL, json.dumps(result.to_dict()))
    except Exception:
        pass

    return result


def _population_recommendations(
    improvement_rate: float,
    declining:        int,
    critical:         int,
    total:            int,
) -> list[str]:
    recs: list[str] = []
    if critical >= 3:
        recs.append(f"{critical} patients are in critical range (CRI ≥ 80) — arrange clinical officer review within 24 h")
    if declining >= max(2, int(0.20 * total)):
        recs.append(
            f"{declining} patients are deteriorating — review care plans for adherence barriers and SDOH factors"
        )
    if improvement_rate < 0.40 and (declining + total > 0):
        recs.append("Less than 40% of tracked patients are improving — consider care protocol refresh with supervisor")
    if improvement_rate >= 0.70:
        recs.append("Strong outcomes across panel — document and share successful care strategies with peer CHWs")
    if not recs:
        recs.append("Outcomes are within expected range — continue current care protocols")
    return recs
