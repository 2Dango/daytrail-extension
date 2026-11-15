import { normalizeDomain } from './settings.js';

export const trailsKey = 'daytrailTrails';
export const activeTrailKey = 'daytrailActiveTrailId';

const schemaName = 'daytrail-trail';
const schemaVersion = 1;
const maximumTrails = 100;
const maximumPages = 100;
const maximumResumePages = 20;
const lengths = Object.freeze({ name: 120, goal: 500, notes: 4000, checkpoint: 1000, title: 300, note: 1000 });
let trailsQueue = Promise.resolve();

export async function getTrails() {
  const stored = await chrome.storage.local.get(trailsKey);
  const records = Array.isArray(stored?.[trailsKey]) ? stored[trailsKey] : [];
  return records.slice(0, maximumTrails).map((record) => sanitizeStoredTrail(record)).filter(Boolean);
}

export async function getActiveTrail() {
  const stored = await chrome.storage.local.get([trailsKey, activeTrailKey]);
  const activeId = typeof stored?.[activeTrailKey] === 'string' ? stored[activeTrailKey] : null;
  if (!activeId) return null;
  const records = Array.isArray(stored?.[trailsKey]) ? stored[trailsKey] : [];
  const trail = records.map((record) => sanitizeStoredTrail(record)).find((record) => record?.id === activeId);
  return trail ?? null;
}

export async function setActiveTrail(id) {
  if (id !== null && (typeof id !== 'string' || !id.trim())) throw new TypeError('Trail id must be a string or null.');
  return withTrailsLock(async () => {
    if (id === null) {
      await chrome.storage.local.set({ [activeTrailKey]: null });
      return null;
    }
    const trail = (await getTrails()).find((candidate) => candidate.id === id);
    if (!trail) throw new Error('Trail not found.');
    await chrome.storage.local.set({ [activeTrailKey]: trail.id });
    return cloneTrail(trail);
  });
}

export async function createTrail({ name, goal = '', notes = '', checkpoint = '' } = {}) {
  const fields = sanitizeTrailFields({ name, goal, notes, checkpoint }, true);
  return withTrailsLock(async () => {
    const trails = await getTrails();
    if (trails.length >= maximumTrails) throw new Error(`Daytrail supports up to ${maximumTrails} Trails.`);
    const now = Date.now();
    const trail = {
      id: createId(),
      ...fields,
      createdAt: now,
      updatedAt: now,
      pages: [],
    };
    trails.unshift(trail);
    await chrome.storage.local.set({ [trailsKey]: trails, [activeTrailKey]: trail.id });
    return cloneTrail(trail);
  });
}

export async function updateTrail(id, patch) {
  assertPatch(patch);
  return mutateTrail(id, (trail) => {
    const next = sanitizeTrailFields({
      name: Object.hasOwn(patch, 'name') ? patch.name : trail.name,
      goal: Object.hasOwn(patch, 'goal') ? patch.goal : trail.goal,
      notes: Object.hasOwn(patch, 'notes') ? patch.notes : trail.notes,
      checkpoint: Object.hasOwn(patch, 'checkpoint') ? patch.checkpoint : trail.checkpoint,
    }, true);
    Object.assign(trail, next, { updatedAt: Date.now() });
    return trail;
  });
}

export async function deleteTrail(id) {
  return withTrailsLock(async () => {
    const stored = await chrome.storage.local.get([trailsKey, activeTrailKey]);
    const trails = normalizeStoredTrails(stored?.[trailsKey]);
    const index = trails.findIndex((trail) => trail.id === id);
    if (index < 0) throw new Error('Trail not found.');
    const [deleted] = trails.splice(index, 1);
    const update = { [trailsKey]: trails };
    if (stored?.[activeTrailKey] === id) update[activeTrailKey] = null;
    await chrome.storage.local.set(update);
    return cloneTrail(deleted);
  });
}

