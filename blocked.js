import { readFocusState, stopFocus } from './focus-client.js';
import { getActiveTrail, getTrails } from './trails.js';

const byId = (id) => document.getElementById(id);
let timer;

function formatRemaining(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')} remaining`;
}

async function sessionTrail(session) {
  if (session?.trailId) {
    const trails = await getTrails();
    const selected = trails.find(({ id }) => id === session.trailId);
    if (selected) return selected;
  }
  return getActiveTrail();
}

function renderTimer(session) {
  clearInterval(timer);
  if (!session) {
    byId('focus-timer').textContent = 'This focus session has ended.';
    byId('end-focus').disabled = true;
    return;
  }
  byId('end-focus').disabled = false;
  const update = () => {
    const remaining = session.endsAt - Date.now();
    byId('focus-timer').textContent = remaining > 0
      ? formatRemaining(remaining)
      : 'The timer ended. Finishing focus cleanup…';
    if (remaining <= 0) {
      clearInterval(timer);
    }
  };
  update();
  if (session.endsAt > Date.now()) timer = setInterval(update, 1000);
}

async function render() {
  const { session } = await readFocusState();
  renderTimer(session);
  const trail = await sessionTrail(session).catch(() => null);
  if (!trail) return;
  byId('trail-box').hidden = false;
  byId('trail-name').textContent = trail.name || 'Untitled Trail';
  if (trail.checkpoint) {
    byId('trail-checkpoint').hidden = false;
    byId('trail-checkpoint').textContent = `Next step: ${trail.checkpoint}`;
  }
}

byId('return-task').addEventListener('click', () => {
  window.location.href = chrome.runtime.getURL('index.html#trails');
});

byId('end-focus').addEventListener('click', async () => {
  const button = byId('end-focus');
  button.disabled = true;
  byId('focus-status').textContent = 'Ending focus…';
  try {
    await stopFocus();
    byId('focus-status').textContent = 'Focus ended. You can continue browsing.';
    renderTimer(null);
  } catch (error) {
    button.disabled = false;
    byId('focus-status').textContent = error.message || 'Daytrail couldn’t end focus.';
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.daytrailFocusState) void render();
});

void render().catch(() => {
  byId('focus-status').textContent = 'Daytrail couldn’t load this focus session.';
});
