# Admin Analytics — API Reference & UI/UX Design Brief

## Overview

Two new backend endpoints deliver all the data the admin analytics dashboard needs. Both are protected: the caller must be authenticated **and** have an admin role. All data is automatically scoped to the admin's own patients and AI twins — no extra filtering is needed from the frontend.

---

## Endpoints

### 1. `GET /api/analytics/admin` — Full Summary

Returns every analytics widget's data in a single request. Call this once on page load.

**Query Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `from` | `YYYY-MM-DD` | No | Start of period. Defaults to 30 days ago. |
| `to` | `YYYY-MM-DD` | No | End of period. Defaults to today. |

**Example request**
```
GET /api/analytics/admin?from=2026-04-01&to=2026-04-30
Authorization: Bearer <token>
```

**Response shape**
```json
{
  "period": {
    "from": "2026-04-01T00:00:00.000Z",
    "to": "2026-04-30T23:59:59.999Z"
  },
  "kpis": {
    "totalChatSessions": 142,
    "totalCalls": 38,
    "activePatients": 27,
    "newPatients": 5,
    "totalMessages": 891,
    "avgResponseTimeMs": 1240,
    "avgCallDurationSecs": 183
  },
  "activityByDay": [
    { "day": "2026-04-01", "chatSessions": 4, "calls": 1 },
    { "day": "2026-04-02", "chatSessions": 7, "calls": 3 }
  ],
  "channelSplit": [
    { "channel": "chat", "count": 98 },
    { "channel": "whatsapp", "count": 44 },
    { "channel": "call", "count": 38 }
  ],
  "twinBreakdown": [
    {
      "twinId": "abc123",
      "name": "Dr. Sarah",
      "chatSessions": 80,
      "calls": 22,
      "avgResponseTimeMs": 1100,
      "avgMsgsPerSession": 6.3,
      "avgCallDurationSecs": 195
    }
  ],
  "sessionLengthDistribution": [
    { "bucket": "1-5",  "count": 55 },
    { "bucket": "6-10", "count": 47 },
    { "bucket": "11-20","count": 30 },
    { "bucket": "21+",  "count": 10 }
  ],
  "callDurationDistribution": [
    { "bucket": "<1min",  "count": 5 },
    { "bucket": "1-5min", "count": 18 },
    { "bucket": "5-15min","count": 12 },
    { "bucket": "15+min", "count": 3 }
  ],
  "topCategories": [
    { "category": "Medication", "count": 64 },
    { "category": "Follow-up",  "count": 41 },
    { "category": "Nutrition",  "count": 28 }
  ],
  "callLanguages": [
    { "language": "en", "count": 25 },
    { "language": "ar", "count": 13 }
  ],
  "hourlyDistribution": [
    { "hour": 0, "count": 0 },
    { "hour": 9, "count": 42 },
    { "hour": 10, "count": 67 }
  ]
}
```

---

### 2. `GET /api/analytics/admin/patients` — Per-Patient Breakdown

Paginated table. One row per patient.

**Query Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `from` | `YYYY-MM-DD` | 30 days ago | Start of period |
| `to` | `YYYY-MM-DD` | Today | End of period |
| `offset` | integer | `0` | Pagination offset |
| `limit` | integer | `50` | Max rows (max 200) |

**Example request**
```
GET /api/analytics/admin/patients?from=2026-04-01&to=2026-04-30&offset=0&limit=50
Authorization: Bearer <token>
```

**Response shape**
```json
{
  "total": 31,
  "offset": 0,
  "limit": 50,
  "patients": [
    {
      "patientId": "user-key-123",
      "name": "John Doe",
      "email": "john@example.com",
      "createdAt": "2026-03-10T09:00:00.000Z",
      "chatSessions": 12,
      "calls": 4,
      "totalMessages": 87,
      "avgSessionLength": 7.2,
      "totalCallSecs": 820,
      "avgResponseTimeMs": 1150,
      "lastActive": "2026-04-29T14:33:00.000Z"
    }
  ]
}
```

**Field glossary**

