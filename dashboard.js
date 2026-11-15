import { calendarDay, readHistory } from './analytics.js';
import { activityChart } from './chart.js';
import {
  configureManifest, connectGoogle, currentAccount, disconnectGoogle, googleConfigured,
  historyAccess, markHistoryApproved,
} from './auth.js';
import { sampleHistory } from './sample.js';

const byId = (id) => document.getElementById(id);
const numbers = new Intl.NumberFormat();
const rangeDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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
  const rows = favorites.map(({ site, count }) => {
    const row = make('li', 'site-row');
    const mark = make('span', 'site-mark', site[0].toUpperCase());
    mark.setAttribute('aria-hidden', 'true');
    const favicon = document.createElement('img');
    favicon.alt = '';
    favicon.width = 24;
    favicon.height = 24;
    const faviconUrl = new URL(chrome.runtime.getURL('/_favicon/'));
    faviconUrl.searchParams.set('pageUrl', `https://${site}/`);
    faviconUrl.searchParams.set('size', '32');
    favicon.addEventListener('load', () => mark.replaceChildren(favicon));
    favicon.src = faviconUrl.href;
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

function renderSummary(data) {
  const now = data?.now ?? Date.now();
  const from = data?.start ?? calendarDay(now, 1 - Number(range.value));
  byId('date-caption').textContent = rangeDate.formatRange(from, now);
  byId('search-count').textContent = data ? numbers.format(data.searches) : '–';
  byId('site-count').textContent = data ? numbers.format(data.sites) : '–';
  byId('visit-count').textContent = data ? numbers.format(data.visits) : '–';
  byId('tracking-date').textContent = data?.trackingSince ? rangeDate.format(data.trackingSince) : '–';
  byId('source-pill').classList.toggle('is-live', Boolean(data && !data.sample));
  byId('source-label').textContent = data?.sample ? 'Sample data' : data ? 'Chrome history' : 'Chrome history unavailable';
  graph.set(data?.timeline ?? []);

  const peak = data?.timeline.reduce((best, day) => day.visits > best.visits ? day : best);
  byId('activity-summary').textContent = peak?.visits
    ? `Busiest day · ${dayDate.format(peak.date)} · ${numbers.format(peak.visits)} visits`
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
  accountButton.hidden = !account;
  byId('connect-title').textContent = account ? 'Allow Chrome history access' : 'See your own browsing activity';
  byId('connect-description').textContent = account
    ? `Signed in as ${account.email}. Chrome uses a separate permission for this profile’s history.`
    : 'Connect your Google account, then allow access to this Chrome profile’s history.';
  byId('connect-action-label').textContent = account ? 'Allow history access' : 'Connect Google account';
  if (!account) {
    if (accountDialog.open && !byId('account-panel').hidden) accountDialog.close();
    byId('profile-name').textContent = '';
    byId('profile-email').textContent = '';
    byId('account-label').textContent = '';
    byId('account-initials').textContent = '';
    accountButton.removeAttribute('aria-label');
    return;
  }

  const identity = account.name || account.email;
  byId('account-label').textContent = identity;
  byId('account-initials').textContent = identity.split(/\s+/).slice(0, 2)
    .map((part) => Array.from(part)[0]).join('').toLocaleUpperCase();
  accountButton.setAttribute('aria-label', `Manage Google account, ${account.email}`);
  byId('profile-name').textContent = account.name;
  byId('profile-email').textContent = account.email;
  byId('profile-history-status').textContent = historyReady
    ? 'This profile has granted Chrome history access.'
    : 'Waiting for history approval from Chrome.';
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
    const result = await readHistory(chrome.history, days, { active });
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

function openSetup() {
  byId('account-title').textContent = 'Set up Google sign-in';
  byId('account-panel').hidden = true;
  byId('setup-panel').hidden = false;
  byId('extension-id').value = chrome.runtime.id;
  byId('setup-status').textContent = '';
  accountDialog.showModal();
}

accountButton.addEventListener('click', () => {
  byId('account-title').textContent = 'Google account';
  byId('setup-panel').hidden = true;
  byId('account-panel').hidden = false;
  accountDialog.showModal();
});
byId('about-control').addEventListener('click', () => byId('about-dialog').showModal());

connectButton.addEventListener('click', () => {
  if (account) {
    const { profileId } = account;
    void accountAction('Waiting for Chrome…', async () => {
      if (await chrome.permissions.request(historyAccess)) {
        await markHistoryApproved(profileId);
      } else {
        showNotice('History access was declined. You can keep exploring the sample data.');
      }
    });
  } else if (googleConfigured) {
    void accountAction('Connecting…', connectGoogle, (error) => {
      if (/not granted|cancel|closed|denied|rejected/i.test(error.message ?? '')) {
        return 'Google sign-in was interrupted. You can try again.';
      }
      if (/oauth2|invalid.client|bad client/i.test(error.message ?? '')) {
        return 'Google couldn’t use this OAuth client. Check that its Item ID matches this extension and try again.';
      }
      return '';
    });
  } else {
    openSetup();
  }
});

disconnectButton.addEventListener('click', () => {
  accountDialog.close();
  version += 1;
  resetToSample();
  void accountAction('Disconnecting…', disconnectGoogle);
});

byId('copy-id').addEventListener('click', async () => {
  const field = byId('extension-id');
  try {
    await navigator.clipboard.writeText(field.value);
    byId('setup-status').textContent = 'Extension ID copied.';
  } catch {
    field.select();
    byId('setup-status').textContent = 'Copy the selected extension ID.';
  }
});

byId('setup-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const status = byId('setup-status');
  try {
    const manifest = configureManifest(byId('client-id').value.trim());
    const file = new Blob([JSON.stringify(manifest, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(file);
    const link = make('a');
    link.href = url;
    link.download = 'manifest.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = 'Check your Chrome downloads for manifest.json.';
  } catch (error) {
    status.textContent = error.message;
  }
});

range.addEventListener('change', () => {
  showNotice();
  void refresh();
});
refreshButton.addEventListener('click', () => {
  showNotice();
  void refresh();
});

chrome.identity.onSignInChanged.addListener(() => {
  if (!accountBusy) void refresh({ invalidate: true });
});
chrome.permissions.onRemoved.addListener(({ permissions }) => {
  if (!accountBusy && permissions?.includes('history')) void refresh({ invalidate: true });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (!accountBusy && area === 'local' && Object.hasOwn(changes, 'connectedAccount')) {
    void refresh({ invalidate: true });
  }
});
document.addEventListener('visibilitychange', () => {
  if (!accountBusy && document.visibilityState === 'visible') void refresh();
});

renderSummary(sampleHistory(Number(range.value)));
void refresh();

import './pixel-art.js';
