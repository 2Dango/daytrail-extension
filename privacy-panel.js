import { connectHistory, currentAccount, disconnectDaytrail } from './auth.js';
import { readSettings, updateSettings, normalizeDomain } from './settings.js';
import { readTime, timeCommand, timePermissions, formatDuration } from './time-data.js';

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function initPrivacyPanel() {
  const root = document.getElementById('privacy-panel');
  if (!root || root.dataset.initialized) return;
  root.dataset.initialized = 'true';
  const heading = make('div', 'overview');
  heading.append(make('h1', '', 'Your history, your rules'));
  const intro = make('p', 'field-help', 'Daytrail works on this device. No account, subscription, or AI service is connected.');
  const status = make('p', 'notice');
  status.hidden = true;
  status.setAttribute('role', 'status');

  function card(title, description) {
    const section = make('section', 'card recent');
    const header = make('header', 'card-header');
    header.append(make('h2', '', title));
    const body = make('div', 'time-body history-controls');
    body.append(make('p', 'field-help', description));
    section.append(header, body);
    root.append(section);
    return body;
  }
  function button(text, action, dangerous = false) {
    const node = make('button', 'button ' + (dangerous ? 'button-danger' : 'button-outline'), text);
    node.type = 'button';
    node.addEventListener('click', () => {
      if (node.disabled) return;
      node.disabled = true;
      status.hidden = true;
      // Call synchronously so optional permission prompts retain the click gesture.
      let result;
      try { result = action(); } catch (error) { result = Promise.reject(error); }
      Promise.resolve(result).catch(error => say(error.message || 'That action could not be completed.'))
        .finally(() => { node.disabled = false; void refresh(); });
    });
    return node;
  }
  function say(message) { status.textContent = message; status.hidden = !message; }
  root.append(heading, intro, status);

  const accessBody = card('History access', 'Chrome controls access to this profile’s history. Google My Activity and Incognito are not included.');
  const accessStatus = make('p');
  const grant = button('Allow history access', async () => {
    if (await connectHistory()) say('History access is enabled for this Chrome profile.');
    else say('History access was declined. Sample history remains available.');
  });
  accessBody.append(accessStatus, grant);

  const timeBody = card('Active-time collection', 'Measures the active site while Chrome is focused and your device is active. It does not measure attention or productivity.');
  const timeStatus = make('p');
  let trackingEnabled = false;
  const tracking = button('Enable time tracking', async () => {
    if (trackingEnabled) {
      await updateSettings({ remindersEnabled: false });
      await timeCommand('pause');
      say('Time collection and reminders are paused.');
    } else {
      if (!await chrome.permissions.request(timePermissions)) {
        say('Time tracking permission was declined.');
        return;
      }
      await timeCommand('enable');
      say('Active-time collection is enabled.');
    }
  });
  timeBody.append(timeStatus, tracking);

  const retentionBody = card('Keep less, keep control', 'Automatically removes old active-time records. Saved Trails and their notes are deliberate saves and remain until you delete them. Browser history has its own Chrome retention.');
  const retentionLabel = make('label', '', 'Keep recorded active time for');
  retentionLabel.htmlFor = 'privacy-retention';
  const retention = make('select');
  retention.id = 'privacy-retention';
  for (const days of [7, 30, 90]) {
    const option = make('option', '', days + ' days');
    option.value = String(days);
    retention.append(option);
  }
  retention.addEventListener('change', () => {
    void updateSettings({ retentionDays: Number(retention.value) })
      .then(() => say('Retention updated. Older recorded time will be removed.'))
      .catch(error => say(error.message));
  });
  retentionBody.append(retentionLabel, retention);

  const exclusionBody = card('Excluded websites', 'A leading www. is grouped with the bare domain. Excluded domains and their subdomains are omitted from Daytrail’s history views, time collection, and reminders. Existing recorded time for them is removed. This does not delete Chrome history or explicitly saved Trail links.');
  const exclusionForm = make('form', 'history-controls');
  const exclusionLabel = make('label', '', 'Website to exclude');
  exclusionLabel.htmlFor = 'privacy-exclude-domain';
  const exclusionInput = make('input');
  exclusionInput.id = 'privacy-exclude-domain';
  exclusionInput.placeholder = 'example.com';
  exclusionInput.autocomplete = 'off';
  exclusionInput.maxLength = 300;
  exclusionInput.required = true;
  const exclude = make('button', 'button button-outline', 'Exclude website');
  exclude.type = 'submit';
  const excludedList = make('ul', 'insight-list');
  exclusionForm.append(exclusionLabel, exclusionInput, exclude);
  exclusionForm.addEventListener('submit', event => {
    event.preventDefault();
    void (async () => {
      exclude.disabled = true;
      const domain = normalizeDomain(exclusionInput.value);
      const settings = await readSettings();
      await updateSettings({ excludedSites: [...new Set([...settings.excludedSites, domain])] });
      exclusionInput.value = '';
      say(domain + ' is excluded from collection and history views.');
    })().catch(error => say(error.message)).finally(() => { exclude.disabled = false; void refresh(); });
  });
  exclusionBody.append(exclusionForm, excludedList);

  const controlsBody = card('Pause or erase', 'Hiding a website only changes reports. Disconnect pauses collection, ends focus, and removes optional permissions. Erasing Daytrail data also removes saved Trails, notes, time records, and preferences; it does not delete Chrome history.');
  const actions = make('div', 'history-actions');
  actions.append(button('Disconnect and pause Daytrail', async () => {
    await disconnectDaytrail();
    say('Daytrail is disconnected. Collection, reminders and blocking are stopped. Saved data is still here.');
  }));
  const confirm = make('dialog');
  confirm.setAttribute('aria-labelledby', 'privacy-erase-title');
  const confirmHeader = make('header', 'dialog-header');
  const confirmTitle = make('h2', '', 'Erase all Daytrail data?');
  confirmTitle.id = 'privacy-erase-title';
  confirmHeader.append(confirmTitle);
  const confirmCopy = make('p', 'field-help', 'This permanently deletes every saved Trail, page note, checkpoint, recorded time interval, and preference on this device. Chrome history will remain. Export any Trails you want to keep first.');
  const confirmActions = make('div', 'history-actions');
  confirmActions.append(button('Cancel', () => confirm.close()), button('Erase all Daytrail data', async () => {
    await disconnectDaytrail();
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    confirm.close();
    say('Daytrail data was erased. Chrome history was not changed.');
  }, true));
  confirm.append(confirmHeader, confirmCopy, confirmActions);
  root.append(confirm);
  actions.append(button('Erase Daytrail data…', () => confirm.showModal(), true));
  controlsBody.append(actions);

  const storedBody = card('What stays on this device', 'Saved locally: Trails with selected page URLs/titles and notes, active-time intervals and settings, focus state and reminder choices, useful/dismissed discovery resource IDs, category overrides, hidden/excluded sites, and the date history access was approved. Search results and discovery matching from page titles stay temporarily in memory.');
  storedBody.append(make('p', 'field-help', 'No page bodies, screenshots, passwords, or form inputs are captured. No history is sent to a server. Trail export only contains the Trail you select.'));

  let version = 0;
  async function refresh() {
    const requested = ++version;
    try {
      const [account, time, settings] = await Promise.all([currentAccount(), readTime(), readSettings()]);
      if (requested !== version) return;
      accessStatus.textContent = account ? 'History access is enabled.' : 'History access is off. History screens show labeled sample data.';
      grant.hidden = Boolean(account);
      trackingEnabled = time.enabled;
      const total = time.sessions.reduce((sum, [, start, end]) => sum + Math.max(0, end - start), 0);
      timeStatus.textContent = (time.enabled ? 'Collecting active time' : 'Collection paused') + ' · ' + formatDuration(total) + ' recorded';
      tracking.textContent = time.enabled ? 'Pause time collection' : 'Enable time tracking';
      if (document.activeElement !== retention) retention.value = String(settings.retentionDays);
      excludedList.replaceChildren(...settings.excludedSites.map(domain => {
        const row = make('li');
        row.append(make('span', '', domain), button('Remove exclusion', async () => {
          const latest = await readSettings();
          await updateSettings({ excludedSites: latest.excludedSites.filter(item => item !== domain) });
          say(domain + ' is no longer excluded.');
        }));
        return row;
      }));
      if (!settings.excludedSites.length) excludedList.append(make('li', 'field-help', 'No excluded websites.'));
    } catch (error) { if (requested === version) say(error.message || 'Privacy settings could not be loaded.'); }
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ['daytrailSettings', 'activeTime', 'daytrailHistoryAccess'].some(key => key in changes)) void refresh();
  });
  chrome.permissions.onAdded.addListener(() => void refresh());
  chrome.permissions.onRemoved.addListener(() => void refresh());
  void refresh();
}
