// Service worker: the only place allowed to talk to the Working Book API.
//
// Doing the POST here rather than in the content script buys two things the
// bookmarklet could never have: host permissions bypass CORS, and the portal's
// own Content-Security-Policy has no say over an extension background fetch.

const DEFAULTS = { apiBase: '', token: '', mode: 'auto', auto: true };

const BADGE = {
  ok: { color: '#2e7d32', ttl: 4000 },
  warn: { color: '#ed6c02', ttl: 6000 },
  err: { color: '#c62828', ttl: 8000 },
};

let badgeTimer;

function badge(text, kind) {
  const { color, ttl } = BADGE[kind];
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setTitle({ title: `Working Book — ${text}` });
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: 'Envoyer le rapport vers Working Book' });
  }, ttl);
}

async function config() {
  return { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
}

async function ingest(text) {
  const cfg = await config();
  if (!cfg.apiBase) {
    badge('config', 'err');
    return { ok: false, error: 'not_configured' };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (cfg.token) headers['X-WB-Token'] = cfg.token;

  let res;
  try {
    res = await fetch(`${cfg.apiBase.replace(/\/+$/, '')}/api/schedules/ingest`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text, mode: cfg.mode }),
    });
  } catch (err) {
    badge('rés.', 'err');
    return { ok: false, error: String(err) };
  }

  const raw = await res.text();
  let body = {};
  try {
    body = JSON.parse(raw);
  } catch {
    /* non-JSON error page — the status carries the story */
  }

  if (!res.ok) {
    // 422 means the grid was read but nothing decoded: worth flagging without
    // shouting, since the stored report is deliberately left untouched.
    badge(res.status === 422 ? '0' : String(res.status), res.status === 422 ? 'warn' : 'err');
    return { ok: false, status: res.status, error: body.error };
  }

  badge(String(body.imported ?? '✓'), 'ok');
  return { ok: true, ...body };
}

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg?.type !== 'wb-ingest') return false;
  ingest(msg.text).then(respond);
  return true; // keep the channel open for the async reply
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  try {
    // Broadcast to every frame — only the one holding the grid answers.
    const replies = await chrome.tabs.sendMessage(tab.id, { type: 'wb-scrape' });
    if (!replies?.found) badge('vide', 'warn');
  } catch {
    // No content script in this tab (not an Infor page), or no frame answered.
    badge('vide', 'warn');
  }
});
