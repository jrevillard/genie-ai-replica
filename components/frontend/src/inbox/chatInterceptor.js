/**
 * chatInterceptor — monkey-patch window.fetch so that:
 *   1. /api/v1/agent/chat is transparently REWRITTEN to /agent/chat-resilient
 *      so every chat call gets automatic model fallback without editing
 *      App.jsx or any callsite.
 *   2. Successful resilient responses fire `amina:suggest_form` (for the
 *      FormDispatcher) AND `amina:model_switched` (for the banner) when the
 *      model_events array shows an actual DOWN → next-model transition.
 *   3. Non-chat fetches pass through untouched.
 *
 * Installation
 *   installChatInterceptor() is idempotent. LiteracyBootstrap → InboxBootstrap
 *   imports this module via its side-effect install at render time.
 *
 * Safety rules (must hold)
 *   - We NEVER retry at this layer. The backend resilient endpoint owns the
 *     model-chain logic. The frontend never swaps tokens or switches models
 *     directly — it only *observes* what the backend did and shows a banner.
 *   - We NEVER surface a banner for TOKEN / BILLING / BAD kinds. Those go
 *     through the existing auth/refresh UI which lives in App.jsx.
 *   - If the resilient endpoint is missing (older backend), the rewrite
 *     still works because /agent/chat-resilient is a drop-in superset; and
 *     if it somehow 404s, we fall back to a second-attempt at /agent/chat.
 */

export function installChatInterceptor() {
  if (typeof window === "undefined") return;
  if (window.__aminaChatInterceptorInstalled) return;
  window.__aminaChatInterceptorInstalled = true;

  const origFetch = window.fetch.bind(window);
  const CHAT_MATCH     = /\/api\/v1\/agent\/chat\b/;
  const RESILIENT_MATCH = /\/api\/v1\/agent\/chat-resilient\b/;

  window.fetch = async function patchedFetch(input, init) {
    const url = _urlOf(input);
    const method = _methodOf(input, init);
    const isChat = method === "POST" && CHAT_MATCH.test(url) && !RESILIENT_MATCH.test(url);

    let target = input;
    let targetInit = init;

    if (isChat) {
      const rewritten = url.replace(
        /\/api\/v1\/agent\/chat(\?|$|#)/,
        "/api/v1/agent/chat-resilient$1",
      );
      // Preserve Request objects but substitute the URL — safest via new Request
      if (typeof input === "string") {
        target = rewritten;
      } else if (input && typeof input === "object") {
        // Some callers pass a Request object. Clone with new URL.
        try {
          target = new Request(rewritten, input);
        } catch {
          target = rewritten;
          targetInit = init;
        }
      }
    }

    let resp;
    try {
      resp = await origFetch(target, targetInit);
    } catch (netErr) {
      if (isChat) {
        // Backend unreachable, or resilient route disabled. Fall back to
        // the classic chat endpoint so the user still gets a reply path.
        resp = await origFetch(input, init);
      } else {
        throw netErr;
      }
    }

    if (isChat) {
      // If the rewrite itself 404'd (older backend without the resilient
      // route), retry against the original URL so chat still works.
      if (resp.status === 404) {
        resp = await origFetch(input, init);
      }

      try {
        const clone = resp.clone();
        clone.json().then((d) => {
          dispatchSuggestForm(d);
          dispatchModelSwitch(d);
        }).catch(() => {});
      } catch { /* no-op */ }
    }

    return resp;
  };
}


// ── URL / method helpers ────────────────────────────────────────────────────

function _urlOf(input) {
  if (typeof input === "string") return input;
  if (!input) return "";
  if (typeof input === "object" && "url" in input) return input.url || "";
  return "";
}

function _methodOf(input, init) {
  if (init && init.method) return String(init.method).toUpperCase();
  if (input && typeof input === "object" && input.method) {
    return String(input.method).toUpperCase();
  }
  return "GET";
}


// ── Event dispatchers ───────────────────────────────────────────────────────

function dispatchSuggestForm(d) {
  if (!d || typeof d !== "object") return;
  const form = typeof d.suggest_form === "string" ? d.suggest_form.toLowerCase() : "";
  const norm = ({
    symptom:              "symptom",
    symptoms:             "symptom",
    prescription:         "prescription",
    prescription_upload:  "prescription",
  })[form];
  if (!norm) return;

  window.dispatchEvent(new CustomEvent("amina:suggest_form", {
    detail: {
      form:    norm,
      prefill: {},
      mode:    (d.mode || localStorage.getItem("AMINA_MODE") || "basic"),
    },
  }));
}

function dispatchModelSwitch(d) {
  if (!d || typeof d !== "object") return;
  const events = Array.isArray(d.model_events) ? d.model_events : [];
  if (events.length === 0) return;

  // A "switch" is any DOWN transition that preceded the successful reply.
  // We fire ONE banner per request (the final from→to pair), not per hop.
  const downs = events.filter((e) => (e.kind || "").toUpperCase() === "DOWN");
  if (downs.length === 0) return;

  const used = d.model_used || null;
  if (!used) return;

  // The banner reads the LAST model that failed and the one that succeeded.
  const lastDown = downs[downs.length - 1];
  window.dispatchEvent(new CustomEvent("amina:model_switched", {
    detail: {
      from:   lastDown.from || null,
      to:     used,
      reason: lastDown.reason || "unreachable",
      kind:   lastDown.kind   || "DOWN",
      events,
    },
  }));
}
