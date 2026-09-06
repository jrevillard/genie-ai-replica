from __future__ import annotations
import os, tempfile, numpy as np
from datetime import datetime, timedelta
import pandas as pd
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    HRFlowable,
    Image as RLImage,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from drought_classify.classify_drought import (
    BandResult,
    classify_band,
    classify_drought,
)
from drought_report.drought_charts import generate_trend_chart, generate_sensor_chart
from utils.utils import ALL_BANDS, Threshold, Thresholds

THRESHOLDS = Thresholds(
    sm_surface=Threshold(0.3576, 0.1479, 0.3228),
    land_evapotranspiration_flux=Threshold(3.9267, 2.1716, 3.1883),
    overland_runoff_flux=Threshold(2.3873, 0.1561, 1.2717),
    NDVI=Threshold(0.7008, 0.5523, 0.6914),
)

# ── plain-language descriptions shown to farmer ────────────────────────────────
BAND_PLAIN = {
    "sm_surface": "Soil water",
    "land_evapotranspiration_flux": "Plant water use",
    "overland_runoff_flux": "Recent rainfall runoff",
    "NDVI": "Crop greenness",
}
BAND_FARMER_DESC = {
    "sm_surface": (
        "How much water is in the top layer of your soil. "
        "When this is low, roots cannot draw enough moisture and crops begin to wilt."
    ),
    "land_evapotranspiration_flux": (
        "How much water your plants and soil are releasing. "
        "A low reading means plants are stressed and not growing normally."
    ),
    "overland_runoff_flux": (
        "Water running over the surface after rain. "
        "Very low values mean there has been little rainfall recently."
    ),
    "NDVI": (
        "A satellite measure of how green and dense your crops are. "
        "Falling values are an early warning that vegetation is under stress."
    ),
}

LEVEL_PLAIN = {
    "NORMAL": "All clear — conditions are healthy",
    "WATCH": "Early warning — keep a close eye on your field",
    "MODERATE": "Drought stress — crops may be affected soon",
    "SEVERE": "Severe drought — act immediately to protect crops",
}

LEVEL_COLOR = {
    "NORMAL": colors.HexColor("#2e7d32"),
    "WATCH": colors.HexColor("#f57f17"),
    "MODERATE": colors.HexColor("#e65100"),
    "SEVERE": colors.HexColor("#b71c1c"),
}
LEVEL_BG = {
    "NORMAL": colors.HexColor("#e8f5e9"),
    "WATCH": colors.HexColor("#fff8e1"),
    "MODERATE": colors.HexColor("#fff3e0"),
    "SEVERE": colors.HexColor("#ffebee"),
}
HEADER_COLOR = colors.HexColor("#1a237e")
SUBHEADER_COLOR = colors.HexColor("#283593")
ROW_ALT_COLOR = colors.HexColor("#f5f5f5")
PAGE_W = A4[0] - 4 * cm

TREND_RANK = {"NORMAL": 0, "WATCH": 1, "MODERATE": 2, "SEVERE": 3}

# ── how often to recommend re-checking based on level + trend ─────────────────
RECHECK_DAYS = {
    ("SEVERE", "WORSENING"): 2,
    ("SEVERE", "STABLE"): 3,
    ("SEVERE", "IMPROVING"): 3,
    ("MODERATE", "WORSENING"): 3,
    ("MODERATE", "STABLE"): 4,
    ("MODERATE", "IMPROVING"): 5,
    ("WATCH", "WORSENING"): 4,
    ("WATCH", "STABLE"): 5,
    ("WATCH", "IMPROVING"): 7,
    ("NORMAL", "WORSENING"): 5,
    ("NORMAL", "STABLE"): 7,
    ("NORMAL", "IMPROVING"): 7,
}

ACTIONS = {
    "SEVERE": [
        "🚨  Contact your local agricultural extension officer today.",
        "💧  Apply emergency irrigation if any water source is available.",
        "🌾  Harvest any mature crops now to avoid total loss.",
        "📋  Document crop damage for disaster-relief applications.",
    ],
    "MODERATE": [
        "🔶  Water less often, but more deeply each time.",
        "🌱  Do not plant new water-hungry crops until rains return.",
        "💦  Fix any leaks in your irrigation system.",
        "📅  Re-check your field in a few days.",
    ],
    "WATCH": [
        "⚠   Start saving water — cut back on non-essential irrigation.",
        "🌿  Add mulch around crops to slow soil drying.",
        "📊  Watch rainfall closely over the coming week.",
    ],
    "NORMAL": [
        "✅  Your field is in good condition.",
        "📆  Keep checking regularly — drought can develop quickly.",
        "🌧   Watch for any long dry spells in the coming weeks.",
    ],
}


