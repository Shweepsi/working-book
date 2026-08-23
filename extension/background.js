// Service worker: the only place allowed to talk to the Working Book API.
//
// Doing the POST here rather than in the content script buys two things the
// bookmarklet could never have: host permissions bypass CORS, and the portal's
// own Content-Security-Policy has no say over an extension background fetch.

importScripts('config.js');

// Not settings. The grid's pager defaults to 5 rows and the report is read
// from what the grid rendered, so the page size decides how much gets
// imported — there is one right answer, and it is "as many as Infor offers".
// Paging then lifts that ceiling. Exposing either as a knob only ever produced
// a stale value that broke an import.
const ROWS_PER_PAGE = -1;
const MAX_PAGES = 20;

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

// One address, one page. Never throws: a server that is down is an outcome to
// report, and with several addresses in play one refusal must not cancel the
// posts still in flight to the others.
async function post(base, text) {
  const target = { base, host: wbHostOf(base) };
  let res;
  try {
    res = await fetch(`${base}/api/schedules/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    return { ...target, ok: false, unreachable: true, error: String(err) };
  }

  const raw = await res.text();
  let body = {};
  try {
    body = JSON.parse(raw);
  } catch {
    /* non-JSON error page — the status carries the story */
  }

  if (!res.ok) return { ...target, ok: false, status: res.status, error: body.error };
  // `imported` is passed on exactly as the server sent it, missing value
  // included: the badge tells "nothing came back to count" from "nothing was
  // counted" apart, and coercing here would collapse the two into a green 0.
  return { ...target, ok: true, imported: body.imported, body };
}

// Sends the page to every configured address at once, and answers for the
// first one. Production is what the operator is importing *for*; dev is kept
// in step so testing does not start with a day of hand-copied schedules. A
// mirror that refuses is worth saying, not worth failing the run over — and
// the two are posted in parallel so the second never adds to the wait.
async function ingest(text) {
  const cfg = await wbConfig();
  if (!cfg.apiBases.length) {
    badge('config', 'err');
    return { ok: false, error: 'not_configured' };
  }

  // The first address is the reference; the flag travels with the answer so
  // the sweep can tell a mirror's refusal from the reference's own.
  const targets = await Promise.all(
    cfg.apiBases.map((base, i) => post(base, text).then((t) => ({ ...t, primary: i === 0 }))),
  );
  const [primary] = targets;
  const refused = targets.filter((t) => !t.ok && !t.primary);

  if (!primary.ok) {
    if (primary.unreachable) badge('rés.', 'err');
    // 422 means the grid was read but nothing decoded: worth flagging without
    // shouting, since the stored report is deliberately left untouched.
    else badge(primary.status === 422 ? '0' : String(primary.status), primary.status === 422 ? 'warn' : 'err');
    return { ok: false, status: primary.status, error: primary.error, targets };
  }

  // Green would claim both databases took the page when only one did.
  badge(String(primary.imported ?? '✓'), refused.length ? 'warn' : 'ok');
  return { ok: true, ...primary.body, imported: primary.imported, targets };
}

// Asks every Infor tab, returns the first frame that answers.
async function ask(message) {
  const tabs = await chrome.tabs.query(INFOR_TABS);
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const reply = await chrome.tabs.sendMessage(tab.id, message);
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
  if (msg?.type === 'wb-run-all') {
    runEverything(msg.send !== false).then(respond);
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
  const { facility, workCenter, fromOffset, toOffset } = cfg;
  return { facility, workCenter, fromOffset, toOffset, maxPages: MAX_PAGES, rowsPerPage: ROWS_PER_PAGE };
}

// Broadcast to every Infor tab: the operator may have the mashup in a
// background tab, and driving it there is the entire point — the report
// refreshes without anyone looking at it.
//
// One call covers the whole run: fill the criteria, press Search, widen the
// page size, send every page, then put the grid back on page one. With `send`
// false it stops after widening — the grid is prepared and left alone.
async function driveSearch(send = true) {
  const cfg = await wbConfig();
  return ask({ type: 'wb-search', criteria: criteriaOf(cfg), send });
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
    // Named, not merely counted: a mirror falling behind is invisible on
    // screen — production looks perfectly imported — and the only moment it
    // can be noticed is here.
    if (swept.refused?.length) lines.push(`Serveur secondaire en échec : ${swept.refused.join(', ')}.`);
  }
  if (reply.rewound) lines.push('Grille remise en page 1.');
  // Said outright rather than left to be inferred from a missing line: a
  // prepared grid and an imported one look identical on screen.
  if (reply.sent === false) lines.push('Grille prête — rien n’a été envoyé.');

  const imported = swept?.imported ?? 0;
  const failed = (swept?.failures?.length ?? 0) + (swept?.refused?.length ?? 0);
  return {
    badge: reply.sent === false ? '✓' : String(imported || '✓'),
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

// The alarm's entry point. A periodic wake-up that finds no PMS230 open is the
// normal case, not an incident — the operator simply has the screen closed.
// Recording it would overwrite the account of the last successful import with
// "Aucun écran PMS230 ouvert" within one period, so a silent wake-up leaves the
// last real run standing. The button still says it: there, someone asked.
async function runSearch() {
  let reply;
  try {
    reply = await driveSearch();
  } catch (err) {
    // A sweep that got far enough to report progress has already set runState;
    // leaving it behind would strand the popup on a walk that is over.
    return publish({ badge: '!', kind: 'err', text: `Interrompu : ${err}` });
  }
  if (!reply) return null;
  await record(reply);
  return reply;
}

// Chrome floors alarm periods at one minute; anything below is silently
// rounded up, so clamping here keeps the stored value honest.
async function syncAlarm() {
  const cfg = await wbConfig();
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
async function runEverything(send = true) {
  badge('…', 'ok', { ttl: 600000 });
  try {
    return await walk(send);
  } catch (err) {
    // publish() is the only thing that clears runState, so a throw on the way
    // there left the popup showing a walk in progress for good — reopening it
    // never cleared, and no button could end it. An interrupted run has to be
    // reported as one.
    return publish({ badge: '!', kind: 'err', text: `Interrompu : ${err}` });
  }
}

async function walk(send) {
  const reply = await driveSearch(send);
  if (reply) return record(reply);

  // No search form anywhere: fall back to sending whatever grid is on screen.
  // A report brought up by hand is still worth importing. Not offered when the
  // ask was to prepare a search — there is no search to prepare, and sending
  // would be the opposite of what was pressed.
  if (!send) return record(null);
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
