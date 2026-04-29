/**
 * Local conversation store — ChatGPT-style thread persistence.
 *
 * Keeps the last MAX_THREADS conversations in localStorage keyed by
 * session_id. Each thread stores its full message array so switching
 * between threads is instant (no API round-trip).
 *
 * Storage key: AMINA_THREADS  (JSON array, newest-first)
 *
 * Thread shape:
 *   { id, sessionId, title, messages[], createdAt, updatedAt, triageLevel }
 */

const STORAGE_KEY = "AMINA_THREADS";
const MAX_THREADS = 5;

function _read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function _write(threads) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(threads.slice(0, MAX_THREADS)));
  } catch { /* quota — drop oldest */ }
}

function _titleFromMessages(messages) {
  const first = messages.find((m) => m.role === "user" && m.content);
  if (!first) return "New conversation";
  const text = first.content.replace(/\n/g, " ").trim();
  return text.length > 50 ? text.slice(0, 50) + "…" : text;
}

export function getThreads() {
  return _read();
}

export function getThread(sessionId) {
  return _read().find((t) => t.sessionId === sessionId) || null;
}

export function getActiveThreadId() {
  return localStorage.getItem("AMINA_ACTIVE_THREAD") || null;
}

export function setActiveThreadId(sessionId) {
  if (sessionId) {
    localStorage.setItem("AMINA_ACTIVE_THREAD", sessionId);
  } else {
    localStorage.removeItem("AMINA_ACTIVE_THREAD");
  }
}

export function saveThread(sessionId, messages, triageLevel) {
  if (!sessionId || !messages || messages.length === 0) return;
  const threads = _read();
  const idx = threads.findIndex((t) => t.sessionId === sessionId);
  const now = new Date().toISOString();
  if (idx >= 0) {
    threads[idx].messages = messages;
    threads[idx].updatedAt = now;
    threads[idx].title = _titleFromMessages(messages);
    if (triageLevel) threads[idx].triageLevel = triageLevel;
    const updated = threads.splice(idx, 1)[0];
    threads.unshift(updated);
  } else {
    threads.unshift({
      id: sessionId,
      sessionId,
      title: _titleFromMessages(messages),
      messages,
      createdAt: now,
      updatedAt: now,
      triageLevel: triageLevel || null,
    });
  }
  _write(threads);
  setActiveThreadId(sessionId);
}

export function deleteThread(sessionId) {
  const threads = _read().filter((t) => t.sessionId !== sessionId);
  _write(threads);
  if (getActiveThreadId() === sessionId) {
    setActiveThreadId(threads[0]?.sessionId || null);
  }
  return threads;
}

export function clearAllThreads() {
  _write([]);
  setActiveThreadId(null);
}
