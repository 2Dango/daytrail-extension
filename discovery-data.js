import { discoveryCatalog } from './discovery-catalog.js';
export { discoveryCatalog } from './discovery-catalog.js';

export const discoveryTypes = Object.freeze([
  { value: 'all', label: 'All types' },
  { value: 'website', label: 'Websites' },
  { value: 'reference', label: 'References' },
  { value: 'tool', label: 'Tools' },
  { value: 'extension', label: 'Chrome add-ons' },
]);

// Deliberately small, inspectable phrase groups rather than a remote model.
const relatedPhrases = [
  ['website blocking', 'block websites', 'stop distracting websites', 'prevent distractions', 'restrict websites', 'site blocking', 'website blocker', 'declarative net request', 'declarativenetrequest', 'dnr'],
  ['browser extensions', 'chrome extensions', 'chrome extension', 'browser extension', 'browser addons', 'browser add ons', 'manifest v3', 'mv3'],
  ['website permissions', 'host permissions', 'optional permissions', 'website access', 'host access', 'activetab', 'active tab permission'],
  ['javascript', 'js', 'ecmascript'],
  ['typescript', 'ts'],
  ['python', 'py'],
  ['version control', 'git', 'source control', 'git branching'],
  ['accessibility', 'a11y', 'screen readers', 'accessible interface', 'wcag'],
  ['interface design', 'ui design', 'user interface', 'ui ux', 'ux design', 'user experience'],
  ['color palettes', 'colour palettes', 'color schemes', 'colour schemes', 'color theory', 'colour theory'],
  ['pixel art', 'pixel sprites', 'sprite art', 'sprite sheets'],
  ['data visualization', 'data visualisation', 'plotting data', 'data charts', 'visualize data', 'visualise data'],
  ['data analysis', 'data analytics', 'analyzing data', 'analysing data'],
  ['spreadsheets', 'excel', 'google sheets', 'spreadsheet formulas'],
  ['machine learning', 'ml', 'neural networks', 'deep learning'],
  ['web security', 'application security', 'xss', 'cross site scripting', 'sql injection'],
  ['privacy', 'data protection', 'private browsing', 'tracking protection'],
  ['local storage', 'localstorage', 'browser storage', 'indexeddb', 'offline data'],
  ['unit testing', 'automated tests', 'test automation', 'software testing'],
  ['debugging', 'fix bugs', 'fixing bugs', 'troubleshooting'],
  ['typography', 'typefaces', 'font pairing', 'fonts'],
  ['photography', 'taking photos', 'taking pictures', 'camera exposure'],
  ['photo editing', 'image editing', 'edit photos', 'edit pictures'],
  ['video editing', 'edit videos', 'video production'],
  ['music production', 'making music', 'audio production', 'digital audio'],
  ['project planning', 'project management', 'task management', 'kanban'],
  ['study skills', 'study techniques', 'spaced repetition', 'active recall', 'flashcards'],
  ['academic research', 'scholarly research', 'literature review', 'research papers'],
  ['creative writing', 'write fiction', 'writing fiction', 'storytelling'],
  ['trip planning', 'travel planning', 'plan a trip', 'travel itinerary'],
  ['hiking', 'walking trails', 'outdoor trails', 'trail maps'],
  ['budgeting', 'personal budget', 'budget planning', 'household budget'],
  ['job search', 'career planning', 'find a job', 'job hunting'],
  ['resume writing', 'cv writing', 'write a resume', 'write a cv'],
];
const stopWords = new Set(`a an and are as at be been being but by can could did do does doing for from had has have how i if in into is it its just like may me more most my new next no not of on one or our out over own page pages project resource resources should site sites so some step such task than that the their them then there these they thing this those through to too use used using very want was we web website websites were what when where which while who why will with work would you your about after all also any app application before between build building course create day documentation document example find get getting guide help introduction learn learning make making need only other overview read reference result search start stop take today tool trail tutorial two up way`.split(/\s+/));
for (const word of ['login', 'signin', 'sign', 'welcome', 'home', 'dashboard', 'account', 'untitled', 'index', 'www', 'com', 'org', 'http', 'https']) stopWords.add(word);

