const connectionKey = 'connectedAccount';
const userInfoEndpoint = 'https://openidconnect.googleapis.com/v1/userinfo';

export const historyAccess = { permissions: ['history'] };
export const oauthScopes = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

const isClientId = (value) => typeof value === 'string' && /^[a-z\d_-]+\.apps\.googleusercontent\.com$/i.test(value);
const configuredClientId = chrome.runtime.getManifest().oauth2?.client_id;
export const googleConfigured = isClientId(configuredClientId);

export function configureManifest(clientId) {
  if (!isClientId(clientId)) throw new Error('Enter the client ID ending in .apps.googleusercontent.com.');
  return { ...chrome.runtime.getManifest(), oauth2: { client_id: clientId, scopes: oauthScopes } };
}

function chromeProfile() {
  return chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' });
}

function sameEmail(left, right) {
  return typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase();
}

async function savedAccount() {
  return (await chrome.storage.local.get(connectionKey))[connectionKey];
}

export async function currentAccount() {
  if (!googleConfigured) return null;
  const account = await savedAccount();
  if (account?.clientId !== configuredClientId) return null;

  const profile = await chromeProfile();
  return profile.id === account.profileId && sameEmail(profile.email, account.email) ? account : null;
}

export async function connectGoogle() {
  const before = await chromeProfile();
  const options = { interactive: true, enableGranularPermissions: true };
  if (before.id) options.account = { id: before.id };
  const { token } = await chrome.identity.getAuthToken(options);
  if (!token) throw new Error('Google did not grant sign-in access. You can try again.');

  const response = await fetch(userInfoEndpoint, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    if (response.status === 401) await chrome.identity.removeCachedAuthToken({ token });
    throw new Error('Google couldn’t confirm the account details. Try reconnecting and allow email access.');
  }

  const user = await response.json();
  const profile = await chromeProfile();
  if (!profile.id || (before.id && profile.id !== before.id) || !sameEmail(profile.email, user.email)) {
    throw new Error('Sign in to Chrome from the profile icon, then connect the same Google account here.');
  }
  if (user.email_verified !== true || typeof user.sub !== 'string' || !user.sub) {
    throw new Error('Google couldn’t verify the account email. Check your Google account and try again.');
  }

  await navigator.locks.request(connectionKey, async () => {
    const saved = await savedAccount();
    const sameAccount = saved?.profileId === profile.id
      && saved.subject === user.sub
      && saved.clientId === configuredClientId;
    const account = {
      profileId: profile.id,
      subject: user.sub,
      clientId: configuredClientId,
      email: profile.email,
      name: typeof user.name === 'string' ? user.name.trim() : '',
      trackingSince: sameAccount ? saved.trackingSince : null,
    };
    await chrome.storage.local.set({ [connectionKey]: account });
  });
}

export async function markHistoryApproved(profileId) {
  await navigator.locks.request(connectionKey, async () => {
    const account = await currentAccount();
    if (account?.profileId !== profileId) {
      await chrome.permissions.remove(historyAccess);
      throw new Error('Connect the Google account for this Chrome profile again.');
    }
    if (!account.trackingSince) {
      await chrome.storage.local.set({ [connectionKey]: { ...account, trackingSince: Date.now() } });
    }
  });
}

export async function disconnectGoogle() {
  await navigator.locks.request(connectionKey, async () => {
    await chrome.storage.local.remove(connectionKey);
    await Promise.all([
      chrome.permissions.remove(historyAccess),
      chrome.identity.clearAllCachedAuthTokens(),
    ]);
  });
}
