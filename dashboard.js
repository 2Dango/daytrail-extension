import { initRecommendations } from './recommendations.js';
import { initDetailedInsights } from './insights.js';
import { initTimePanel } from './time-panel.js';
import { hourMs } from './time-data.js';
import { calendarDay, readHistory, invalidateVisitCache } from './analytics.js';
import { activityChart } from './chart.js';
import { connectHistory, currentAccount, disconnectDaytrail, historyAccess, connectionKey } from './auth.js';
import { initPrivacyPanel } from './privacy-panel.js';
import { sampleHistory } from './sample.js';
import { hiddenSites, initHistoryManager, peakLabels, placeFavicon } from './history-tools.js';
import { loadDiscoveryContext } from './discovery-context.js';
import { discoveryFeedbackKey } from './discovery-state.js';
import { trailsKey, activeTrailKey } from './trails.js';

const byId = (id) => document.getElementById(id);
const numbers = new Intl.NumberFormat();
const rangeDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const dateTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const dayDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const searchDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const range = byId('range');
const refreshButton = byId('refresh');
const report = byId('report');
const connectButton = byId('connect-action');
const notice = byId('notice');
const accountDialog = byId('account-dialog');
const accountButton = byId('account-control');
const disconnectButton = byId('disconnect');
const graph = activityChart(byId('activity-chart'), byId('activity-tooltip'), byId('activity-announcement'));

let account = null;
let historyReady = false;
let accountBusy = false;
let version = 0;

