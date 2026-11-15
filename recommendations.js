import { initCategoryChart } from './category-chart.js';
import { buildDiscoveryFeed, discoveryCatalog, discoveryReason, discoveryTypes } from './discovery-data.js';
import { setDiscoveryFeedback, resetDiscoveryFeedback } from './discovery-state.js';
import { summarizeActivity } from './insights.js';
import { addPageToTrail } from './trails.js';

export function summarizeCategories(visits, durations, overrides) {
  return summarizeActivity(visits, durations, overrides);
}

export function selectRecommendations(activity, excluded = new Set()) {
  const result = buildDiscoveryFeed({ sites: activity.sites, categories: activity.categories, excludedDomains: [...excluded], mode: 'personalized' });
  return {
    extensions: result.items.filter((item) => item.type === 'extension'),
    related: result.items.filter((item) => item.type !== 'extension'),
    fallback: result.fallback,
  };
}

export function initRecommendations() {
  const home = {
    list: document.getElementById('home-recommendation-list'), source: document.getElementById('home-recommendation-source'),
    empty: document.getElementById('home-recommendation-empty'), more: document.getElementById('home-discovery-more'),
  };
  const expanded = {
    root: document.getElementById('insights-discovery'), list: document.getElementById('recommendation-list'),
    source: document.getElementById('recommendation-source'), empty: document.getElementById('recommendation-empty'),
    mode: document.getElementById('recommendation-filter'), search: document.getElementById('discovery-search'),
    category: document.getElementById('discovery-category-filter'), type: document.getElementById('discovery-type-filter'),
    difficulty: document.getElementById('discovery-difficulty-filter'), count: document.getElementById('discovery-count'),
    more: document.getElementById('discovery-show-all'), reset: document.getElementById('discovery-reset-feedback'),
    status: document.getElementById('discovery-status'),
  };
  const drawCategories = initCategoryChart();
  let visibleLimit = 9;
  let context = null;
  let contextVersion = 0;
  let snapshotSignature = null;
  let pendingOperation = null;
  let successReceipt = null;

  function setFiltersEnabled(enabled) {
    for (const control of [home.more, expanded.mode, expanded.search, expanded.category, expanded.type, expanded.difficulty, expanded.more, expanded.reset]) {
      if (control) control.disabled = !enabled;
    }
  }
  function say(message = '') { if (expanded.status) expanded.status.textContent = message; }
  function setCardActionsEnabled(enabled) {
    for (const control of expanded.root?.querySelectorAll('[data-discovery-action]') ?? []) control.disabled = !enabled;
  }
  setFiltersEnabled(false);

  function beginOperation(operation) {
    pendingOperation = { ...operation, settled: false };
    successReceipt = null;
    say(pendingOperation.waiting);
    return pendingOperation;
  }

  function operationProven(operation) {
    if (!context || !operation) return false;
    const liked = context.feedback.liked.includes(operation.itemId);
    const dismissed = context.feedback.dismissed.includes(operation.itemId);
    if (operation.kind === 'like') return liked && !dismissed;
    if (operation.kind === 'clear') return !liked && !dismissed;
    if (operation.kind === 'dismiss') return dismissed && !liked;
    if (operation.kind === 'reset') return !context.feedback.liked.length && !context.feedback.dismissed.length;
    if (operation.kind === 'save') return context.trail?.id === operation.trailId
      && context.trail.pages.some((page) => page.url === operation.url);
    return false;
  }

  function operationCompatible(operation) {
    if (!context || !operation) return false;
    if (operation.kind === 'save' && context.trail?.id !== operation.trailId) return false;
    return operationProven(operation);
  }

  function receiptStatus() {
    if (!context) return '';
    if (pendingOperation?.kind === 'save' && context.trail?.id !== pendingOperation.trailId) pendingOperation = null;
    if (pendingOperation && operationProven(pendingOperation)) {
      successReceipt = { ...pendingOperation };
      pendingOperation = null;
    } else if (pendingOperation?.settled) {
      pendingOperation = null;
    }
    if (successReceipt && !operationCompatible(successReceipt)) successReceipt = null;
    return successReceipt?.success ?? pendingOperation?.waiting ?? '';
  }

  function settleOperation(operation, applyPatch, resetPagination = false) {
    if (pendingOperation !== operation) return;
    operation.settled = true;
    const canApply = Boolean(context && operation.version === contextVersion);
    if (canApply) {
      context = applyPatch(context);
      if (resetPagination) visibleLimit = 9;
    }
    if (!context) return;
    const status = receiptStatus();
    setFiltersEnabled(true);
    rerender();
    if (pendingOperation) setCardActionsEnabled(false);
    if (pendingOperation?.kind === 'reset') setFiltersEnabled(false);
    say(status);
  }

  function failOperation(operation, error, fallback) {
    if (pendingOperation !== operation) return;
    pendingOperation = null;
    if (!context) return;
    setFiltersEnabled(true);
    rerender();
    say(error?.message || fallback);
  }

  function contextSignature(excludedDomains, details) {
    const trail = details?.trail;
    const trailPages = Array.isArray(trail?.pages) ? trail.pages.map((page) => [page.url, page.title]) : [];
    const recent = Array.isArray(details?.pages) ? details.pages.map((page) => [page.url, page.title]) : [];
    return JSON.stringify({
      excluded: [...excludedDomains].sort(),
      trail: trail ? [trail.id, trail.name, trail.goal, trail.checkpoint, trailPages] : null,
      recent,
      pageSource: details?.pageSource,
      liked: [...(details?.feedback?.liked ?? [])].sort(),
      dismissed: [...(details?.feedback?.dismissed ?? [])].sort(),
    });
  }

  if (expanded.category) {
    const names = [...new Set(discoveryCatalog.map((item) => item.category))].sort((a, b) => a.localeCompare(b));
    for (const name of names) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      expanded.category.append(option);
    }
  }
  if (expanded.type) {
    for (const item of discoveryTypes) {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      expanded.type.append(option);
    }
  }

  function actionButton(label, action, className = 'button button-outline') {
    const control = document.createElement('button');
    control.type = 'button';
    control.className = className;
    control.dataset.discoveryAction = action;
    control.textContent = label;
    return control;
  }

  function card(item, compact = false) {
    const row = document.createElement('li');
    row.className = compact ? 'discovery-card discovery-card-compact' : 'discovery-card';
    row.dataset.discoveryId = item.id;
    const meta = document.createElement('span');
    meta.className = 'recommendation-kind';
    meta.textContent = `${typeLabel(item.type)} · ${item.category} · ${difficultyLabel(item.difficulty)}`;
    const link = document.createElement('a');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = `${item.name} ↗`;
    const detail = document.createElement('p');
    detail.className = 'discovery-description';
    detail.textContent = item.description;
    const why = document.createElement('p');
    why.className = 'recommendation-reason';
    why.textContent = discoveryReason(item, context?.source);
    row.append(meta, link, detail, why);

    if (!compact) {
      const next = document.createElement('p');
      next.className = 'discovery-action';
      next.textContent = `Try next · ${item.nextAction}`;
      const chips = document.createElement('div');
      chips.className = 'discovery-meta';
      for (const flag of [item.saved ? 'Saved in active Trail' : '', item.visited ? 'Visited recently' : '', item.liked ? 'Marked Useful' : ''].filter(Boolean)) {
        const chip = document.createElement('span');
        chip.className = 'discovery-chip discovery-chip-state';
        chip.textContent = flag;
        chips.append(chip);
      }
      for (const tag of (item.tags ?? []).slice(0, 5)) {
        const chip = document.createElement('span');
        chip.className = 'discovery-chip';
        chip.textContent = tag;
        chips.append(chip);
      }
      const status = document.createElement('p');
      status.className = 'discovery-link-status';
      status.textContent = linkCheckText(item);
      const actions = document.createElement('div');
      actions.className = 'discovery-card-actions';
      const saved = Boolean(item.saved || context?.trail?.pages?.some((page) => page.url === item.url));
      const save = actionButton(saved ? 'Saved to Trail' : 'Save to Trail', 'save', saved ? 'button button-dark' : 'button button-outline');
      save.disabled = saved;
      save.addEventListener('click', () => saveToTrail(item, save));
      const liked = Boolean(item.liked || context?.feedback?.liked?.includes(item.id));
      const like = actionButton(liked ? 'Useful ✓' : 'Useful', 'like');
      like.setAttribute('aria-pressed', String(liked));
      like.addEventListener('click', () => updatePreference(item, liked ? 'clear' : 'like', like));
      const dismiss = actionButton('Not for me', 'dismiss');
      dismiss.addEventListener('click', () => updatePreference(item, 'dismiss', dismiss));
      actions.append(save, like, dismiss);
      row.append(next, chips, status, actions);
    }
    return row;
  }

  function sourceText(source, fallback, browseAll = false) {
    if (browseAll) return contextCopy('Browse all · fixed local library');
    if (fallback) return contextCopy(source === 'sample' ? 'Demo match is sparse · browsing the local library' : 'Few direct matches · browsing the local library');
    if (source === 'sample') return contextCopy('Demo activity · local matches only');
    if (source === 'history') return contextCopy('Matched locally to this range');
    if (source === 'time') return contextCopy('Matched locally to measured active time');
    return contextCopy('Browse Daytrail’s fixed local library');
  }

  function contextCopy(prefix) {
    if (!context) return prefix;
    const signals = [];
    if (context.trail?.name) signals.push(`Trail “${context.trail.name}”`);
    if (context.trail?.checkpoint) signals.push('its checkpoint');
    if (context.trail?.pages?.length) signals.push('saved Trail pages');
    if (context.pages.length && context.pageSource === 'history') signals.push('recent page titles');
    return signals.length ? `${prefix} · using ${signals.join(', ')}` : prefix;
  }

  function feedOptions(limit) {
    return {
      ...context,
      mode: expanded.mode?.value === 'all' ? 'all' : 'personalized',
      category: expanded.category?.value || 'all', type: expanded.type?.value || 'all',
      difficulty: expanded.difficulty?.value || 'all', search: expanded.search?.value || '', limit,
    };
  }

  function renderHome() {
    if (!home.list || !context) return;
    const feed = buildDiscoveryFeed({ ...context, mode: 'personalized', difficulty: 'all', limit: 3 });
    home.list.replaceChildren(...feed.items.map((item) => card(item, true)));
    home.source.textContent = !feed.items.length && context.excludedDomains.length
      ? 'No discoveries remain after current privacy exclusions' : sourceText(context.source, feed.fallback);
    home.empty.hidden = feed.items.length > 0;
    home.empty.textContent = 'No discoveries are available with the current exclusions and preferences.';
  }

  function renderExpanded() {
    if (!expanded.list || !context) return;
    const feed = buildDiscoveryFeed(feedOptions(visibleLimit));
    expanded.list.replaceChildren(...feed.items.map((item) => card(item)));
    const hasFilter = Boolean(expanded.search?.value.trim() || expanded.category?.value !== 'all'
      || expanded.type?.value !== 'all' || expanded.difficulty?.value !== 'all');
    expanded.source.textContent = !feed.items.length && context.excludedDomains.length && !hasFilter
      ? 'No discoveries remain after current privacy exclusions' : sourceText(context.source, feed.fallback, expanded.mode?.value === 'all');
    expanded.count.textContent = feed.total === feed.items.length
      ? `${feed.total} ${feed.total === 1 ? 'resource' : 'resources'}` : `Showing ${feed.items.length} of ${feed.total} resources`;
    const remaining = Math.max(0, feed.total - feed.items.length);
    expanded.more.hidden = remaining === 0;
    expanded.more.textContent = remaining > 9 ? 'Show 9 more' : `Show ${remaining} more`;
    expanded.empty.hidden = feed.items.length > 0;
    expanded.empty.textContent = !hasFilter && context.excludedDomains.length
      ? 'No field-guide resources remain after current privacy exclusions.'
      : 'No local-library resources match these filters and preferences. Clear a filter or reset your choices.';
    if (pendingOperation) setCardActionsEnabled(false);
  }
  function rerender() { renderHome(); renderExpanded(); }

  async function saveToTrail(item, control) {
    if (!context?.trail) {
      pendingOperation = null;
      successReceipt = null;
      say('Create or activate a Trail first. Daytrail is opening Trails so you can set one up.');
      const guidance = document.getElementById('trail-transfer-status');
      if (guidance) {
        guidance.textContent = 'Choose an existing Trail or create one, then return to Insights to save the resource.';
        guidance.hidden = false;
      }
      document.dispatchEvent(new CustomEvent('daytrail:navigate', { detail: { view: 'trails' } }));
      return;
    }
    const version = contextVersion;
    const operation = beginOperation({
      kind: 'save', version, itemId: item.id, trailId: context.trail.id, url: item.url,
      waiting: `Saving ${item.name} to ${context.trail.name}…`,
      success: `${item.name} was saved to ${context.trail.name}.`,
    });
    setCardActionsEnabled(false);
    try {
      const trail = await addPageToTrail(context.trail.id, { url: item.url, title: item.name, note: item.nextAction ? `Next step: ${item.nextAction}` : '' });
      settleOperation(operation, (current) => ({ ...current, trail }));
    } catch (error) {
      failOperation(operation, error, 'Daytrail could not save this resource to the active Trail.');
    }
  }

  async function updatePreference(item, choice, control) {
    if (!context) return;
    const version = contextVersion;
    const operation = beginOperation({
      kind: choice, version, itemId: item.id,
      waiting: choice === 'dismiss' ? `Removing ${item.name} from suggestions…` : 'Saving your local preference…',
      success: choice === 'dismiss' ? `${item.name} will not appear in suggestions.`
        : choice === 'like' ? `${item.name} is marked Useful.` : `${item.name} is no longer marked Useful.`,
    });
    setCardActionsEnabled(false);
    try {
      const feedback = await setDiscoveryFeedback(item.id, choice);
      settleOperation(operation, (current) => ({ ...current, feedback }), true);
    } catch (error) {
      failOperation(operation, error, 'Daytrail could not save this preference.');
    }
  }

  const refilter = () => { visibleLimit = 9; renderExpanded(); say(receiptStatus()); };
  for (const control of [expanded.mode, expanded.category, expanded.type, expanded.difficulty]) control?.addEventListener('change', refilter);
  expanded.search?.addEventListener('input', refilter);
  expanded.more?.addEventListener('click', () => { visibleLimit += 9; renderExpanded(); });
  expanded.reset?.addEventListener('click', async () => {
    if (!context) return;
    const version = contextVersion;
    const operation = beginOperation({
      kind: 'reset', version, waiting: 'Resetting discovery choices…',
      success: 'Useful and Not for me choices were reset.',
    });
    setFiltersEnabled(false);
    setCardActionsEnabled(false);
    try {
      const feedback = await resetDiscoveryFeedback();
      settleOperation(operation, (current) => ({ ...current, feedback }), true);
    } catch (error) {
      failOperation(operation, error, 'Daytrail could not reset discovery choices.');
    }
  });
  home.more?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('daytrail:navigate', { detail: { view: 'insights' } }));
    setTimeout(() => expanded.root?.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start',
    }), 0);
  });

  return (summary, durations, excludedDomains, overrides, details = {}) => {
    contextVersion += 1;
    const useSample = Boolean(summary?.sample && !durations.size);
    const visits = summary && (!summary.sample || useSample) ? summary.siteStats : [];
    const activity = summarizeActivity(visits, durations, overrides);
    drawCategories(activity.categories);
    if (!excludedDomains) {
      const pending = details?.pending === true;
      context = null;
      if (!pending) {
        pendingOperation = null;
        successReceipt = null;
        snapshotSignature = null;
      }
      setFiltersEnabled(false);
      home.list?.replaceChildren();
      expanded.list?.replaceChildren();
      if (home.source) home.source.textContent = pending ? 'Updating local matches…' : 'Discoveries unavailable · privacy settings could not be read';
      if (expanded.source) expanded.source.textContent = pending ? 'Reading your Trail and allowed activity…' : 'Discoveries unavailable · privacy settings could not be read';
      if (expanded.count) expanded.count.textContent = '0 resources';
      if (expanded.more) expanded.more.hidden = true;
      if (home.empty) {
        home.empty.hidden = false;
        home.empty.textContent = pending ? 'Updating discoveries from local data…' : 'Daytrail could not safely load discoveries. Reopen the dashboard and try again.';
      }
      if (expanded.empty) {
        expanded.empty.hidden = false;
        expanded.empty.textContent = pending ? 'Reading allowed activity, your active Trail and saved choices…' : 'Daytrail could not safely load discoveries. Reopen the dashboard and try again.';
      }
      say(pending ? 'Local matches will appear when the current snapshot is ready.' : 'Discovery controls are disabled because privacy settings could not be read.');
      return;
    }
    const nextSignature = contextSignature(excludedDomains, details);
    if (snapshotSignature !== null && nextSignature !== snapshotSignature) visibleLimit = 9;
    snapshotSignature = nextSignature;
    context = {
      sites: activity.sites, categories: activity.categories, excludedDomains: [...excludedDomains],
      source: useSample ? 'sample' : summary && !summary.sample ? 'history' : durations.size ? 'time' : 'empty',
      trail: details?.trail ?? null, pages: Array.isArray(details?.pages) ? details.pages : [],
      feedback: {
        liked: Array.isArray(details?.feedback?.liked) ? details.feedback.liked : [],
        dismissed: Array.isArray(details?.feedback?.dismissed) ? details.feedback.dismissed : [],
      },
      pageSource: details?.pageSource === 'history' ? 'history' : 'none',
    };
    const status = receiptStatus();
    setFiltersEnabled(true);
    rerender();
    if (pendingOperation) setCardActionsEnabled(false);
    if (pendingOperation?.kind === 'reset') setFiltersEnabled(false);
    say(status);
  };
}

function typeLabel(type) {
  const label = discoveryTypes.find((item) => item.value === type)?.label ?? 'Resource';
  return label.endsWith('s') ? label.slice(0, -1) : label;
}

function difficultyLabel(value) {
  if (!value || value === 'all') return 'Any level';
  return value[0].toUpperCase() + value.slice(1);
}

function linkCheckText(item) {
  if (item.linkStatus !== 'ok') return 'Link not recently checked · verify it before relying on it.';
  if (item.lastChecked) return `Provider link checked ${item.lastChecked} · details can still change.`;
  return 'Provider link listed as checked · check date unavailable.';
}
