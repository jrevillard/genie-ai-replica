import { useEffect, useRef } from "react";
import { sessionApi } from "../api/platformApi";

const KEEPALIVE_INTERVAL = 60_000;

export default function SessionKeepAlive({ sessionId, enabled = true }) {
  const timerRef = useRef(null);
  const sid = sessionId || localStorage.getItem("AMINA_SID");

  useEffect(() => {
    if (!enabled || !sid) return;

    const ping = async () => {
      try {
        await sessionApi.keepAlive(sid);
      } catch (e) {
        console.warn("[SessionKeepAlive] ping failed:", e);
      }
    };

    ping();
    timerRef.current = setInterval(ping, KEEPALIVE_INTERVAL);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      sessionApi.end(sid).catch(() => {});
    };
  }, [sid, enabled]);

  return null;
}

export function useSessionKeepAlive(sessionId) {
  const sid = sessionId || localStorage.getItem("AMINA_SID");
  const timerRef = useRef(null);

  useEffect(() => {
    if (!sid) return;

    const ping = () => sessionApi.keepAlive(sid).catch(() => {});
    ping();
    timerRef.current = setInterval(ping, KEEPALIVE_INTERVAL);

    const handleUnload = () => {
      navigator.sendBeacon?.(
        `${(typeof window !== "undefined" && window.GENIE_API) || import.meta.env.VITE_GOV_API_URL || "http://localhost:3000/api"}/sessions/${sid}/end`,
        ""
      );
    };
    window.addEventListener("beforeunload", handleUnload);

    return () => {
      clearInterval(timerRef.current);
      window.removeEventListener("beforeunload", handleUnload);
      sessionApi.end(sid).catch(() => {});
    };
  }, [sid]);
}
