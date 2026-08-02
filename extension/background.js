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
  // is comfortable to look at. -1 takes the menu's largest offering, 0 leaves
  // the grid on whatever it shows.
  rowsPerPage: -1,
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
// The tooltip outlives the badge: the badge is a glance, the tooltip is where
// the account of the last run stays readable long after the colour has faded.
let idleTitle = 'Working Book — lancer la recherche et importer le rapport';

function badge(text, kind, { ttl } = {}) {
  const spec = BADGE[kind] ?? BADGE.warn;
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: spec.color });
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: idleTitle });
  }, ttl ?? spec.ttl);
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

// Asks every Infor tab, returns the first frame that answers. Used by all the
// read-only queries the options page makes — nothing here writes.
async function ask(message) {
  const cfg = await config();
  const tabs = await chrome.tabs.query(INFOR_TABS);
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const reply = await chrome.tabs.sendMessage(tab.id, { selectors: cfg.selectors, ...message });
      if (reply?.found) return reply;
    } catch {
      /* no frame in this tab answers to it */
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
    ask({ type: 'wb-inspect' }).then(respond);
    return true;
  }
  if (msg?.type === 'wb-probe-form') {
    ask({ type: 'wb-probe', css: msg.css, opts: msg.opts }).then(respond);
    return true;
  }
  if (msg?.type === 'wb-snapshot-form') {
    ask({ type: 'wb-snapshot' }).then(respond);
    return true;
  }
  if (msg?.type === 'wb-run-all') {
    runEverything().then(respond);
    return true;
  }
  if (msg?.type === 'wb-progress') {
    // Kept alive well past a normal badge: a thirty-page walk must not look
    // like an extension that stopped responding.
    badge(`${msg.page}`, 'ok', { ttl: 600000 });
    // Recorded too, so a popup opened mid-run picks the progress back up
    // instead of showing an idle panel over a walk still in flight.
    chrome.storage.local.set({
      runState: { running: true, page: msg.page, imported: msg.imported },
    });
    return false;
  }
  return false;
});

function criteriaOf(cfg) {
  const { facility, workCenter, fromOffset, toOffset, maxPages, rowsPerPage } = cfg;
  return { facility, workCenter, fromOffset, toOffset, maxPages, rowsPerPage };
}

// Broadcast to every Infor tab: the operator may have the mashup in a
// background tab, and driving it there is the entire point — the report
// refreshes without anyone looking at it.
//
// One call covers the whole run: fill the criteria, press Search, widen the
// page size, send every page, then put the grid back on page one.
async function driveSearch() {
  const cfg = await config();
  return ask({ type: 'wb-search', criteria: criteriaOf(cfg) });
}

// Human-readable account of a run, for the toolbar tooltip and the options
// page. The counts that matter are what the server stored, not what the grid
// appeared to show.
function summarise(reply) {
  if (!reply) return { badge: 'form', kind: 'warn', text: 'Aucun écran PMS230 ouvert.' };
  if (reply.error) return { badge: '!', kind: 'err', text: `Interrompu : ${reply.error}` };
  if (!reply.clicked) {
    const missing = (reply.empty ?? []).concat(reply.failed ?? []).join(', ') || 'un critère';
    return { badge: 'crit.', kind: 'warn', text: `Recherche non lancée — ${missing} vide.` };
  }

  const swept = reply.swept;
  const lines = [];
  lines.push(reply.filled?.length ? `Critères écrits : ${reply.filled.join(', ')}.` : 'Critères déjà à jour.');
  if (reply.rows?.rows) lines.push(`Lignes par page : ${reply.rows.rows}.`);
  if (swept) {
    lines.push(`${swept.pages} page(s) parcourue(s), ${swept.imported} ligne(s) importée(s).`);
    if (swept.failures?.length) lines.push(`${swept.failures.length} page(s) refusée(s) par le serveur.`);
  }
  if (reply.rewound) lines.push('Grille remise en page 1.');

  const imported = swept?.imported ?? 0;
  const failed = swept?.failures?.length ?? 0;
  return {
    badge: String(imported || '✓'),
    kind: failed ? 'warn' : 'ok',
    text: lines.join('\n'),
  };
}

// The single place a run's outcome becomes visible: badge, tooltip, and the
// stored account the popup and the options page both read. Clearing runState
// here is what tells an open popup the walk is over.
async function publish(summary) {
  idleTitle = `Working Book — dernière exécution\n${summary.text}`;
  badge(summary.badge, summary.kind);
  chrome.action.setTitle({ title: idleTitle });
  await chrome.storage.local.remove('runState');
  await chrome.storage.local.set({ lastRun: { at: new Date().toISOString(), ...summary } });
  return summary;
}

async function record(reply) {
  return publish(summarise(reply));
}

async function runSearch() {
  const reply = await driveSearch();
  await record(reply);
  return reply;
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

// The whole run, from the popup's button. Declaring a popup means
// chrome.action.onClicked never fires, so this is the only entry point left —
// and the popup outlives nothing: closing it does not stop the walk.
async function runEverything() {
  badge('…', 'ok', { ttl: 600000 });
  const reply = await driveSearch();
  if (reply) return record(reply);

  // No search form anywhere: fall back to sending whatever grid is on screen.
  // A report brought up by hand is still worth importing.
  const scraped = await ask({ type: 'wb-scrape' });
  if (scraped?.found) {
    return publish({
      badge: String(scraped.count),
      kind: 'ok',
      text: `${scraped.count} ligne(s) envoyée(s) depuis l’écran affiché.`,
    });
  }
  return record(null);
}
