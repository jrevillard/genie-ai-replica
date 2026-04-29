import { useState, useEffect } from "react";
import { serviceTreeApi } from "../api/platformApi";

const S = {
  panel: {
    background: "#fff", borderRadius: 12, border: "1px solid #f1f5f9",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)", overflow: "hidden",
  },
  header: {
    padding: "14px 16px", borderBottom: "1px solid #e2e8f0",
    display: "flex", justifyContent: "space-between", alignItems: "center",
  },
  title: { fontSize: 15, fontWeight: 600, color: "#1e293b" },
  search: {
    padding: "6px 12px", border: "1px solid #d1d5db", borderRadius: 6,
    fontSize: 13, width: 180,
  },
  tree: { maxHeight: 500, overflowY: "auto", padding: "4px 0" },
  category: {
    padding: "8px 16px", cursor: "pointer", display: "flex",
    alignItems: "center", gap: 8, fontSize: 14, color: "#334155",
    transition: "background 0.1s",
  },
  categoryHover: { background: "#f8fafc" },
  catIcon: { fontSize: 14, width: 20, textAlign: "center", transition: "transform 0.15s" },
  catName: { flex: 1, fontWeight: 500 },
  catCount: { fontSize: 11, color: "#94a3b8" },
  service: {
    padding: "6px 16px 6px 44px", fontSize: 13, color: "#64748b",
    cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
    transition: "background 0.1s",
  },
  serviceActive: { background: "#eff6ff", color: "#1d4ed8" },
  badge: {
    fontSize: 10, padding: "1px 6px", borderRadius: 10,
    background: "#e0e7ff", color: "#4338ca",
  },
  empty: { padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 13 },
};

export default function ServiceTreeBrowser({ onSelectService, locale = "en" }) {
  const [categories, setCategories] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [services, setServices] = useState({});
  const [searchTerm, setSearchTerm] = useState("");
  const [activeService, setActiveService] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    serviceTreeApi
      .categories(locale)
      .then((data) => {
        setCategories(Array.isArray(data) ? data : data?.categories || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [locale]);

  const toggleCategory = async (catId) => {
    const isOpen = expanded[catId];
    setExpanded((p) => ({ ...p, [catId]: !isOpen }));
    if (!isOpen && !services[catId]) {
      try {
        const data = await serviceTreeApi.categoryServices(catId, locale);
        setServices((p) => ({
          ...p,
          [catId]: Array.isArray(data) ? data : data?.services || [],
        }));
      } catch (e) {
        console.warn("[ServiceTree] services load failed:", e);
      }
    }
  };

  const selectService = (svc) => {
    setActiveService(svc._id || svc.id);
    onSelectService?.(svc);
  };

  const filtered = searchTerm
    ? categories.filter(
        (c) =>
          (c.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
          (c.description || "").toLowerCase().includes(searchTerm.toLowerCase())
      )
    : categories;

  if (loading) return <div style={S.empty}>Loading services...</div>;

  return (
    <div style={S.panel}>
      <div style={S.header}>
        <span style={S.title}>Service Categories</span>
        <input
          style={S.search}
          placeholder="Search..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>
      <div style={S.tree}>
        {filtered.length === 0 && (
          <div style={S.empty}>No categories found</div>
        )}
        {filtered.map((cat) => {
          const cid = cat._id || cat.id;
          const isOpen = expanded[cid];
          return (
            <div key={cid}>
              <div
                style={S.category}
                onClick={() => toggleCategory(cid)}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#f8fafc")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <span
                  style={{
                    ...S.catIcon,
                    transform: isOpen ? "rotate(90deg)" : "none",
                  }}
                >
                  ▶
                </span>
                <span style={S.catName}>
                  {cat.name || cat.title || cid}
                </span>
                {cat.serviceCount != null && (
                  <span style={S.catCount}>
                    {cat.serviceCount} services
                  </span>
                )}
              </div>
              {isOpen &&
                (services[cid] || []).map((svc) => {
                  const sid = svc._id || svc.id;
                  return (
                    <div
                      key={sid}
                      style={{
                        ...S.service,
                        ...(activeService === sid ? S.serviceActive : {}),
                      }}
                      onClick={() => selectService(svc)}
                    >
                      <span>•</span>
                      <span style={{ flex: 1 }}>
                        {svc.name || svc.title || sid}
                      </span>
                      {svc.type && <span style={S.badge}>{svc.type}</span>}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
