import { useState } from "react";
import { queryApi, analyticsApi } from "../api/platformApi";

const S = {
  overlay: {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(0,0,0,0.35)", display: "flex",
    alignItems: "center", justifyContent: "center", zIndex: 10000,
  },
  dialog: {
    background: "#fff", borderRadius: 16, padding: 28, width: 400,
    boxShadow: "0 20px 60px rgba(0,0,0,0.2)", fontFamily: "inherit",
  },
  title: { fontSize: 17, fontWeight: 600, color: "#1e293b", marginBottom: 16 },
  stars: { display: "flex", gap: 6, marginBottom: 16, justifyContent: "center" },
  star: (active) => ({
    fontSize: 28, cursor: "pointer", color: active ? "#eab308" : "#d1d5db",
    transition: "color 0.15s",
  }),
  options: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 },
  chip: (active) => ({
    padding: "6px 14px", borderRadius: 20, fontSize: 13, cursor: "pointer",
    border: `1px solid ${active ? "#3b82f6" : "#d1d5db"}`,
    background: active ? "#eff6ff" : "#fff",
    color: active ? "#1d4ed8" : "#64748b",
    transition: "all 0.15s",
  }),
  textarea: {
    width: "100%", padding: "10px 12px", border: "1px solid #d1d5db",
    borderRadius: 8, fontSize: 13, resize: "vertical", minHeight: 60,
    fontFamily: "inherit", boxSizing: "border-box", marginBottom: 16,
  },
  btns: { display: "flex", gap: 8, justifyContent: "flex-end" },
  btn: {
    padding: "8px 18px", borderRadius: 8, border: "none", fontSize: 13,
    fontWeight: 600, cursor: "pointer",
  },
  btnPrimary: { background: "#3b82f6", color: "#fff" },
  btnGhost: { background: "#f1f5f9", color: "#334155" },
  inline: {
    display: "inline-flex", gap: 4, alignItems: "center", marginLeft: 8,
  },
  thumbBtn: (active, type) => ({
    width: 28, height: 28, borderRadius: "50%", border: "none",
    cursor: "pointer", fontSize: 14, display: "flex",
    alignItems: "center", justifyContent: "center",
    background: active ? (type === "up" ? "#dcfce7" : "#fef2f2") : "#f1f5f9",
    color: active ? (type === "up" ? "#16a34a" : "#dc2626") : "#94a3b8",
    transition: "all 0.15s",
  }),
  toast: {
    position: "fixed", bottom: 24, right: 24, background: "#1e293b",
    color: "#fff", padding: "10px 20px", borderRadius: 10, fontSize: 13,
    zIndex: 10001, boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
  },
};

const FEEDBACK_TAGS = [
  "Accurate", "Helpful", "Clear",
  "Inaccurate", "Confusing", "Too long",
  "Missing info", "Culturally insensitive",
];

export function ChatFeedbackDialog({ queryId, onClose, onSubmit }) {
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState([]);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const toggleTag = (t) =>
    setTags((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  const submit = async () => {
    setSubmitting(true);
    const feedback = { rating, tags, comment };
    try {
      await queryApi.submitFeedback(queryId, feedback);
      await analyticsApi.recordFeedback(queryId, feedback).catch(() => {});
      onSubmit?.(feedback);
      onClose?.();
    } catch (e) {
      console.warn("[Feedback] submit failed:", e);
    }
    setSubmitting(false);
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.dialog} onClick={(e) => e.stopPropagation()}>
        <div style={S.title}>Rate this response</div>

        <div style={S.stars}>
          {[1, 2, 3, 4, 5].map((n) => (
            <span
              key={n}
              style={S.star(n <= rating)}
              onClick={() => setRating(n)}
            >
              ★
            </span>
          ))}
        </div>

        <div style={S.options}>
          {FEEDBACK_TAGS.map((t) => (
            <span
              key={t}
              style={S.chip(tags.includes(t))}
              onClick={() => toggleTag(t)}
            >
              {t}
            </span>
          ))}
        </div>

        <textarea
          style={S.textarea}
          placeholder="Additional comments (optional)..."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />

        <div style={S.btns}>
          <button style={{ ...S.btn, ...S.btnGhost }} onClick={onClose}>
            Skip
          </button>
          <button
            style={{ ...S.btn, ...S.btnPrimary }}
            onClick={submit}
            disabled={submitting || rating === 0}
          >
            {submitting ? "Sending..." : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function InlineThumbFeedback({ queryId }) {
  const [vote, setVote] = useState(null);
  const [showToast, setShowToast] = useState(false);

  const doVote = async (type) => {
    setVote(type);
    try {
      await queryApi.submitFeedback(queryId, {
        rating: type === "up" ? 5 : 1,
        tags: [type === "up" ? "Helpful" : "Inaccurate"],
      });
    } catch (e) {
      console.warn("[Feedback] thumb failed:", e);
    }
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2000);
  };

  return (
    <>
      <span style={S.inline}>
        <button
          style={S.thumbBtn(vote === "up", "up")}
          onClick={() => doVote("up")}
          title="Helpful"
        >
          👍
        </button>
        <button
          style={S.thumbBtn(vote === "down", "down")}
          onClick={() => doVote("down")}
          title="Not helpful"
        >
          👎
        </button>
      </span>
      {showToast && <div style={S.toast}>Thanks for your feedback!</div>}
    </>
  );
}
