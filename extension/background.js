// Service worker: the only place allowed to talk to the Working Book API.
//
// Doing the POST here rather than in the content script buys two things the
// bookmarklet could never have: host permissions bypass CORS, and the portal's
// own Content-Security-Policy has no say over an extension background fetch.

const DEFAULTS = {
  apiBase: '',
  auto: true,
  // Search criteria. The dates are offsets in days from today, not fixed
  // dates: a hard-coded 20260718 would silently go stale the next morning and
  // the operator would never know the window had drifted.
  autoSearch: false,
  searchEveryMin: 15,
  facility: '221',
  workCenter: 'COATER',
  fromOffset: -14,
  toOffset: 14,
  // The grid's pager defaults to 5 rows, and the report is read from what the
  // grid rendered — so the pager decides how much gets imported, not just what
  // is comfortable to look at.
  maxRows: true,
  // 0 = the largest value the menu offers. A number beyond that is injected
  // into the select: the list is what Infor chose to show, not a limit the
  // grid enforces.
  rowsPerPage: 0,
  // Pages walked after a search. The page-size menu tops out at whatever Infor
  // listed; paging is what actually lifts the ceiling, and re-sending a row
  // updates it rather than duplicating it.
  maxPages: 20,
  // Escape hatch: a CSS selector per field, used instead of the label-based
  // resolver when a screen defeats it.
  selectors: {},
};

const SEARCH_ALARM = 'wb-search';
const INFOR_TABS = { url: 'https://*.inforcloudsuite.com/*' };

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

  let res;
  try {
    res = await fetch(`${cfg.apiBase.replace(/\/+$/, '')}/api/schedules/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
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

// Dry run for the options page: asks every Infor tab what its resolver sees,
// without writing to a single field.
async function inspectForm() {
  const cfg = await config();
  const tabs = await chrome.tabs.query(INFOR_TABS);
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const reply = await chrome.tabs.sendMessage(tab.id, {
        type: 'wb-inspect',
        selectors: cfg.selectors,
      });
      if (reply?.found) return reply;
    } catch {
      /* no form in this tab */
    }
  }
  return null;
}

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg?.type === 'wb-ingest') {
    ingest(msg.text).then(respond);
    return true; // keep the channel open for the async reply
  }
  if (msg?.type === 'wb-run-search') {
    runSearch().then(respond);
    return true;
  }
  if (msg?.type === 'wb-inspect-form') {
    inspectForm().then(respond);
    return true;
  }
  return false;
});

function criteriaOf(cfg) {
  const { facility, workCenter, fromOffset, toOffset, maxRows, maxPages, rowsPerPage } = cfg;
  return { facility, workCenter, fromOffset, toOffset, maxRows, maxPages, rowsPerPage };
}

// Broadcast to every Infor tab: the operator may have the mashup in a
// background tab, and driving it there is the entire point — the report
// refreshes without anyone looking at it.
async function runSearch() {
  const cfg = await config();
  const tabs = await chrome.tabs.query(INFOR_TABS);
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const reply = await chrome.tabs.sendMessage(tab.id, {
        type: 'wb-search',
        criteria: criteriaOf(cfg),
        selectors: cfg.selectors,
      });
      if (!reply?.found) continue;
      // A form found but left incomplete is worse than none: the mashup would
      // answer with its own error dialog and blank the grid.
      if (!reply.clicked) badge('crit.', 'warn');
      return reply;
    } catch {
      // No frame in this tab holds the search form. Expected, and not an error.
    }
  }
  badge('form', 'warn');
  return null;
}

// Chrome floors alarm periods at one minute; anything below is silently
// rounded up, so clamping here keeps the stored value honest.
async function syncAlarm() {
  const cfg = await config();
  await chrome.alarms.clear(SEARCH_ALARM);
  if (!cfg.autoSearch) return;
  const minutes = Math.max(1, Number(cfg.searchEveryMin) || 15);
  chrome.alarms.create(SEARCH_ALARM, { periodInMinutes: minutes, delayInMinutes: minutes });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SEARCH_ALARM) runSearch();
});

chrome.runtime.onInstalled.addListener(syncAlarm);
chrome.runtime.onStartup.addListener(syncAlarm);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if ('autoSearch' in changes || 'searchEveryMin' in changes) syncAlarm();
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
