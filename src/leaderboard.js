/* ============================================================
   DEAD HOURS - leaderboard
   The game is fully static, so scores live in the player's
   own browser (localStorage). No server, no KV, no API.
   ============================================================ */

const LS_KEY = 'dead-hours-board';
const MAX = 10;

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const entries = JSON.parse(raw);
      if (Array.isArray(entries)) return entries.slice(0, MAX);
    }
  } catch (e) { /* private mode / blocked */ }
  return [];
}

function store(entries) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(entries.slice(0, MAX))); } catch (e) { /* ignore */ }
}

export const Leaderboard = {
  /** returns { entries: [{ name, score, wave }] } */
  async fetch() {
    return { entries: load() };
  },

  /** returns { rank } */
  async submit(name, score, wave) {
    const entries = load();
    entries.push({ name, score, wave });
    entries.sort((a, b) => b.score - a.score);
    const trimmed = entries.slice(0, MAX);
    store(trimmed);
    const rank = trimmed.findIndex((e) => e.name === name && e.score === score) + 1;
    return { rank: rank || null };
  },
};
