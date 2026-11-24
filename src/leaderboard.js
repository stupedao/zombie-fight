/* ============================================================
   DEAD HOURS - leaderboard client
   Tries the /api endpoints (Cloudflare Pages Functions or the
   standalone worker); falls back to localStorage when the API
   is unreachable or not deployed.
   ============================================================ */

const API_BASE = (import.meta.env && import.meta.env.VITE_API_BASE) || '';
const LS_KEY = 'dead-hours-board';

function localBoard() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const entries = JSON.parse(raw);
      if (Array.isArray(entries)) return entries.slice(0, 10);
    }
  } catch (e) { /* private mode / blocked */ }
  return [];
}

function saveLocal(entries) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(entries.slice(0, 10))); } catch (e) { /* ignore */ }
}

async function fetchWithTimeout(url, opts = {}, ms = 2500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export const Leaderboard = {
  /** returns { entries: [{name, score, wave}], offline: bool } */
  async fetch() {
    if (API_BASE !== undefined) {
      try {
        const res = await fetchWithTimeout(`${API_BASE}/api/leaderboard`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.ok && Array.isArray(data.entries)) {
            return { entries: data.entries, offline: false };
          }
        }
      } catch (e) { /* fall through to local */ }
    }
    return { entries: localBoard(), offline: true };
  },

  /** returns { rank, offline } */
  async submit(name, score, wave) {
    const payload = JSON.stringify({ name, score, wave });
    if (API_BASE !== undefined) {
      try {
        const res = await fetchWithTimeout(`${API_BASE}/api/score`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        }, 3500);
        if (res.ok) {
          const data = await res.json();
          if (data && data.ok) return { rank: data.rank, offline: false };
          if (data && data.error) return { rank: null, offline: false, error: data.error };
        }
      } catch (e) { /* fall through to local */ }
    }
    // local fallback
    const entries = localBoard();
    entries.push({ name, score, wave });
    entries.sort((a, b) => b.score - a.score);
    const trimmed = entries.slice(0, 10);
    saveLocal(trimmed);
    const rank = trimmed.findIndex((e) => e.name === name && e.score === score) + 1;
    return { rank: rank || null, offline: true };
  },
}
