import { categoryFor, overridesKey } from './categories.js';
import { matchesDomain, normalizeDomain, readSettings } from './settings.js';

const hiddenSitesKey = 'hiddenSites';
const cacheMaximum = 2000;
const cacheEntryMaximum = 12;
const cacheLifetime = 60_000;
const dayMs = 86_400_000;

// This is intentionally a small, separate demonstration dataset. The returned
// source is always "sample", so these pages cannot be mistaken for user history.
const samplePages = Object.freeze([
  { url: 'https://developer.chrome.com/docs/extensions/reference/api/history', title: 'Chrome History API', hoursAgo: 1, visitCount: 4 },
  { url: 'https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest', title: 'Declarative Net Request API', hoursAgo: 2, visitCount: 2 },
  { url: 'https://github.com/2Dango/g-extension-', title: 'Daytrail extension prototype', hoursAgo: 3, visitCount: 8 },
  { url: 'https://developer.mozilla.org/en-US/docs/Web/API/URL', title: 'URL API — MDN', hoursAgo: 5, visitCount: 3 },
  { url: 'https://www.figma.com/community', title: 'Explore community design resources', hoursAgo: 9, visitCount: 2 },
  { url: 'https://www.youtube.com/watch?v=daytrail-demo', title: 'Designing a useful browser extension', hoursAgo: 18, visitCount: 1 },
  { url: 'https://stackoverflow.com/questions/tagged/google-chrome-extension', title: 'Newest Chrome extension questions', hoursAgo: 27, visitCount: 3 },
  { url: 'https://www.notion.so/templates', title: 'Project planning templates', hoursAgo: 45, visitCount: 1 },
  { url: 'https://www.reddit.com/r/webdev/', title: 'Web development discussions', hoursAgo: 70, visitCount: 5 },
  { url: 'https://web.dev/articles/storage-for-the-web', title: 'Storage for the web', hoursAgo: 95, visitCount: 2 },
  { url: 'https://unsplash.com/s/photos/pixel-landscape', title: 'Pixel landscape references', hoursAgo: 130, visitCount: 1 },
  { url: 'https://en.wikipedia.org/wiki/Spaced_repetition', title: 'Spaced repetition', hoursAgo: 190, visitCount: 1 },
  { url: 'https://archive.org/details/softwarelibrary', title: 'Software Library', hoursAgo: 350, visitCount: 2 },
  { url: 'https://www.alltrails.com/canada/ontario/toronto', title: 'Best trails near Toronto', hoursAgo: 520, visitCount: 1 },
]);

const historyCaches = new Map();
const pendingLoads = new Map();
let cacheGeneration = 0;
let historyListenerTarget = null;

export async function readRecentPages({ text = '', days = 7, site = '', limit = 200 } = {}) {
  validateOptions({ text, days, site, limit });
  const now = Date.now();
  const rangeStart = now - days * dayMs;
  const [allowed, preferences] = await Promise.all([
    hasHistoryPermission(),
    readPreferences(),
  ]);
  // Match the same hostname grouping displayed in the results.
  const siteFilter = site.trim() ? normalizeDomain(site).replace(/^www\./, '') : '';
  const query = text.trim().toLocaleLowerCase().slice(0, 500);
  const chromeQuery = query ? text.trim().slice(0, 500) : siteFilter;
  let source = allowed ? 'history' : 'sample';
  let raw;
  if (allowed) {
    try {
      raw = await loadHistory(rangeStart, now, chromeQuery);
    } catch (error) {
      if (await hasHistoryPermission()) throw error;
      source = 'sample';
      raw = createSamplePages(now);
    }
    if (source === 'history' && !await hasHistoryPermission()) {
      source = 'sample';
      raw = createSamplePages(now);
    }
  } else {
    raw = createSamplePages(now);
  }

  const visible = raw.items.filter((item) => {
    if (item.lastVisitTime < rangeStart || item.lastVisitTime > now + 1000) return false;
    if (isMatched(item.site, preferences.excludedSites) || isMatched(item.site, preferences.hiddenSites)) return false;
    if (siteFilter && !matchesDomain(item.site, siteFilter)) return false;
    if (!query) return true;
    return `${item.title}\n${item.url}\n${item.site}`.toLocaleLowerCase().includes(query);
  });

  const hasMore = visible.length > limit || Boolean(raw.truncated);
  const items = visible.slice(0, limit).map((item) => ({
    ...item,
    category: categoryFor(item.site, preferences.overrides),
  }));
  return { items, hasMore, source, rangeStart };
}

export function invalidateHistoryCache() {
  cacheGeneration += 1;
  historyCaches.clear();
  pendingLoads.clear();
}

async function hasHistoryPermission() {
  if (!globalThis.chrome?.history || !chrome.permissions?.contains) return false;
  try {
    return await chrome.permissions.contains({ permissions: ['history'] });
  } catch {
    return false;
  }
}

async function readPreferences() {
  const [settings, stored] = await Promise.all([
    readSettings(),
    chrome.storage.local.get([hiddenSitesKey, overridesKey]),
  ]);
  return {
    excludedSites: settings.excludedSites,
    hiddenSites: normalizeStoredDomains(stored?.[hiddenSitesKey]),
    overrides: stored?.[overridesKey] && typeof stored[overridesKey] === 'object' ? stored[overridesKey] : {},
  };
}

