/**
 * Commex Ranking System — System-wide based on total comments across all orgs
 *
 * Why system-wide: one identity, one rank that grows everywhere.
 * Per-org rank would mean a user has a different rank on every site they comment on,
 * which fragments their identity and makes ranks feel meaningless.
 */

const RANKS = [
  { id: 'lurker',        min: 0,    label: 'Lurker',         emoji: '👀', color: '#52525b', description: 'Just watching for now...' },
  { id: 'newcomer',      min: 1,    label: 'Newcomer',       emoji: '🌱', color: '#4ade80', description: 'Welcome to the community!' },
  { id: 'rookie',        min: 10,   label: 'Rookie',         emoji: '⚡', color: '#60a5fa', description: 'Getting the hang of it' },
  { id: 'super_rookie',  min: 25,   label: 'Super Rookie',   emoji: '🔥', color: '#f97316', description: 'On a roll!' },
  { id: 'contributor',   min: 50,   label: 'Contributor',    emoji: '💬', color: '#a78bfa', description: 'A regular voice' },
  { id: 'rising_star',   min: 100,  label: 'Rising Star',    emoji: '⭐', color: '#fbbf24', description: 'People notice you' },
  { id: 'veteran',       min: 250,  label: 'Veteran',        emoji: '🏆', color: '#f59e0b', description: 'Seen it all' },
  { id: 'epic',          min: 500,  label: 'Epic',           emoji: '💎', color: '#06b6d4', description: 'A true regular' },
  { id: 'legendary',     min: 1000, label: 'Legendary',      emoji: '🌟', color: '#ec4899', description: 'A legend of the community' },
  { id: 'mythic',        min: 2500, label: 'Mythic',         emoji: '👑', color: '#7c3aed', description: 'Beyond legendary' },
  { id: 'immortal',      min: 5000, label: 'Immortal',       emoji: '⚜️', color: '#ef4444', description: 'One of the all-time greats' },
];

/**
 * Get rank for a given comment count
 */
function getRank(commentCount) {
  const count = commentCount || 0;
  let rank = RANKS[0];
  for (const r of RANKS) {
    if (count >= r.min) rank = r;
    else break;
  }
  return rank;
}

/**
 * Get next rank milestone
 */
function getNextRank(commentCount) {
  const count = commentCount || 0;
  for (const r of RANKS) {
    if (r.min > count) return r;
  }
  return null; // maxed out
}

/**
 * Get progress to next rank (0-100)
 */
function getRankProgress(commentCount) {
  const count = commentCount || 0;
  const current = getRank(count);
  const next = getNextRank(count);
  if (!next) return 100;
  const range = next.min - current.min;
  const progress = count - current.min;
  return Math.floor((progress / range) * 100);
}

module.exports = { RANKS, getRank, getNextRank, getRankProgress };
