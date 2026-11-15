import { readHistory } from './analytics.js';
import { currentAccount, historyAccess } from './auth.js';
import { activityChart } from './chart.js';
import { hiddenSites, peakLabels } from './history-tools.js';
import { sampleHistory } from './sample.js';

const byId = (id) => document.getElementById(id);
const graph = activityChart(byId('popup-chart'), byId('popup-tooltip'), byId('popup-announcement'));
const source = byId('popup-source');
const numbers = new Intl.NumberFormat();

function render(summary, label) {
  const peaks = peakLabels(summary);
  source.textContent = label;
  byId('popup-visits').textContent = summary ? numbers.format(summary.visits) : '–';
  byId('popup-searches').textContent = summary ? numbers.format(summary.searches) : '–';
  byId('popup-hour').textContent = peaks.hour;
  byId('popup-weekday').textContent = peaks.weekday;
  graph.set(summary?.timeline ?? []);
}

try {
  const account = await currentAccount();
  if (account?.trackingSince && await chrome.permissions.contains(historyAccess)) {
    const summary = await readHistory(chrome.history, 7, { hiddenSites: await hiddenSites() });
    const verified = await currentAccount();
    if (verified?.subject === account.subject && await chrome.permissions.contains(historyAccess)) {
      render(summary, 'Chrome history');
    } else {
      render(sampleHistory(7), 'Sample data');
    }
  } else {
    render(sampleHistory(7), 'Sample data');
  }
} catch {
  render(null, 'History unavailable');
}
