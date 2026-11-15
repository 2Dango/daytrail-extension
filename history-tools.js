import { describeUrl, readHistory } from './analytics.js';
import { currentAccount, historyAccess } from './auth.js';
import { initCategoryPicker } from './categories.js';
import { formatDuration, readTime, timeBySite, timeCommand } from './time-data.js';

const storageKey = 'hiddenSites';

export async function hiddenSites() {
  const stored = await chrome.storage.local.get(storageKey);
  return new Set(stored[storageKey] ?? []);
}

export function peakLabels(summary) {
  if (!summary?.visits) return { hour: '–', weekday: '–' };
  const busiest = (counts) => counts.reduce((best, count, index) => count > counts[best] ? index : best, 0);
  const hour = busiest(summary.hours);
  const weekday = busiest(summary.weekdays);
  const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  return {
    hour: clock.formatRange(new Date(2024, 0, 7, hour), new Date(2024, 0, 7, hour + 1)),
    weekday: new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(new Date(2024, 0, 7 + weekday)),
  };
}

async function historyOwner() {
  const account = await currentAccount();
  if (account?.trackingSince && await chrome.permissions.contains(historyAccess)) return account.subject;
  return null;
}

let defaultFavicon;

function loadFavicon(pageUrl) {
  const icon = document.createElement('img');
  icon.alt = '';
  icon.width = 24;
  icon.height = 24;
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', '32');
  return new Promise((resolve, reject) => {
    icon.addEventListener('load', () => resolve(icon), { once: true });
    icon.addEventListener('error', reject, { once: true });
    icon.src = url.href;
  });
}

function faviconPixels(icon) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  canvas.getContext('2d').drawImage(icon, 0, 0, 32, 32);
  return canvas.toDataURL();
}

export function placeFavicon(container, site, pageUrl) {
  container.textContent = site[0].toUpperCase();
  if (!pageUrl) return;
  const fallback = container.firstChild;
  // Chrome may return its generic globe as a successful image response.
  defaultFavicon ??= loadFavicon('https://daytrail-favicon-fallback.invalid/').then(faviconPixels);
  void Promise.all([loadFavicon(pageUrl), defaultFavicon]).then(([icon, generic]) => {
    if (container.firstChild === fallback && faviconPixels(icon) !== generic) container.replaceChildren(icon);
  }).catch(() => {});
}

async function historyBySite() {
  const entries = await chrome.history.search({ text: '', startTime: 0, maxResults: 0 });
  const sites = new Map();
  for (const { url } of entries) {
    const page = describeUrl(url);
    if (!page) continue;
    if (!sites.has(page.site)) sites.set(page.site, new Set());
    sites.get(page.site).add(url);
  }
  return sites;
}

