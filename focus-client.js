import { normalizeDomain, readSettings } from './settings.js';
import { timeCommand } from './time-data.js';

export const focusKey = 'daytrailFocusState';

const focusPermissions = ['declarativeNetRequestWithHostAccess', 'alarms'];
// Reminders turn on the existing all-site active-time tracker, which needs
// `tabs` to read the active tab outside the selected reminder hosts.
const reminderPermissions = ['scripting', 'tabs', 'idle', 'alarms'];
const maxSites = 30;
const permissionDeadlineMs = 20_000;
const commandDeadlineMs = 8_000;
const recoveryDeadlineMs = 1_000;
const workerRetryDelayMs = 150;
const pendingPermissionRequests = new Map();

class DaytrailTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DaytrailTimeoutError';
  }
}

class DaytrailCommandError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DaytrailCommandError';
  }
}

function withDeadline(operation, milliseconds, message) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new DaytrailTimeoutError(message)), milliseconds);
  });
  return Promise.race([Promise.resolve(operation), deadline]).finally(() => clearTimeout(timer));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sameSites(left, right) {
  return left.length === right.length && left.every((site, index) => site === right[index]);
}

function commandId() {
  return globalThis.crypto?.randomUUID?.() ?? `focus-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function transientWorkerFailure(error) {
  return /receiving end does not exist|message port closed|context invalidated|could not establish connection/i.test(error?.message || '');
}

export async function hasFocusAccess(sites) {
  let domains;
  try {
    domains = normalizeFocusSites(sites);
  } catch {
    return false;
  }
  const request = {
    permissions: focusPermissions,
    origins: hostPermissionOrigins(domains),
  };
  try {
    return await withDeadline(
      chrome.permissions.contains(request),
      recoveryDeadlineMs,
      'Focus access could not be checked.',
    );
  } catch {
    return false;
  }
}

function boundedInteger(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`${label} must be a whole number from ${minimum} to ${maximum}.`);
  }
  return number;
}

export function normalizeFocusSites(sites) {
  if (!Array.isArray(sites) || !sites.length) {
    throw new TypeError('Choose at least one website.');
  }
  const normalized = [];
  for (const value of sites) {
    let domain;
    try {
      domain = normalizeDomain(value);
    } catch {
      domain = '';
    }
    if (!domain) throw new TypeError(`“${String(value).slice(0, 80)}” is not a valid website domain.`);
    if (!normalized.includes(domain)) normalized.push(domain);
  }
  if (normalized.length > maxSites) throw new TypeError(`Choose no more than ${maxSites} websites.`);
  return normalized;
}

export function hostPermissionOrigins(sites) {
  return sites.flatMap((site) => [
    `http://${site}/*`,
    `http://*.${site}/*`,
    `https://${site}/*`,
    `https://*.${site}/*`,
  ]);
}

async function requestFeaturePermissions(permissions, sites) {
  const request = {
    permissions,
    origins: hostPermissionOrigins(sites),
  };
  const key = JSON.stringify(request);
  let pending = pendingPermissionRequests.get(key);
  if (!pending) {
    // Chrome requires permissions.request() to run in the user gesture. Do
    // not await permissions.contains() first: that extension API callback can
    // resume in a later task and lose transient user activation. Requesting an
    // already granted permission resolves without showing another prompt.
    pending = chrome.permissions.request(request);
    pendingPermissionRequests.set(key, pending);
    void pending.finally(() => pendingPermissionRequests.delete(key)).catch(() => {});
  }
  const granted = await withDeadline(
    pending,
    permissionDeadlineMs,
    'Chrome is still waiting for permission. Finish the Chrome permission prompt, then press the button again.',
  );
  if (!granted) throw new Error('Daytrail needs access to the selected websites for this feature.');
  const active = await withDeadline(
    chrome.permissions.contains(request),
    recoveryDeadlineMs,
    'Chrome granted access but did not activate it yet. Press the button again.',
  );
  if (!active) throw new Error('Chrome did not activate access to every selected website. Press the button again.');
}

