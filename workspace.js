import { readRecentPages } from './history-data.js';
import {
  activeTrailKey, addPageToTrail, createTrail, deleteTrail, exportTrail, getActiveTrail, getTrails,
  importTrail, removePageFromTrail, resumeTrail, setActiveTrail, trailsKey, updateTrail,
} from './trails.js';
import {
  disableReminders, enableReminders, focusKey, readFocusState, startFocus, stopFocus,
} from './focus-client.js';
import { readSettings, settingsKey, updateSettings } from './settings.js';

const validViews = new Set(['home', 'history', 'trails', 'focus', 'insights', 'privacy']);
const views = new Map([...document.querySelectorAll('[data-workspace-view]')]
  .map((element) => [element.dataset.workspaceView, element]));
const analyticsShell = document.getElementById('analytics-shell');
const mobileNavigation = document.getElementById('mobile-navigation');
const mobileToggle = document.getElementById('mobile-nav-toggle');

let currentView = '';
let trails = [];
let selectedTrailId = null;
let focusTimer;
let searchGeneration = 0;
let trailRefreshGeneration = 0;
const trailDrafts = new Map();
const trailStatuses = new Map();
const savingTrails = new Set();

function make(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== '') element.textContent = text;
  return element;
}

function button(label, className = 'button button-outline') {
  const control = make('button', className, label);
  control.type = 'button';
  return control;
}

function safeMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
    : '';
}

