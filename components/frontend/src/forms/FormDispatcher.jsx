/**
 * FormDispatcher — listens for `amina:suggest_form` window events and
 * opens the matching form modal.
 *
 * Event shape
 *   window.dispatchEvent(new CustomEvent("amina:suggest_form", {
 *     detail: { form: "symptom" | "prescription", prefill?: {...}, mode?: "beginner"|"basic"|"advanced" }
 *   }))
 *
 * Who fires the event?
 *   - chatInterceptor.js wraps window.fetch so that whenever /api/v1/agent/chat
 *     returns suggest_form !== null, a CustomEvent is dispatched.
 *   - Future: shell quick-action buttons can dispatch directly with no chat.
 *
 * The dispatcher is deliberately stateless about literacy mode — callers pass
 * it via the detail payload. If absent we read it from localStorage.AMINA_MODE
 * which the literacy boot sets on login.
 */

import { useCallback, useEffect, useState } from "react";
import SymptomReportForm     from "./SymptomReportForm.jsx";
import PrescriptionUploadForm from "./PrescriptionUploadForm.jsx";

export default function FormDispatcher() {
  const [active,  setActive]  = useState(null);  // "symptom" | "prescription" | null
  const [prefill, setPrefill] = useState({});
  const [mode,    setMode]    = useState("basic");

  const close = useCallback(() => { setActive(null); setPrefill({}); }, []);

  useEffect(() => {
    const handler = (e) => {
      const detail = e.detail || {};
      const form   = String(detail.form || "").toLowerCase();
      if (!["symptom", "prescription"].includes(form)) return;
      setActive(form);
      setPrefill(detail.prefill || {});
      // Prefer event-supplied mode > localStorage > default
      const m = detail.mode || localStorage.getItem("AMINA_MODE") || "basic";
      setMode(m);
    };
    window.addEventListener("amina:suggest_form", handler);
    return () => window.removeEventListener("amina:suggest_form", handler);
  }, []);

  return (
    <>
      <SymptomReportForm
        open={active === "symptom"}
        mode={mode}
        prefill={prefill}
        onClose={close}
      />
      <PrescriptionUploadForm
        open={active === "prescription"}
        mode={mode}
        prefill={prefill}
        onClose={close}
      />
    </>
  );
}
