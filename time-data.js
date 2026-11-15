export const timeKey = 'activeTime';
export const timePermissions = { permissions: ['tabs', 'idle', 'alarms'] };
export const hourMs = 3_600_000;
const commandDeadlineMs = 8_000;
const workerRetryDelayMs = 150;

class DaytrailTimeCommandError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DaytrailTimeCommandError';
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function transientWorkerFailure(error) {
  return /receiving end does not exist|message port closed|context invalidated|could not establish connection/i.test(error?.message || '');
}

function withDeadline(operation, milliseconds) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Daytrail time command timed out.')), milliseconds);
  });
  return Promise.race([Promise.resolve(operation), deadline]).finally(() => clearTimeout(timer));
}

export function appendTime(sessions, site, start, end) {
  if (end <= start) return;
  const previous = sessions.at(-1);
  if (previous?.[0] === site && previous[2] === start) previous[2] = end;
  else sessions.push([site, start, end]);
}

export function timeBySite(sessions, start, end, hidden = new Set()) {
  const totals = new Map();
  for (const [site, from, to] of sessions) {
    const duration = Math.min(to, end) - Math.max(from, start);
    if (duration > 0 && !hidden.has(site)) totals.set(site, (totals.get(site) ?? 0) + duration);
  }
  return totals;
}

export function formatDuration(ms) {
  if (!ms) return '0 min';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 1) return '<1 sec';
  if (seconds < 60) return seconds + ' sec';
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return minutes + ' min';
  return hours + ' hr' + (remainder ? ' ' + remainder + ' min' : '');
}

export async function readTime() {
  return (await chrome.storage.local.get(timeKey))[timeKey] ?? { enabled: false, since: null, sessions: [] };
}

export async function timeCommand(action, site) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await withDeadline(chrome.runtime.sendMessage({ timeAction: action, site }), commandDeadlineMs);
      if (!result?.ok) throw new DaytrailTimeCommandError('Daytrail couldn’t update time tracking.');
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 0 && transientWorkerFailure(error)) {
        await delay(workerRetryDelayMs);
        continue;
      }
      break;
    }
  }
  if (lastError instanceof DaytrailTimeCommandError) throw lastError;
  const state = await withDeadline(readTime(), 1_000).catch(() => null);
  if (state && action === 'enable' && state.enabled) return;
  if (state && action === 'pause' && !state.enabled) return;
  if (state && action === 'erase' && !state.sessions.some(([host]) => host === site)) return;
  if (/timed out/i.test(lastError?.message || '')) {
    throw new Error('Daytrail’s background worker did not finish updating time tracking. Reopen Daytrail and try again.');
  }
  if (transientWorkerFailure(lastError)) {
    throw new Error('Daytrail’s background worker restarted before updating time tracking. Reopen Daytrail and try again.');
  }
  throw lastError;
}
