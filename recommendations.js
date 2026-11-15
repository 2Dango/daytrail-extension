import { categoryFor } from './categories.js';
import { initCategoryChart } from './category-chart.js';

const resources = new Map([
  ['Development', [{ site: 'developer.mozilla.org', name: 'MDN Web Docs' }, { site: 'stackoverflow.com', name: 'Stack Overflow' }]],
  ['Learning & reference', [{ site: 'khanacademy.org', name: 'Khan Academy' }, { site: 'archive.org', name: 'Internet Archive' }]],
  ['Education', [{ site: 'khanacademy.org', name: 'Khan Academy' }, { site: 'edx.org', name: 'edX' }]],
  ['Design & creativity', [{ site: 'unsplash.com', name: 'Unsplash' }, { site: 'behance.net', name: 'Behance' }]],
  ['News', [{ site: 'reuters.com', name: 'Reuters' }, { site: 'apnews.com', name: 'Associated Press' }]],
  ['Entertainment', [{ site: 'letterboxd.com', name: 'Letterboxd' }, { site: 'bandcamp.com', name: 'Bandcamp' }]],
  ['Books', [{ site: 'openlibrary.org', name: 'Open Library' }, { site: 'gutenberg.org', name: 'Project Gutenberg' }]],
  ['Maps, travel & outdoors', [{ site: 'openstreetmap.org', name: 'OpenStreetMap' }, { site: 'wikivoyage.org', name: 'Wikivoyage' }]],
]);

const addOns = [
  { name: 'Octotree', slug: 'octotree-github-code-tree/bkhaagjahfmjljalopjnoealnfndnagc', sites: ['github.com'], detail: 'Browse repository files in a code tree.' },
  { name: 'React Developer Tools', slug: 'react-developer-tools/fmkadmapgofadopljbjfkapdkoienihi', sites: ['react.dev'], detail: 'Inspect React components and profile renders.' },
  { name: 'WhatFont', slug: 'whatfont/jabopobgcpjmedljpbcaablpmlmfcogm', sites: ['figma.com', 'codepen.io', 'developer.mozilla.org'], detail: 'Identify fonts on web pages.' },
  { name: 'ColorZilla', slug: 'colorzilla/bhlhnicpbhignbdhedgjhgdocnmhomnp', sites: ['figma.com', 'codepen.io', 'behance.net'], detail: 'Sample and copy colors from web pages.' },
  { name: 'SponsorBlock', slug: 'sponsorblock-for-youtube/mnjggcdmjocbbbhaepdhchncahnbgone', sites: ['youtube.com', 'youtu.be'], detail: 'Skip community-marked sponsor segments.' },
  { name: 'Old Reddit Redirect', slug: 'old-reddit-redirect/dneaehbmnbhcippjikoajpoabadpodje', sites: ['reddit.com'], detail: 'Open Reddit in its classic layout.' },
  { name: 'Reddit Enhancement Suite', slug: 'reddit-enhancement-suite/kbmfpngjjgdllneeigpgjifpgocmfgmb', sites: ['old.reddit.com'], detail: 'Add browsing controls to Old Reddit.' },
  { name: 'FrankerFaceZ', slug: 'frankerfacez/fadndhdgpmmaapbmfcknlfgcflmmmieb', sites: ['twitch.tv'], detail: 'Customize Twitch chat, emotes, and layout.' },
  { name: 'Control Panel for Twitter', slug: 'control-panel-for-twitter/kpmjjdhbcfebfjgdnpjagcndoelnidfj', sites: ['x.com', 'twitter.com'], detail: 'Customize which feeds and interface elements you see.' },
  { name: 'LanguageTool', slug: 'ai-grammar-checker-paraph/oldceeleldhonbafppcapldpdifcinji', sites: ['linkedin.com', 'docs.google.com', 'mail.google.com', 'outlook.com'], detail: 'Check spelling and grammar as you write.' },
];