| Field | Description |
|-------|-------------|
| `chatSessions` | Total chat/WhatsApp sessions started in period |
| `calls` | Total voice calls made in period |
| `totalMessages` | Total user messages sent across all chat sessions |
| `avgSessionLength` | Average number of messages per chat session |
| `totalCallSecs` | Total call time in seconds (divide by 60 for minutes) |
| `avgResponseTimeMs` | Average AI response time in milliseconds for this patient |
| `lastActive` | Most recent activity timestamp (chat or call, whichever is later) |

---

## Notes for the Frontend Team

- **Date picker default**: load the last 30 days on first render. Allow the user to pick a custom range.
- **Null values**: `avgResponseTimeMs`, `avgCallDurationSecs`, `avgSessionLength`, `totalCallSecs` can be `null` if there is no data. Display `—` instead of `0` in these cases.
- **`hourlyDistribution`** always returns all 24 hours (0–23), even when count is 0. Safe to plot directly.
- **`sessionLengthDistribution`** and **`callDurationDistribution`** always return all buckets in the correct order.
- **`topCategories`** returns at most 10 items, already sorted by count descending. Only present when the admin has used the auto-routing feature.
- **Authentication header**: `Authorization: Bearer <accessToken>` — same token used everywhere else.

---

---

# UI/UX Design Brief — Admin Analytics Dashboard

## Goal

Design a single **Analytics** page in the admin dashboard. The page should let the admin quickly understand how their patients are engaging with their AI twins, across chat, WhatsApp, and voice calls.

---

## Layout Structure

```
┌─────────────────────────────────────────────────────────┐
│  Page title: Analytics          [Date range picker]      │
├──────────┬──────────┬──────────┬──────────┬─────────────┤
│  KPI     │  KPI     │  KPI     │  KPI     │  KPI card   │
│  card    │  card    │  card    │  card    │  ...        │
├──────────┴──────────┴──────────┴──────────┴─────────────┤
│  Activity over time (line chart)  │  Channel split       │
│  Chat sessions + Calls per day    │  (donut chart)       │
├───────────────────────────────────┴─────────────────────┤
│  Top Conversation Topics (bar chart, horizontal)         │
├──────────────────────────┬──────────────────────────────┤
│  Session Length           │  Call Duration               │
│  Distribution (bar chart) │  Distribution (bar chart)   │
├──────────────────────────┴──────────────────────────────┤
│  Hourly Activity (heatmap bar — messages per hour 0–23) │
├─────────────────────────────────────────────────────────┤
│  Twin Performance Table                                  │
│  (name, chats, calls, avg response time, avg call dur.) │
├─────────────────────────────────────────────────────────┤
│  Patient Engagement Table (paginated)                    │
│  (name, email, chats, calls, msgs, last active, etc.)   │
└─────────────────────────────────────────────────────────┘
```

---

## Section-by-Section Specifications

### Section 1 — KPI Cards (top row)

Display 7 cards in a responsive grid (4 per row on desktop, 2 on tablet, 1 on mobile).

| Card | Value | Unit | Icon suggestion |
|------|-------|------|-----------------|
| Total Chat Sessions | `kpis.totalChatSessions` | sessions | chat bubble |
| Total Calls | `kpis.totalCalls` | calls | phone |
| Active Patients | `kpis.activePatients` | patients | users |
| New Patients | `kpis.newPatients` | this period | user-plus |
| Messages Sent | `kpis.totalMessages` | messages | message |
| Avg Response Time | `kpis.avgResponseTimeMs / 1000` | seconds | clock |
| Avg Call Duration | `kpis.avgCallDurationSecs / 60` | minutes | timer |

- Show `—` for null values (no data yet).
- Each card: large number, label below, small trend icon or unit label.
- Use a subtle colored left-border or icon tint per category.

---

### Section 2 — Activity Over Time (Line Chart)

- **Two series**: "Chat Sessions" (primary color) and "Calls" (secondary color).
- X-axis: dates from `activityByDay[].day`.
- Y-axis: count. Integer ticks only.
- Show a tooltip on hover with exact counts for both series.
- If the range is > 60 days, consider aggregating to weekly.

---

### Section 3 — Channel Split (Donut Chart)

