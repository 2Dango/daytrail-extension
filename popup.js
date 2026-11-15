import { readHistory } from './analytics.js';
import { currentAccount, historyAccess } from './auth.js';
import { activityChart } from './chart.js';
import { hiddenSites, peakLabels } from './history-tools.js';
import { sampleHistory } from './sample.js';
import { getTrails, getActiveTrail, setActiveTrail, createTrail, addPageToTrail, resumeTrail } from './trails.js';
import { readSettings } from './settings.js';
import { readFocusState, hasFocusAccess, startFocus, stopFocus } from './focus-client.js';

const byId = id => document.getElementById(id);
const graph = activityChart(byId('popup-chart'), byId('popup-tooltip'), byId('popup-announcement'));
const numbers = new Intl.NumberFormat();
const trailSelect = byId('popup-trail-select');
const saveButton = byId('popup-save');
const resumeButton = byId('popup-resume');
const focusButton = byId('popup-focus');
const createButton = byId('popup-create-form').querySelector('button');
let activeTrail = null;
let settings = null;
let focusSession = null;
let focusAccess = false;
let focusRefreshVersion = 0;
let pageToSave = null;
let refreshVersion = 0;
let busy = false;
let trailsReady = false;

function say(message) {
  byId('popup-status').textContent = message;
  byId('popup-status').hidden = !message;
}

// Capture the tab that opened this toolbar once. Background refreshes must not
// replace it with a tab opened by Resume or the dashboard.
async function capturePage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && !tab.incognito && tab.url) {
      const url = new URL(tab.url);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) {
        pageToSave = { url: url.href, title: tab.title || url.hostname };
      }
    }
  } catch { /* Chrome's own pages cannot be saved with activeTab. */ }
  byId('popup-page').textContent = pageToSave?.title || 'Open a website, then click the Daytrail toolbar icon to save it.';
  byId('popup-page').title = pageToSave?.url || '';
  createButton.textContent = pageToSave ? 'Create & save page' : 'Create Trail';
  renderControls();
}

function renderControls() {
  trailSelect.disabled = busy || !trailsReady;
  createButton.disabled = busy || !trailsReady;
  saveButton.disabled = busy || !trailsReady || !pageToSave;
  resumeButton.disabled = busy || !activeTrail?.pages.length;
  const saved = activeTrail?.pages.some(page => page.url === pageToSave?.url);
  saveButton.textContent = saved ? 'Saved · save again' : 'Save this page';
  saveButton.title = pageToSave ? '' : 'Chrome pages and the extension dashboard cannot be saved. Open a website first.';
  renderFocus();
}

function renderFocus() {
  const remaining = focusSession ? Math.max(0, Math.ceil((focusSession.endsAt - Date.now()) / 60_000)) : 0;
  byId('popup-focus-label').textContent = focusSession
    ? (remaining ? `${remaining} min of focus left` : 'Timer ended · finishing cleanup') : 'Focus is off';
  focusButton.textContent = focusSession ? 'End focus' : `Focus ${settings?.focusMinutes || 25} min`;
  focusButton.disabled = busy || !settings;
  const sites = focusSession ? focusSession.sites : settings?.distractionSites || [];
  byId('popup-focus-sites').textContent = sites.length
    ? `${sites.length} ${sites.length === 1 ? 'site' : 'sites'} selected · edit in Focus` : 'Choose websites in the Focus tab.';
  byId('popup-focus-sites').title = sites.join(', ');
}

async function refreshTrails() {
  const version = ++refreshVersion;
  const [trails, selected] = await Promise.all([getTrails(), getActiveTrail()]);
  if (version !== refreshVersion) return;
  activeTrail = selected || trails[0] || null;
  trailSelect.replaceChildren();
  if (!activeTrail) {
    const option = new Option(trails.length ? 'Choose a Trail' : 'Create a Trail below', '');
    trailSelect.append(option);
  }
  for (const trail of trails) trailSelect.append(new Option(`${trail.name} · ${trail.pages.length} ${trail.pages.length === 1 ? 'page' : 'pages'}`, trail.id));
  trailSelect.value = activeTrail?.id || '';
  byId('popup-checkpoint').hidden = !activeTrail?.checkpoint;
  byId('popup-checkpoint').textContent = activeTrail?.checkpoint ? `Next: ${activeTrail.checkpoint}` : '';
  if (!trails.length) byId('popup-new-trail').open = true;
  trailsReady = true;
  renderControls();
}