async function loadHistory(rangeStart, now, searchText) {
  const cacheKey = searchText.toLocaleLowerCase();
  const cached = historyCaches.get(cacheKey);
  if (cached && cached.rangeStart <= rangeStart && now - cached.loadedAt < cacheLifetime) {
    historyCaches.delete(cacheKey);
    historyCaches.set(cacheKey, cached);
    return cached;
  }
  const pending = pendingLoads.get(cacheKey);
  if (pending && pending.rangeStart <= rangeStart) return pending.promise;

  const generation = cacheGeneration;
  const promise = chrome.history.search({
    text: searchText,
    startTime: rangeStart,
    endTime: now + 1,
    maxResults: cacheMaximum + 1,
  }).then((entries) => {
    const list = Array.isArray(entries) ? entries : [];
    const normalized = normalizeHistoryItems(list.slice(0, cacheMaximum), rangeStart, now);
    const result = {
      items: normalized,
      truncated: list.length > cacheMaximum,
      rangeStart,
      loadedAt: Date.now(),
    };
    if (generation === cacheGeneration) {
      historyCaches.delete(cacheKey);
      historyCaches.set(cacheKey, result);
      while (historyCaches.size > cacheEntryMaximum) historyCaches.delete(historyCaches.keys().next().value);
    }
    return result;
  }).finally(() => {
    if (pendingLoads.get(cacheKey)?.promise === promise) pendingLoads.delete(cacheKey);
  });
  pendingLoads.set(cacheKey, { rangeStart, promise });
  return promise;
}

function normalizeHistoryItems(entries, rangeStart, now) {
  const byUrl = new Map();
  for (const entry of entries) {
    const page = normalizeHistoryItem(entry, rangeStart, now);
    if (!page) continue;
    const previous = byUrl.get(page.url);
    if (!previous || page.lastVisitTime > previous.lastVisitTime) byUrl.set(page.url, page);
  }
  return [...byUrl.values()].sort((left, right) => (
    right.lastVisitTime - left.lastVisitTime || left.title.localeCompare(right.title)
  ));
}

function normalizeHistoryItem(entry, rangeStart, now) {
  if (!entry || typeof entry.url !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(entry.url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    normalizeDomain(parsed.hostname);
  } catch {
    return null;
  }
  const lastVisitTime = Number(entry.lastVisitTime);
  if (!Number.isFinite(lastVisitTime) || lastVisitTime < rangeStart || lastVisitTime > now + 1000) return null;
  const url = parsed.href;
  const site = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  return {
    id: cleanId(entry.id) || `history-${hashString(url)}`,
    url,
    title: cleanTitle(entry.title) || site,
    site,
    lastVisitTime,
    visitCount: positiveInteger(entry.visitCount),
  };
}

function createSamplePages(now) {
  const anchor = Math.floor(now / 3_600_000) * 3_600_000;
  return {
    items: samplePages.map((page, index) => {
      const parsed = new URL(page.url);
      const site = parsed.hostname.replace(/^www\./, '');
      return {
        id: `sample-${index + 1}`,
        url: parsed.href,
        title: page.title,
        site,
        lastVisitTime: anchor - page.hoursAgo * 3_600_000,
        visitCount: page.visitCount,
      };
    }),
    truncated: false,
  };
}

function validateOptions({ text, days, site, limit }) {
  if (typeof text !== 'string' || typeof site !== 'string') throw new TypeError('History filters must be text.');
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new RangeError('History range must be 1 to 3650 days.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new RangeError('History result limit must be 1 to 500.');
}

function normalizeStoredDomains(value) {
  if (!Array.isArray(value)) return [];
  const domains = [];
  for (const candidate of value) {
    try {
      const domain = normalizeDomain(candidate);
      if (!domains.includes(domain)) domains.push(domain);
    } catch {
      // Older or corrupt preferences should not make history unavailable.
    }
  }
  return domains;
}

function isMatched(site, domains) {
  return domains.some((domain) => matchesDomain(site, domain));
}

function cleanTitle(value) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 300)
    : '';
}

function cleanId(value) {
  return typeof value === 'string' ? value.trim().slice(0, 200) : '';
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function addInvalidationListeners() {
  registerHistoryListeners();
  chrome.permissions?.onAdded?.addListener?.(({ permissions }) => {
    if (!permissions?.includes('history')) return;
    invalidateHistoryCache();
    registerHistoryListeners();
    queueMicrotask(registerHistoryListeners);
  });
  chrome.permissions?.onRemoved?.addListener?.(({ permissions }) => {
    if (permissions?.includes('history')) invalidateHistoryCache();
  });
}

function registerHistoryListeners() {
  const history = chrome.history;
  if (!history || historyListenerTarget === history) return;
  const visited = history.onVisited;
  const removed = history.onVisitRemoved;
  if (!visited?.addListener || !removed?.addListener) return;
  visited.addListener(invalidateHistoryCache);
  removed.addListener(invalidateHistoryCache);
  historyListenerTarget = history;
}

if (globalThis.chrome) addInvalidationListeners();
