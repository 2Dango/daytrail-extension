const keyName = 'websiteCategoryApiKey';
const endpoint = 'https://website-categorization.whoisxmlapi.com/api/v3';
const permission = { origins: ['https://website-categorization.whoisxmlapi.com/*'] };

export async function fetchCategories(site, key) {
  const url = new URL(endpoint);
  url.searchParams.set('apiKey', key);
  url.searchParams.set('url', site);
  const response = await fetch(url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(25_000),
  });
  if (response.status === 401 || response.status === 403) throw new Error('Check your WhoisXML API key or available credits.');
  if (response.status === 429) throw new Error('WhoisXML API is rate limiting lookups. Try again later.');
  if (!response.ok) throw new Error('WhoisXML API couldn’t look up this website.');
  const data = await response.json();
  if (!Array.isArray(data.categories)) throw new Error('WhoisXML API returned an unexpected response.');
  return data.categories
    .filter((item) => typeof item?.name === 'string' && item.name.trim())
    .map(({ id, name, confidence }) => ({ id, name, confidence }));
}

export function initCategories() {
  const byId = (id) => document.getElementById(id);
  const dialog = byId('category-dialog');
  const settings = byId('category-settings');
  const form = byId('category-form');
  const input = byId('category-key');
  const status = byId('category-status');
  const lookup = byId('lookup-category');
  const result = byId('detail-category');
  const remove = byId('remove-category-key');
  let site;
  let key;
  let generation = 0;

  async function showCategory(domain) {
    site = domain;
    const request = ++generation;
    lookup.disabled = true;
    result.textContent = '';
    if (!site) return;
    const cacheName = 'category:' + site;
    try {
      const data = await chrome.storage.local.get([keyName, cacheName]);
      if (request !== generation) return;
      key = data[keyName];
      const cached = data[cacheName];
      lookup.hidden = Array.isArray(cached);
      lookup.textContent = key ? 'Look up category' : 'Set up category lookup';
      result.textContent = cached?.length
        ? 'Categories · ' + cached.map(({ name }) => name).join(', ')
        : cached ? 'WhoisXML API found no category for this site.' : 'Category unavailable locally';
      lookup.disabled = false;
    } catch {
      if (request === generation) result.textContent = 'Daytrail couldn’t load the category.';
    }
  }

  function openSettings() {
    input.value = '';
    status.textContent = '';
    dialog.showModal();
  }

  settings.addEventListener('click', openSettings);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) {
      status.textContent = 'Enter your WhoisXML API key.';
      return;
    }
    try {
      await chrome.storage.local.set({ [keyName]: value });
      input.value = '';
      status.textContent = 'API key saved.';
    } catch {
      status.textContent = 'Daytrail couldn’t save the API key.';
    }
  });
  remove.addEventListener('click', async () => {
    try {
      await chrome.storage.local.remove(keyName);
      input.value = '';
      status.textContent = 'API key removed.';
    } catch {
      status.textContent = 'Daytrail couldn’t remove the API key.';
    }
  });
  dialog.addEventListener('close', () => {
    input.value = '';
    if (site) void showCategory(site);
  });

  lookup.addEventListener('click', async () => {
    if (!site) return;
    if (!key) {
      openSettings();
      return;
    }
    const domain = site;
    const request = generation;
    lookup.disabled = true;
    result.textContent = 'Looking up category…';
    try {
      if (!await chrome.permissions.request(permission)) {
        if (request === generation) result.textContent = 'Website category access was declined.';
        return;
      }
      if (request !== generation) return;
      const stored = (await chrome.storage.local.get(keyName))[keyName];
      if (request !== generation) return;
      if (!stored) throw new Error('Save your WhoisXML API key before looking up a category.');
      const categories = await fetchCategories(domain, stored);
      await chrome.storage.local.set({ ['category:' + domain]: categories });
      if (request === generation) await showCategory(domain);
    } catch (error) {
      if (request === generation) {
        result.textContent = error instanceof TypeError || error.name === 'TimeoutError'
          ? 'Daytrail couldn’t reach WhoisXML API. Try again later.'
          : error.message;
      }
    } finally {
      if (request === generation) lookup.disabled = false;
    }
  });

  return showCategory;
}
