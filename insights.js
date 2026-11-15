import { categoryFor } from './categories.js';
import { formatDuration } from './time-data.js';

export function summarizeActivity(visits = [], durations = new Map(), overrides = {}) {
  const sites = new Map();
  for (const row of visits) {
    if (!row?.site) continue;
    sites.set(row.site, { site: row.site, visits: Math.max(0, Number(row.count) || 0), ms: 0 });
  }
  for (const [site, value] of durations) {
    if (!site) continue;
    const record = sites.get(site) ?? { site, visits: 0, ms: 0 };
    record.ms = Math.max(0, Number(value) || 0);
    sites.set(site, record);
  }
  const totals = new Map();
  for (const record of sites.values()) {
    const category = categoryFor(record.site, overrides);
    record.category = category;
    const row = totals.get(category) ?? { category, visits: 0, ms: 0, sites: 0 };
    row.visits += record.visits;
    row.ms += record.ms;
    row.sites += 1;
    totals.set(category, row);
  }
  const categories = [...totals.values()].sort((a, b) => b.ms - a.ms || b.visits - a.visits || a.category.localeCompare(b.category));
  return { sites, categories };
}

export function computeDetailedInsights(summary, durations = new Map(), overrides = {}) {
  const hasMeasuredTime = [...durations.values()].some((value) => Number(value) > 0);
  const useSampleVisits = Boolean(summary?.sample && !hasMeasuredTime);
  const useHistoryVisits = Boolean(summary && (!summary.sample || useSampleVisits));
  const visits = useHistoryVisits ? summary.siteStats ?? [] : [];
  const activity = summarizeActivity(visits, durations, overrides);
  const sites = [...activity.sites.values()];
  const totalVisits = sites.reduce((sum, row) => sum + row.visits, 0);
  const totalMs = sites.reduce((sum, row) => sum + row.ms, 0);
  const byVisits = sites.filter((row) => row.visits > 0)
    .sort((a, b) => b.visits - a.visits || a.site.localeCompare(b.site));
  const byTime = sites.filter((row) => row.ms > 0)
    .sort((a, b) => b.ms - a.ms || a.site.localeCompare(b.site));
  const categoriesByVisits = activity.categories.filter((row) => row.visits > 0)
    .sort((a, b) => b.visits - a.visits || a.category.localeCompare(b.category));
  const categoriesByTime = activity.categories.filter((row) => row.ms > 0)
    .sort((a, b) => b.ms - a.ms || a.category.localeCompare(b.category));
  const categorizedSites = sites.filter((row) => categoryFor(row.site, overrides) !== 'Uncategorized').length;
  const categoryCoverage = sites.length ? categorizedSites / sites.length : null;
  const visitConcentration = concentration(byVisits, 'visits', totalVisits);
  const timeConcentration = concentration(byTime, 'ms', totalMs);

  const timeline = useHistoryVisits ? summary.timeline ?? [] : [];
  const busiestPeriod = timeline.reduce((best, row) => !best || row.visits > best.visits ? row : best, null);
  const busiestHour = useHistoryVisits ? maxIndex(summary.hours ?? []) : null;
  const source = useSampleVisits ? 'sample' : summary && !summary.sample ? 'history' : hasMeasuredTime ? 'time' : 'empty';
  const observations = buildObservations({
    source, totalVisits, totalMs, byVisits, byTime, categoriesByVisits, categoriesByTime,
    categoryCoverage, categorizedSites, siteCount: sites.length,
  });

  return {
    source,
    totalVisits,
    totalMs,
    sites,
    byVisits,
    byTime,
    categoriesByVisits,
    categoriesByTime,
    categoryCoverage,
    categorizedSites,
    visitConcentration,
    timeConcentration,
    busiestPeriod: busiestPeriod?.visits ? { date: busiestPeriod.date, visits: busiestPeriod.visits, hourly: Boolean(summary?.hourly) } : null,
    busiestHour: busiestHour === null || !summary?.hours?.[busiestHour] ? null : { hour: busiestHour, visits: summary.hours[busiestHour] },
    visitHours: useHistoryVisits ? Array.from({ length: 24 }, (_, hour) => Math.max(0, Number(summary?.hours?.[hour]) || 0)) : [],
    observations,
  };
}

