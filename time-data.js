export const timeKey = 'activeTime';
export const timePermissions = { permissions: ['tabs', 'idle', 'alarms'] };
export const hourMs = 3_600_000;

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
  const result = await chrome.runtime.sendMessage({ timeAction: action, site });
  if (!result?.ok) throw new Error('Daytrail couldn’t update time tracking.');
}