def get_daily_trend_message(daily_df: pd.DataFrame) -> str:
    if daily_df is None or daily_df.empty:
        return "Daily trend data not available."

    levels = daily_df["drought_level"].fillna("NORMAL").tolist()
    ranks = [TREND_RANK[l] for l in levels]

    # Consecutive worsening run at the tail
    run = 1
    for i in range(len(ranks) - 1, 0, -1):
        if ranks[i] > ranks[i - 1]:
            run += 1
        else:
            break

    slope = float(np.polyfit(range(len(ranks)), ranks, 1)[0])

    worsening = run >= 3 or (slope > 0.15 and ranks[-1] > ranks[0])

    if worsening:
        start_date = daily_df["date"].iloc[-run]
        end_date = daily_df["date"].iloc[-1]
        return (
            f"Warning: conditions have worsened for {run} consecutive days "
            f"({start_date} → {end_date}). "
            "Continue monitoring — situation may escalate."
        )

    if len(set(levels)) == 1:
        return f"Conditions remained {levels[0]} throughout the period."

    return (
        "Daily alerts were mixed with no clear worsening trend. "
        "Continue regular monitoring."
    )


# ── trend analysis ─────────────────────────────────────────────────────────────
def analyse_trend(daily_df: pd.DataFrame) -> dict:
    """
    Returns a dict with keys:
      trend        : "WORSENING" | "STABLE" | "IMPROVING"
      run          : int  — consecutive days at tail moving in that direction
      warning      : bool
      message      : str  — plain-language sentence for the farmer
      recheck_days : int
    """
    if daily_df is None or daily_df.empty:
        return dict(
            trend="STABLE",
            run=0,
            warning=False,
            message="Not enough data to assess trend.",
            recheck_days=7,
        )

    levels = daily_df["drought_level"].fillna("NORMAL").tolist()
    ranks = [TREND_RANK[l] for l in levels]

    # Tail run
    run = 1
    for i in range(len(ranks) - 1, 0, -1):
        if ranks[i] > ranks[i - 1]:
            run += 1
        else:
            break

    slope = float(np.polyfit(range(len(ranks)), ranks, 1)[0])
    overall = ranks[-1] - ranks[0]

    worsening = run >= 3 or (slope > 0.15 and overall > 0)
    improving = run >= 3 and all(
        ranks[i] <= ranks[i - 1]
        for i in range(len(ranks) - 1, max(len(ranks) - 4, 0), -1)
    )

    if worsening:
        trend = "WORSENING"
        current_level = levels[-1]
        start_date = str(daily_df["date"].iloc[-run])[:10]
        end_date = str(daily_df["date"].iloc[-1])[:10]
        message = (
            f"⚠ Warning: conditions have been getting worse for {run} days in a row "
            f"({start_date} to {end_date}). "
            "Continue monitoring closely — the situation may worsen further."
        )
        warning = True
    elif improving:
        trend = "IMPROVING"
        message = "Conditions have been slowly improving. Keep monitoring."
        warning = False
    else:
        trend = "STABLE"
        message = "Conditions have been mostly stable with no clear direction."
        warning = False

    current_level = levels[-1]
    recheck = RECHECK_DAYS.get((current_level, trend), 5)

    return dict(
        trend=trend, run=run, warning=warning, message=message, recheck_days=recheck
    )