export function computeTimeSeries({ sessions = [], start, end, trackingEnabled = false } = {}) {
  const rangeStart = Number(start);
  const rangeEnd = Number(end);
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart) {
    return { available: false, trackingEnabled: Boolean(trackingEnabled), bins: [], totalMs: 0, recordedDays: 0, averageMs: 0, busiestDay: null };
  }

  const bins = [];
  const byStart = new Map();
  for (let cursor = localDayStart(rangeStart); cursor < rangeEnd;) {
    const next = nextLocalDay(cursor);
    const bin = { date: cursor, ms: 0 };
    bins.push(bin);
    byStart.set(cursor, bin);
    cursor = next;
  }
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const from = Math.max(rangeStart, Number(session?.[1]));
    const to = Math.min(rangeEnd, Number(session?.[2]));
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
    for (let cursor = from; cursor < to;) {
      const day = localDayStart(cursor);
      const boundary = Math.min(to, nextLocalDay(day));
      const bin = byStart.get(day);
      if (bin) bin.ms += boundary - cursor;
      cursor = boundary;
    }
  }
  const totalMs = bins.reduce((sum, bin) => sum + bin.ms, 0);
  const recorded = bins.filter((bin) => bin.ms > 0);
  const busiestDay = recorded.reduce((best, bin) => !best || bin.ms > best.ms ? bin : best, null);
  return {
    available: true,
    trackingEnabled: Boolean(trackingEnabled),
    bins,
    totalMs,
    recordedDays: recorded.length,
    averageMs: recorded.length ? totalMs / recorded.length : 0,
    busiestDay: busiestDay ? { ...busiestDay } : null,
  };
}

function localDayStart(value) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function nextLocalDay(dayStart) {
  const date = new Date(dayStart);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
}

function concentration(rows, metric, total) {
  if (!total) return null;
  const value = rows.slice(0, 3).reduce((sum, row) => sum + row[metric], 0);
  return { value, share: value / total, count: Math.min(3, rows.length) };
}

function maxIndex(values) {
  if (!values.length || !values.some((value) => value > 0)) return null;
  return values.reduce((best, value, index) => value > values[best] ? index : best, 0);
}

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

function buildObservations(data) {
  const notes = [];
  if (data.source === 'sample') notes.push(data.totalVisits || data.totalMs
    ? 'These observations use labeled sample activity, not your Chrome history.'
    : 'The labeled demo range contains no activity.');
  if (data.source === 'time') notes.push('History is not connected, so these observations use measured active time only.');
  if (data.byVisits[0]) {
    notes.push(`${data.byVisits[0].site} had the most visits: ${data.byVisits[0].visits} of ${data.totalVisits} (${percent(data.byVisits[0].visits / data.totalVisits)}).`);
  }
  if (data.byTime[0]) {
    notes.push(`${data.byTime[0].site} had the most measured active time: ${formatDuration(data.byTime[0].ms)} of ${formatDuration(data.totalMs)} (${percent(data.byTime[0].ms / data.totalMs)}).`);
  }
  if (data.categoriesByVisits[0]) {
    notes.push(`${data.categoriesByVisits[0].category} led by visits with ${data.categoriesByVisits[0].visits}.`);
  }
  if (data.categoriesByTime[0]) {
    notes.push(`${data.categoriesByTime[0].category} led by measured active time with ${formatDuration(data.categoriesByTime[0].ms)}.`);
  }
  if (data.categoryCoverage !== null && data.categoryCoverage < 1) {
    notes.push(`${data.categorizedSites} of ${data.siteCount} active sites have a category. Assigning the remaining sites will make category totals more complete.`);
  }
  return notes;
}

