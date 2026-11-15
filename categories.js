export const overridesKey = 'categoryOverrides';

const catalog = {
  'Development': ['github.com', 'gitlab.com', 'stackoverflow.com', 'developer.mozilla.org', 'developer.chrome.com', 'npmjs.com', 'codepen.io', 'react.dev', 'vercel.com', 'replit.com', 'docs.python.org'],
  'Learning & reference': ['wikipedia.org', 'wikimedia.org', 'khanacademy.org', 'coursera.org', 'edx.org', 'duolingo.com', 'archive.org', 'torontopubliclibrary.ca'],
  'Design & creativity': ['figma.com', 'unsplash.com', 'behance.net', 'canva.com', 'dribbble.com', 'are.na'],
  'Search': ['google.com', 'google.ca', 'google.co.uk', 'bing.com', 'duckduckgo.com', 'search.yahoo.com'],
  'News': ['nytimes.com', 'bbc.com', 'cbc.ca', 'reuters.com', 'apnews.com', 'npr.org', 'tvo.org', 'theguardian.com'],
  'Social & communities': ['reddit.com', 'instagram.com', 'facebook.com', 'discord.com', 'tiktok.com', 'linkedin.com', 'x.com', 'twitter.com', 'mastodon.social'],
  'Entertainment': ['youtube.com', 'youtu.be', 'netflix.com', 'spotify.com', 'twitch.tv', 'steampowered.com', 'letterboxd.com', 'bandcamp.com', 'music.apple.com'],
  'Books': ['goodreads.com', 'openlibrary.org', 'gutenberg.org', 'storygraph.com', 'thestorygraph.com'],
  'Maps, travel & outdoors': ['alltrails.com', 'openstreetmap.org', 'booking.com', 'airbnb.com', 'maps.google.com', 'wikivoyage.org', 'weather.gc.ca'],
  'Work & communication': ['mail.google.com', 'docs.google.com', 'drive.google.com', 'calendar.google.com', 'outlook.com', 'slack.com', 'notion.so', 'notion.com', 'trello.com', 'zoom.us'],
  'Shopping': ['amazon.com', 'amazon.ca', 'ebay.com', 'etsy.com', 'walmart.com', 'walmart.ca', 'bestbuy.ca'],
  'Finance & markets': ['polymarket.com', 'kalshi.com', 'tradingview.com', 'finance.yahoo.com', 'coinbase.com', 'wealthsimple.com'],
  'Government': ['canada.ca', 'ontario.ca', 'toronto.ca', 'gc.ca', 'gov.uk'],
  'Education': [],
};
export const categories = Object.keys(catalog);
const knownSites = new Map(Object.entries(catalog).flatMap(([category, sites]) => sites.map((site) => [site, category])));

function currentCategory(category) {
  if (category === 'Developer tools') return 'Development';
  if (category === 'Video, music & games') return 'Entertainment';
  return categories.includes(category) ? category : '';
}

export function categoryFor(site, overrides = {}) {
  const custom = Object.hasOwn(overrides, site) ? currentCategory(overrides[site]) : '';
  if (custom) return custom;
  const labels = site.split('.');
  // Match the most specific known hostname first, on whole DNS labels.
  for (let index = 0; index < labels.length - 1; index += 1) {
    const category = knownSites.get(labels.slice(index).join('.'));
    if (category) return category;
  }
  if (/\.edu(?:\.[a-z]{2})?$|\.ac\.[a-z]{2}$/.test(site)) return 'Education';
  if (/\.gov(?:\.[a-z]{2})?$/.test(site)) return 'Government';
  return 'Uncategorized';
}

export async function readOverrides() {
  return (await chrome.storage.local.get(overridesKey))[overridesKey] ?? {};
}

export function initCategoryPicker() {
  const picker = document.getElementById('detail-category');
  const label = document.getElementById('category-detail-status');
  picker.append(new Option('Automatic', ''), ...categories.map((category) => new Option(category, category)));
  let site;
  let generation = 0;

  async function show(domain) {
    site = domain;
    const request = ++generation;
    picker.disabled = true;
    label.textContent = '';
    if (!site) return;

    try {
      const overrides = await readOverrides();
      if (request !== generation) return;
      picker.value = Object.hasOwn(overrides, domain) ? currentCategory(overrides[domain]) : '';
      label.textContent = 'Category · ' + categoryFor(domain, overrides);
    } catch {
      if (request === generation) label.textContent = 'Couldn’t load this website’s category.';
    } finally {
      if (request === generation) picker.disabled = false;
    }
  }

  picker.addEventListener('change', async () => {
    const domain = site;
    if (!domain) return;
    const choice = picker.value;
    picker.disabled = true;
    try {
      await navigator.locks.request(overridesKey, async () => {
        const overrides = await readOverrides();
        if (choice) Object.defineProperty(overrides, domain, { value: choice, enumerable: true, configurable: true, writable: true });
        else delete overrides[domain];
        await chrome.storage.local.set({ [overridesKey]: overrides });
      });
      if (site === domain) await show(domain);
    } catch {
      if (site === domain) {
        label.textContent = 'Couldn’t save this website’s category.';
        picker.disabled = false;
      }
    }
  });
  return show;
}
