/**
 * Platform API — unified service layer for gov-chat features
 * ported into the AMINA React frontend.
 *
 * API_GOV points to the Express gov-chat-backend (port 3000).
 * API_AMINA points to the Haystack FastAPI backend (port 8000).
 */

const API_GOV =
  (typeof window !== "undefined" && window.GENIE_API) ||
  import.meta.env.VITE_GOV_API_URL ||
  "http://localhost:3000/api";

const API_AMINA =
  (typeof window !== "undefined" && window.AMINA_API) ||
  import.meta.env.VITE_API_URL ||
  "http://localhost:8000";

function headers() {
  const h = { "Content-Type": "application/json" };
  const tok =
    localStorage.getItem("AMINA_TOKEN") ||
    localStorage.getItem("genie_token");
  if (tok) h["Authorization"] = `Bearer ${tok}`;
  return h;
}

async function govFetch(path, opts = {}) {
  const r = await fetch(`${API_GOV}${path}`, {
    credentials: "include",
    headers: headers(),
    ...opts,
  });
  if (r.status === 401) {
    console.warn("[platformApi] 401 on", path);
  }
  return r;
}

async function aminaFetch(path, opts = {}) {
  const r = await fetch(`${API_AMINA}${path}`, {
    credentials: "include",
    headers: headers(),
    ...opts,
  });
  return r;
}

/* ──────────────────────────────────────────────
   1. CONVERSATION FOLDERS
   ────────────────────────────────────────────── */

