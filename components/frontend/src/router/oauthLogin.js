/**
 * oauthLogin — shared OAuth helper mirroring AuthScreen's existing
 * Google / Facebook / DHIS2 flow so the home page can offer the SAME
 * sign-in options without duplicating integration work.
 *
 * Each provider returns an access_token via its native popup SDK, we
 * POST it to `/api/v1/auth/oauth/callback`, and the backend hands back
 * a patient JWT + profile. On success we set the same localStorage
 * keys App.jsx expects (`AMINA_TOKEN`, `AMINA_PATIENT`, `AMINA_SID`)
 * and hard-reload the tab so every bootstrap module re-inits cleanly.
 *
 * Call site: `await oauthLogin("google")` / `"facebook"` / `"dhis2"`.
 * Returns `{ ok: true }` on success or `{ ok: false, error: "..." }`.
 * Never throws.
 */


function _base() {
  const raw = (typeof window !== "undefined" && window.__AMINA_API_BASE__)
           || (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE)
           || "http://localhost:8000";
  return String(raw).replace(/\/+$/, "");
}


// ── provider-specific popup dances ─────────────────────────────────

async function _getGoogleToken() {
  const clientId = window.__AMINA_GOOGLE_CLIENT_ID || "";
  if (!clientId || clientId.includes("%VITE_")) {
    throw new Error("Google login not configured. Set VITE_GOOGLE_CLIENT_ID.");
  }
  if (!window.google?.accounts?.oauth2) {
    throw new Error("Google SDK not loaded. Check internet connection.");
  }
  return await new Promise((resolve, reject) => {
    window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope:     "email profile openid",
      callback:  (resp) => resp.error
        ? reject(new Error(resp.error))
        : resolve(resp.access_token),
    }).requestAccessToken();
  });
}


async function _getFacebookToken() {
  const appId = window.__AMINA_FACEBOOK_APP_ID || "";
  if (!appId || appId.includes("%VITE_")) {
    throw new Error("Facebook login not configured. Set VITE_FACEBOOK_APP_ID.");
  }
  if (!window.FB) {
    throw new Error("Facebook SDK not loaded. Check internet connection.");
  }
  return await new Promise((resolve, reject) => {
    window.FB.login(
      (resp) => resp.status === "connected"
        ? resolve(resp.authResponse.accessToken)
        : reject(new Error("Facebook login cancelled")),
      { scope: "email,public_profile" },
    );
  });
}


async function _getDhis2Token() {
  // DHIS2 is already integrated — same popup + hash flow the existing
  // AuthScreen uses. Keeping identical code so the backend OAuth
  // callback handler works without changes.
  const dhis2Url = (window.__AMINA_DHIS2_URL || "").replace(/%VITE_[^%]+%/g, "");
  if (!dhis2Url) {
    throw new Error("DHIS2 login not configured. Set VITE_DHIS2_BASE_URL.");
  }
  const redirectUri = encodeURIComponent(window.location.origin + "/oauth/dhis2");
  const popup = window.open(
    `${dhis2Url}/uaa/oauth/authorize?response_type=token&client_id=amina&redirect_uri=${redirectUri}`,
    "dhis2_login", "width=600,height=700",
  );
  if (!popup) throw new Error("Popup blocked. Please allow popups for this site.");
  return await new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      try {
        if (popup.closed) {
          clearInterval(timer);
          reject(new Error("DHIS2 login cancelled"));
          return;
        }
        const hash = popup.location.hash;
        if (hash) {
          clearInterval(timer); popup.close();
          resolve(new URLSearchParams(hash.slice(1)).get("access_token") || "");
        }
      } catch { /* cross-origin during load — still authenticating */ }
    }, 500);
    setTimeout(() => {
      clearInterval(timer); popup.close();
      reject(new Error("DHIS2 login timed out"));
    }, 120000);
  });
}


// ── main entrypoint ───────────────────────────────────────────────

export default async function oauthLogin(provider) {
  try {
    let accessToken = "";
    if (provider === "google")   accessToken = await _getGoogleToken();
    else if (provider === "facebook") accessToken = await _getFacebookToken();
    else if (provider === "dhis2")    accessToken = await _getDhis2Token();
    else return { ok: false, error: `unknown provider ${provider}` };

    if (!accessToken) return { ok: false, error: "No access token returned" };

    const r = await fetch(`${_base()}/api/v1/auth/oauth/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, access_token: accessToken, id_token: "" }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.success || !d.token || !d.patient) {
      return { ok: false, error: d.error || `${provider} login failed` };
    }

    // Populate the live keys (matches what AuthScreen does in onLogin
    // + handleLogin) AND the session slot so the switcher knows about it.
    try {
      localStorage.setItem("AMINA_TOKEN",   d.token);
      localStorage.setItem("AMINA_PATIENT", JSON.stringify(d.patient));
      if (d.session_id) localStorage.setItem("AMINA_SID", d.session_id);
      localStorage.setItem("AMINA_ACTIVE", "pt");
      // Best-effort: SessionBootstrap's fetch interceptor already
      // snooped this POST and wrote the slot, so we don't need to
      // duplicate that here.
    } catch { /* noop */ }

    // Hard reload so every bootstrap reinitialises from clean state.
    setTimeout(() => {
      try { window.location.hash = "#/"; window.location.reload(); }
      catch { /* noop */ }
    }, 60);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}