export function initDetailedInsights() {
  const root = document.getElementById('insights-details');
  const source = document.getElementById('insights-details-source');
  const facts = document.getElementById('insights-facts');
  const observations = document.getElementById('insights-observations');
  const visitSites = document.getElementById('insights-visit-sites');
  const timeSites = document.getElementById('insights-time-sites');
  const visitCategories = document.getElementById('insights-visit-categories');
  const timeCategories = document.getElementById('insights-time-categories');
  const empty = document.getElementById('insights-details-empty');
  const totalTime = document.getElementById('insights-total-time');
  const recordedDays = document.getElementById('insights-recorded-days');
  const averageTime = document.getElementById('insights-average-time');
  const busiestTimeDay = document.getElementById('insights-busiest-time-day');
  const timeState = document.getElementById('insights-time-state');
  const dailyTimeGraph = document.getElementById('insights-daily-time-graph');
  const dailyTimeCaption = document.getElementById('insights-daily-time-caption');
  const hourlyVisitsGraph = document.getElementById('insights-hourly-visits-graph');
  const hourlyVisitsCaption = document.getElementById('insights-hourly-visits-caption');
  const visitCategoryGraph = document.getElementById('insights-visit-category-graph');
  const timeCategoryGraph = document.getElementById('insights-time-category-graph');
  if (!root || !source || !facts || !observations || !visitSites || !timeSites || !visitCategories || !timeCategories || !empty) {
    return () => {};
  }

  const numbers = new Intl.NumberFormat();
  const percentFormat = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 });
  const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const shortDayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

  function fact(label, value, detail) {
    const card = document.createElement('article');
    card.className = 'insight-fact';
    const term = document.createElement('span');
    term.textContent = label;
    const main = document.createElement('strong');
    main.textContent = value;
    const help = document.createElement('small');
    help.textContent = detail;
    card.append(term, main, help);
    return card;
  }

  function ranking(target, rows, metric, total) {
    const fragment = document.createDocumentFragment();
    for (const row of rows.slice(0, 5)) {
      const item = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = row.site ?? row.category;
      const value = document.createElement('strong');
      const amount = metric === 'ms' ? formatDuration(row.ms) : numbers.format(row.visits);
      const share = total ? percentFormat.format(row[metric] / total) : '0%';
      value.textContent = `${amount} · ${share}`;
      item.append(label, value);
      fragment.append(item);
    }
    if (!fragment.childNodes.length) {
      const item = document.createElement('li');
      item.className = 'empty-state';
      item.textContent = metric === 'ms' ? 'No measured active time in this range.' : 'No visits in this range.';
      fragment.append(item);
    }
    target.replaceChildren(fragment);
  }

  function renderColumnGraph(target, values, { valueFor, labelFor, ariaFor, emptyText }) {
    if (!target) return;
    target.style.setProperty('--column-count', String(Math.max(1, values.length)));
    const max = Math.max(0, ...values.map(valueFor));
    if (!max) {
      const message = document.createElement('li');
      message.className = 'graph-empty';
      message.textContent = emptyText;
      target.replaceChildren(message);
      return;
    }
    target.replaceChildren(...values.map((value, index) => {
      const amount = valueFor(value);
      const item = document.createElement('li');
      item.className = 'pixel-column';
      item.setAttribute('aria-label', ariaFor(value, index));
      item.title = ariaFor(value, index);
      const display = document.createElement('span');
      display.className = 'graph-value';
      display.textContent = amount ? (value.ms !== undefined ? formatDuration(amount) : numbers.format(amount)) : '0';
      const well = document.createElement('span');
      well.className = 'pixel-column-well';
      const bar = document.createElement('i');
      bar.style.setProperty('--graph-bar', `${100 * amount / max}%`);
      well.append(bar);
      const label = document.createElement('span');
      label.className = 'graph-label';
      label.textContent = labelFor(value, index);
      item.append(display, well, label);
      return item;
    }));
  }

  function renderCategoryGraph(target, rows, metric, total) {
    if (!target) return;
    const visible = rows.slice(0, 8);
    if (!visible.length) {
      const message = document.createElement('li');
      message.className = 'graph-empty';
      message.textContent = metric === 'ms' ? 'No measured active time by category.' : 'No visits by category.';
      target.replaceChildren(message);
      return;
    }
    const max = visible[0][metric];
    target.replaceChildren(...visible.map((row) => {
      const item = document.createElement('li');
      const heading = document.createElement('div');
      const label = document.createElement('span');
      label.textContent = row.category;
      const value = document.createElement('strong');
      const amount = metric === 'ms' ? formatDuration(row.ms) : numbers.format(row.visits);
      value.textContent = `${amount} · ${percentFormat.format(row[metric] / total)}`;
      heading.append(label, value);
      const track = document.createElement('span');
      track.className = 'pixel-graph-track';
      const bar = document.createElement('i');
      bar.style.setProperty('--graph-bar', `${100 * row[metric] / max}%`);
      track.append(bar);
      item.append(heading, track);
      return item;
    }));
  }

  return (summary, durations, overrides, timeContext) => {
    const data = computeDetailedInsights(summary, durations, overrides);
    const timeSeries = computeTimeSeries(timeContext);
    const hasActivity = data.totalVisits > 0 || data.totalMs > 0;
    const noVisitDetail = data.source === 'history' ? 'No visits in this range'
      : data.source === 'sample' ? 'No sample visits in this range'
        : 'History not available';
    empty.hidden = hasActivity;
    empty.textContent = data.source === 'history'
      ? 'No Chrome history visits or measured active time fall in this range.'
      : data.source === 'sample'
        ? 'The labeled demo range has no activity.'
        : 'Connect history or enable time tracking to build this report.';
    source.textContent = data.source === 'sample' ? (hasActivity ? 'DEMO · SAMPLE ACTIVITY' : 'DEMO · NO SAMPLE ACTIVITY IN RANGE')
      : data.source === 'history' ? (data.totalMs ? 'CHROME HISTORY + MEASURED ACTIVE TIME' : 'CHROME HISTORY · NO MEASURED TIME IN RANGE')
        : data.source === 'time' ? 'MEASURED ACTIVE TIME · HISTORY SAMPLE EXCLUDED'
          : 'NO ACTIVITY IN THIS RANGE';
    source.classList.toggle('is-sample', data.source === 'sample');

    const nextFacts = [];
    if (data.busiestPeriod) {
      const label = data.busiestPeriod.hourly ? timeFormat.format(data.busiestPeriod.date) : dayFormat.format(data.busiestPeriod.date);
      nextFacts.push(fact(data.busiestPeriod.hourly ? 'Busiest interval' : 'Busiest day', label, `${numbers.format(data.busiestPeriod.visits)} visits`));
    } else nextFacts.push(fact('Busiest day', '–', noVisitDetail));
    if (data.busiestHour) {
      const start = new Date(2024, 0, 7, data.busiestHour.hour);
      const end = new Date(2024, 0, 7, data.busiestHour.hour + 1);
      nextFacts.push(fact('Busiest hour', timeFormat.formatRange(start, end), `${numbers.format(data.busiestHour.visits)} visits`));
    } else nextFacts.push(fact('Busiest hour', '–', noVisitDetail));
    nextFacts.push(fact('Category coverage', data.categoryCoverage === null ? '–' : percentFormat.format(data.categoryCoverage),
      data.categoryCoverage === null ? 'No active sites' : `${data.categorizedSites} of ${data.sites.length} sites categorized`));
    const visitShare = data.visitConcentration ? percentFormat.format(data.visitConcentration.share) : '–';
    const timeShare = data.timeConcentration ? percentFormat.format(data.timeConcentration.share) : '–';
    nextFacts.push(fact('Top-3 concentration', `${visitShare} visits`, `${timeShare} of measured time`));
    facts.replaceChildren(...nextFacts);

    const exactTotal = timeSeries.available ? timeSeries.totalMs : data.totalMs;
    if (totalTime) totalTime.textContent = formatDuration(exactTotal);
    if (recordedDays) recordedDays.textContent = timeSeries.available ? numbers.format(timeSeries.recordedDays) : '–';
    if (averageTime) averageTime.textContent = timeSeries.available && timeSeries.recordedDays ? formatDuration(timeSeries.averageMs) : '–';
    if (busiestTimeDay) busiestTimeDay.textContent = timeSeries.busiestDay
      ? `${dayFormat.format(timeSeries.busiestDay.date)} · ${formatDuration(timeSeries.busiestDay.ms)}` : '–';
    if (timeState) timeState.textContent = timeSeries.available
      ? `${timeSeries.trackingEnabled ? 'Tracking is on' : 'Tracking is paused'} · ${exactTotal ? 'showing recorded intervals in this range' : 'no measured active time in this range'}.`
      : 'Daily measured-time breakdown is unavailable for this render.';

    renderColumnGraph(dailyTimeGraph, timeSeries.bins, {
      valueFor: (bin) => bin.ms,
      labelFor: (bin) => shortDayFormat.format(bin.date),
      ariaFor: (bin) => `${dayFormat.format(bin.date)}: ${formatDuration(bin.ms)} measured active time`,
      emptyText: timeSeries.available ? 'No measured active time in this range.' : 'Measured-time detail is unavailable.',
    });
    if (dailyTimeCaption) dailyTimeCaption.textContent = timeSeries.available
      ? `${timeSeries.trackingEnabled ? 'Tracking on' : 'Tracking paused'} · sessions are clipped to the selected range and split at local midnight.`
      : 'No daily measured-time context was supplied.';
    const hours = data.visitHours.map((visits, hour) => ({ hour, visits }));
    renderColumnGraph(hourlyVisitsGraph, hours, {
      valueFor: (row) => row.visits,
      labelFor: (row) => row.hour % 3 === 0 ? new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2024, 0, 7, row.hour)) : '',
      ariaFor: (row) => `${new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2024, 0, 7, row.hour))}: ${numbers.format(row.visits)} visits`,
      emptyText: data.source === 'time' ? 'Sample visits are excluded while measured time is shown.' : 'No visits by hour in this range.',
    });
    if (hourlyVisitsCaption) hourlyVisitsCaption.textContent = data.source === 'sample'
      ? 'Labeled demo visits only.' : data.source === 'history' ? 'Chrome history visits, grouped by local hour.' : 'Chrome history is unavailable; sample visits are not mixed with measured time.';
    renderCategoryGraph(visitCategoryGraph, data.categoriesByVisits, 'visits', data.totalVisits);
    renderCategoryGraph(timeCategoryGraph, data.categoriesByTime, 'ms', data.totalMs);

    ranking(visitSites, data.byVisits, 'visits', data.totalVisits);
    ranking(timeSites, data.byTime, 'ms', data.totalMs);
    ranking(visitCategories, data.categoriesByVisits, 'visits', data.totalVisits);
    ranking(timeCategories, data.categoriesByTime, 'ms', data.totalMs);
    observations.replaceChildren(...data.observations.map((message) => {
      const item = document.createElement('li');
      item.textContent = message;
      return item;
    }));
    if (!data.observations.length) {
      const item = document.createElement('li');
      item.textContent = 'Connect history or enable time tracking to see grounded observations.';
      observations.append(item);
    }
  };
}
