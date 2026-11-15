import { overridesKey, readOverrides } from './categories.js';
import { formatDuration, readTime, timeBySite, timeCommand, timeKey, timePermissions } from './time-data.js';
import { hiddenSites } from './history-tools.js';

export function initTimePanel(getRange, onSummary) {
  const button = document.getElementById('toggle-tracking');
  const status = document.getElementById('tracking-status');
  const list = document.getElementById('time-chart');
  const empty = document.getElementById('time-empty');
  let enabled = false;
  let busy = false;
  let renderId = 0;

  async function render() {
    const request = ++renderId;
    const [state, hidden, overrides] = await Promise.all([readTime(), hiddenSites(), readOverrides()]);
    if (request !== renderId) return;
    enabled = state.enabled;
    button.textContent = enabled ? 'Pause time tracking' : state.since ? 'Resume time tracking' : 'Enable time tracking';
    document.getElementById('time-since').textContent = state.since
      ? 'Tracking since ' + new Date(state.since).toLocaleDateString() + (enabled ? '' : ' · Paused')
      : 'Time tracking is off';
    const { start, end } = getRange();
    const totals = [...timeBySite(state.sessions, start, end, hidden)].sort((a, b) => b[1] - a[1]);
    document.getElementById('time-total').textContent = formatDuration(totals.reduce((sum, [, ms]) => sum + ms, 0));
    list.replaceChildren(...totals.slice(0, 8).map(([site, ms]) => {
      const row = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = site;
      const duration = document.createElement('strong');
      duration.textContent = formatDuration(ms);
      const bar = document.createElement('progress');
      bar.max = totals[0][1];
      bar.value = ms;
      bar.setAttribute('aria-label', site + ' · ' + duration.textContent);
      row.append(label, duration, bar);
      return row;
    }));
    empty.hidden = totals.length > 0;
    onSummary(new Map(totals), hidden, overrides);
  }

  function refresh() {
    void render().catch(() => { status.textContent = 'Daytrail couldn’t load recorded time.'; });
  }

  button.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    status.textContent = '';
    try {
      if (!enabled && !await chrome.permissions.request(timePermissions)) {
        status.textContent = 'Time tracking permission was declined.';
        return;
      }
      await timeCommand(enabled ? 'pause' : 'enable');
      await render();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
      button.disabled = false;
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes[timeKey] || changes.hiddenSites || changes[overridesKey])) refresh();
  });
  return refresh;
}
