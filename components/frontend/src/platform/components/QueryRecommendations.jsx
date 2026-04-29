import { useState, useEffect } from "react";
import { queryApi } from "../api/platformApi";

const S = {
  panel: {
    background: "#fff", borderRadius: 12, border: "1px solid #f1f5f9",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)", padding: 16,
    fontFamily: "inherit",
  },
  title: { fontSize: 13, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", marginBottom: 12 },
  item: {
    padding: "8px 12px", borderRadius: 8, cursor: "pointer",
    fontSize: 13, color: "#334155", marginBottom: 4,
    transition: "background 0.1s", display: "flex",
    alignItems: "center", gap: 8,
  },
  icon: { fontSize: 14, opacity: 0.5 },
  divider: { borderTop: "1px solid #f1f5f9", margin: "12px 0" },
  similarLabel: {
    fontSize: 12, color: "#3b82f6", fontWeight: 500, marginBottom: 8,
    display: "flex", alignItems: "center", gap: 4,
  },
  empty: { fontSize: 13, color: "#94a3b8", textAlign: "center", padding: 12 },
};

export default function QueryRecommendations({ userId, currentQuery, onSelect }) {
  const [recs, setRecs] = useState([]);
  const [similar, setSimilar] = useState([]);

  const uid = userId || localStorage.getItem("AMINA_PATIENT") || "anonymous";

  useEffect(() => {
    queryApi
      .recommendations(uid, 5)
      .then((data) => setRecs(Array.isArray(data) ? data : data?.recommendations || []))
      .catch(() => {});
  }, [uid]);

  useEffect(() => {
    if (!currentQuery || currentQuery.length < 5) {
      setSimilar([]);
      return;
    }
    const timer = setTimeout(() => {
      queryApi
        .similar(currentQuery, 3)
        .then((data) => setSimilar(Array.isArray(data) ? data : data?.queries || []))
        .catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [currentQuery]);

  if (recs.length === 0 && similar.length === 0) return null;

  return (
    <div style={S.panel}>
      {recs.length > 0 && (
        <>
          <div style={S.title}>Recommended Questions</div>
          {recs.map((r, i) => (
            <div
              key={i}
              style={S.item}
              onClick={() => onSelect?.(r.text || r.query || r)}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span style={S.icon}>💡</span>
              <span>{r.text || r.query || r}</span>
            </div>
          ))}
        </>
      )}

      {similar.length > 0 && (
        <>
          {recs.length > 0 && <div style={S.divider} />}
          <div style={S.similarLabel}>
            <span>🔍</span> Similar queries
          </div>
          {similar.map((s, i) => (
            <div
              key={i}
              style={S.item}
              onClick={() => onSelect?.(s.text || s.query || s)}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f9ff")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <span style={S.icon}>↗</span>
              <span>{s.text || s.query || s}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