async function recoverFocusCommand(action, options, id) {
  if (action === 'start') {
    const state = await withDeadline(readFocusState(), recoveryDeadlineMs, 'Focus state could not be checked.');
    if (state.session?.id === id) return { ok: true, state, recovered: true };
  }
  if (action === 'stop') {
    const state = await withDeadline(readFocusState(), recoveryDeadlineMs, 'Focus state could not be checked.');
    if (!state.session) return { ok: true, state, recovered: true };
  }
  if (action === 'enableReminders' || action === 'disableReminders') {
    const settings = await withDeadline(readSettings(), recoveryDeadlineMs, 'Reminder settings could not be checked.');
    if (action === 'disableReminders' && !settings.remindersEnabled) {
      return { ok: true, settings, recovered: true };
    }
    if (action === 'enableReminders' && settings.remindersEnabled &&
        settings.reminderMinutes === options.minutes && sameSites(settings.distractionSites, options.sites)) {
      return { ok: true, settings, recovered: true };
    }
  }
  return null;
}

async function sendFocusCommand(action, options, id = commandId()) {
  const message = { type: 'daytrail:focus', action, options, commandId: id };
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await withDeadline(
        chrome.runtime.sendMessage(message),
        commandDeadlineMs,
        'Daytrail’s background worker did not respond in time.',
      );
      if (!response?.ok) throw new DaytrailCommandError(response?.error || 'Daytrail couldn’t update focus mode.');
      return response;
    } catch (error) {
      lastError = error;
      if (error instanceof DaytrailTimeoutError) break;
      if (attempt === 0 && transientWorkerFailure(error)) {
        await delay(workerRetryDelayMs);
        continue;
      }
      break;
    }
  }
  // An explicit worker rejection is authoritative. Storage recovery is only
  // safe when transport failure left the outcome unknown.
  if (lastError instanceof DaytrailCommandError) throw lastError;
  const recovered = await recoverFocusCommand(action, options, id).catch(() => null);
  if (recovered) return recovered;
  if (lastError instanceof DaytrailTimeoutError) {
    throw new Error('Daytrail’s background worker did not finish. Reopen Daytrail and try again.');
  }
  if (transientWorkerFailure(lastError)) {
    throw new Error('Daytrail’s background worker restarted before finishing. Reopen Daytrail and try again.');
  }
  throw lastError;
}

export async function readFocusState() {
  const stored = await chrome.storage.local.get(focusKey);
  const session = stored[focusKey]?.session;
  if (!session || typeof session !== 'object') return { session: null };
  const startedAt = Number(session.startedAt);
  const endsAt = Number(session.endsAt);
  let sites;
  try {
    sites = normalizeFocusSites(session.sites);
  } catch {
    return { session: null };
  }
  if (typeof session.id !== 'string' || !session.id ||
      !Number.isFinite(startedAt) || !Number.isFinite(endsAt) || endsAt <= startedAt) {
    return { session: null };
  }
  return {
    session: {
      id: session.id.slice(0, 160),
      startedAt,
      endsAt,
      trailId: typeof session.trailId === 'string' && session.trailId.trim()
        ? session.trailId.trim().slice(0, 160)
        : null,
      sites,
    },
  };
}

export async function startFocus({ minutes, sites, trailId = null }) {
  const duration = boundedInteger(minutes, 1, 180, 'Focus time');
  const domains = normalizeFocusSites(sites);
  if (trailId !== null && (typeof trailId !== 'string' || !trailId.trim() || trailId.length > 160)) {
    throw new TypeError('Choose a valid Trail.');
  }
  await requestFeaturePermissions(focusPermissions, domains);
  const id = commandId();
  return (await sendFocusCommand('start', {
    minutes: duration,
    sites: domains,
    trailId: trailId?.trim() || null,
  }, id)).state;
}

export async function stopFocus() {
  return (await sendFocusCommand('stop')).state;
}

export async function enableReminders({ sites, minutes }) {
  const threshold = boundedInteger(minutes, 1, 120, 'Reminder time');
  const domains = normalizeFocusSites(sites);
  await requestFeaturePermissions(reminderPermissions, domains);
  await timeCommand('enable');
  return (await sendFocusCommand('enableReminders', {
    sites: domains,
    minutes: threshold,
  })).settings;
}

export async function disableReminders() {
  return (await sendFocusCommand('disableReminders')).settings;
}