export async function addPageToTrail(id, { url, title = '', note = '' } = {}) {
  const page = sanitizePage({ url, title, note }, { strict: true, newId: true });
  return mutateTrail(id, (trail) => {
    const existing = trail.pages.find((candidate) => candidate.url === page.url);
    if (existing) {
      if (page.title) existing.title = page.title;
      if (page.note) existing.note = page.note;
    } else {
      if (trail.pages.length >= maximumPages) throw new Error(`A Trail can contain up to ${maximumPages} pages.`);
      trail.pages.push(page);
    }
    trail.updatedAt = Date.now();
    return trail;
  });
}

export async function removePageFromTrail(id, url) {
  const normalizedUrl = normalizePageUrl(url);
  return mutateTrail(id, (trail) => {
    const next = trail.pages.filter((page) => page.url !== normalizedUrl);
    if (next.length === trail.pages.length) throw new Error('Page not found in Trail.');
    trail.pages = next;
    trail.updatedAt = Date.now();
    return trail;
  });
}

export async function resumeTrail(id, { urls } = {}) {
  const trail = (await getTrails()).find((candidate) => candidate.id === id);
  if (!trail) throw new Error('Trail not found.');
  if (urls !== undefined && !Array.isArray(urls)) throw new TypeError('Resume URLs must be an array.');

  const selected = urls === undefined
    ? trail.pages.map((page) => page.url)
    : urls.map(normalizePageUrl);
  const available = new Set(trail.pages.map((page) => page.url));
  const unique = [...new Set(selected)].filter((url) => available.has(url)).slice(0, maximumResumePages);
  let opened = 0;
  let firstTabId = null;
  for (const url of unique) {
    try {
      // Activating the first tab would close a toolbar popup and destroy
      // this async loop before the remaining saved pages can open.
      const tab = await chrome.tabs.create({ url, active: false });
      if (firstTabId === null && Number.isInteger(tab?.id)) firstTabId = tab.id;
      opened += 1;
    } catch {
      // A single removed/restricted URL should not prevent the remaining pages opening.
    }
  }
  if (firstTabId !== null) {
    try { await chrome.tabs.update(firstTabId, { active: true }); }
    catch { /* Pages are already open; selection is a convenience only. */ }
  }
  return opened;
}

/** Return a portable plain object. Call JSON.stringify before saving it to disk. */
export async function exportTrail(id) {
  const trail = (await getTrails()).find((candidate) => candidate.id === id);
  if (!trail) throw new Error('Trail not found.');
  return {
    schema: schemaName,
    version: schemaVersion,
    exportedAt: new Date().toISOString(),
    trail: cloneTrail(trail),
  };
}

export async function importTrail(payload) {
  const parsed = parseImport(payload);
  if (parsed.schema !== schemaName || parsed.version !== schemaVersion || !parsed.trail) {
    throw new TypeError('This is not a supported Daytrail Trail export.');
  }
  const imported = sanitizeImportedTrail(parsed.trail);
  return withTrailsLock(async () => {
    const trails = await getTrails();
    if (trails.length >= maximumTrails) throw new Error(`Daytrail supports up to ${maximumTrails} Trails.`);
    trails.unshift(imported);
    await chrome.storage.local.set({ [trailsKey]: trails, [activeTrailKey]: imported.id });
    return cloneTrail(imported);
  });
}

async function mutateTrail(id, operation) {
  if (typeof id !== 'string' || !id) throw new TypeError('Trail id is required.');
  return withTrailsLock(async () => {
    const trails = await getTrails();
    const index = trails.findIndex((trail) => trail.id === id);
    if (index < 0) throw new Error('Trail not found.');
    const updated = operation(trails[index]);
    trails[index] = updated;
    await chrome.storage.local.set({ [trailsKey]: trails });
    return cloneTrail(updated);
  });
}