export function selectRecommendations({ sites, categories }, hidden) {
  const siteActivity = [...sites.values()].sort((a, b) => b.ms - a.ms || b.visits - a.visits);
  const matches = addOns.map((addon) => {
    const rank = siteActivity.findIndex(({ site }) => addon.sites.some((host) => site === host || site.endsWith('.' + host)));
    return { addon, rank };
  }).filter(({ rank }) => rank >= 0).sort((a, b) => a.rank - b.rank);
  const extensions = matches.map(({ addon, rank }) => ({
    name: addon.name,
    url: 'https://chromewebstore.google.com/detail/' + addon.slug,
    detail: addon.detail,
    reason: 'Because you use ' + siteActivity[rank].site,
    type: 'extension',
  }));
  const related = [];
  const seen = new Set();
  for (const { category } of categories) {
    for (const { site, name } of resources.get(category) ?? []) {
      if (sites.has(site) || hidden.has(site) || seen.has(site)) continue;
      seen.add(site);
      related.push({ name, url: 'https://' + site + '/', reason: 'Explore ' + category, type: 'site' });
    }
  }
  return { extensions, related };
}

export function summarizeCategories(visits, durations, overrides) {
  const sites = new Map(visits.map(({ site, count }) => [site, { site, visits: count, ms: 0 }]));
  for (const [site, ms] of durations) {
    const record = sites.get(site) ?? { site, visits: 0, ms: 0 };
    record.ms = ms;
    sites.set(site, record);
  }
  const totals = new Map();
  for (const record of sites.values()) {
    const category = categoryFor(record.site, overrides);
    const row = totals.get(category) ?? { category, visits: 0, ms: 0 };
    row.visits += record.visits;
    row.ms += record.ms;
    totals.set(category, row);
  }

  const ranking = (a, b) => b.ms - a.ms || b.visits - a.visits || a.category.localeCompare(b.category);
  const categories = [...totals.values()].sort(ranking);
  return { sites, categories };
}

export function initRecommendations() {
  const list = document.getElementById('recommendation-list');
  const source = document.getElementById('recommendation-source');
  const empty = document.getElementById('recommendation-empty');
  const filter = document.getElementById('recommendation-filter');
  const drawCategories = initCategoryChart();
  let picks = { extensions: [], related: [] };
  let unclassified;

  function renderCards() {
    // Mix both kinds in the default view while leaving the full lists one click away.
    const suggestions = filter.value === 'extension' ? picks.extensions
      : filter.value === 'site' ? picks.related
        : [...picks.extensions.slice(0, 4), ...picks.related.slice(0, picks.extensions.length ? 2 : 6)];
    const fragment = document.createDocumentFragment();
    for (const { name, url, detail, reason, type } of suggestions) {
      const row = document.createElement('li');
      const kind = document.createElement('span');
      kind.className = 'recommendation-kind';
      kind.textContent = type === 'extension' ? 'Chrome add-on' : 'Website';
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = name + ' ↗';
      const why = document.createElement('p');
      why.className = 'recommendation-reason';
      why.textContent = reason;
      row.append(kind, link, why);
      if (detail) {
        const description = document.createElement('p');
        description.textContent = detail;
        row.append(description);
      }
      fragment.append(row);
    }
    list.replaceChildren(fragment);
    empty.hidden = suggestions.length > 0;
    empty.textContent = filter.value === 'all' && unclassified
      ? 'Choose a category for ' + unclassified + ' in Search websites to get more suggestions.'
      : 'No matching recommendations in this date range.';
  }

  filter.addEventListener('change', renderCards);
  return (summary, durations, hidden, overrides) => {
    const useSample = summary?.sample && !durations.size;
    const visits = summary && (!summary.sample || useSample)
      ? summary.siteStats.filter(({ site }) => !hidden.has(site))
      : [];
    const data = summarizeCategories(visits, durations, overrides);
    source.textContent = useSample ? 'Based on sample activity' : 'Based on activity in your selected date range';
    unclassified = [...data.sites.keys()].find((site) => categoryFor(site, overrides) === 'Uncategorized');
    picks = selectRecommendations(data, hidden);
    renderCards();
    drawCategories(data.categories);
  };
}
