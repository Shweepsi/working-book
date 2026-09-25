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
// "Incl. Completed" is ticked before every search: the report is the whole
// window, finished schedules included, whatever the screen kept from the
// last operator.
const INCLUDE_COMPLETED = true;

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
//
// Takes the body already serialised, not the report: a page of the grid is
// tens of kilobytes and every address was encoding its own copy of the same
// one, twenty times over on a twenty-page walk.
async function post(base, payload) {
  const target = { base, host: wbHostOf(base) };
  let res;
  try {
    res = await fetch(`${base}/api/schedules/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
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
  const payload = JSON.stringify({ text });
  const targets = await Promise.all(
    cfg.apiBases.map((base, i) => post(base, payload).then((t) => ({ ...t, primary: i === 0 }))),
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
    // instead of showing an idle panel over a walk still in flight. Stamped,
    // because storage.local outlives what wrote it: the popup needs to tell a
    // walk in flight from the remains of one that died with its worker.
    chrome.storage.local.set({
      runState: { running: true, page: msg.page, imported: msg.imported, at: Date.now() },
    });
    return false;
  }
  return false;
});

function criteriaOf(cfg) {
  const { facility, workCenter, fromOffset, toOffset } = cfg;
  return {
    facility,
    workCenter,
    fromOffset,
    toOffset,
    maxPages: MAX_PAGES,
    rowsPerPage: ROWS_PER_PAGE,
    includeCompleted: INCLUDE_COMPLETED,
  };
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

// A run that went nowhere. `headline` is what the panel shows under its
// verdict; `text` is the full account, for the tooltip and the options page.
function failure(badgeText, headline, reasons = []) {
  return { badge: badgeText, kind: 'err', headline, reasons, text: [headline, ...reasons].join('\n') };
}

// Account of a run, at two lengths. The panel gets a verdict — `kind` ok, warn
// or err, read there as « Terminé OK », « Terminé — avertissement », « NOK » —
// with one line of result and, when it is not OK, the reasons in a few words.
// The tooltip and the options page keep the full account. The counts that
// matter are what the server stored, not what the grid appeared to show.
function summarise(reply) {
  if (!reply) return failure('form', 'Aucun écran PMS230 ouvert');
  if (reply.error) return failure('!', 'Interrompu', [String(reply.error)]);
  if (!reply.clicked) {
    const missing = (reply.empty ?? []).concat(reply.failed ?? []).join(', ') || 'un critère';
    return failure('crit.', 'Recherche non lancée', [`${missing} vide`]);
  }

  const swept = reply.swept;
  const lines = [];
  lines.push(reply.filled?.length ? `Critères écrits : ${reply.filled.join(', ')}.` : 'Critères déjà à jour.');
  // Said every time, because it changes what the report contains and nothing
  // on the imported rows shows which way the box was.
  const completed = reply.completed;
  let completedOff = false;
  if (completed?.found) {
    if (completed.now) lines.push('Terminés inclus.');
    else {
      lines.push('Terminés exclus — la case « Incl. Completed » n’a pas pu être cochée.');
      completedOff = true;
    }
  } else if (completed) {
    lines.push('Case « Incl. Completed » introuvable — terminés selon l’écran.');
    completedOff = true;
  }
  const perPage = reply.rows?.rows ? ` de ${reply.rows.rows} lignes` : '';
  if (swept) {
    const took = reply.ms ? ` en ${(reply.ms / 1000).toFixed(1).replace('.', ',')} s` : '';
    lines.push(`${swept.pages} page(s)${perPage} parcourue(s), ${swept.imported} ligne(s) importée(s)${took}.`);
    if (swept.restarts) lines.push('Grille remise en page 1 en cours de parcours : reparti du début.');
    if (swept.reruns) lines.push('Réponse de la recherche arrivée après le parcours : parcours refait.');
    if (swept.failures?.length) lines.push(`${swept.failures.length} page(s) refusée(s) par le serveur.`);
    // Named, not merely counted: a mirror falling behind is invisible on
    // screen — production looks perfectly imported — and the only moment it
    // can be noticed is here.
    if (swept.refused?.length) lines.push(`Serveur secondaire en échec : ${swept.refused.join(', ')}.`);
    lines.push(...anomalyLines(swept.timings));
  } else if (perPage) {
    lines.push(`Lignes par page : ${reply.rows.rows}.`);
  }
  if (reply.rewound) lines.push('Grille remise en page 1.');
  // Said outright rather than left to be inferred from a missing line: a
  // prepared grid and an imported one look identical on screen.
  if (reply.sent === false) lines.push('Grille prête — rien n’a été envoyé.');

  const imported = swept?.imported ?? 0;
  const pageFailures = swept?.failures?.length ?? 0;
  const reasons = [];
  if (pageFailures) reasons.push(`${pageFailures} page(s) refusée(s) par le serveur`);
  if (swept?.refused?.length) reasons.push(`Serveur secondaire en échec : ${swept.refused.join(', ')}`);
  if (completedOff) reasons.push('Terminés non inclus');

  const headline =
    reply.sent === false
      ? 'Grille prête, rien n’a été envoyé'
      : swept
        ? `${imported} ligne(s) importée(s) · ${swept.pages} page(s)`
        : 'Aucune page lue';
  // Every page refused, or nothing read at all, is not a run with a warning:
  // nothing reached the report.
  const sank = reply.sent !== false && (!swept || (pageFailures > 0 && imported === 0));
  return {
    badge: reply.sent === false ? '✓' : String(imported || (sank ? '!' : '✓')),
    kind: sank ? 'err' : reasons.length ? 'warn' : 'ok',
    headline,
    reasons,
    text: lines.join('\n'),
    // What the walk waited on, and the run's timeline: for the options page,
    // where someone looking into a run wants it, not in the panel.
    detail: swept ? timingLines(swept.timings).join('\n') : '',
    timings: swept?.timings ?? null,
    timeline: reply.timeline ?? null,
  };
}

// Only what an operator should hear about: a page read without the signal it
// should have had, or without any. A run where every page was read on the
// pager's word says nothing here.
function anomalyLines(timings) {
  if (!timings?.length) return [];
  const count = (...modes) => timings.filter((t) => modes.includes(t.mode)).length;
  const lines = [];
  const ceiling = count('timeout', 'stale');
  if (ceiling) lines.push(`${ceiling} page(s) lue(s) au plafond de 20 s.`);
  const fallback = count('fallback');
  if (fallback) lines.push(`${fallback} page(s) lue(s) après 2 s de calme, pager illisible.`);
  if (timings[0]?.via === 'redraw') lines.push('Réponse de la recherche non observée : page 1 lue sur le redessin.');
  return lines;
}

// What the walk waited on, page by page. Each page says whether it was read
// on the pager's word ("exacte"), on the old two-second rule ("repli"), or at
// the ceiling — and how long it took. This is how the screen tells us which
// signals it actually provides.
function timingLines(timings) {
  if (!timings?.length) return [];
  const sec = (ms) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
  const count = (mode) => timings.filter((t) => t.mode === mode).length;
  const all = timings.map((t) => t.ms);
  const avg = all.reduce((a, b) => a + b, 0) / all.length;
  const lines = [
    `Attente par page : ${count('exact')} exacte(s), ${count('page')} par n° de page, ${count('fallback')} repli 2 s, ${count('timeout') + count('stale')} plafond, ${count('unchanged') + count('wrapped')} sans changement — moy. ${sec(avg)}, max ${sec(Math.max(...all))}.`,
  ];
  const withPager = timings.find((t) => t.pager);
  if (withPager) {
    const p = withPager.pager;
    lines.push(`Pager lu : ${p.pageSize ?? '?'} / page, page ${p.page ?? '?'} sur ${p.pages ?? '?'}, ${p.total ?? '?'} résultat(s).`);
  } else {
    lines.push('Pager illisible — repli sur le délai fixe.');
  }
  const [firstPage] = timings;
  if (firstPage?.request) {
    lines.push(`Recherche : réponse à ${(firstPage.request.end / 1000).toFixed(1).replace('.', ',')} s (…${firstPage.request.name.slice(-40)}), ${firstPage.redraws ?? '?'} ligne(s) redessinée(s).`);
  } else if (firstPage) {
    lines.push(`Recherche : aucune requête vue depuis le clic, ${firstPage.redraws ?? '?'} ligne(s) redessinée(s), lue sur ${firstPage.via === 'redraw' ? 'le redessin + 2 s de calme' : 'le plafond'}.`);
  }
  const busy = timings.find((t) => t.busy);
  if (busy) {
    lines.push(`Indicateur d’occupation : ${busy.busy}${timings.some((t) => t.busyIgnored) ? ' (ignoré, jamais retombé)' : ''}.`);
  } else {
    lines.push('Aucun indicateur d’occupation vu.');
  }
  return lines;
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
    return publish(failure('!', 'Interrompu', [String(err)]));
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

// No walk survives the browser: closing it mid-import kills the content
// script and this worker before publish() — the only eraser — ever runs, and
// storage.local keeps the runState they left behind. The next launch then
// opened on "Import en cours…" with both buttons locked, for good, since only
// a finished run clears the flag and a locked button can start none. At
// startup a stored runState is therefore always a leftover, never a run; an
// update or a reload orphans the walk the same way, hence both listeners.
function wake() {
  chrome.storage.local.remove('runState');
  syncAlarm();
}

chrome.runtime.onInstalled.addListener(wake);
chrome.runtime.onStartup.addListener(wake);
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
    return publish(failure('!', 'Interrompu', [String(err)]));
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
    const headline = `${scraped.count} ligne(s) envoyée(s) depuis l’écran affiché`;
    return publish({ badge: String(scraped.count), kind: 'ok', headline, reasons: [], text: `${headline}.` });
  }
  return record(null);
}
