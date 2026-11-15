import { describeUrl } from './analytics.js';
import { appendTime, readTime, timeKey, timePermissions } from './time-data.js';

const alarmName = 'daytrail-time';
const idleSeconds = 60;
const maxGap = 45_000;
const retention = 90 * 86_400_000;
let browserEpoch;

async function getBrowserEpoch() {
  if (browserEpoch) return browserEpoch;
  const stored = await chrome.storage.session.get('timeBrowserEpoch');
  browserEpoch = stored.timeBrowserEpoch ?? crypto.randomUUID();
  if (!stored.timeBrowserEpoch) await chrome.storage.session.set({ timeBrowserEpoch: browserEpoch });
  return browserEpoch;
}
let queue = Promise.resolve();

function serialize(task) {
  const result = queue.then(task);
  queue = result.catch((error) => console.error('Daytrail tracking update failed', error));
  return result;
}

async function currentSite() {
  if (await chrome.idle.queryState(idleSeconds) !== 'active') return;
  const window = await chrome.windows.getLastFocused({ populate: false }).catch(() => null);
  if (!window?.focused || window.incognito || window.type !== 'normal') return;
  const [tab] = await chrome.tabs.query({ active: true, windowId: window.id });
  if (tab?.incognito || tab?.discarded) return;
  const site = describeUrl(tab?.url)?.site;
  if (site) return { site, windowId: window.id, tabId: tab.id };
}

async function update(at, reason, site) {
  const state = await readTime();
  const granted = await chrome.permissions.contains(timePermissions);
  const wasEnabled = state.enabled;
  if (reason === 'enable' && !granted) throw new Error('Tracking permission is required.');
  if (reason === 'enable') {
    state.enabled = true;
    state.since ??= at;
  }
  if (reason === 'pause' || !granted) state.enabled = false;

  const epoch = await getBrowserEpoch();
  const previous = state.checkpoint?.epoch === epoch ? state.checkpoint : undefined;
  const forceStop = ['unfocused', 'inactive', 'pause'].includes(reason);
  const next = state.enabled && !forceStop ? await currentSite() : undefined;
  const sameContext = next?.site === previous?.site && next?.tabId === previous?.tabId
    && next?.windowId === previous?.windowId;

  // A late alarm may follow sleep or a suspended worker. Keep only time
  // bounded by a recent observation or a Chrome event ending that visit.
  if (previous && wasEnabled && at - previous.since <= maxGap &&
      (reason !== 'alarm' || sameContext)) {
    appendTime(state.sessions, previous.site, previous.since, at);
  }
  if (reason === 'erase') state.sessions = state.sessions.filter(([host]) => host !== site);
  const cutoff = at - retention;
  state.sessions = state.sessions.filter(([, , end]) => end > cutoff);
  state.checkpoint = next ? { ...next, since: Math.max(at, previous?.since ?? at), epoch } : null;
  if (state.enabled || wasEnabled || reason === 'erase') {
    await chrome.storage.local.set({ [timeKey]: state });
  }

  if (chrome.alarms) {
    if (!state.enabled) await chrome.alarms.clear(alarmName);
    else if (!await chrome.alarms.get(alarmName)) {
      await chrome.alarms.create(alarmName, { periodInMinutes: 0.5 });
    }
  }
}

function observe(reason = 'change') {
  const at = Date.now();
  void serialize(() => update(at, reason));
}

chrome.tabs.onActivated.addListener(() => observe());
chrome.tabs.onUpdated.addListener((id, change, tab) => {
  if (tab.active && ('url' in change || 'discarded' in change || change.status === 'complete')) observe();
});
chrome.tabs.onRemoved.addListener(() => observe());
chrome.windows.onFocusChanged.addListener((id) => observe(id === chrome.windows.WINDOW_ID_NONE ? 'unfocused' : 'change'));
function idleChanged(state) {
  observe(state === 'active' ? 'change' : 'inactive');
}
function checkpoint(alarm) {
  if (alarm.name === alarmName) observe('alarm');
}
function registerTrackingListeners() {
  chrome.idle?.onStateChanged.addListener(idleChanged);
  chrome.alarms?.onAlarm.addListener(checkpoint);
}
registerTrackingListeners();
chrome.permissions.onAdded.addListener(registerTrackingListeners);
chrome.runtime.onStartup.addListener(() => observe());
chrome.runtime.onInstalled.addListener(() => observe());
chrome.permissions.onRemoved.addListener(({ permissions }) => {
  if (timePermissions.permissions.some((permission) => permissions?.includes(permission))) observe('inactive');
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !['enable', 'pause', 'erase'].includes(message?.timeAction)) return;
  if (message.timeAction === 'erase' && typeof message.site !== 'string') return;
  const at = Date.now();
  serialize(async () => {
    if (message.timeAction === 'enable' || (await chrome.permissions.contains({ permissions: ['idle'] }))) {
      chrome.idle?.setDetectionInterval(idleSeconds);
      registerTrackingListeners();
    }
    await update(at, message.timeAction, message.site);
  }).then(() => reply({ ok: true }), () => reply({ ok: false }));
  return true;
});
