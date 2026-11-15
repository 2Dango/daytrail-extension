import { focusKey, hostPermissionOrigins, normalizeFocusSites } from './focus-client.js';
import { getActiveTrail, getTrails } from './trails.js';
import { matchesDomain, normalizeDomain, readSettings, settingsKey, updateSettings } from './settings.js';
import { timeKey } from './time-data.js';

export const focusRuleStart = 100000;
export const focusRuleEnd = 100099;
export const reminderStateKey = 'daytrailReminderState';

const focusAlarm = 'daytrail-focus-end';
const focusRetryKey = 'daytrailFocusCleanupRetry';
const reminderAlarm = 'daytrail-reminder-check';
const focusPermissions = ['declarativeNetRequestWithHostAccess', 'alarms'];
const reminderPermissions = ['scripting', 'tabs', 'idle', 'alarms'];
const reminderCooldown = 10 * 60_000;
const reminderSnooze = 5 * 60_000;
const activeIdleSeconds = 60;
const focusRetryDelay = 5_000;
const maximumFocusRetries = 3;
let initialized = false;
let alarmListenerRegistered = false;
let focusQueue = Promise.resolve();
let reminderQueue = Promise.resolve();

function queueFocusUpdate(operation) {
  const result = focusQueue.then(operation, operation);
  focusQueue = result.catch(() => {});
  return result;
}

function queueReminderUpdate(operation) {
  const result = reminderQueue.then(operation, operation);
  reminderQueue = result.catch(() => {});
  return result;
}

function extensionPage(url) {
  return typeof url === 'string' && url.startsWith(chrome.runtime.getURL(''));
}

function validExtensionSender(sender) {
  return sender?.id === chrome.runtime.id && extensionPage(sender.url);
}

function safeDomain(value) {
  try {
    return normalizeDomain(value) || null;
  } catch {
    return null;
  }
}

export function hostFromUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return safeDomain(url.hostname);
  } catch {
    return null;
  }
}

function normalizeTrailId(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !value.trim() || value.length > 160) throw new TypeError('Invalid Trail.');
  return value.trim();
}

function normalizeCommandId(value) {
  if (value === undefined || value === null || value === '') return randomId();
  if (typeof value !== 'string' || !value.trim() || value.length > 160) throw new TypeError('Invalid focus command.');
  return value.trim();
}

function normalizeMinutes(value, maximum, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > maximum) {
    throw new TypeError(`${label} must be a whole number from 1 to ${maximum}.`);
  }
  return number;
}

