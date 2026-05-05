// Tiny UI chimes via Web Audio. No assets, no network — generated on the fly.
// Used by the chat voice recorder to give an audible cue on start/stop.

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  // Browsers may suspend the context until a user gesture; resume opportunistically.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function playTone(frequency: number, durationMs: number, peakGain = 0.18): void {
  const c = getContext();
  if (!c) return;
  const now = c.currentTime;
  const end = now + durationMs / 1000;

  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequency, now);

  // Quick attack, exponential release so the click sounds soft.
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peakGain, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  osc.connect(gain).connect(c.destination);
  osc.start(now);
  osc.stop(end + 0.02);
}

export function playRecordStartChime(): void {
  // Two short ascending blips so the user clearly hears "go".
  playTone(660, 90);
  setTimeout(() => playTone(880, 110), 90);
}

export function playRecordStopChime(): void {
  // Single short descending blip so the cue differs from "start".
  playTone(520, 120);
}
