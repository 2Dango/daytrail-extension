import { discoveryCatalog } from './discovery-catalog.js';

export const discoveryFeedbackKey = 'daytrailDiscoveryFeedback';
const knownIds = new Set(discoveryCatalog.map(item => item.id));
let pending = Promise.resolve();

export function normalizeDiscoveryFeedback(value) {
  const unique = list => [...new Set(Array.isArray(list) ? list.filter(id => typeof id === 'string' && knownIds.has(id)) : [])];
  const dismissed = unique(value?.dismissed);
  const hidden = new Set(dismissed);
  return { liked: unique(value?.liked).filter(id => !hidden.has(id)), dismissed };
}

export async function readDiscoveryFeedback() {
  const stored = await chrome.storage.local.get(discoveryFeedbackKey);
  return normalizeDiscoveryFeedback(stored?.[discoveryFeedbackKey]);
}

function withFeedbackLock(operation) {
  const locked = () => globalThis.navigator?.locks?.request
    ? navigator.locks.request(discoveryFeedbackKey, operation)
    : operation();
  const result = pending.then(locked, locked);
  pending = result.catch(() => {});
  return result;
}

export async function setDiscoveryFeedback(id, choice) {
  if (!knownIds.has(id)) throw new TypeError('Unknown discovery resource.');
  if (!['like', 'dismiss', 'clear'].includes(choice)) throw new TypeError('Unknown discovery preference.');
  return withFeedbackLock(async () => {
    const state = await readDiscoveryFeedback();
    state.liked = state.liked.filter(value => value !== id);
    state.dismissed = state.dismissed.filter(value => value !== id);
    if (choice === 'like') state.liked.push(id);
    if (choice === 'dismiss') state.dismissed.push(id);
    await chrome.storage.local.set({ [discoveryFeedbackKey]: state });
    return state;
  });
}

export async function resetDiscoveryFeedback() {
  return withFeedbackLock(async () => {
    await chrome.storage.local.remove(discoveryFeedbackKey);
    return { liked: [], dismissed: [] };
  });
}
