import { readSettings } from './settings.js';
import { getActiveTrail } from './trails.js';
import { readRecentPages } from './history-data.js';
import { readDiscoveryFeedback } from './discovery-state.js';
import { domainMatches } from './discovery-data.js';

// Titles are used only in this in-memory snapshot. No topic profile, title list,
// or browsing URLs are persisted or sent outside the extension.
export async function loadDiscoveryContext({ days, start, end, hidden = new Set(), includeHistory = false }, dependencies = {}) {
  const api = { readSettings, getActiveTrail, readRecentPages, readDiscoveryFeedback, ...dependencies };
  const [settings, trail, feedback, history] = await Promise.all([
    api.readSettings(), api.getActiveTrail(), api.readDiscoveryFeedback(),
    includeHistory ? api.readRecentPages({ days, limit: 200 }) : Promise.resolve({ source: 'none', items: [] }),
  ]);
  const excluded = new Set([...hidden, ...settings.excludedSites]);
  const allowed = page => {
    try {
      const url = new URL(page.url);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
        && ![...excluded].some(domain => domainMatches(url.hostname, domain));
    } catch { return false; }
  };
  // readRecentPages can return labeled demonstration pages if permission was
  // removed while loading. Those must never become real personalized evidence.
  const pages = history.source === 'history'
    ? history.items.filter(page => page.lastVisitTime >= start && page.lastVisitTime <= end && allowed(page))
    : [];
  return {
    excluded,
    details: {
      trail: trail ? { id: trail.id, name: trail.name, goal: trail.goal, checkpoint: trail.checkpoint, pages: trail.pages.filter(allowed) } : null,
      pages, feedback, pageSource: history.source === 'history' ? 'history' : 'none',
    },
  };
}