export const foldersApi = {
  list: (userId) =>
    govFetch(`/chat/folders?userId=${userId}`).then((r) => r.json()),

  create: (data) =>
    govFetch("/chat/folders", {
      method: "POST",
      body: JSON.stringify(data),
    }).then((r) => r.json()),

  update: (id, data) =>
    govFetch(`/chat/folders/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }).then((r) => r.json()),

  remove: (id, userId) =>
    govFetch(`/chat/folders/${id}?userId=${userId}`, {
      method: "DELETE",
    }).then((r) => r.json()),

  addConversation: (folderId, conversationId, userId) =>
    govFetch(`/chat/folders/${folderId}/conversations/${conversationId}`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    }).then((r) => r.json()),

  removeConversation: (folderId, conversationId, userId) =>
    govFetch(
      `/chat/folders/${folderId}/conversations/${conversationId}?userId=${userId}`,
      { method: "DELETE" }
    ).then((r) => r.json()),

  share: (folderId, userId, targetUserId, role) =>
    govFetch(`/chat/folders/${folderId}/share`, {
      method: "POST",
      body: JSON.stringify({ userId, targetUserId, role }),
    }).then((r) => r.json()),

  path: (folderId) =>
    govFetch(`/chat/folders/${folderId}/path`).then((r) => r.json()),

  reorder: (userId, folderOrders, parentFolderId) =>
    govFetch("/chat/folders/reorder", {
      method: "POST",
      body: JSON.stringify({ userId, folderOrders, parentFolderId }),
    }).then((r) => r.json()),
};

/* ──────────────────────────────────────────────
   2. CONVERSATIONS (export, search, stats)
   ────────────────────────────────────────────── */

export const conversationsApi = {
  list: (userId, opts = {}) => {
    const params = new URLSearchParams({ userId, ...opts });
    return govFetch(`/chat/conversations?${params}`).then((r) => r.json());
  },

  get: (id) =>
    govFetch(`/chat/conversations/${id}`).then((r) => r.json()),

  messages: (id, opts = {}) => {
    const params = new URLSearchParams(opts);
    return govFetch(`/chat/conversations/${id}/messages?${params}`).then(
      (r) => r.json()
    );
  },

  exportConversation: (id, format = "json") =>
    govFetch(`/chat/conversations/${id}/export?format=${format}`).then((r) =>
      format === "json" ? r.json() : r.blob()
    ),

  search: (userId, searchTerm, opts = {}) => {
    const params = new URLSearchParams({ userId, searchTerm, ...opts });
    return govFetch(`/chat/search?${params}`).then((r) => r.json());
  },

  stats: (userId) =>
    govFetch(`/chat/stats?userId=${userId}`).then((r) => r.json()),
};

/* ──────────────────────────────────────────────
   3. ANALYTICS
   ────────────────────────────────────────────── */

export const analyticsApi = {
  dashboard: (period = "monthly", date) => {
    const params = new URLSearchParams({ period });
    if (date) params.set("date", date);
    return govFetch(`/analytics/dashboard?${params}`).then((r) => r.json());
  },

  timeseries: (type, interval, startDate, endDate) =>
    govFetch(
      `/analytics/timeseries/${type}?interval=${interval}&startDate=${startDate}&endDate=${endDate}`
    ).then((r) => r.json()),

  satisfactionHeatmap: (period, date) =>
    govFetch(
      `/analytics/satisfaction/heatmap?period=${period}&date=${date || ""}`
    ).then((r) => r.json()),

  satisfactionGauge: (period, date) =>
    govFetch(
      `/analytics/satisfaction/gauge?period=${period}&date=${date || ""}`
    ).then((r) => r.json()),

  uniqueUsers: (startDate, endDate) =>
    govFetch(
      `/analytics/metric/uniqueUsers?startDate=${startDate}&endDate=${endDate}`
    ).then((r) => r.json()),

  recordFeedback: (queryId, feedback) =>
    govFetch(`/analytics/feedback`, {
      method: "POST",
      body: JSON.stringify({ queryId, feedback }),
    }).then((r) => r.json()),
};

/* ──────────────────────────────────────────────
   4. ADMIN / SYSTEM HEALTH
   ────────────────────────────────────────────── */

export const adminHealthApi = {
  systemHealth: () =>
    govFetch("/admin/system-health").then((r) => r.json()),

  logs: (opts = {}) => {
    const params = new URLSearchParams(opts);
    return govFetch(`/admin/logs?${params}`).then((r) => r.json());
  },

  logsSummary: (opts = {}) => {
    const params = new URLSearchParams(opts);
    return govFetch(`/admin/logs/summary?${params}`).then((r) => r.json());
  },

  searchLogs: (opts = {}) => {
    const params = new URLSearchParams(opts);
    return govFetch(`/admin/logs/search?${params}`).then((r) => r.json());
  },

  rolloverLogs: () =>
    govFetch("/admin/logs/rollover", { method: "POST" }).then((r) =>
      r.json()
    ),

  securityMetrics: () =>
    govFetch("/admin/security-metrics").then((r) => r.json()),

  runSecurityScan: () =>
    govFetch("/admin/security-scan", { method: "POST" }).then((r) =>
      r.json()
    ),

  runDiagnostics: () =>
    govFetch("/admin/diagnostics", { method: "POST" }).then((r) =>
      r.json()
    ),

  userStats: (opts = {}) => {
    const params = new URLSearchParams(opts);
    return govFetch(`/admin/user-stats?${params}`).then((r) => r.json());
  },

  searchUsers: (opts = {}) => {
    const params = new URLSearchParams(opts);
    return govFetch(`/admin/users/search?${params}`).then((r) => r.json());
  },
};

/* ──────────────────────────────────────────────
   5. SERVICE TREE / CATEGORIES
   ────────────────────────────────────────────── */

export const serviceTreeApi = {
  categories: (locale = "en") =>
    govFetch(`/services/categories?locale=${locale}`).then((r) => r.json()),

  categoryServices: (categoryId, locale = "en") =>
    govFetch(`/services/categories/${categoryId}?locale=${locale}`).then(
      (r) => r.json()
    ),

  adminCategories: (locale = "en") =>
    govFetch(
      `/service-categories/categories/detailed?locale=${locale}`
    ).then((r) => r.json()),
};

/* ──────────────────────────────────────────────
   6. AUTH FLOWS (email verify, password reset)
   ────────────────────────────────────────────── */

export const authFlowApi = {
  verifyEmail: (token) =>
    govFetch(`/auth/verify-email/${token}`).then((r) => r.json()),

  resendVerification: (email) =>
    govFetch("/auth/resend-verification", {
      method: "POST",
      body: JSON.stringify({ email }),
    }).then((r) => r.json()),

  initiatePasswordReset: (email) =>
    govFetch("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }).then((r) => r.json()),

  validateResetToken: (token) =>
    govFetch(`/auth/validate-token?token=${token}`).then((r) => r.json()),

  resetPassword: (token, newPassword) =>
    govFetch("/auth/reset-password/confirm", {
      method: "POST",
      body: JSON.stringify({ token, newPassword }),
    }).then((r) => r.json()),

  changePassword: (currentPassword, newPassword) =>
    govFetch("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }).then((r) => r.json()),
};

/* ──────────────────────────────────────────────
   7. QUERY RECOMMENDATIONS
   ────────────────────────────────────────────── */

export const queryApi = {
  recommendations: (userId, limit = 5) =>
    govFetch(
      `/queries/recommendations?userId=${userId}&limit=${limit}`
    ).then((r) => r.json()),

  similar: (queryText, limit = 5) =>
    govFetch(
      `/queries/similar?queryText=${encodeURIComponent(queryText)}&limit=${limit}`
    ).then((r) => r.json()),

  submitFeedback: (queryId, feedback) =>
    govFetch(`/queries/${queryId}/feedback`, {
      method: "POST",
      body: JSON.stringify(feedback),
    }).then((r) => r.json()),
};

/* ──────────────────────────────────────────────
   8. SESSION KEEP-ALIVE
   ────────────────────────────────────────────── */

export const sessionApi = {
  start: (userId, deviceInfo = {}) =>
    govFetch("/sessions", {
      method: "POST",
      body: JSON.stringify({ userId, deviceInfo }),
    }).then((r) => r.json()),

  keepAlive: (sessionId) =>
    govFetch(`/sessions/${sessionId}/keepalive`, {
      method: "PATCH",
    }).then((r) => r.json()),

  end: (sessionId) =>
    govFetch(`/sessions/${sessionId}/end`, {
      method: "PATCH",
    }).then((r) => r.json()),

  info: (sessionId) =>
    govFetch(`/sessions/${sessionId}`).then((r) => r.json()),
};

/* ──────────────────────────────────────────────
   9. CLINICAL OUTCOMES (AMINA backend)
   ────────────────────────────────────────────── */

export const outcomesApi = {
  dashboard: (days = 90) =>
    aminaFetch(`/api/v1/outcomes/dashboard?days=${days}`).then((r) =>
      r.json()
    ),

  vitalTrend: (days = 90) =>
    aminaFetch(`/api/v1/outcomes/vital-trend?days=${days}`).then((r) =>
      r.json()
    ),

  adherence: (days = 90) =>
    aminaFetch(`/api/v1/outcomes/adherence?days=${days}`).then((r) =>
      r.json()
    ),

  qualityScores: (days = 90) =>
    aminaFetch(`/api/v1/outcomes/quality-scores?days=${days}`).then((r) =>
      r.json()
    ),

  engagementTrend: (days = 90) =>
    aminaFetch(`/api/v1/outcomes/engagement-trend?days=${days}`).then((r) =>
      r.json()
    ),
};