export function initHistoryManager(refresh, displayRange) {
  const byId = (id) => document.getElementById(id);
  const dialog = byId('history-dialog');
  const showCategory = initCategoryPicker();
  const search = byId('history-search');
  const panel = byId('history-results-panel');
  const list = byId('history-results-list');
  const results = byId('history-results');
  const hide = byId('hide-site');
  const remove = byId('delete-site');
  const review = byId('delete-review');
  const status = byId('history-status');
  const confirm = byId('confirm-delete');
  let index;
  let request = 0;
  let selected;
  let pending;
  let busy = false;

  async function loadIndex() {
    const owner = await historyOwner();
    const [sites, hidden, time] = await Promise.all([
      owner ? historyBySite() : new Map(), hiddenSites(), readTime(),
    ]);
    const verified = await historyOwner();
    if (owner !== verified) throw new Error('Your history access changed. Search again.');
    const names = [...new Set([...sites.keys(), ...hidden, ...time.sessions.map(([site]) => site)])];
    names.sort((a, b) => a.localeCompare(b));
    return { owner, sites, hidden, names };
  }

  function renderResults(data) {
    const query = search.value.trim().toLowerCase();
    const matches = data.names.filter((site) => site.includes(query));
    list.replaceChildren(...matches.slice(0, 80).map((site) => {
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = data.hidden.has(site) ? site + ' · Hidden' : site;
      button.addEventListener('click', () => {
        void openSite(site, data).catch(showError);
      });
      row.append(button);
      return row;
    }));
    results.textContent = matches.length
      ? (matches.length > 80 ? 'Showing 80 of ' : '') + matches.length + (matches.length === 1 ? ' website' : ' websites')
      : data.names.length ? 'No websites match your search.' : 'Connect Chrome history or record active time to find websites here.';
  }

  async function showResults() {
    const latest = ++request;
    panel.hidden = false;
    if (!index) {
      list.replaceChildren();
      results.textContent = 'Loading websites…';
    }
    const loading = index ??= loadIndex();
    try {
      const data = await loading;
      if (latest === request && !panel.hidden) renderResults(data);
    } catch (error) {
      if (index === loading) index = undefined;
      if (latest === request && !panel.hidden) results.textContent = error.message;
    }
  }

  function closeResults() {
    panel.hidden = true;
    request += 1;
  }

  function showError(error) {
    status.textContent = error.message || 'Daytrail couldn’t update this website.';
  }

  async function openSite(site, data) {
    selected = { site, owner: data.owner, urls: data.sites.get(site), hidden: data.hidden.has(site) };
    pending = undefined;
    closeResults();
    byId('detail-site').textContent = site;
    void showCategory(site);
    placeFavicon(byId('detail-icon'), site, selected.urls?.values().next().value);
    status.textContent = '';
    review.hidden = true;
    hide.disabled = busy;
    hide.textContent = selected.hidden ? 'Show in Daytrail' : 'Hide from Daytrail';
    remove.disabled = busy || !selected.urls?.size;
    const { days, start, end, label } = displayRange();
    byId('detail-range').textContent = label;
    byId('detail-visits').textContent = selected.owner ? '…' : 'History unavailable';
    byId('detail-time').textContent = '…';
    if (!dialog.open) dialog.showModal();
    const context = selected;
    const [time, history] = await Promise.all([
      readTime(),
      selected.owner && selected.urls ? readHistory(chrome.history, days, { now: end, urls: selected.urls }) : null,
    ]);
    if (!dialog.open || selected !== context) return;
    const verified = await historyOwner();
    if (!dialog.open || selected !== context) return;
    if (selected.owner === verified && selected.owner) {
      byId('detail-visits').textContent = (history?.visits ?? 0).toLocaleString();
    } else {
      byId('detail-visits').textContent = 'History unavailable';
      selected.urls = undefined;
      remove.disabled = true;
    }
    byId('detail-time').textContent = formatDuration(timeBySite(time.sessions, start, end).get(site));
  }

  async function run(operation) {
    if (busy || !selected) return;
    busy = true;
    hide.disabled = remove.disabled = confirm.disabled = true;
    status.textContent = '';
    try {
      await operation();
    } catch (error) {
      showError(error);
    } finally {
      busy = false;
      hide.disabled = confirm.disabled = false;
      remove.disabled = !selected?.urls?.size;
    }
  }

  search.addEventListener('focus', () => {
    if (panel.hidden) index = undefined;
    void showResults();
  });
  search.addEventListener('input', () => { void showResults(); });
  byId('website-search').addEventListener('focusout', (event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) closeResults();
  });
  byId('website-search').addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      search.focus();
      closeResults();
      event.preventDefault();
      return;
    }
    if (panel.hidden || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
    const buttons = [...list.querySelectorAll('button')];
    if (!buttons.length || (event.key === 'Enter' && event.target !== search)) return;
    event.preventDefault();
    if (event.key === 'Enter') buttons[0].click();
    else {
      const current = buttons.indexOf(event.target);
      const next = event.key === 'ArrowDown' ? current + 1 : current - 1;
      (buttons[next] ?? search).focus();
    }
  });
  dialog.addEventListener('close', () => {
    void showCategory(null);
    pending = undefined;
    index = undefined;
    search.focus();
    closeResults();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || (!changes.connectedAccount && !changes.hiddenSites)) return;
    index = undefined;
    if (changes.connectedAccount) {
      if (dialog.open) dialog.close();
      list.replaceChildren();
      closeResults();
    } else if (!panel.hidden) void showResults();
  });
  chrome.identity.onSignInChanged.addListener(() => {
    index = undefined;
    list.replaceChildren();
    closeResults();
    if (dialog.open) dialog.close();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') index = undefined;
  });
  chrome.permissions.onRemoved.addListener(({ permissions }) => {
    if (!permissions?.includes('history')) return;
    index = undefined;
    list.replaceChildren();
    closeResults();
    if (dialog.open) dialog.close();
  });

  hide.addEventListener('click', () => run(async () => {
    const { site, hidden } = selected;
    pending = undefined;
    review.hidden = true;
    await navigator.locks.request(storageKey, async () => {
      const stored = await hiddenSites();
      if (hidden) stored.delete(site);
      else stored.add(site);
      await chrome.storage.local.set({ [storageKey]: [...stored] });
    });
    selected.hidden = !hidden;
    hide.textContent = hidden ? 'Hide from Daytrail' : 'Show in Daytrail';
    status.textContent = hidden ? site + ' is visible in Daytrail.' : site + ' is hidden from Daytrail.';
  }));

  remove.addEventListener('click', () => run(async () => {
    const { site, owner } = selected;
    if (!owner || owner !== await historyOwner()) throw new Error('Connect Chrome history to delete visits.');
    const urls = (await historyBySite()).get(site);
    if (!urls?.size) throw new Error('Chrome has no saved pages for this website.');
    pending = { site, urls, owner };
    byId('delete-description').textContent =
      'Permanently delete every saved visit to ' + urls.size + (urls.size === 1 ? ' page address' : ' page addresses') +
      ' on ' + site + ' across all dates? Daytrail groups www with the bare hostname and lists other subdomains separately.';
    byId('erase-time').checked = false;
    review.hidden = false;
    byId('cancel-delete').focus();
  }));
  byId('cancel-delete').addEventListener('click', () => {
    pending = undefined;
    review.hidden = true;
    remove.focus();
  });
  confirm.addEventListener('click', () => run(async () => {
    if (!pending || !dialog.open) return;
    const { site, owner, urls } = pending;
    const erase = byId('erase-time').checked;
    pending = undefined;
    review.hidden = true;
    let deleted = 0;
    let failure;
    try {
      await navigator.locks.request('deleteSiteHistory', async () => {
        if (!dialog.open || await historyOwner() !== owner) throw new Error('Reopen website details to confirm deletion.');
        const latest = (await historyBySite()).get(site) ?? new Set();
        if ([...latest].some((url) => !urls.has(url))) throw new Error('More pages were added. Review the site again before deleting.');
        for (const url of latest) {
          if (await historyOwner() !== owner) throw new Error('Your history access changed.');
          await chrome.history.deleteUrl({ url });
          deleted += 1;
        }
        if (erase) await timeCommand('erase', site);
      });
    } catch (error) {
      failure = error;
    } finally {
      index = undefined;
      void refresh();
    }
    if (dialog.open && owner === await historyOwner()) await openSite(site, await loadIndex());
    if (failure) throw new Error('Deleted ' + deleted + ' page addresses. ' + failure.message);
    status.textContent = 'Deleted Chrome history for ' + deleted + ' page addresses on ' + site + '.';
  }));
}