# ── plain-language field summary ───────────────────────────────────────────────
def field_summary(results: dict[str, BandResult], level: str, trend: str) -> list[str]:
    """
    Returns 2-3 plain-language sentences a non-technical farmer can read.
    """
    stressed = [b for b, r in results.items() if r.flag]
    ok = [b for b, r in results.items() if not r.flag]

    lines = []
    if level == "NORMAL":
        lines.append("Your soil and crops are in good health right now.")
    elif level == "WATCH":
        lines.append(
            f"Your {BAND_PLAIN[stressed[0]].lower()} is starting to drop below safe levels."
            " This is an early warning sign — no damage yet, but worth watching."
        )
    elif level == "MODERATE":
        stressed_names = " and ".join(BAND_PLAIN[b].lower() for b in stressed[:2])
        lines.append(
            f"Your {stressed_names} are below the safe level. "
            "Crops are under stress and may show damage if conditions do not improve soon."
        )
    elif level == "SEVERE":
        lines.append(
            "Multiple sensors show critically low levels. "
            "Crops are at serious risk of damage or failure."
        )

    if ok and level != "NORMAL":
        ok_names = " and ".join(BAND_PLAIN[b].lower() for b in ok[:2])
        lines.append(f"On the positive side, your {ok_names} are still normal.")

    if trend == "WORSENING":
        lines.append(
            "The situation has been getting worse over recent days — act soon."
        )
    elif trend == "IMPROVING":
        lines.append("The good news is that conditions have started to improve.")

    return lines


