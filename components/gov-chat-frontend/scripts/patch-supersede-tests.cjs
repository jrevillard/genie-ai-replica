// One-shot: the six supersede-path assertions drop "GRAPH" (1-8f3 — the
// legacy leg is excluded under an active claim), plus a fresh explicit pin.
const fs = require('fs');
const f = 'D:/ITU-Gitlab/genie-ai-overlay/tests/test_fanout.py';
let s = fs.readFileSync(f, 'utf8');
const edits = [
  // 1. test_head_pseudo_row_lights_up_its_graph
  {
    old: `        assert degraded is False\n        assert routed == ["GRAPH", "OKF_ncd_v1"]\n\n    async def test_supersede_skips_the_chunk_probe`,
    nw: `        assert degraded is False\n        assert routed == ["OKF_ncd_v1"]\n\n    async def test_supersede_skips_the_chunk_probe`,
  },
  // 2. test_supersede_skips_the_chunk_probe
  {
    old: `        assert degraded is False\n        assert routed == ["GRAPH", "OKF_ncd_v1"]\n        assert stub.db.calls and all(`,
    nw: `        assert degraded is False\n        assert routed == ["OKF_ncd_v1"]\n        assert stub.db.calls and all(`,
  },
  // 3. test_veto_ignores_tags_below_the_ceiling
  {
    old: `        assert degraded is False\n        assert routed == ["GRAPH", "OKF_ncd_v1"]\n        attrs = self._span_attrs(span)\n        assert attrs["rag.route.heads_vetoed"] == 0\n        assert attrs["rag.route.head_rows"] == 1\n\n    async def test_all_gates_pass_head_row_injected`,
    nw: `        assert degraded is False\n        assert routed == ["OKF_ncd_v1"]\n        attrs = self._span_attrs(span)\n        assert attrs["rag.route.heads_vetoed"] == 0\n        assert attrs["rag.route.head_rows"] == 1\n\n    async def test_all_gates_pass_head_row_injected`,
  },
  // 4. test_all_gates_pass_head_row_injected (keeps the mode pin)
  {
    old: `        assert degraded is False\n        assert routed == ["GRAPH", "OKF_ncd_v1"]\n        attrs = self._span_attrs(span)\n        assert attrs["rag.route.mode"] == "heads-supersede"`,
    nw: `        assert degraded is False\n        assert routed == ["OKF_ncd_v1"]\n        attrs = self._span_attrs(span)\n        assert attrs["rag.route.mode"] == "heads-supersede"`,
  },
  // 5. test_degradation_no_forbidden_vectors_skips_veto
  {
    old: `        assert degraded is False\n        assert routed == ["GRAPH", "OKF_ncd_v1"]\n        attrs = self._span_attrs(span)\n        assert attrs["rag.route.heads_vetoed"] == 0\n        assert attrs["rag.route.head_rows"] == 1\n\n    async def test_degradation_no_centroid_skips_margin`,
    nw: `        assert degraded is False\n        assert routed == ["OKF_ncd_v1"]\n        attrs = self._span_attrs(span)\n        assert attrs["rag.route.heads_vetoed"] == 0\n        assert attrs["rag.route.head_rows"] == 1\n\n    async def test_degradation_no_centroid_skips_margin`,
  },
  // 6. test_degradation_no_centroid_skips_margin
  {
    old: `        assert degraded is False\n        assert routed == ["GRAPH", "OKF_ncd_v1"]\n        attrs = self._span_attrs(span)\n        assert attrs["rag.route.heads_gated"] == 0\n        assert attrs["rag.route.head_rows"] == 1`,
    nw: `        assert degraded is False\n        assert routed == ["OKF_ncd_v1"]\n        attrs = self._span_attrs(span)\n        assert attrs["rag.route.heads_gated"] == 0\n        assert attrs["rag.route.head_rows"] == 1`,
  },
];
let done = 0;
for (const e of edits) {
  if (!s.includes(e.old)) {
    console.log('MISS:', e.old.slice(40, 110).replace(/\n/g, '\\n'));
    continue;
  }
  s = s.replace(e.old, e.nw);
  done++;
}
// New explicit pin: the legacy GRAPH leg is excluded under an active claim.
const anchor = `    async def test_supersede_off_restores_pool_semantics`;
const newTest = `    async def test_supersede_excludes_the_legacy_graph_leg(self):
        # 1-8f3 (live 2026-10-10): 20 unrelated legacy-Kenya GRAPH chunks were
        # the ONLY content reranked for an NCD-routed asthma query when the
        # NCD leg returned 0 documents — grounding verdict 0, general-knowledge
        # fallback. Under an active claim the legacy leg is dropped with the
        # headless OKF graphs; no-claim paths keep it (D8 unchanged there).
        import retriever.genieai_retriever_arangodb as rmod

        results = {
            "OKF_ncd_v1_SOURCE": [0.83, 0.82],
            "GRAPH_SOURCE": [0.9, 0.89, 0.88],
        }
        routed, degraded = await self._route(
            _routing_stub(results, heads=self._head_rows()),
            ["GRAPH", "OKF_ncd_v1"],
        )
        assert degraded is False
        assert routed == ["OKF_ncd_v1"]
        assert "GRAPH" not in routed

`;
if (s.includes(anchor)) {
  s = s.replace(anchor, newTest + anchor);
  done++;
} else {
  console.log('MISS anchor for new test');
}
fs.writeFileSync(f, s);
console.log('applied', done, 'of', edits.length + 1);