function make(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

function renderFavorites(favorites) {
  const max = favorites[0]?.count ?? 1;
  const rows = favorites.map(({ site, count, pageUrl }) => {
    const row = make('li', 'site-row');
    const mark = make('span', 'site-mark');
    mark.setAttribute('aria-hidden', 'true');
    placeFavicon(mark, site, pageUrl);
    const main = make('div', 'site-details');
    const name = make('span', 'site-name', site);
    name.title = site;
    const track = make('span', 'site-track');
    const fill = make('span', 'site-bar');
    fill.style.setProperty('--bar', `${100 * count / max}%`);
    track.append(fill);
    main.append(name, track);

    const visits = make('span', 'site-count');
    visits.append(make('strong', '', numbers.format(count)), count === 1 ? ' visit' : ' visits');
    row.append(mark, main, visits);
    return row;
  });
  byId('site-chart').replaceChildren(...rows);
  byId('site-empty').hidden = Boolean(rows.length);
}

function renderRecent(searches) {
  const rows = searches.map(({ query, time }) => {
    const row = make('li', 'search-row');
    const term = make('span', '', query);
    term.dir = 'auto';
    term.title = query;
    const stamp = make('time', '', searchDate.format(time));
    stamp.dateTime = new Date(time).toISOString();
    row.append(icon('search'), term, stamp);
    return row;
  });
  byId('recent-searches').replaceChildren(...rows);
  byId('recent-empty').hidden = Boolean(rows.length);
}

function displayRange(now = Date.now()) {
  const days = Number(range.value);
  const start = days === 1 ? now - 24 * hourMs : calendarDay(now, 1 - days);
  return { days, start, end: now, label: (days === 1 ? dateTime : rangeDate).formatRange(start, now) };
}

let latestSummary;
const renderRecommendations = initRecommendations();
const renderDetailedInsights = initDetailedInsights();
let insightVersion = 0;
function invalidateDiscoveries(pending = false) {
  insightVersion += 1;
  renderRecommendations(null, new Map(), null, {}, { pending });
}
const refreshTime = initTimePanel(displayRange, (durations, hidden, overrides, timeContext) => {
  const requested = ++insightVersion;
  const summary = latestSummary;
  // Clear stale matches while loading a new privacy/context snapshot. Delayed
  // reads must not repaint results after a Trail, permission or exclusion change.
  renderRecommendations(null, new Map(), null, {}, { pending: true });
  void loadDiscoveryContext({
    ...displayRange(), hidden, includeHistory: Boolean(historyReady && summary && !summary.sample),
  }).then(({ excluded, details }) => {
    if (requested !== insightVersion) return;
    renderRecommendations(summary, durations, excluded, overrides, details);
    renderDetailedInsights(summary, durations, overrides, timeContext);
  }).catch(() => {
    if (requested !== insightVersion) return;
    renderRecommendations(summary, durations, null, overrides);
    renderDetailedInsights(summary, durations, overrides, timeContext);
  });
}, invalidateDiscoveries);

function renderSummary(data) {
  latestSummary = data;
  const now = data?.now ?? Date.now();
  byId('date-caption').textContent = displayRange(now).label;
  byId('activity-caption').textContent = Number(range.value) === 1
    ? 'Hourly web visits and Google searches' : 'Daily web visits and Google searches';
  refreshTime();
  byId('search-count').textContent = data ? numbers.format(data.searches) : '–';
  byId('site-count').textContent = data ? numbers.format(data.sites) : '–';
  byId('visit-count').textContent = data ? numbers.format(data.visits) : '–';
  byId('tracking-date').textContent = data?.sample ? 'Off' : data?.trackingSince ? rangeDate.format(data.trackingSince) : '–';
  document.querySelector('#tracking-date + .metric-detail').textContent = data?.sample ? 'Sample activity shown' : 'First permission date';
  byId('source-pill').classList.toggle('is-live', Boolean(data && !data.sample));
  byId('source-label').textContent = data?.sample ? 'Sample data' : data ? 'Chrome history' : 'Chrome history unavailable';
  graph.set(data?.timeline ?? [], data?.hourly);
  const { hour, weekday } = peakLabels(data);
  byId('peak-hour').textContent = hour;
  byId('peak-weekday').textContent = weekday;

  const peak = data?.timeline.reduce((best, day) => day.visits > best.visits ? day : best);
  byId('activity-summary').textContent = peak?.visits
    ? `${data.hourly ? 'Busiest hour' : 'Busiest day'} · ${(data.hourly ? dateTime : dayDate).format(peak.date)} · ${numbers.format(peak.visits)} visits`
    : data ? 'No web visits in this date range.' : 'Activity could not be loaded.';
  renderFavorites(data?.favorites ?? []);
  renderRecent(data?.recent ?? []);
  if (!data) {
    byId('site-empty').textContent = 'Website visits could not be loaded.';
    byId('recent-empty').textContent = 'Searches could not be loaded.';
  } else {
    byId('site-empty').textContent = 'No website visits in this date range.';
    byId('recent-empty').textContent = 'No Google searches in this date range.';
  }
}

function renderAccess() {
  byId('connect-banner').hidden = historyReady;
  refreshButton.hidden = !historyReady;
  accountButton.hidden = false;
  byId('connect-title').textContent = 'Explore your own browsing';
  byId('connect-description').textContent = 'Allow access to this Chrome profile’s history. Everything stays on this device.';
  byId('connect-action-label').textContent = 'Allow history access';
  byId('account-label').textContent = 'Privacy';
  byId('account-initials').textContent = 'P';
  accountButton.setAttribute('aria-label', 'Open privacy and data controls');
  byId('profile-name').textContent = 'This Chrome profile';
  byId('profile-email').textContent = 'No Google account or cloud connection required.';
  byId('profile-history-status').textContent = historyReady
    ? 'History access is enabled. Recorded time, saved Trails and settings stay on this device.'
    : 'History access is off. The dashboard is showing labeled sample data.';
}

function showNotice(message = '') {
  notice.textContent = message;
  notice.hidden = !message;
}

function setLoading(loading) {
  report.setAttribute('aria-busy', String(loading));
  refreshButton.disabled = loading || accountBusy;
}

function resetToSample() {
  account = null;
  historyReady = false;
  renderAccess();
  renderSummary(sampleHistory(Number(range.value)));
}

async function refresh({ invalidate = false } = {}) {
  const requested = ++version;
  const days = Number(range.value);
  const active = () => requested === version;
  if (invalidate) resetToSample();

  try {
    const [nextAccount, granted] = await Promise.all([
      currentAccount(),
      chrome.permissions.contains(historyAccess),
    ]);
    if (!active()) return;

    account = nextAccount;
    historyReady = Boolean(account?.trackingSince && granted);
    renderAccess();
    if (!historyReady) {
      renderSummary(sampleHistory(days));
      return;
    }

    setLoading(true);
    const result = await readHistory(chrome.history, days, { active, hiddenSites: await hiddenSites() });
    if (!active()) return;
    const verified = await currentAccount();
    if (!active()) return;
    if (verified?.subject !== nextAccount.subject) {
      resetToSample();
      return;
    }
    renderSummary({ ...result, trackingSince: nextAccount.trackingSince });
  } catch {
    if (!active()) return;
    renderSummary(null);
    showNotice('Daytrail couldn’t load history. Reopen the dashboard or try refreshing.');
  } finally {
    if (active()) setLoading(false);
  }
}

async function accountAction(label, action, failure) {
  if (accountBusy) return;

  showNotice();
  accountBusy = true;
  connectButton.disabled = true;
  disconnectButton.disabled = true;
  byId('connect-action-label').textContent = label;
  try {
    await action();
  } catch (error) {
    showNotice(failure?.(error) || error.message || 'Daytrail couldn’t complete the request. Try again.');
  } finally {
    accountBusy = false;
    connectButton.disabled = false;
    disconnectButton.disabled = false;
    renderAccess();
    await refresh();
  }
}

accountButton.addEventListener('click', () => {
  document.dispatchEvent(new CustomEvent('daytrail:navigate', { detail: { view: 'privacy' } }));
});
byId('about-control').addEventListener('click', () => byId('about-dialog').showModal());

connectButton.addEventListener('click', () => {
  const request = connectHistory();
  void accountAction('Waiting for Chrome…', async () => {
    if (!await request) showNotice('History permission was declined. You can still explore the sample data.');
  });
});

disconnectButton.addEventListener('click', () => {
  accountDialog.close();
  void accountAction('Disconnecting…', disconnectDaytrail);
});

range.addEventListener('change', () => {
  showNotice();
  invalidateDiscoveries(true);
  void refresh();
});
refreshButton.addEventListener('click', () => {
  showNotice();
  void refresh();
});

chrome.permissions.onRemoved.addListener(({ permissions }) => {
  if (permissions?.includes('history')) {
    invalidateDiscoveries(true);
    invalidateVisitCache();
    if (!accountBusy) void refresh({ invalidate: true });
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && [trailsKey, activeTrailKey, discoveryFeedbackKey, 'hiddenSites', 'daytrailSettings', connectionKey].some(key => Object.hasOwn(changes, key))) {
    invalidateDiscoveries(true);
    refreshTime();
  }
  if (area === 'local' && (Object.hasOwn(changes, 'hiddenSites') || Object.hasOwn(changes, 'daytrailSettings')) && historyReady) void refresh();
  if (!accountBusy && area === 'local' && Object.hasOwn(changes, connectionKey)) {
    void refresh({ invalidate: true });
  }
});
document.addEventListener('visibilitychange', () => {
  if (!accountBusy && document.visibilityState === 'visible') void refresh();
});

chrome.permissions.onAdded.addListener(({ permissions }) => {
  if (permissions?.includes('history')) {
    registerHistoryEvents();
    if (!accountBusy) void refresh();
  }
});
let historyEvents;
function registerHistoryEvents() {
  if (!chrome.history || historyEvents === chrome.history) return;
  historyEvents = chrome.history;
  historyEvents.onVisited.addListener(item => invalidateVisitCache(item.url));
  historyEvents.onVisitRemoved.addListener(() => {
    invalidateDiscoveries(true);
    invalidateVisitCache();
    if (!accountBusy) void refresh();
  });
}
registerHistoryEvents();
initPrivacyPanel();
initHistoryManager(refresh, displayRange);
renderSummary(sampleHistory(Number(range.value)));
void refresh();

import './pixel-art.js';