function formatRemaining(endsAt) {
  const seconds = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function navigate(view, { updateHash = true, focusHeading = true } = {}) {
  const next = validViews.has(view) ? view : 'home';
  currentView = next;
  for (const [name, element] of views) element.hidden = name !== next;
  // The original report remains part of Home and is also the complete Insights route.
  analyticsShell.hidden = !['home', 'insights'].includes(next);
  document.body.dataset.view = next;
  for (const link of document.querySelectorAll('[data-view-link]')) {
    if (link.dataset.viewLink === next) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (updateHash && location.hash !== `#${next}`) history.replaceState(null, '', `#${next}`);
  mobileNavigation.hidden = true;
  mobileToggle.setAttribute('aria-expanded', 'false');
  document.title = `Daytrail · ${next[0].toUpperCase()}${next.slice(1)}`;
  if (focusHeading) {
    const heading = next === 'insights' ? document.getElementById('overview-title') : views.get(next)?.querySelector('h1');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  if (next === 'history') void runHistorySearch();
  if (next === 'trails') void refreshTrails();
  if (next === 'focus') void refreshFocus();
}

function requestNavigate(view) {
  document.dispatchEvent(new CustomEvent('daytrail:navigate', { detail: { view } }));
}

document.addEventListener('daytrail:navigate', (event) => {
  const view = event.detail?.view;
  if (typeof view === 'string') navigate(view);
});
window.addEventListener('hashchange', () => navigate(location.hash.slice(1), { updateHash: false }));
for (const link of document.querySelectorAll('[data-view-link]')) {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    requestNavigate(link.dataset.viewLink);
  });
}
for (const control of document.querySelectorAll('[data-go-view]')) {
  control.addEventListener('click', () => requestNavigate(control.dataset.goView));
}
mobileToggle.addEventListener('click', () => {
  const open = mobileNavigation.hidden;
  mobileNavigation.hidden = !open;
  mobileToggle.setAttribute('aria-expanded', String(open));
});

function trailById(id) {
  return trails.find((trail) => trail.id === id) ?? null;
}

function trailHeader(trail, label = 'ACTIVE TRAIL') {
  const header = make('div', 'card-header');
  const copy = make('div');
  copy.append(make('span', 'eyebrow', label), make('h2', '', trail.name));
  header.append(copy);
  return header;
}

async function renderHomeTrail() {
  const root = document.getElementById('home-trail-card');
  try {
    const active = await getActiveTrail();
    if (!active) {
      const empty = make('div', 'home-empty');
      empty.append(make('span', 'empty-pixel-icon', '⌁'), make('h2', '', 'No active Trail yet'),
        make('p', '', 'Save the pages and next step for something you want to return to.'));
      const create = button('Create your first Trail', 'button button-dark');
      create.addEventListener('click', () => requestNavigate('trails'));
      empty.append(create);
      root.replaceChildren(empty);
      return;
    }
    const content = make('div', 'active-trail-home');
    const goal = make('p', 'trail-goal', active.goal || 'No goal written yet.');
    const checkpoint = make('div', 'checkpoint');
    checkpoint.append(make('span', 'eyebrow', 'NEXT STEP'), make('p', '', active.checkpoint || 'Leave a checkpoint so future you knows where to begin.'));
    const meta = make('p', 'trail-meta', `${active.pages.length} saved ${active.pages.length === 1 ? 'page' : 'pages'} · Updated ${formatDate(active.updatedAt)}`);
    const actions = make('div', 'form-actions');
    const resume = button('Resume Trail', 'button button-dark');
    const open = button('Open Trail');
    const focus = button('Start focus');
    resume.addEventListener('click', async () => {
      resume.disabled = true;
      try {
        const result = await resumeTrail(active.id);
        const opened = typeof result === 'number' ? result : result.opened;
        meta.textContent = opened ? `Opened ${opened} saved ${opened === 1 ? 'page' : 'pages'}.` : 'This Trail has no saved pages yet.';
      } catch (error) {
        meta.textContent = safeMessage(error, 'Daytrail could not resume this Trail.');
      } finally {
        resume.disabled = false;
      }
    });
    open.addEventListener('click', () => {
      selectedTrailId = active.id;
      requestNavigate('trails');
    });
    focus.addEventListener('click', () => {
      document.getElementById('focus-trail').value = active.id;
      requestNavigate('focus');
    });
    actions.append(resume, open, focus);
    content.append(trailHeader(active), goal, checkpoint, meta, actions);
    root.replaceChildren(content);
  } catch (error) {
    const problem = make('div', 'home-empty');
    problem.append(make('h2', '', 'Your Trail could not be loaded'), make('p', '', safeMessage(error, 'Check Chrome storage and reopen Daytrail.')));
    root.replaceChildren(problem);
  }
}

function renderTrailIndex() {
  const list = document.getElementById('trail-list');
  document.getElementById('trail-count').textContent = String(trails.length);
  if (!trails.length) {
    list.replaceChildren(make('p', 'empty-state', 'No Trails saved yet.'));
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const trail of trails) {
    const control = make('button', 'trail-list-button');
    control.type = 'button';
    control.setAttribute('aria-current', String(trail.id === selectedTrailId));
    control.append(make('strong', '', trail.name), make('small', '', `${trail.pages.length} ${trail.pages.length === 1 ? 'page' : 'pages'} · ${formatDate(trail.updatedAt)}`));
    control.addEventListener('click', () => {
      selectedTrailId = trail.id;
      renderTrailIndex();
      renderTrailEditor();
    });
    fragment.append(control);
  }
  list.replaceChildren(fragment);
}

function field(labelText, value, { multiline = false, className = '', maxLength = 2000 } = {}) {
  const label = make('label', className);
  label.append(make('span', '', labelText));
  const input = make(multiline ? 'textarea' : 'input');
  input.value = value ?? '';
  input.maxLength = maxLength;
  if (multiline) input.rows = 3;
  label.append(input);
  return { label, input };
}

function renderTrailEditor() {
  const root = document.getElementById('trail-editor');
  const trail = trailById(selectedTrailId);
  if (!trail) {
    const empty = make('div', 'trail-editor-empty');
    const copy = make('div');
    copy.append(make('span', 'eyebrow', 'TRAIL LOG'), make('h2', '', trails.length ? 'Choose a Trail from the map' : 'Your trail map is empty'),
      make('p', '', trails.length ? 'Its pages, notes and checkpoint will appear here.' : 'Create a Trail to keep useful pages together.'));
    empty.append(copy);
    root.replaceChildren(empty);
    return;
  }

  const existing = root.querySelector('form');
  // Storage events also arrive when the toolbar saves a page. Keep the live
  // form (and caret) intact while this Trail is being edited or saved.
  if (existing?.dataset.trailId === trail.id && (trailDrafts.has(trail.id) || savingTrails.has(trail.id))) {
    root.querySelector('.field-status').textContent = trailStatuses.get(trail.id) || 'Unsaved changes · kept while you browse.';
    renderSavedPages(root.querySelector('.saved-pages'), root.querySelector('.saved-pages-title'), trail);
    return;
  }
  const draft = trailDrafts.get(trail.id) || trail;
  const header = trailHeader(trail, 'TRAIL LOG');
  const form = make('form', 'trail-editor-form');
  form.dataset.trailId = trail.id;
  const name = field('Trail name', draft.name, { maxLength: 120 });
  name.input.required = true;
  const goal = field('Goal', draft.goal, { multiline: true, maxLength: 500 });
  const notes = field('Notes', draft.notes, { multiline: true, maxLength: 4000 });
  const checkpoint = field('Next checkpoint', draft.checkpoint, { multiline: true, className: 'checkpoint-field', maxLength: 1000 });
  const status = make('p', 'field-status');
  status.setAttribute('role', 'status');
  status.textContent = trailStatuses.get(trail.id) || (trailDrafts.has(trail.id) ? 'Unsaved changes · kept while you browse.' : '');
  const actions = make('div', 'form-actions');
  const save = button('Save changes', 'button button-dark');
  save.type = 'submit';
  const makeActive = button('Make active');
  const resume = button('Resume saved pages');
  const exportButton = button('Export JSON');
  actions.append(save, makeActive, resume, exportButton);

  const pagesTitle = make('h3', 'saved-pages-title');
  const pages = make('ul', 'saved-pages');
  renderSavedPages(pages, pagesTitle, trail);

  const danger = make('div', 'trail-danger-zone');
  danger.append(make('p', '', 'Delete this Trail and its saved notes.'));
  const removeTrail = button('Delete Trail', 'button button-danger');
  danger.append(removeTrail);

  form.append(name.label, goal.label, notes.label, checkpoint.label, actions, status, pagesTitle, pages, danger);
  root.replaceChildren(header, form);

  const readDraft = () => ({ name: name.input.value, goal: goal.input.value, notes: notes.input.value, checkpoint: checkpoint.input.value });
  form.addEventListener('input', () => {
    trailDrafts.set(trail.id, readDraft());
    trailStatuses.delete(trail.id);
    status.textContent = 'Unsaved changes · kept while you browse.';
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (savingTrails.has(trail.id)) return;
    const submitted = readDraft();
    savingTrails.add(trail.id);
    save.disabled = true;
    trailStatuses.set(trail.id, 'Saving…');
    status.textContent = 'Saving…';
    try {
      await updateTrail(trail.id, submitted);
      // Typing may continue while Chrome storage writes. Never discard edits
      // that were made after this particular Save action.
      if (JSON.stringify(readDraft()) === JSON.stringify(submitted)) {
        trailDrafts.delete(trail.id);
        trailStatuses.set(trail.id, 'Trail saved.');
      } else trailStatuses.set(trail.id, 'Saved. Your newer edits still need saving.');
    } catch (error) {
      trailStatuses.set(trail.id, safeMessage(error, 'The Trail could not be saved.'));
    } finally {
      savingTrails.delete(trail.id);
      save.disabled = false;
      status.textContent = trailStatuses.get(trail.id);
      await refreshTrails();
    }
  });
  makeActive.addEventListener('click', async () => {
    makeActive.disabled = true;
    try {
      await setActiveTrail(trail.id);
      trailStatuses.set(trail.id, 'This is now your active Trail.');
      status.textContent = trailStatuses.get(trail.id);
      await refreshTrails();
      await renderHomeTrail();
    } catch (error) {
      status.textContent = safeMessage(error, 'The active Trail could not be changed.');
    } finally {
      makeActive.disabled = false;
    }
  });
  resume.addEventListener('click', async () => {
    resume.disabled = true;
    try {
      const result = await resumeTrail(trail.id);
      const opened = typeof result === 'number' ? result : result.opened;
      status.textContent = opened ? `Opened ${opened} saved ${opened === 1 ? 'page' : 'pages'}.` : 'Save a page before resuming this Trail.';
    } catch (error) {
      status.textContent = safeMessage(error, 'Daytrail could not open the saved pages.');
    } finally {
      resume.disabled = false;
    }
  });
  exportButton.addEventListener('click', async () => {
    exportButton.disabled = true;
    try {
      const payload = await exportTrail(trail.id);
      const file = new Blob([JSON.stringify(payload, null, 2) + '\n'], { type: 'application/json' });
      const url = URL.createObjectURL(file);
      const link = make('a');
      const safeName = trail.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'trail';
      link.href = url;
      link.download = `daytrail-${safeName}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = 'Trail exported as JSON.';
    } catch (error) {
      status.textContent = safeMessage(error, 'The Trail could not be exported.');
    } finally {
      exportButton.disabled = false;
    }
  });
  removeTrail.addEventListener('click', async () => {
    if (!window.confirm(`Delete “${trail.name}” and its saved notes? This cannot be undone.`)) return;
    removeTrail.disabled = true;
    try {
      await deleteTrail(trail.id);
      trailDrafts.delete(trail.id);
      trailStatuses.delete(trail.id);
      selectedTrailId = null;
      await refreshTrails();
    } catch (error) {
      status.textContent = safeMessage(error, 'The Trail could not be deleted.');
      removeTrail.disabled = false;
    }
  });
}

function renderSavedPages(pages, title, trail) {
  title.textContent = `Saved pages (${trail.pages.length})`;
  pages.replaceChildren();
  if (!trail.pages.length) pages.append(make('li', 'empty-state', 'No pages saved. Open a website and use the Daytrail toolbar, or add one from History.'));
  for (const page of trail.pages) {
    const row = make('li', 'saved-page');
    const copy = make('div');
    copy.append(make('strong', '', page.title || page.site || page.url), make('small', '', page.url));
    if (page.note) copy.append(make('small', '', page.note));
    const actions = make('div', 'saved-page-actions');
    const open = button('Open', '');
    const remove = button('Remove', '');
    const report = message => {
      trailStatuses.set(trail.id, message);
      if (selectedTrailId === trail.id) document.querySelector('#trail-editor .field-status').textContent = message;
    };
    open.addEventListener('click', () => void chrome.tabs.create({ url: page.url }).catch(error => report(safeMessage(error, 'The page could not be opened.'))));
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        await removePageFromTrail(trail.id, page.url);
        report('Page removed.');
        await refreshTrails();
      } catch (error) {
        report(safeMessage(error, 'The page could not be removed.'));
        remove.disabled = false;
      }
    });
    actions.append(open, remove);
    row.append(copy, actions);
    pages.append(row);
  }
}

async function refreshTrails() {
  const generation = ++trailRefreshGeneration;
  try {
    const [nextTrails, active] = await Promise.all([getTrails(), getActiveTrail()]);
    if (generation !== trailRefreshGeneration) return;
    trails = nextTrails;
    for (const id of trailDrafts.keys()) if (!trailById(id)) trailDrafts.delete(id);
    if (selectedTrailId && !trailById(selectedTrailId)) selectedTrailId = null;
    if (!selectedTrailId) selectedTrailId = active?.id ?? trails[0]?.id ?? null;
    renderTrailIndex();
    renderTrailEditor();
    renderFocusTrailChoices();
    await renderHomeTrail();
  } catch (error) {
    if (generation !== trailRefreshGeneration) return;
    document.getElementById('trail-list').replaceChildren(make('p', 'empty-state', safeMessage(error, 'Trails could not be loaded.')));
    if (!document.querySelector('#trail-editor form')) document.getElementById('trail-editor').replaceChildren(make('div', 'trail-editor-empty', 'Chrome storage is unavailable. Reopen Daytrail and try again.'));
  }
}

const newTrailForm = document.getElementById('new-trail-form');
document.getElementById('show-new-trail').addEventListener('click', () => {
  newTrailForm.hidden = false;
  document.getElementById('new-trail-name').focus();
});
document.getElementById('cancel-new-trail').addEventListener('click', () => {
  newTrailForm.reset();
  newTrailForm.hidden = true;
  document.getElementById('new-trail-status').textContent = '';
});
newTrailForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = newTrailForm.querySelector('[type="submit"]');
  const status = document.getElementById('new-trail-status');
  submit.disabled = true;
  status.textContent = 'Creating Trail…';
  try {
    const trail = await createTrail({ name: document.getElementById('new-trail-name').value, goal: document.getElementById('new-trail-goal').value });
    selectedTrailId = trail.id;
    newTrailForm.reset();
    newTrailForm.hidden = true;
    status.textContent = '';
    await refreshTrails();
  } catch (error) {
    status.textContent = safeMessage(error, 'The Trail could not be created.');
  } finally {
    submit.disabled = false;
  }
});

const importTrailButton = document.getElementById('import-trail');
const importTrailFile = document.getElementById('import-trail-file');
const transferStatus = document.getElementById('trail-transfer-status');
function sayTransfer(message) {
  transferStatus.textContent = message;
  transferStatus.hidden = !message;
}
importTrailButton.addEventListener('click', () => {
  importTrailFile.value = '';
  importTrailFile.click();
});
importTrailFile.addEventListener('change', async () => {
  const file = importTrailFile.files?.[0];
  if (!file) return;
  if (file.size > 1_000_000) {
    sayTransfer('That file is larger than 1 MB. Choose a Daytrail JSON export under 1 MB.');
    return;
  }
  importTrailButton.disabled = true;
  sayTransfer('Checking Trail file…');
  try {
    const trail = await importTrail(await file.text());
    selectedTrailId = trail.id;
    sayTransfer(`Imported “${trail.name}”. Review its pages and notes before opening links.`);
    await refreshTrails();
  } catch (error) {
    sayTransfer(safeMessage(error, 'This is not a valid Daytrail export.'));
  } finally {
    importTrailButton.disabled = false;
    importTrailFile.value = '';
  }
});

function renderHistoryResults(result) {
  const list = document.getElementById('page-search-results');
  const source = document.getElementById('page-search-source');
  source.textContent = result.source === 'sample' ? 'DEMO · SAMPLE PAGES' : 'CHROME HISTORY';
  source.classList.toggle('is-sample', result.source === 'sample');
  const fragment = document.createDocumentFragment();
  for (const page of result.items) {
    const row = make('li', 'page-result');
    const mark = make('span', 'result-mark', (page.site || '?')[0].toUpperCase());
    mark.setAttribute('aria-hidden', 'true');
    const copy = make('div', 'result-copy');
    const title = make('a', 'result-title', page.title || page.url);
    title.href = page.url;
    title.target = '_blank';
    title.rel = 'noopener noreferrer';
    const url = make('span', 'result-url', page.url);
    const meta = make('div', 'result-meta');
    meta.append(make('span', '', page.site), make('span', '', formatDate(page.lastVisitTime)),
      make('span', '', `${page.visitCount} ${page.visitCount === 1 ? 'visit' : 'visits'}`), make('span', '', page.category || 'Uncategorized'));
    copy.append(title, url, meta);
    const actions = make('div', 'result-actions');
    const open = button('Open');
    open.addEventListener('click', () => void chrome.tabs.create({ url: page.url }));
    if (trails.length) {
      const chooser = make('select', 'inline-select');
      chooser.setAttribute('aria-label', `Trail for ${page.title || page.site}`);
      for (const trail of trails) {
        const option = make('option', '', trail.name);
        option.value = trail.id;
        chooser.append(option);
      }
      const active = trails.find((trail) => trail.id === selectedTrailId);
      if (active) chooser.value = active.id;
      const save = button('Save');
      save.addEventListener('click', async () => {
        save.disabled = true;
        try {
          await addPageToTrail(chooser.value, { url: page.url, title: page.title, note: '' });
          save.textContent = 'Saved';
          await refreshTrails();
        } catch (error) {
          save.textContent = safeMessage(error, 'Could not save');
          save.disabled = false;
        }
      });
      actions.append(chooser, save);
    } else {
      const create = button('Create Trail');
      create.addEventListener('click', () => requestNavigate('trails'));
      actions.append(create);
    }
    actions.prepend(open);
    row.append(mark, copy, actions);
    fragment.append(row);
  }
  if (!result.items.length) fragment.append(make('li', 'empty-state', 'No pages match these filters. Try a broader search or date range.'));
  list.replaceChildren(fragment);
  const status = document.getElementById('page-search-status');
  const count = result.items.length;
  status.textContent = result.hasMore
    ? `Showing the newest ${count} pages. Narrow your search; Chrome queries are capped at 2,000 matches.`
    : `${count} ${count === 1 ? 'page' : 'pages'}`;
}

async function runHistorySearch() {
  const request = ++searchGeneration;
  const status = document.getElementById('page-search-status');
  status.textContent = 'Searching recent pages…';
  try {
    const result = await readRecentPages({
      text: document.getElementById('page-search').value.trim(),
      days: Number(document.getElementById('page-search-days').value),
      site: document.getElementById('page-search-site').value.trim(),
      limit: 200,
    });
    if (request !== searchGeneration) return;
    renderHistoryResults(result);
  } catch (error) {
    if (request !== searchGeneration) return;
    document.getElementById('page-search-results').replaceChildren();
    document.getElementById('page-search-source').textContent = '';
    status.textContent = safeMessage(error, 'History search could not be loaded. Check the permission and try again.');
  }
}

document.getElementById('page-search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void runHistorySearch();
});
document.getElementById('page-search-days').addEventListener('change', () => void runHistorySearch());
let searchDebounce;
for (const id of ['page-search', 'page-search-site']) {
  document.getElementById(id).addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(runHistorySearch, 280);
  });
}

function parseSites(value) {
  return [...new Set(value.split(/[\n,]+/).map((site) => site.trim()).filter(Boolean))];
}

function renderFocusTrailChoices() {
  const select = document.getElementById('focus-trail');
  const previous = select.value;
  const fragment = document.createDocumentFragment();
  const none = make('option', '', 'No Trail selected');
  none.value = '';
  fragment.append(none);
  for (const trail of trails) {
    const option = make('option', '', trail.name);
    option.value = trail.id;
    fragment.append(option);
  }
  select.replaceChildren(fragment);
  if (trails.some((trail) => trail.id === previous)) select.value = previous;
  else if (selectedTrailId && trails.some((trail) => trail.id === selectedTrailId)) select.value = selectedTrailId;
}

function renderFocusSession(state) {
  clearInterval(focusTimer);
  const root = document.getElementById('focus-session-card');
  if (!state.session) {
    const idle = make('div', 'focus-idle');
    idle.append(make('span', 'eyebrow', 'CAMP IS QUIET'), make('h2', '', 'No focus session is running'),
      make('p', '', 'Choose a length and the sites you want Daytrail to block.'));
    root.replaceChildren(idle);
    return;
  }
  const session = state.session;
  const panel = make('div', 'focus-session-state');
  panel.append(make('span', 'campfire', '♨'));
  const copy = make('div');
  const clock = make('strong', 'focus-clock', formatRemaining(session.endsAt));
  const sites = make('p', '', session.sites.length ? `Blocking ${session.sites.join(', ')}` : 'No sites are blocked.');
  const phase = make('span', 'eyebrow', 'FOCUS IN PROGRESS');
  copy.append(phase, clock, sites);
  const stop = button('End focus', 'button button-danger');
  stop.addEventListener('click', async () => {
    stop.disabled = true;
    try {
      await stopFocus();
      await refreshFocus();
    } catch (error) {
      sites.textContent = safeMessage(error, 'Daytrail could not end this session.');
      stop.disabled = false;
    }
  });
  panel.append(copy, stop);
  root.replaceChildren(panel);
  const tick = () => {
    clock.textContent = formatRemaining(session.endsAt);
    if (session.endsAt <= Date.now()) {
      clearInterval(focusTimer);
      phase.textContent = 'TIMER ENDED';
      sites.textContent = 'Finishing cleanup. You can still end focus here.';
    }
  };
  focusTimer = setInterval(tick, 1000);
  tick();
}

const dirtyFocusFields = new Set();
let focusRefreshGeneration = 0;
for (const id of ['focus-minutes', 'focus-sites', 'reminder-minutes', 'reminder-sites']) {
  document.getElementById(id).addEventListener('input', () => dirtyFocusFields.add(id));
}
async function refreshFocus() {
  const generation = ++focusRefreshGeneration;
  try {
    const [state, settings] = await Promise.all([readFocusState(), readSettings()]);
    if (generation !== focusRefreshGeneration) return;
    renderFocusSession(state);
    const values = {
      'focus-minutes': String(settings.focusMinutes),
      'focus-sites': settings.distractionSites.join('\n'),
      'reminder-minutes': String(settings.reminderMinutes),
      'reminder-sites': settings.distractionSites.join('\n'),
    };
    for (const [id, value] of Object.entries(values)) {
      if (!dirtyFocusFields.has(id)) document.getElementById(id).value = value;
    }
    if (!document.getElementById('enable-reminders').disabled) {
      document.getElementById('reminder-status').textContent = settings.remindersEnabled
        ? `Reminders are on for ${settings.distractionSites.length} ${settings.distractionSites.length === 1 ? 'site' : 'sites'}.`
        : 'Reminders are off.';
    }
  } catch (error) {
    if (generation !== focusRefreshGeneration) return;
    document.getElementById('focus-form-status').textContent = safeMessage(error, 'Focus settings could not be loaded. Try reopening Daytrail.');
  }
}

document.getElementById('focus-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = document.getElementById('start-focus');
  const status = document.getElementById('focus-form-status');
  if (submit.disabled) return;
  submit.disabled = true;
  status.textContent = 'Starting focus · approve Chrome’s website-access prompt if it appears.';
  try {
    const minutes = Number(document.getElementById('focus-minutes').value);
    const sites = parseSites(document.getElementById('focus-sites').value);
    await startFocus({
      minutes,
      sites,
      trailId: document.getElementById('focus-trail').value || null,
    });
    dirtyFocusFields.delete('focus-minutes');
    dirtyFocusFields.delete('focus-sites');
    try {
      await updateSettings({ focusMinutes: minutes, distractionSites: sites });
      status.textContent = 'Focus started. These choices are now your toolbar defaults.';
    } catch {
      status.textContent = 'Focus started, but Daytrail could not save these choices as your toolbar defaults.';
    }
    await refreshFocus();
  } catch (error) {
    status.textContent = safeMessage(error, 'Focus could not start. Check the sites and Chrome permission.');
  } finally {
    submit.disabled = false;
  }
});

document.getElementById('reminder-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = document.getElementById('enable-reminders');
  const status = document.getElementById('reminder-status');
  submit.disabled = true;
  status.textContent = 'Enabling reminders · approve Chrome’s website-access prompt if it appears.';
  try {
    await enableReminders({ sites: parseSites(document.getElementById('reminder-sites').value), minutes: Number(document.getElementById('reminder-minutes').value) });
    dirtyFocusFields.delete('reminder-minutes');
    dirtyFocusFields.delete('reminder-sites');
    status.textContent = 'Reminders are on for your selected websites.';
    await refreshFocus();
  } catch (error) {
    status.textContent = safeMessage(error, 'Reminders could not be enabled. Check the sites and Chrome permission.');
  } finally {
    submit.disabled = false;
  }
});
document.getElementById('disable-reminders').addEventListener('click', async () => {
  const control = document.getElementById('disable-reminders');
  const status = document.getElementById('reminder-status');
  control.disabled = true;
  try {
    await disableReminders();
    await refreshFocus();
  } catch (error) {
    status.textContent = safeMessage(error, 'Reminders could not be turned off.');
  } finally {
    control.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[trailsKey] || changes[activeTrailKey]) void refreshTrails();
  if (changes[focusKey] || changes[settingsKey]) void refreshFocus();
  if (currentView === 'history' && (changes[settingsKey] || changes.hiddenSites || changes.categoryOverrides)) void runHistorySearch();
});
chrome.permissions.onRemoved.addListener(() => {
  if (currentView === 'history') void runHistorySearch();
  if (currentView === 'focus') void refreshFocus();
});
let historyEventTarget;
function refreshVisibleHistory() {
  if (currentView !== 'history') return;
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(runHistorySearch, 180);
}
function registerPageHistoryEvents() {
  if (!chrome.history || chrome.history === historyEventTarget) return;
  historyEventTarget = chrome.history;
  chrome.history.onVisited.addListener(refreshVisibleHistory);
  chrome.history.onVisitRemoved.addListener(refreshVisibleHistory);
}
chrome.permissions.onAdded.addListener(({ permissions }) => {
  if (permissions?.includes('history')) {
    registerPageHistoryEvents();
    refreshVisibleHistory();
  }
});
registerPageHistoryEvents();

navigate(location.hash.slice(1) || 'home', { updateHash: true, focusHeading: false });
void refreshTrails().then(() => {
  if (currentView === 'history') void runHistorySearch();
});
void refreshFocus();

window.addEventListener('beforeunload', event => {
  if (!trailDrafts.size) return;
  event.preventDefault();
  event.returnValue = '';
});
