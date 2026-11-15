// Browser history belongs to the current Chrome profile. Local access needs no account.
export const historyAccess = { permissions: ['history'] };
export const connectionKey = 'daytrailHistoryAccess';

export async function currentAccount() {
  if (!await chrome.permissions.contains(historyAccess)) return null;
  const stored = await chrome.storage.local.get([connectionKey, 'connectedAccount']);
  let approvedAt = stored[connectionKey]?.approvedAt;
  if (!Number.isFinite(approvedAt)) {
    approvedAt = Number.isFinite(stored.connectedAccount?.trackingSince)
      ? stored.connectedAccount.trackingSince : Date.now();
    await chrome.storage.local.set({ [connectionKey]: { approvedAt } });
  }
  if (stored.connectedAccount) await chrome.storage.local.remove('connectedAccount');
  if (!await chrome.permissions.contains(historyAccess)) return null;
  // Keep this internal shape compatible with the original website-management module.
  return { subject: 'local-profile', profileId: 'local-profile', name: 'This device', email: '', trackingSince: approvedAt };
}

export async function connectHistory() {
  const granted = await chrome.permissions.request(historyAccess);
  if (!granted) return false;
  await currentAccount();
  return true;
}

export async function disconnectDaytrail() {
  const { stopFocus } = await import('./focus-client.js');
  const { updateSettings } = await import('./settings.js');
  await stopFocus();
  await updateSettings({ remindersEnabled: false });
  const reply = await chrome.runtime.sendMessage({ timeAction: 'pause' });
  if (!reply?.ok) throw new Error('Tracking could not be paused. Try again before disconnecting.');
  const access = await chrome.permissions.getAll();
  const optional = new Set(['history', 'tabs', 'idle', 'alarms', 'scripting', 'declarativeNetRequestWithHostAccess']);
  const permissions = access.permissions.filter(name => optional.has(name));
  const origins = access.origins ?? [];
  if (permissions.length || origins.length) {
    const removed = await chrome.permissions.remove({ permissions, origins });
    if (!removed) throw new Error('Collection is paused, but Chrome could not remove every permission. Try disconnecting again.');
  }
  await chrome.storage.local.remove([connectionKey, 'connectedAccount', 'websiteCategoryApiKey']);
}