function sanitizeImportedTrail(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new TypeError('Trail export is malformed.');
  const now = Date.now();
  const fields = sanitizeTrailFields(record, true);
  const pages = [];
  const seen = new Set();
  const sourcePages = Array.isArray(record.pages) ? record.pages.slice(0, maximumPages) : [];
  for (const source of sourcePages) {
    const page = sanitizePage(source, { strict: true, newId: true });
    if (!seen.has(page.url)) {
      pages.push(page);
      seen.add(page.url);
    }
  }
  return {
    id: createId(),
    ...fields,
    createdAt: validTime(record.createdAt, now),
    updatedAt: now,
    pages,
  };
}

function sanitizeStoredTrail(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const id = cleanId(record.id);
  const name = cleanText(record.name, lengths.name);
  if (!id || !name) return null;
  const pages = [];
  const seen = new Set();
  for (const source of Array.isArray(record.pages) ? record.pages.slice(0, maximumPages) : []) {
    try {
      const page = sanitizePage(source, { strict: false, newId: false });
      if (page && !seen.has(page.url)) {
        pages.push(page);
        seen.add(page.url);
      }
    } catch {
      // Ignore only the corrupt page; preserve the rest of a locally saved Trail.
    }
  }
  const now = Date.now();
  const createdAt = validTime(record.createdAt, now);
  return {
    id,
    name,
    goal: cleanText(record.goal, lengths.goal),
    notes: cleanText(record.notes, lengths.notes),
    checkpoint: cleanText(record.checkpoint, lengths.checkpoint),
    createdAt,
    updatedAt: validTime(record.updatedAt, createdAt),
    pages,
  };
}

function normalizeStoredTrails(value) {
  return (Array.isArray(value) ? value : []).slice(0, maximumTrails)
    .map((record) => sanitizeStoredTrail(record)).filter(Boolean);
}

function sanitizeTrailFields(record, requireName) {
  const name = cleanText(record.name, lengths.name);
  if (requireName && !name) throw new TypeError('Trail name is required.');
  return {
    name,
    goal: cleanText(record.goal, lengths.goal),
    notes: cleanText(record.notes, lengths.notes),
    checkpoint: cleanText(record.checkpoint, lengths.checkpoint),
  };
}

function sanitizePage(record, { strict, newId }) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    if (strict) throw new TypeError('Trail page is malformed.');
    return null;
  }
  const url = normalizePageUrl(record.url);
  const parsed = new URL(url);
  const title = cleanText(record.title, lengths.title) || parsed.hostname;
  return {
    id: newId ? createId() : cleanId(record.id) || createId(),
    url,
    title,
    site: normalizeDomain(parsed.hostname).replace(/^www\./, ''),
    savedAt: validTime(record.savedAt, Date.now()),
    note: cleanText(record.note, lengths.note),
  };
}

function normalizePageUrl(input) {
  if (typeof input !== 'string' || !input.trim()) throw new TypeError('Page URL is required.');
  if (input.length > 4096) throw new TypeError('Page URL is too long.');
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new TypeError('Page URL is invalid.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new TypeError('Only safe HTTP(S) page URLs can be saved.');
  }
  normalizeDomain(parsed.hostname);
  return parsed.href;
}

function cleanText(value, maximum) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, maximum);
}

function cleanId(value) {
  return typeof value === 'string' ? value.trim().slice(0, 100) : '';
}

function validTime(value, fallback) {
  return Number.isFinite(value) && value > 0 && value <= Date.now() + 86_400_000 ? Math.round(value) : fallback;
}

function createId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function cloneTrail(trail) {
  return { ...trail, pages: trail.pages.map((page) => ({ ...page })) };
}

function parseImport(payload) {
  if (typeof payload === 'string') {
    if (payload.length > 1_000_000) throw new TypeError('Trail export is too large.');
    try {
      return JSON.parse(payload);
    } catch {
      throw new TypeError('Trail export is not valid JSON.');
    }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('Trail export is malformed.');
  return payload;
}

function assertPatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('Trail update must be an object.');
}

function withTrailsLock(operation) {
  if (globalThis.navigator?.locks?.request) {
    return navigator.locks.request(`${trailsKey}:write`, operation);
  }
  const result = trailsQueue.then(operation, operation);
  trailsQueue = result.catch(() => {});
  return result;
}