# ── main report function ───────────────────────────────────────────────────────
def generate_pdf_report(
    geo_info: dict,
    averages: dict,
    start: str,
    end: str,
    lat: float,
    lon: float,
    output_path: str = "output/drought_report.pdf",
    daily_df: pd.DataFrame | None = None,
) -> str:

    results: dict[str, BandResult] = {
        b: classify_band(b, averages.get(b)) for b in ALL_BANDS
    }
    score = sum(r.flag for r in results.values())
    level = classify_drought(score)
    level_color = LEVEL_COLOR[level]
    level_bg = LEVEL_BG[level]
    n_days = (pd.Timestamp(end) - pd.Timestamp(start)).days + 1

    trend_info = analyse_trend(daily_df)
    trend = trend_info["trend"]
    summary_lines = field_summary(results, level, trend)

    TREND_ARROW = {
        "WORSENING": "↑ Getting worse",
        "STABLE": "→ Stable",
        "IMPROVING": "↓ Improving",
    }

    tmpdir = tempfile.mkdtemp()
    trend_chart_path = os.path.join(tmpdir, "trend.png")
    sensor_chart_path = os.path.join(tmpdir, "sensors.png")

    # Generate both charts
    if daily_df is not None and not daily_df.empty:
        generate_trend_chart(daily_df, output_path=trend_chart_path)
    generate_sensor_chart(averages, results, THRESHOLDS, output_path=sensor_chart_path)

    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
    )
    styles = getSampleStyleSheet()
    story = []

    def S(name, **kw):
        return ParagraphStyle(name, parent=styles["Normal"], **kw)

    # ── styles ─────────────────────────────────────────────────────────────────
    title_s = S(
        "T",
        fontSize=18,
        textColor=colors.white,
        alignment=TA_CENTER,
        fontName="Helvetica-Bold",
        leading=28,
    )
    sub_s = S(
        "ST",
        fontSize=10,
        textColor=colors.HexColor("#bbdefb"),
        alignment=TA_CENTER,
        fontName="Helvetica",
        leading=16,
    )
    section_s = S(
        "SC",
        fontSize=12,
        textColor=SUBHEADER_COLOR,
        fontName="Helvetica-Bold",
        spaceBefore=12,
        spaceAfter=3,
    )
    body_s = S("B", fontSize=9, leading=15, textColor=colors.HexColor("#212121"))
    caption_s = S(
        "C",
        fontSize=7,
        textColor=colors.HexColor("#757575"),
        fontName="Helvetica-Oblique",
    )
    alert_s = S(
        "A",
        fontSize=13,
        textColor=level_color,
        fontName="Helvetica-Bold",
        alignment=TA_CENTER,
        leading=22,
    )
    trend_s = S(
        "TR",
        fontSize=9,
        leading=13,
        textColor=(
            colors.HexColor("#b71c1c")
            if trend_info["warning"]
            else colors.HexColor("#1a237e")
        ),
    )
    summary_s = S(
        "SM",
        fontSize=10,
        leading=16,
        textColor=colors.HexColor("#212121"),
        leftIndent=8,
    )
    advice_s = S(
        "AD",
        fontSize=10,
        leading=16,
        textColor=colors.HexColor("#212121"),
        leftIndent=12,
    )
    recheck_s = S(
        "RC", fontSize=10, leading=15, textColor=SUBHEADER_COLOR, alignment=TA_CENTER
    )

    # ── HEADER ─────────────────────────────────────────────────────────────────
    header = Table(
        [
            [Paragraph("FIELD DROUGHT REPORT", title_s)],
            [
                Paragraph(
                    f"Generated {datetime.now().strftime('%d %B %Y')}  |  "
                    f"{start} to {end}  ({n_days} days)  |  "
                    f"{geo_info.get('district','—')}, {geo_info.get('country','—')}",
                    sub_s,
                )
            ],
        ],
        colWidths=[PAGE_W],
    )
    header.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), HEADER_COLOR),
                ("TOPPADDING", (0, 0), (-1, -1), 14),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
                ("LEFTPADDING", (0, 0), (-1, -1), 16),
                ("RIGHTPADDING", (0, 0), (-1, -1), 16),
            ]
        )
    )
    story.append(header)
    story.append(Spacer(1, 0.35 * cm))

    # ── OVERALL STATUS BANNER ──────────────────────────────────────────────────
    LEVEL_EMOJI = {"NORMAL": "✅", "WATCH": "⚠", "MODERATE": "🔶", "SEVERE": "🚨"}
    banner = Table(
        [
            [
                Paragraph(
                    f"{LEVEL_EMOJI[level]}  {level}  —  {LEVEL_PLAIN[level]}<br/>"
                    f"<font size='10'>{score} of 4 sensors stressed  |  "
                    f"Trend: {TREND_ARROW[trend]}</font>",
                    alert_s,
                )
            ]
        ],
        colWidths=[PAGE_W],
    )
    banner.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), level_bg),
                ("BOX", (0, 0), (-1, -1), 2, level_color),
                ("TOPPADDING", (0, 0), (-1, -1), 14),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
            ]
        )
    )
    story.append(banner)
    story.append(Spacer(1, 0.25 * cm))

    # Trend warning line (only when worsening)
    if trend_info["warning"]:
        story.append(Paragraph(trend_info["message"], trend_s))
        story.append(Spacer(1, 0.3 * cm))

    # ── PLAIN-LANGUAGE FIELD SUMMARY ───────────────────────────────────────────
    story.append(Paragraph("What is happening on your field?", section_s))
    for line in summary_lines:
        story.append(Paragraph(line, summary_s))
        story.append(Spacer(1, 2))
    story.append(Spacer(1, 0.3 * cm))

    # ── 20-DAY TREND CHART ─────────────────────────────────────────────────────
    if daily_df is not None and not daily_df.empty and os.path.exists(trend_chart_path):
        story.append(
            Paragraph("How conditions changed over your selected period", section_s)
        )
        story.append(
            Paragraph(
                "Each bar is one day. Taller and darker bars mean more drought stress.",
                caption_s,
            )
        )
        story.append(Spacer(1, 0.2 * cm))
        story.append(RLImage(trend_chart_path, width=PAGE_W, height=PAGE_W * 0.38))
        story.append(Spacer(1, 0.3 * cm))

    # ── SENSOR STATUS PILLS ────────────────────────────────────────────────────
    story.append(Paragraph("What each sensor is showing today", section_s))
    story.append(
        Paragraph(
            "Green = safe level  |  Orange = early warning  |  Red = below safe level",
            caption_s,
        )
    )
    story.append(Spacer(1, 0.2 * cm))

    pill_data = [[]]
    for band in ALL_BANDS:
        res = results[band]
        pct = (
            f"{res.pct_of_threshold}% of safe level"
            if res.pct_of_threshold
            else "No data"
        )
        if res.flag:
            bg_c, fg_c, status_txt = (
                colors.HexColor("#ffebee"),
                colors.HexColor("#b71c1c"),
                "⚠ LOW",
            )
        else:
            bg_c, fg_c, status_txt = (
                colors.HexColor("#e8f5e9"),
                colors.HexColor("#2e7d32"),
                "✓ OK",
            )
        cell = Table(
            [
                [
                    Paragraph(
                        f"<b>{BAND_PLAIN[band]}</b>",
                        S(
                            f"p{band}",
                            fontSize=9,
                            fontName="Helvetica-Bold",
                            textColor=fg_c,
                            alignment=TA_CENTER,
                        ),
                    )
                ],
                [
                    Paragraph(
                        status_txt,
                        S(
                            f"s{band}",
                            fontSize=11,
                            fontName="Helvetica-Bold",
                            textColor=fg_c,
                            alignment=TA_CENTER,
                        ),
                    )
                ],
                [
                    Paragraph(
                        pct,
                        S(f"q{band}", fontSize=8, textColor=fg_c, alignment=TA_CENTER),
                    )
                ],
            ],
            colWidths=[PAGE_W / 4 - 0.3 * cm],
        )
        cell.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), bg_c),
                    ("BOX", (0, 0), (-1, -1), 1, fg_c),
                    ("TOPPADDING", (0, 0), (-1, -1), 7),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                    ("ROUNDEDCORNERS", [6]),
                ]
            )
        )
        pill_data[0].append(cell)

    pill_table = Table(pill_data, colWidths=[PAGE_W / 4] * 4, hAlign="LEFT")
    pill_table.setStyle(
        TableStyle(
            [
                ("LEFTPADDING", (0, 0), (-1, -1), 3),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    story.append(pill_table)
    story.append(Spacer(1, 0.4 * cm))

    # ── SENSOR DETAIL CHART ────────────────────────────────────────────────────
    if os.path.exists(sensor_chart_path):
        story.append(Paragraph("Sensor readings in detail", section_s))
        story.append(
            Paragraph(
                "The bar shows where your reading sits between zero and a healthy level. "
                "Red means your reading is in the danger zone.",
                caption_s,
            )
        )
        # ── WHAT EACH SENSOR MEANS ─────────────────────────────────────────────────
        story.append(Paragraph("What each sensor measures", section_s))
        for band in ALL_BANDS:
            res = results[band]
            dot_col = "#b71c1c" if res.flag else "#2e7d32"
            story.append(
                Paragraph(
                    f'<font color="{dot_col}"><b>● {BAND_PLAIN[band]}</b></font>',
                    S("bh", fontSize=10, fontName="Helvetica-Bold", spaceBefore=5),
                )
            )
            story.append(Paragraph(BAND_FARMER_DESC[band], body_s))
        story.append(Spacer(1, 0.4 * cm))
        story.append(Spacer(1, 0.2 * cm))
        story.append(RLImage(sensor_chart_path, width=PAGE_W, height=PAGE_W * 0.55))
        story.append(Spacer(1, 0.3 * cm))

    # ── RECOMMENDED ACTIONS ────────────────────────────────────────────────────
    story.append(HRFlowable(width="100%", thickness=1, color=HEADER_COLOR))
    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph("What you should do now", section_s))
    for action in ACTIONS[level]:
        story.append(Paragraph(action, advice_s))
        story.append(Spacer(1, 3))
    story.append(Spacer(1, 0.4 * cm))

    # ── NEXT CHECK REMINDER ────────────────────────────────────────────────────

    recheck_date = (
        datetime.strptime(end, "%Y-%m-%d") + timedelta(days=trend_info["recheck_days"])
    ).strftime("%d %B %Y")
    recheck_box = Table(
        [
            [
                Paragraph(
                    f"📅  Recommended next check:  <b>{recheck_date}</b>"
                    f"  (in {trend_info['recheck_days']} days)<br/>"
                    f"<font size='8'>"
                    + (
                        "Conditions are worsening — do not wait longer."
                        if trend_info["warning"]
                        else "Regular monitoring keeps you ahead of drought."
                    )
                    + "</font>",
                    recheck_s,
                )
            ]
        ],
        colWidths=[PAGE_W],
    )
    recheck_box.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#e8eaf6")),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#9fa8da")),
                ("TOPPADDING", (0, 0), (-1, -1), 12),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
            ]
        )
    )
    story.append(recheck_box)
    story.append(Spacer(1, 0.4 * cm))

    # ── FOOTER ─────────────────────────────────────────────────────────────────
    story.append(
        HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#9fa8da"))
    )
    story.append(Spacer(1, 0.2 * cm))
    story.append(
        Paragraph(
            "Data: NASA SMAP SPL4SMGP/008 (soil moisture, ET, runoff)  ·  "
            "NOAA VIIRS NDVI  ·  Google Earth Engine  ·  Advisory use only.",
            caption_s,
        )
    )

    doc.build(story)
    print(f"  [report] PDF saved → {output_path}")
    return output_path