- Three segments from `channelSplit`: Chat, WhatsApp, Call.
- Show segment labels and percentage inside or as a legend below.
- Center label: total interactions.

---

### Section 4 — Top Conversation Topics (Horizontal Bar Chart)

- Source: `topCategories` (up to 10 items, pre-sorted by count).
- Y-axis: category names. X-axis: count.
- If `topCategories` is empty, show a friendly empty state: *"No topic data yet — topics appear once patients start chatting."*

---

### Section 5 — Session Length Distribution (Bar Chart)

- Source: `sessionLengthDistribution`.
- 4 buckets: `1–5 msgs`, `6–10`, `11–20`, `21+`.
- X-axis: bucket labels. Y-axis: number of sessions.
- Title: *"Chat Session Length"*.

---

### Section 6 — Call Duration Distribution (Bar Chart)

- Source: `callDurationDistribution`.
- 4 buckets: `< 1 min`, `1–5 min`, `5–15 min`, `15+ min`.
- Place directly next to Section 5 in a two-column layout.
- Title: *"Call Duration"*.

---

### Section 7 — Hourly Activity (Bar Chart / Heatmap Strip)

- Source: `hourlyDistribution` (24 data points, hours 0–23).
- Show as a bar chart or a single-row colour-intensity heatmap strip.
- X-axis: hour labels (12 AM, 1 AM … 11 PM).
- Highlight the peak hour visually.
- Title: *"When Are Patients Most Active?"*

---

### Section 8 — Twin Performance Table

- Source: `twinBreakdown` (one row per AI twin).
- Columns:

| Column | Source field |
|--------|-------------|
| Twin Name | `name` |
| Chat Sessions | `chatSessions` |
| Calls | `calls` |
| Avg Response Time | `avgResponseTimeMs` → display in seconds (1 dp) |
| Avg Call Duration | `avgCallDurationSecs` → display in minutes (1 dp) |
| Avg Msgs/Session | `avgMsgsPerSession` |

- Sortable columns.
- Show `—` for null values.

---

### Section 9 — Patient Engagement Table

- Source: `GET /api/analytics/admin/patients` (paginated — load on scroll or page buttons).
- Columns:

| Column | Source field | Notes |
|--------|-------------|-------|
| Patient Name | `name` | Link to patient profile |
| Email | `email` | |
| Chat Sessions | `chatSessions` | |
| Calls | `calls` | |
| Messages Sent | `totalMessages` | |
| Avg Session Length | `avgSessionLength` | show as "X msgs" |
| Total Call Time | `totalCallSecs` | display as "Xm Ys" |
| Avg Response Time | `avgResponseTimeMs` | display in seconds |
| Last Active | `lastActive` | relative time (e.g. "2 days ago") |

- Sortable columns.
- Pagination controls at bottom (show total count).
- Search/filter by patient name or email (client-side on loaded rows is fine for small lists).

---

## Date Range Picker

- Placed top-right of the page header.
- Presets: **Last 7 days**, **Last 30 days** (default), **Last 90 days**, **Custom range**.
- On change, re-fetch both endpoints with the new `from`/`to` values.
- Show a loading skeleton while data is fetching.

---

## Empty States

Each chart/table should have a graceful empty state when the data array is empty or all values are zero:

- Use a neutral illustration or icon.
- Short message: *"No data for this period."*
- Do **not** show broken charts with empty axes.

---

## Responsive Behaviour

| Breakpoint | Layout |
|------------|--------|
| Desktop (≥ 1280 px) | 2-column charts, 4-column KPI grid |
| Tablet (768–1279 px) | 1-column charts, 2-column KPI grid |
| Mobile (< 768 px) | 1-column everything, KPI cards scroll horizontally |

---

## Color & Style Guidelines

- Follow the existing admin dashboard color palette.
- Primary chart color: the brand's primary blue/teal.
- Secondary chart color (Calls): a muted coral/orange to contrast.
- KPI cards: white background, subtle shadow, colored left-border accent.
- Tables: alternating row shading, sticky header.
- Skeleton loaders during data fetch — match the shape of each chart/table.