async function refreshFocus() {
  const version = ++focusRefreshVersion;
  const [nextSettings, focus] = await Promise.all([readSettings(), readFocusState()]);
  const access = await hasFocusAccess(nextSettings.distractionSites);
  if (version !== focusRefreshVersion) return;
  focusAccess = access;
  settings = nextSettings;
  focusSession = focus.session;
  renderFocus();
}

async function run(action) {
  if (busy) return;
  busy = true;
  renderControls();
  try { await action(); }
  catch (error) { say(error.message || 'That action could not be completed. Try again.'); }
  finally {
    busy = false;
    await Promise.allSettled([refreshTrails(), refreshFocus()]);
    renderControls();
  }
}

trailSelect.addEventListener('change', () => {
  const id = trailSelect.value;
  void run(async () => { await setActiveTrail(id || null); say(''); });
});
byId('popup-create-form').addEventListener('submit', event => {
  event.preventDefault();
  void run(async () => {
    const trail = await createTrail({ name: byId('popup-trail-name').value });
    byId('popup-trail-name').value = '';
    byId('popup-new-trail').open = false;
    if (pageToSave) {
      try { await addPageToTrail(trail.id, pageToSave); }
      catch (error) { throw new Error(`Trail created. The page was not saved: ${error.message}`); }
      say(`Created “${trail.name}” and saved this page.`);
    } else say(`Created “${trail.name}”. Open a website to save your first page.`);
  });
});
saveButton.addEventListener('click', () => void run(async () => {
  if (!pageToSave) throw new Error('Open a regular website and click Daytrail’s toolbar icon to save it.');
  if (!trailSelect.value) {
    byId('popup-new-trail').open = true;
    byId('popup-trail-name').focus();
    say('Name your first Trail below, then choose Create & save page.');
    return;
  }
  const trail = await addPageToTrail(trailSelect.value, pageToSave);
  await setActiveTrail(trail.id);
  say(`Saved to “${trail.name}” · ${trail.pages.length} ${trail.pages.length === 1 ? 'page' : 'pages'}.`);
}));
resumeButton.addEventListener('click', () => void run(async () => {
  const count = await resumeTrail(trailSelect.value);
  say(count ? `Opened ${count} saved ${count === 1 ? 'page' : 'pages'}.` : 'This Trail has no pages to open.');
}));
focusButton.addEventListener('click', () => void run(async () => {
  if (focusSession) {
    await stopFocus();
    say('Focus ended. Your websites are available again.');
    return;
  }
  // A Chrome permission dialog can close a toolbar popup. First-time setup
  // belongs in the persistent dashboard so the user's Start action can finish.
  if (!settings?.distractionSites.length || !focusAccess) {
    await chrome.tabs.create({ url: chrome.runtime.getURL('index.html#focus') });
    window.close();
    return;
  }
  await startFocus({ minutes: settings.focusMinutes, sites: settings.distractionSites, trailId: activeTrail?.id || null });
  say('Focus started. Your selected websites are blocked.');
}));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (['daytrailTrails', 'daytrailActiveTrailId'].some(key => key in changes)) void refreshTrails().catch(error => say(error.message));
  if (['daytrailFocusState', 'daytrailSettings'].some(key => key in changes)) void refreshFocus().catch(error => say(error.message));
});
setInterval(renderFocus, 1000);
void capturePage();
void refreshTrails().catch(error => say(`Trails could not load: ${error.message}. Reopen Daytrail to retry.`));
void refreshFocus().catch(() => { byId('popup-focus-label').textContent = 'Open the dashboard to set up Focus.'; });

function render(summary, label) {
  const peaks = peakLabels(summary);
  byId('popup-source').textContent = label;
  byId('popup-visits').textContent = summary ? numbers.format(summary.visits) : '–';
  byId('popup-searches').textContent = summary ? numbers.format(summary.searches) : '–';
  byId('popup-hour').textContent = peaks.hour;
  byId('popup-weekday').textContent = peaks.weekday;
  graph.set(summary?.timeline ?? []);
}
try {
  const account = await currentAccount();
  if (account?.trackingSince && await chrome.permissions.contains(historyAccess)) {
    const summary = await readHistory(chrome.history, 7, { hiddenSites: await hiddenSites() });
    const verified = await currentAccount();
    const connected = verified?.subject === account.subject && await chrome.permissions.contains(historyAccess);
    render(connected ? summary : sampleHistory(7), connected ? 'Chrome history' : 'Sample data');
  } else render(sampleHistory(7), 'Sample data');
} catch { render(null, 'History unavailable'); }
