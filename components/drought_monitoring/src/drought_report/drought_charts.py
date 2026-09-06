# ── drought_report/drought_charts.py ──────────────────────────────────────────

from __future__ import annotations
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np
import pandas as pd

from utils.utils import BAND_LABELS

LEVEL_HEX = {
    "NORMAL": "#4CAF50",
    "WATCH": "#FFA726",
    "MODERATE": "#EF6C00",
    "SEVERE": "#B71C1C",
}
C_BG = "#FAFAFA"


def generate_trend_chart(daily_df: pd.DataFrame, output_path: str) -> str:
    """
    Bar chart of daily drought score over the lookback window.
    Bar colour encodes the daily level. A trend line is overlaid.
    """
    df = daily_df.copy()
    if pd.api.types.is_datetime64_any_dtype(df["date"]):
        df["date"] = df["date"].dt.strftime("%d %b")
    else:
        df["date"] = pd.to_datetime(df["date"]).dt.strftime("%d %b")

    scores = df["drought_score"].tolist()
    levels = df["drought_level"].fillna("NORMAL").tolist()
    labels = df["date"].tolist()
    bar_colors = [LEVEL_HEX.get(l, "#4CAF50") for l in levels]

    fig, ax = plt.subplots(figsize=(14, 4))
    fig.patch.set_facecolor(C_BG)
    ax.set_facecolor(C_BG)

    x = np.arange(len(scores))
    ax.bar(x, scores, color=bar_colors, width=0.72, zorder=2)

    # Trend line (rolling mean so it's smooth)
    if len(scores) >= 4:
        window = min(5, len(scores))
        smoothed = pd.Series(scores).rolling(window, center=True, min_periods=1).mean()
        ax.plot(
            x,
            smoothed,
            color="#212121",
            linewidth=1.5,
            linestyle="--",
            zorder=3,
            label="Trend",
        )

    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=45, ha="right", fontsize=8)
    ax.set_yticks([0, 1, 2, 3, 4])
    ax.set_yticklabels(["0", "1\nWatch", "2\nModerate", "3", "4\nSevere"], fontsize=8)
    ax.set_ylim(0, 4.6)
    ax.set_ylabel("Stress score", fontsize=9)
    ax.set_xlim(-0.6, len(scores) - 0.4)

    for spine in ["top", "right"]:
        ax.spines[spine].set_visible(False)

    # Legend
    patches = [mpatches.Patch(color=c, label=l) for l, c in LEVEL_HEX.items()]
    ax.legend(handles=patches, fontsize=8, loc="upper left", framealpha=0.7, ncol=4)

    plt.tight_layout()
    plt.savefig(output_path, dpi=160, bbox_inches="tight", facecolor=C_BG)
    plt.close()
    return output_path


def generate_sensor_chart(
    averages: dict,
    results: dict,
    thresholds,
    output_path: str,
) -> str:
    """
    Horizontal bar chart — one row per sensor.
    Each bar shows the actual value as a fraction of the safe threshold.
    Red fill = below threshold, green fill = above threshold.
    """
    bands = list(averages.keys())
    n = len(bands)

    fig, ax = plt.subplots(figsize=(14, n * 1.4 + 0.6))
    fig.patch.set_facecolor(C_BG)
    ax.set_facecolor(C_BG)

    for i, band in enumerate(bands):
        thresh = thresholds.get(band)
        value = averages.get(band)
        result = results.get(band)

        if value is None or thresh is None:
            continue

        # Normalise to % of threshold so all bands are on the same 0-100+ scale
        pct = (value / thresh.alert_thresh) * 100
        good_pct = (thresh.good_mean / thresh.alert_thresh) * 100
        bar_color = "#EF5350" if (result and result.flag) else "#66BB6A"

        # Background track up to good_mean
        ax.barh(i, good_pct, height=0.5, color="#E0E0E0", zorder=1)
        # Actual value
        ax.barh(i, min(pct, 150), height=0.5, color=bar_color, zorder=2)
        # Threshold line
        ax.axvline(
            100, color="#424242", linewidth=1, linestyle="--", zorder=3, alpha=0.6
        )

        label_txt = (
            f"{BAND_LABELS[band]}  —  "
            f"{'⚠ Below safe level' if result and result.flag else '✓ Normal'}  "
            f"({pct:.0f}% of safe limit)"
        )
        ax.text(2, i, label_txt, va="center", fontsize=9, color="#212121")

    ax.set_xlim(0, 155)
    ax.set_yticks([])
    ax.set_xlabel("% of safe threshold  (100% = minimum safe level)", fontsize=9)
    ax.axvspan(0, 100, alpha=0.03, color="red")
    ax.axvspan(100, 155, alpha=0.03, color="green")
    ax.text(
        50, n - 0.1, "Stress zone", ha="center", fontsize=8, color="#b71c1c", alpha=0.7
    )
    ax.text(
        125, n - 0.1, "Safe zone", ha="center", fontsize=8, color="#2e7d32", alpha=0.7
    )

    for spine in ["top", "right", "left"]:
        ax.spines[spine].set_visible(False)

    plt.tight_layout()
    plt.savefig(output_path, dpi=160, bbox_inches="tight", facecolor=C_BG)
    plt.close()
    return output_path
