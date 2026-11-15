export const settingsKey = 'daytrailSettings';

const defaultSettings = Object.freeze({
  excludedSites: [],
  retentionDays: 30,
  remindersEnabled: false,
  reminderMinutes: 10,
  distractionSites: ['reddit.com', 'instagram.com'],
  focusMinutes: 25,
});

const limits = Object.freeze({
  retentionDays: [1, 90],
  reminderMinutes: [1, 120],
  focusMinutes: [1, 180],
});

let settingsQueue = Promise.resolve();

/**
 * Normalize a website domain. Bare hostnames are accepted. A complete http(s)
 * URL may also be pasted; its hostname is extracted and its path is ignored.
 * Credentials, explicit ports, wildcards, and all other schemes are rejected.
 */
export function normalizeDomain(input) {
  if (typeof input !== 'string') throw new TypeError('Website must be a domain or an HTTP(S) URL.');
  const value = input.trim();
  if (!value) throw new TypeError('Website cannot be empty.');
  if (value.includes('*') || /\s/.test(value)) throw new TypeError('Website contains unsupported characters.');

  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(value);
  let parsed;
  try {
    if (hasScheme) {
      parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new TypeError('Only HTTP(S) websites are supported.');
    } else {
      if (/[\/@:?#]/.test(value)) throw new TypeError('Enter a domain without a path, port, or credentials.');
      parsed = new URL(`https://${value}/`);
    }
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith('Only ')) throw error;
    if (error instanceof TypeError && error.message.startsWith('Enter ')) throw error;
    throw new TypeError('Enter a valid website domain.');
  }

  if (parsed.username || parsed.password) throw new TypeError('Website credentials are not supported.');
  // URL normalizes default ports away, so inspect the pasted authority as well.
  const authority = hasScheme ? value.slice(value.indexOf(':') + 1).replace(/^\/\//, '').split(/[/?#]/, 1)[0] : value;
  if (parsed.port || /:\d+$/.test(authority)) throw new TypeError('Website ports are not supported.');

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!isHostname(hostname)) throw new TypeError('Enter a valid website domain.');
  return hostname;
}

export function matchesDomain(site, domain) {
  try {
    const normalizedSite = normalizeDomain(site);
    const normalizedDomain = normalizeDomain(domain);
    return normalizedSite === normalizedDomain || normalizedSite.endsWith(`.${normalizedDomain}`);
  } catch {
    return false;
  }
}

export async function readSettings() {
  const stored = await chrome.storage.local.get(settingsKey);
  return normalizeSettings(stored?.[settingsKey]);
}

export async function updateSettings(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new TypeError('Settings update must be an object.');
  }
  return withSettingsLock(async () => {
    const current = await readSettings();
    const updated = normalizeSettings({ ...current, ...pickSettings(patch) }, true);
    await chrome.storage.local.set({ [settingsKey]: updated });
    return cloneSettings(updated);
  });
}

function isHostname(hostname) {
  if (!hostname || hostname.length > 253 || hostname.includes('..')) return false;
  const labels = hostname.split('.');
  return labels.every((label) => (
    label.length >= 1 && label.length <= 63 &&
    /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label)
  ));
}

function normalizeSettings(value, strict = false) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    // Reports and active-time tracking group a leading www hostname with its
    // bare domain. Fold exclusions the same way so the privacy boundary cannot
    // be bypassed by that display normalization.
    excludedSites: normalizeDomains(raw.excludedSites, defaultSettings.excludedSites, strict, 100, true),
    retentionDays: normalizeInteger(raw.retentionDays, defaultSettings.retentionDays, limits.retentionDays, strict),
    remindersEnabled: typeof raw.remindersEnabled === 'boolean' ? raw.remindersEnabled : defaultSettings.remindersEnabled,
    reminderMinutes: normalizeInteger(raw.reminderMinutes, defaultSettings.reminderMinutes, limits.reminderMinutes, strict),
    distractionSites: normalizeDomains(raw.distractionSites, defaultSettings.distractionSites, strict, 30),
    focusMinutes: normalizeInteger(raw.focusMinutes, defaultSettings.focusMinutes, limits.focusMinutes, strict),
  };
}

function normalizeDomains(value, fallback, strict, maximum, foldLeadingWww = false) {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value)) {
    if (strict) throw new TypeError('Website lists must be arrays.');
    return [...fallback];
  }
  const domains = [];
  for (const candidate of value) {
    try {
      const normalized = normalizeDomain(candidate);
      const domain = foldLeadingWww && normalized.startsWith('www.') ? normalized.slice(4) : normalized;
      if (!domains.includes(domain)) domains.push(domain);
    } catch (error) {
      if (strict) throw error;
    }
    if (domains.length >= maximum) break;
  }
  return domains;
}

function normalizeInteger(value, fallback, [minimum, maximum], strict) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    if (strict) throw new RangeError(`Setting must be an integer from ${minimum} to ${maximum}.`);
    return fallback;
  }
  return value;
}

function pickSettings(patch) {
  const picked = {};
  for (const key of Object.keys(defaultSettings)) {
    if (Object.hasOwn(patch, key)) picked[key] = patch[key];
  }
  return picked;
}

function cloneSettings(settings) {
  return {
    ...settings,
    excludedSites: [...settings.excludedSites],
    distractionSites: [...settings.distractionSites],
  };
}

function withSettingsLock(operation) {
  if (globalThis.navigator?.locks?.request) {
    return navigator.locks.request(`${settingsKey}:write`, operation);
  }
  const result = settingsQueue.then(operation, operation);
  settingsQueue = result.catch(() => {});
  return result;
}
