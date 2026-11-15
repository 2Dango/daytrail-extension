(() => {
  if (globalThis.__daytrailReminderInstalled) return;
  globalThis.__daytrailReminderInstalled = true;

  let host;
  let currentSite = '';

  function remove() {
    host?.remove();
    host = undefined;
    currentSite = '';
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function safeText(value, maximum) {
    return typeof value === 'string' ? value.slice(0, maximum) : '';
  }

  function actionButton(label, action, primary = false) {
    const button = element('button', primary ? 'dt-primary' : '', label);
    button.type = 'button';
    button.addEventListener('click', () => {
      const site = currentSite;
      remove();
      void chrome.runtime.sendMessage({
        type: 'daytrail:reminder:action',
        action,
        site,
      });
    });
    return button;
  }

  function render(message) {
    remove();
    const site = safeText(message.site, 253);
    const minutes = Number(message.minutes);
    if (!site || !Number.isFinite(minutes) || minutes < 1) return false;
    currentSite = site;

    host = document.createElement('div');
    host.id = 'daytrail-focus-reminder';
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:20px;top:20px;display:block;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = element('style');
    style.textContent = `
      :host { all: initial; }
      @font-face { font-family: "Daytrail Pixel"; src: url("${chrome.runtime.getURL('PixelifySans.ttf')}") format("truetype"); font-display: swap; }
      * { box-sizing: border-box; }
      .card { width: min(360px, calc(100vw - 32px)); color: #183d2d; background: #fff6d8;
        border: 3px solid #183d2d; box-shadow: 7px 7px 0 #183d2d; padding: 18px;
        font-family: "Daytrail Pixel", ui-monospace, monospace; line-height: 1.35; }
      .top { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
      .eyebrow { margin:0 0 5px; color:#577c4e; font-size:13px; letter-spacing:.08em; text-transform:uppercase; }
      h2 { margin:0; font:700 23px/1.08 "Daytrail Pixel", ui-monospace, monospace; }
      p { margin:12px 0 0; font:500 15px/1.4 "Daytrail Pixel", ui-monospace, monospace; }
      .checkpoint { padding:10px; background:#dcebb5; border:2px solid #183d2d; }
      .close { min-width:34px; height:34px; padding:0; font-size:22px; line-height:1; }
      .actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:16px; }
      button { appearance:none; border:2px solid #183d2d; border-radius:0; background:#fff6d8; color:#183d2d;
        min-height:38px; padding:7px 10px; cursor:pointer; font:700 14px/1 "Daytrail Pixel", ui-monospace, monospace;
        box-shadow:3px 3px 0 #183d2d; }
      button:hover, button:focus-visible { background:#dcebb5; outline:3px solid #e7a83d; outline-offset:2px; }
      button:active { transform:translate(2px,2px); box-shadow:1px 1px 0 #183d2d; }
      .dt-primary { background:#2e6645; color:#fff6d8; }
      @media (max-width: 430px) { .card { width:calc(100vw - 28px); padding:14px; } }
      @media (prefers-reduced-motion: reduce) { button:active { transform:none; } }
    `;
    const card = element('section', 'card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'false');
    card.setAttribute('aria-labelledby', 'daytrail-reminder-title');
    const top = element('div', 'top');
    const heading = element('div');
    heading.append(element('p', 'eyebrow', 'Daytrail focus check'));
    const title = element('h2', '', `Still on ${site}?`);
    title.id = 'daytrail-reminder-title';
    heading.append(title);
    const close = element('button', 'close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss Daytrail reminder');
    close.addEventListener('click', () => {
      const selected = currentSite;
      remove();
      void chrome.runtime.sendMessage({ type: 'daytrail:reminder:action', action: 'dismiss', site: selected });
    });
    top.append(heading, close);
    card.append(top);
    card.append(element('p', '', `You’ve spent about ${Math.floor(minutes)} active minute${minutes === 1 ? '' : 's'} here today.`));
    const trailName = safeText(message.trailName, 120);
    const checkpoint = safeText(message.checkpoint, 240);
    if (trailName) card.append(element('p', '', `Your Trail: ${trailName}`));
    if (checkpoint) card.append(element('p', 'checkpoint', `Next step: ${checkpoint}`));
    const actions = element('div', 'actions');
    actions.append(
      actionButton('Back to my task', 'return', true),
      actionButton('5 more minutes', 'snooze'),
      actionButton('This is work', 'work'),
    );
    card.append(actions);
    shadow.append(style, card);
    document.documentElement.append(host);
    close.focus();
    return true;
  }

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type === 'daytrail:reminder:show') {
      reply({ shown: render(message) });
      return;
    }
    if (message?.type === 'daytrail:reminder:hide') {
      remove();
      reply({ hidden: true });
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !host) return;
    const site = currentSite;
    remove();
    void chrome.runtime.sendMessage({ type: 'daytrail:reminder:action', action: 'dismiss', site });
  }, true);
})();