function words(text) {
  return String(text ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}
function stem(word) {
  if (word.length > 5 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.length > 4 && word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}
const phraseGroups = relatedPhrases.map((group, index) => ({
  token: `@${index}`, label: group[0], phrases: group.map(text => ` ${words(text).map(stem).join(' ')} `),
}));
const topicLabels = new Map(phraseGroups.map(group => [group.token, group.label]));
function terms(text) {
  const raw = words(String(text ?? '').slice(0, 12_000));
  const result = new Map();
  for (const word of raw) {
    if (stopWords.has(word) || word.length < 2 || /^\d+$/.test(word)) continue;
    result.set(stem(word), 1);
  }
  const phrase = ` ${raw.map(stem).join(' ')} `;
  for (const group of phraseGroups) {
    if (group.phrases.some(value => phrase.includes(value))) result.set(group.token, 3);
  }
  return result;
}
function mergeTerms(target, text, multiplier = 1) {
  for (const [term, weight] of terms(text)) target.set(term, Math.max(target.get(term) ?? 0, weight * multiplier));
  return target;
}
const documents = discoveryCatalog.map(item => {
  const index = new Map();
  mergeTerms(index, item.name, 3);
  for (const tag of item.tags ?? []) mergeTerms(index, tag, 4);
  for (const phrase of item.phrases ?? []) mergeTerms(index, phrase, 3);
  mergeTerms(index, item.description);
  mergeTerms(index, item.nextAction);
  return { item, index };
});
const frequencies = new Map();
for (const { index } of documents) for (const term of index.keys()) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
function match(index, query) {
  const hits = [];
  for (const [term, weight] of query) {
    if (!index.has(term)) continue;
    const specificity = 1 + Math.log((documents.length + 1) / ((frequencies.get(term) ?? 0) + 1));
    hits.push({ term, value: weight * index.get(term) * specificity });
  }
  hits.sort((a, b) => b.value - a.value || a.term.localeCompare(b.term));
  return { score: hits.slice(0, 8).reduce((sum, hit) => sum + hit.value, 0), terms: [...new Set(hits.slice(0, 3).map(hit => topicLabels.get(hit.term) ?? hit.term))] };
}

export function domainMatches(site, domain) {
  if (typeof site !== 'string' || typeof domain !== 'string') return false;
  const left = site.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  const right = domain.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  return Boolean(left && right && (left === right || left.endsWith(`.${right}`)));
}
function pageIdentity(raw) {
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    const site = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    return { site, url: url.href.replace(/\/$/, '') };
  } catch { return null; }
}
function filteredPages(pages, excluded) {
  return (Array.isArray(pages) ? pages : []).slice(0, 500).flatMap(page => {
    const parsed = pageIdentity(page?.url);
    if (!parsed || excluded.some(domain => domainMatches(parsed.site, domain))) return [];
    const title = typeof page.title === 'string' ? page.title.trim().slice(0, 300) : '';
    return [{ ...parsed, title: title.toLowerCase().replace(/^www\./, '') === parsed.site ? '' : title }];
  });
}

export function buildDiscoveryFeed({
  sites = new Map(), categories = [], excludedDomains = [], mode = 'personalized',
  category = 'all', type = 'all', search = '', limit = 50, difficulty = 'all',
  trail = null, pages = [], feedback = {},
} = {}) {
  const excluded = [...excludedDomains].filter(value => typeof value === 'string');
  const activity = [...sites.values()]
    .filter(row => typeof row?.site === 'string' && !excluded.some(domain => domainMatches(row.site, domain)))
    .sort((a, b) => b.ms - a.ms || b.visits - a.visits || a.site.localeCompare(b.site));
  const activeCategories = new Set(activity.map(row => row.category).filter(Boolean));
  const eligibleCategories = excluded.length ? categories.filter(row => activeCategories.has(row.category)) : categories;
  const categoryRanks = new Map(eligibleCategories.map((row, index) => [row.category, index]));
  const recent = filteredPages(pages, excluded);
  const saved = filteredPages(trail?.pages, excluded);
  const visitedUrls = new Set(recent.map(page => page.url));
  const savedUrls = new Set(saved.map(page => page.url));
  const historyTerms = new Map();
  for (const page of recent.slice(0, 60)) mergeTerms(historyTerms, page.title);
  const trailTerms = terms(`${trail?.name ?? ''} ${trail?.goal ?? ''}`);
  for (const page of saved.slice(0, 30)) mergeTerms(trailTerms, page.title, 0.5);
  const signals = [
    { kind: 'checkpoint', query: terms(trail?.checkpoint), weight: 14 },
    { kind: 'trail', query: trailTerms, weight: 9 },
    { kind: 'history', query: historyTerms, weight: 3 },
  ];
  const query = terms(search);
  const hasQuery = Boolean(String(search).trim());
  const dismissed = new Set(Array.isArray(feedback.dismissed) ? feedback.dismissed : []);
  const liked = new Set(Array.isArray(feedback.liked) ? feedback.liked : []);
  const likedTerms = new Map();
  for (const item of discoveryCatalog) {
    if (!liked.has(item.id) || dismissed.has(item.id) || excluded.some(domain => domainMatches(item.site, domain) || item.matchSites.some(site => domainMatches(site, domain)))) continue;
    for (const tag of item.tags ?? []) mergeTerms(likedTerms, tag);
  }
  const candidates = documents.flatMap(({ item, index }, catalogIndex) => {
    if (dismissed.has(item.id)) return [];
    if (excluded.some(domain => domainMatches(item.site, domain) || item.matchSites.some(site => domainMatches(site, domain)))) return [];
    if (category !== 'all' && item.category !== category) return [];
    if (type !== 'all' && item.type !== type) return [];
    if (difficulty !== 'all' && item.difficulty !== 'all' && item.difficulty !== difficulty) return [];
    const searched = match(index, query);
    if (hasQuery && !searched.score) return [];
    let score = 0;
    let best = { kind: 'catalog', value: '', score: 0, terms: [] };
    for (const signal of signals) {
      const result = match(index, signal.query);
      const value = result.score * signal.weight;
      score += value;
      if (value > best.score) best = { kind: signal.kind, value: result.terms[0], terms: result.terms, score: value };
    }
    const siteIndex = activity.findIndex(row => item.matchSites.some(domain => domainMatches(row.site, domain)));
    const categoryIndex = categoryRanks.get(item.category);
    if (siteIndex >= 0) {
      const value = Math.max(12, 24 - siteIndex);
      score += value;
      if (value > best.score) best = { kind: 'site', value: activity[siteIndex].site, score: value, terms: [] };
    } else if (categoryIndex !== undefined) {
      const value = Math.max(2, 8 - categoryIndex);
      score += value;
      if (value > best.score) best = { kind: 'category', value: item.category, score: value, terms: [] };
    }
    const preference = match(index, likedTerms);
    const preferenceScore = liked.has(item.id) ? 30 : Math.min(12, preference.score / 12);
    score += preferenceScore;
    if (preferenceScore > best.score) best = { kind: 'preference', value: preference.terms[0] ?? item.tags?.[0] ?? item.category, terms: preference.terms, score: preferenceScore };
    const personalized = score > 0;
    const identity = pageIdentity(item.url)?.url;
    const visited = visitedUrls.has(identity);
    const alreadySaved = savedUrls.has(identity);
    if (personalized || hasQuery) score += alreadySaved ? -15 : visited ? -8 : 4;
    if (hasQuery) {
      score += searched.score * 18;
      best = { kind: 'search', value: searched.terms[0], terms: searched.terms, score: searched.score };
    }
    return [{ ...item, score, evidence: best, personalized, visited, saved: alreadySaved, liked: liked.has(item.id), catalogIndex }];
  });
  let ranked = candidates;
  let fallback = false;
  if (mode === 'personalized' && !hasQuery) {
    ranked = candidates.filter(item => item.personalized);
    // Explicit filters still search the whole catalog when no personal signal
    // matches. The fallback label makes this distinction visible.
    if (!ranked.length) { ranked = candidates; fallback = true; }
  }
  ranked.sort((a, b) => b.score - a.score || a.catalogIndex - b.catalogIndex);
  const maximum = Number.isFinite(Number(limit)) ? Math.max(0, Math.min(discoveryCatalog.length, Math.floor(Number(limit)))) : 50;
  return { items: ranked.slice(0, maximum), fallback, total: ranked.length };
}

export function discoveryReason(item, source = '') {
  const topics = (item.evidence?.terms ?? []).join(', ') || item.evidence?.value || '';
  switch (item.evidence?.kind) {
    case 'checkpoint': return `Why this fits · Your next checkpoint matches ${topics}.`;
    case 'trail': return `Why this fits · Your active Trail matches ${topics}.`;
    case 'history': return `Why this fits · Recent page titles in this range match ${topics}.`;
    case 'search': return `Why this fits · Your search matches ${topics}.`;
    case 'preference': return `Why this fits · Related to resources you marked useful: ${topics}.`;
    case 'site': return `Why this fits · ${source === 'sample' ? 'The demo range' : 'Your selected range'} includes ${item.evidence.value}.`;
    case 'category': return `Why this fits · ${item.evidence.value} appears in ${source === 'sample' ? 'the demo range' : 'your selected range'}.`;
    default: return 'Why this fits · A starting point from Daytrail’s local resource library.';
  }
}