function normalizeSites(value) {
  return normalizeFocusSites(value);
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `focus-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeSession(value) {
  if (!value || typeof value !== 'object') return null;
  const startedAt = Number(value.startedAt);
  const endsAt = Number(value.endsAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endsAt) || endsAt <= startedAt) return null;
  let sites;
  try {
    sites = normalizeSites(value.sites);
  } catch {
    return null;
  }
  const trailId = typeof value.trailId === 'string' && value.trailId.length <= 160 ? value.trailId : null;
  return {
    id: typeof value.id === 'string' && value.id ? value.id.slice(0, 160) : randomId(),
    startedAt,
    endsAt,
    trailId,
    sites,
  };
}

export function sessionHasExpired(session, now = Date.now()) {
  return !session || !Number.isFinite(session.endsAt) || session.endsAt <= now;
}

async function readSession() {
  const stored = await chrome.storage.local.get(focusKey);
  return normalizeSession(stored[focusKey]?.session);
}

async function writeSession(session) {
  await chrome.storage.local.set({ [focusKey]: { session } });
  return { session };
}

export function buildFocusRules(sites) {
  return normalizeSites(sites).map((site, index) => ({
    id: focusRuleStart + index,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: { extensionPath: '/blocked.html' },
    },
    condition: {
      urlFilter: `||${site}^`,
      resourceTypes: ['main_frame'],
    },
  }));
}

async function ownedRuleIds() {
  if (!chrome.declarativeNetRequest?.getDynamicRules) {
    throw new Error('Website blocking is not available in this browser.');
  }
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  return rules
    .map(({ id }) => id)
    .filter((id) => id >= focusRuleStart && id <= focusRuleEnd);
}

async function clearFocusRules() {
  try {
    const ids = await ownedRuleIds();
    if (!ids.length) return true;
    if (!chrome.declarativeNetRequest?.updateDynamicRules) {
      throw new Error('Website blocking is not available in this browser.');
    }
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ids });
    return true;
  } catch (error) {
    const permissionStillGranted = await chrome.permissions.contains({
      permissions: ['declarativeNetRequestWithHostAccess'],
    }).catch(() => false);
    // Rules cannot act after the API permission itself is revoked. Chrome may
    // also reject cleanup at that point; the next grant/start reconciles them.
    if (!permissionStillGranted) return false;
    throw new Error('Daytrail could not remove its website blocking rules. Try ending focus again.', { cause: error });
  }
}

async function installFocusRules(sites) {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) {
    throw new Error('Website blocking is not available in this browser.');
  }
  const oldIds = await ownedRuleIds();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldIds,
    addRules: buildFocusRules(sites),
  });
}

async function hasFeaturePermissions(permissions, sites) {
  try {
    return await chrome.permissions.contains({
      permissions,
      origins: hostPermissionOrigins(sites),
    });
  } catch {
    return false;
  }
}

async function createFocusAlarm(endsAt) {
  if (!chrome.alarms?.clear || !chrome.alarms?.create) {
    throw new Error('Focus timers are not available in this browser.');
  }
  await chrome.alarms.clear(focusAlarm);
  await chrome.alarms.create(focusAlarm, { when: endsAt });
}

async function clearAlarmIfAvailable(name) {
  try {
    if (!chrome.alarms?.clear) return false;
    await chrome.alarms.clear(name);
    return true;
  } catch (error) {
    const permissionStillGranted = await chrome.permissions.contains({ permissions: ['alarms'] }).catch(() => false);
    if (!permissionStillGranted) return false;
    throw error;
  }
}

async function clearFocusRetry() {
  await chrome.storage.local.remove(focusRetryKey);
}

async function scheduleFocusCleanupRetry(session) {
  if (!session || !sessionHasExpired(session)) return false;
  const stored = await chrome.storage.local.get(focusRetryKey);
  const previous = stored[focusRetryKey];
  const attempts = previous?.sessionId === session.id ? Number(previous.attempts) + 1 : 1;
  if (!Number.isInteger(attempts) || attempts > maximumFocusRetries) return false;
  const when = Date.now() + attempts * focusRetryDelay;
  await chrome.storage.local.set({ [focusRetryKey]: { sessionId: session.id, attempts, when } });
  if (!chrome.alarms?.create) return false;
  await chrome.alarms.create(focusAlarm, { when });
  return true;
}

async function stopFocusInternal() {
  await clearFocusRules();
  await clearAlarmIfAvailable(focusAlarm);
  const result = await writeSession(null);
  await clearFocusRetry();
  return result;
}

function matchesAny(site, domains) {
  return domains.some((domain) => matchesDomain(site, domain));
}

async function redirectTabIfBlocked(tab, session) {
  if (!tab || tab.incognito || typeof tab.id !== 'number') return false;
  const site = hostFromUrl(tab.url);
  if (!site || !matchesAny(site, session.sites)) return false;
  await chrome.tabs.update(tab.id, { url: chrome.runtime.getURL('blocked.html') });
  return true;
}

async function redirectOpenBlockedTabs(session) {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.map((tab) => redirectTabIfBlocked(tab, session)));
}

async function redirectActivatedTab(tabId) {
  const session = await readSession();
  if (!session || sessionHasExpired(session)) return false;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const latest = await readSession();
  if (!latest || latest.id !== session.id || sessionHasExpired(latest)) return false;
  if (!await hasFeaturePermissions(focusPermissions, latest.sites)) return false;
  return redirectTabIfBlocked(tab, latest);
}

async function startFocusInternal(options) {
  const minutes = normalizeMinutes(options?.minutes, 180, 'Focus time');
  const sites = normalizeSites(options?.sites);
  const trailId = normalizeTrailId(options?.trailId);
  const id = normalizeCommandId(options?.commandId);
  const existing = await readSession();
  if (existing?.id === id && !sessionHasExpired(existing) && existing.trailId === trailId &&
      existing.endsAt - existing.startedAt === minutes * 60_000 &&
      existing.sites.length === sites.length && existing.sites.every((site, index) => site === sites[index])) {
    return { session: existing };
  }
  if (trailId && !(await getTrails()).some((trail) => trail.id === trailId)) {
    throw new Error('The selected Trail no longer exists.');
  }
  if (!await hasFeaturePermissions(focusPermissions, sites)) {
    throw new Error('Focus permission was not granted for every selected website.');
  }
  const startedAt = Date.now();
  const session = {
    id,
    startedAt,
    endsAt: startedAt + minutes * 60_000,
    trailId,
    sites,
  };
  try {
    await clearFocusRetry();
    await installFocusRules(sites);
    await createFocusAlarm(session.endsAt);
    await writeSession(session);
    await redirectOpenBlockedTabs(session);
    return { session };
  } catch (error) {
    await stopFocusInternal();
    throw error;
  }
}

async function reconcileFocus({ redirectTabs = false } = {}) {
  const session = await readSession();
  if (!session) {
    await clearFocusRules();
    await clearAlarmIfAvailable(focusAlarm);
    await clearFocusRetry();
    return { session: null };
  }
  if (sessionHasExpired(session) || !await hasFeaturePermissions(focusPermissions, session.sites)) {
    return stopFocusInternal();
  }
  await installFocusRules(session.sites);
  await createFocusAlarm(session.endsAt);
  if (redirectTabs) await redirectOpenBlockedTabs(session);
  return { session };
}

function startOfLocalDay(at) {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function startOfNextLocalDay(at) {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
}

export function activeTimeForSite(record, site, start, end, domainMatcher = matchesDomain) {
  const intervals = [];
  for (const entry of Array.isArray(record?.sessions) ? record.sessions : []) {
    if (!Array.isArray(entry) || entry.length < 3 || !domainMatcher(entry[0], site)) continue;
    const from = Math.max(Number(entry[1]), start);
    const to = Math.min(Number(entry[2]), end);
    if (Number.isFinite(from) && Number.isFinite(to) && to > from) intervals.push([from, to]);
  }
  const checkpoint = record?.checkpoint;
  if (record?.enabled && checkpoint && domainMatcher(checkpoint.site, site)) {
    const observedFrom = Number(checkpoint.since);
    const from = Math.max(observedFrom, start);
    const to = Math.min(end, observedFrom + 45_000);
    if (Number.isFinite(from) && Number.isFinite(to) && to > from) intervals.push([from, to]);
  }
  intervals.sort((left, right) => left[0] - right[0]);
  let total = 0;
  let cursorStart;
  let cursorEnd;
  for (const [from, to] of intervals) {
    if (cursorStart === undefined) [cursorStart, cursorEnd] = [from, to];
    else if (from <= cursorEnd) cursorEnd = Math.max(cursorEnd, to);
    else {
      total += cursorEnd - cursorStart;
      [cursorStart, cursorEnd] = [from, to];
    }
  }
  if (cursorStart !== undefined) total += cursorEnd - cursorStart;
  return total;
}

export function reminderRecordIsEnabled(record) {
  return record?.enabled === true;
}

function normalizeReminderMap(value) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [domain, until] of Object.entries(value)) {
    const site = safeDomain(domain);
    const timestamp = Number(until);
    if (site && Number.isFinite(timestamp) && timestamp > 0) result[site] = timestamp;
  }
  return result;
}

async function readReminderState() {
  const stored = await chrome.storage.local.get(reminderStateKey);
  const value = stored[reminderStateKey];
  return {
    snoozeUntil: normalizeReminderMap(value?.snoozeUntil),
    cooldownUntil: normalizeReminderMap(value?.cooldownUntil),
    workUntil: normalizeReminderMap(value?.workUntil),
  };
}

async function writeReminderState(state) {
  await chrome.storage.local.set({ [reminderStateKey]: state });
}

async function currentActiveTab() {
  if (!chrome.idle || await chrome.idle.queryState(activeIdleSeconds) !== 'active') return null;
  const window = await chrome.windows.getLastFocused({ populate: false }).catch(() => null);
  if (!window?.focused || window.incognito || window.type !== 'normal') return null;
  const [tab] = await chrome.tabs.query({ active: true, windowId: window.id });
  if (!tab || tab.incognito || tab.discarded || typeof tab.id !== 'number') return null;
  const site = hostFromUrl(tab.url);
  return site ? { tab, site } : null;
}

async function reminderTrailCopy() {
  try {
    const trail = await getActiveTrail();
    return {
      trailName: typeof trail?.name === 'string' ? trail.name.slice(0, 120) : '',
      checkpoint: typeof trail?.checkpoint === 'string' ? trail.checkpoint.slice(0, 240) : '',
    };
  } catch {
    return { trailName: '', checkpoint: '' };
  }
}

async function injectReminder(tabId, copy) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['reminder.js'] });
  const response = await chrome.tabs.sendMessage(tabId, {
    type: 'daytrail:reminder:show',
    ...copy,
  });
  return response?.shown === true;
}

async function reminderCandidate(now = Date.now()) {
  const settings = await readSettings();
  if (!settings.remindersEnabled) return null;
  const sites = normalizeSites(settings.distractionSites);
  if (!await hasFeaturePermissions(reminderPermissions, sites)) return null;
  const active = await currentActiveTab();
  if (!active) return null;
  if ((settings.excludedSites ?? []).some((site) => matchesDomain(active.site, site))) return null;
  const selected = sites.find((site) => matchesDomain(active.site, site));
  if (!selected) return null;

  const reminderState = await readReminderState();
  if ((reminderState.workUntil[selected] ?? 0) > now ||
      (reminderState.snoozeUntil[selected] ?? 0) > now ||
      (reminderState.cooldownUntil[selected] ?? 0) > now) return null;

  const stored = await chrome.storage.local.get(timeKey);
  if (!reminderRecordIsEnabled(stored[timeKey])) {
    return null;
  }
  // The existing tracker intentionally folds www.example.com into example.com.
  const measuredSite = selected.replace(/^www\./, '');
  const elapsed = activeTimeForSite(stored[timeKey], measuredSite, startOfLocalDay(now), now);
  const thresholdMinutes = normalizeMinutes(settings.reminderMinutes, 120, 'Reminder time');
  if (elapsed < thresholdMinutes * 60_000) return null;
  return { active, elapsed, reminderState, selected, thresholdMinutes };
}

async function evaluateReminder() {
  const candidate = await reminderCandidate();
  if (!candidate) return false;

  const trailCopy = await reminderTrailCopy();
  // Settings, permissions, active tab, persisted time and snooze state may all
  // have changed while Trail copy was loading. Recheck immediately before the
  // injection; a later pause is serialized behind this check and hides it.
  const latest = await reminderCandidate();
  if (!latest || latest.active.tab.id !== candidate.active.tab.id || latest.selected !== candidate.selected) return false;
  const shown = await injectReminder(latest.active.tab.id, {
    site: latest.selected,
    minutes: Math.max(latest.thresholdMinutes, Math.floor(latest.elapsed / 60_000)),
    ...trailCopy,
  }).catch(() => false);
  if (!shown) return false;
  latest.reminderState.cooldownUntil[latest.selected] = Date.now() + reminderCooldown;
  await writeReminderState(latest.reminderState);
  return true;
}

function queueReminderCheck() {
  return queueReminderUpdate(evaluateReminder).catch((error) => {
    console.warn('Daytrail reminder check failed.', error);
  });
}

async function hideInjectedReminders() {
  if (!chrome.tabs?.query) return;
  const tabs = await chrome.tabs.query({}).catch(() => []);
  await Promise.allSettled(tabs.map((tab) =>
    typeof tab.id === 'number'
      ? chrome.tabs.sendMessage(tab.id, { type: 'daytrail:reminder:hide' })
      : Promise.resolve()
  ));
}

async function enableRemindersInternal(options) {
  const minutes = normalizeMinutes(options?.minutes, 120, 'Reminder time');
  const sites = normalizeSites(options?.sites);
  if (!await hasFeaturePermissions(reminderPermissions, sites)) {
    throw new Error('Reminder permission was not granted for every selected website.');
  }
  const settings = await updateSettings({
    remindersEnabled: true,
    reminderMinutes: minutes,
    distractionSites: sites,
  });
  if (!chrome.alarms?.create) throw new Error('Reminder timers are not available in this browser.');
  await chrome.alarms.create(reminderAlarm, { periodInMinutes: 1 });
  void queueReminderCheck();
  return settings;
}

async function disableRemindersInternal() {
  const settings = await updateSettings({ remindersEnabled: false });
  await clearAlarmIfAvailable(reminderAlarm);
  await hideInjectedReminders();
  return settings;
}

function validReminderSender(sender, site) {
  if (sender?.id !== chrome.runtime.id || typeof sender?.tab?.id !== 'number' || sender.frameId !== 0) return false;
  const senderSite = hostFromUrl(sender.url || sender.tab.url);
  return Boolean(senderSite && site && matchesDomain(senderSite, site));
}

async function handleReminderAction(message, sender) {
  const site = safeDomain(message.site);
  if (!validReminderSender(sender, site)) throw new Error('Invalid reminder source.');
  if (!['return', 'snooze', 'work', 'dismiss'].includes(message.action)) throw new Error('Invalid reminder action.');
  const settings = await readSettings();
  const selected = settings.distractionSites.find((domain) => domain === site);
  if (!selected) throw new Error('This website is not configured for reminders.');
  const state = await readReminderState();
  const now = Date.now();
  applyReminderChoice(state, selected, message.action, now);
  await writeReminderState(state);
  if (message.action === 'return') {
    await chrome.tabs.update(sender.tab.id, { url: chrome.runtime.getURL('index.html#trails') });
  }
  return { ok: true };
}

export function applyReminderChoice(state, site, action, now = Date.now()) {
  if (action === 'snooze') {
    state.snoozeUntil[site] = now + reminderSnooze;
    delete state.cooldownUntil[site];
  }
  if (action === 'work') {
    state.workUntil[site] = startOfNextLocalDay(now);
    delete state.cooldownUntil[site];
  }
  if (action === 'dismiss') state.cooldownUntil[site] = now + reminderCooldown;
  return state;
}

async function handleFocusCommand(message, sender) {
  if (!validExtensionSender(sender)) throw new Error('Invalid Daytrail command source.');
  if (message.action === 'start') {
    return {
      ok: true,
      state: await queueFocusUpdate(() => startFocusInternal({ ...message.options, commandId: message.commandId })),
    };
  }
  if (message.action === 'stop') {
    return { ok: true, state: await queueFocusUpdate(stopFocusInternal) };
  }
  if (message.action === 'enableReminders') {
    return { ok: true, settings: await queueReminderUpdate(() => enableRemindersInternal(message.options)) };
  }
  if (message.action === 'disableReminders') {
    return { ok: true, settings: await queueReminderUpdate(disableRemindersInternal) };
  }
  throw new Error('Unknown focus command.');
}

async function reconcileReminders() {
  const settings = await readSettings();
  if (!settings.remindersEnabled) {
    await clearAlarmIfAvailable(reminderAlarm);
    await hideInjectedReminders();
    return;
  }
  let sites;
  try {
    sites = normalizeSites(settings.distractionSites);
  } catch {
    await disableRemindersInternal();
    return;
  }
  if (!await hasFeaturePermissions(reminderPermissions, sites)) {
    await disableRemindersInternal();
    return;
  }
  if (!chrome.alarms?.create) {
    await disableRemindersInternal();
    return;
  }
  await chrome.alarms.create(reminderAlarm, { periodInMinutes: 1 });
  void queueReminderCheck();
}

async function reconcileAll({ redirectTabs = false } = {}) {
  await queueFocusUpdate(() => reconcileFocus({ redirectTabs })).catch(async (error) => {
    console.warn('Daytrail focus recovery failed.', error);
    const session = await readSession().catch(() => null);
    if (sessionHasExpired(session) && session) {
      await scheduleFocusCleanupRetry(session).catch((retryError) => {
        console.warn('Daytrail could not schedule focus cleanup retry.', retryError);
      });
      return;
    }
    await queueFocusUpdate(stopFocusInternal).catch((cleanupError) => {
      console.warn('Daytrail focus cleanup failed.', cleanupError);
    });
  });
  await queueReminderUpdate(reconcileReminders).catch((error) => console.warn('Daytrail reminder recovery failed.', error));
}

function onMessage(message, sender, reply) {
  let operation;
  if (message?.type === 'daytrail:focus') operation = handleFocusCommand(message, sender);
  else if (message?.type === 'daytrail:reminder:action') operation = queueReminderUpdate(() => handleReminderAction(message, sender));
  else return;
  operation.then(reply, (error) => reply({ ok: false, error: error?.message || 'Daytrail could not complete that action.' }));
  return true;
}

function onAlarm(alarm) {
  if (alarm.name === focusAlarm) {
    void queueFocusUpdate(() => reconcileFocus({ redirectTabs: false })).catch(async (error) => {
      console.warn('Daytrail focus expiry cleanup failed.', error);
      const session = await readSession().catch(() => null);
      await scheduleFocusCleanupRetry(session).catch((retryError) => {
        console.warn('Daytrail could not schedule focus cleanup retry.', retryError);
      });
    });
  }
  if (alarm.name === reminderAlarm) void queueReminderCheck();
}

function registerAlarmListener() {
  if (alarmListenerRegistered || !chrome.alarms?.onAlarm?.addListener) return false;
  chrome.alarms.onAlarm.addListener(onAlarm);
  alarmListenerRegistered = true;
  return true;
}

function onStorageChanged(changes, area) {
  if (area !== 'local') return;
  if (changes[timeKey]) {
    if (reminderRecordIsEnabled(changes[timeKey].newValue)) void queueReminderCheck();
    else void queueReminderUpdate(hideInjectedReminders);
  }
  if (changes[settingsKey]) {
    void queueReminderUpdate(reconcileReminders).catch((error) => {
      console.warn('Daytrail reminder settings reconciliation failed.', error);
    });
  }
}

function onTabActivated({ tabId }) {
  void queueFocusUpdate(() => redirectActivatedTab(tabId)).catch(() => {}).then(() => queueReminderCheck());
}

export function initFocusEngine() {
  if (initialized) return;
  initialized = true;
  chrome.runtime.onMessage.addListener(onMessage);
  registerAlarmListener();
  chrome.runtime.onStartup.addListener(() => void reconcileAll({ redirectTabs: true }));
  chrome.runtime.onInstalled.addListener(() => void reconcileAll({ redirectTabs: false }));
  chrome.permissions.onAdded.addListener(() => {
    registerAlarmListener();
    void reconcileAll({ redirectTabs: false });
  });
  chrome.permissions.onRemoved.addListener(() => void reconcileAll({ redirectTabs: false }));
  chrome.storage.onChanged.addListener(onStorageChanged);
  chrome.tabs.onActivated.addListener(onTabActivated);
  void reconcileAll({ redirectTabs: false });
}
