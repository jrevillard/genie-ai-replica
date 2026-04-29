/**
 * Agent Lab — AMINA's differentiator.
 *
 * Observability over the agent itself: which model served, how fast,
 * what tools fired, what safety flags blocked, what users downvoted.
 * This is what Hippocratic AI's QA console looks like — scoped to
 * AMINA's stack (Amina LoRA / OpenAI / Groq / Gemini / Mistral).
 *
 * Three tabs:
 *   - Models       — calls / p50 / p95 / p99 / error rate per model
 *   - Tools        — bar chart of tool invocations
 *   - Safety       — safety-flag reasons + regen / downvote patterns
 *   - Training     — LoRA fine-tune candidate review (D3)
 */

import { useState } from "react";
import { Cpu, Wrench, ShieldAlert, Beaker, ArrowRight } from "lucide-react";

import { Tabs, Card, Stat, Badge, HBar, Pill, Button, Sparkline } from "../primitives/index.jsx";
import { useAdminApi } from "../hooks/useAdminApi.js";
import EvidenceLayerCard from "../EvidenceLayerCard.jsx";


const TABS = [
  { id: "models",   label: "Models",   icon: Cpu },
  { id: "tools",    label: "Tools",    icon: Wrench },
  { id: "safety",   label: "Safety",   icon: ShieldAlert },
  { id: "training", label: "Training", icon: Beaker },
];


function ModelsPanel({ data }) {
  const models = data?.models || [];
  const totalCalls = models.reduce((s, m) => s + (m.calls_24h || 0), 0) || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
        {models.map((m) => (
          <Card key={m.id}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: m.color }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--a-fg)" }}>{m.label}</span>
            </div>
            <Stat
              label="Calls · 24h"
              value={Number(m.calls_24h).toLocaleString()}
              sub={`${((m.calls_24h / totalCalls) * 100).toFixed(1)}% of traffic`}
            />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10,
                          fontSize: 11, color: "var(--a-fg-dim)" }}>
              <div>
                <div style={{ letterSpacing: "0.12em", textTransform: "uppercase" }}>p50</div>
                <div style={{ color: "var(--a-fg)", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                  {m.p50_ms}<span style={{ opacity: 0.6, fontSize: 10 }}>ms</span>
                </div>
              </div>
              <div>
                <div style={{ letterSpacing: "0.12em", textTransform: "uppercase" }}>p95</div>
                <div style={{ color: "var(--a-fg)", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                  {m.p95_ms}<span style={{ opacity: 0.6, fontSize: 10 }}>ms</span>
                </div>
              </div>
              <div>
                <div style={{ letterSpacing: "0.12em", textTransform: "uppercase" }}>p99</div>
                <div style={{ color: "var(--a-fg)", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                  {m.p99_ms}<span style={{ opacity: 0.6, fontSize: 10 }}>ms</span>
                </div>
              </div>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: "var(--a-fg-dim)" }}>
              Errors: <span style={{
                color: (m.errors_24h || 0) > 10 ? "var(--a-danger)" : "var(--a-success)",
                fontWeight: 600,
              }}>{m.errors_24h}</span>
            </div>
          </Card>
        ))}
      </div>

      <Card title="Switch rate · 24h"
            actions={<Pill>{totalCalls.toLocaleString()} calls</Pill>}>
        <HBar
          rows={models.map((m) => ({
            label: m.label, value: m.calls_24h, color: m.color,
          }))}
          formatter={(v) => `${v} calls`}
        />
        <div style={{ marginTop: 12, fontSize: 11, color: "var(--a-fg-dim)", lineHeight: 1.5 }}>
          Guest chat auto-routes through Groq → Gemini. Signed-in traffic starts at
          Amina LoRA and falls back on error per the model_fallback chain.
        </div>
      </Card>
    </div>
  );
}


function ToolsPanel({ data }) {
  const rows = (data?.tools || []).map((t, i) => ({
    ...t,
    color: i % 3 === 0 ? "var(--a-accent)" : i % 3 === 1 ? "var(--a-info)" : "var(--a-success)",
  }));
  return (
    <Card title="Tool invocations · 24h">
      <HBar rows={rows} />
      <div style={{ marginTop: 12, fontSize: 11, color: "var(--a-fg-dim)", lineHeight: 1.5 }}>
        Most-used tools should map to the most-common patient questions. Sudden
        drop-offs usually mean routing regressed — dig into Agent Lab → Safety.
      </div>
    </Card>
  );
}


function SafetyPanel({ data }) {
  const flags = data?.safety || [];
  const regen = data?.regen || {};
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 16 }}>
      <Card title="Safety-flag rejections">
        <HBar
          rows={flags.map((f) => ({
            label: f.reason, value: f.count,
            color: "var(--a-danger)",
          }))}
        />
      </Card>
      <Card title="Downvote / regen patterns">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <Stat label="Downvotes · 24h" value={regen.downvotes_24h ?? "—"} />
          <Stat label="Regen rate"      value={regen.regen_rate_pct != null ? `${regen.regen_rate_pct}%` : "—"} />
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em",
                       textTransform: "uppercase", color: "var(--a-fg-dim)", marginBottom: 8 }}>
          Top reasons
        </div>
        <HBar
          rows={(regen.common_reasons || []).map((r) => ({
            label: r.reason, value: r.count, color: "var(--a-warn)",
          }))}
        />
      </Card>
    </div>
  );
}


function TrainingPanel() {
  return (
    <Card title="Training pipeline"
          actions={<Badge tone="neutral">Preview</Badge>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10,
                    fontSize: 13, color: "var(--a-fg-mute)", lineHeight: 1.6 }}>
        <div>
          <strong style={{ color: "var(--a-fg)" }}>Consented conversations queue</strong> —
          patients who opted in via the "train on my data" switch. Full review
          UI lands in D3 polish, but the export already works:
        </div>
        <pre style={{
          background: "var(--a-bg-inset)",
          border: "1px solid var(--a-border-1)",
          borderRadius: "var(--a-r-3)",
          padding: 12, fontFamily: "var(--a-font-mono)", fontSize: 12,
          color: "var(--a-fg)",
          overflow: "auto",
        }}>{`# Export consented conversations to JSONL
curl -s /api/v1/training/export \\
  -H "Authorization: Bearer <admin-jwt>" \\
  -o /tmp/amina-training.jsonl`}</pre>
        <div style={{ marginTop: 4 }}>
          Last LoRA run: <Pill>2026-04-14 · v2-final · 3 epochs</Pill>
        </div>
        <Button variant="secondary" tailIcon={ArrowRight}>
          Open training dataset review
        </Button>
      </div>
    </Card>
  );
}


export default function AgentLab() {
  const [tab, setTab] = useState("models");
  const { data, loading } = useAdminApi("/api/v1/admin/mv/agent-lab", { refreshMs: 15000 });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <EvidenceLayerCard />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Tabs items={TABS} value={tab} onChange={setTab} ariaLabel="Agent Lab sub-sections" />
        {data?.synthetic && <Badge tone="neutral">Demo data</Badge>}
        {loading && !data && <Badge tone="info">Loading…</Badge>}
      </div>
      {tab === "models"   && <ModelsPanel   data={data} />}
      {tab === "tools"    && <ToolsPanel    data={data} />}
      {tab === "safety"   && <SafetyPanel   data={data} />}
      {tab === "training" && <TrainingPanel />}
    </div>
  );
}
