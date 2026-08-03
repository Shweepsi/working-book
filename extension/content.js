// Injected into every frame of every inforcloudsuite.com page — that is the
// whole reason this extension exists. The M3 grid is served from a different
// host than mingle-portal, so a bookmarklet running in the top frame is barred
// from reading it by the same-origin policy. A content script has no such
// limit: the browser runs a copy of this file *inside* the grid's own frame.
//
// This file only ever reads text and hands it to the service worker; the
// network call lives there, where host permissions apply and the portal's CSP
// does not.

const ANCHOR = /\b22\d{8}\b/g;

// How long the page has to stop changing before an auto-send fires. The mashup
// repaints the grid in bursts as a search resolves; sending on the first
// mutation would ship a half-drawn table.
const SETTLE_MS = 2000;
// Floor between two automatic sends, whatever the page does.
const MIN_SEND_INTERVAL_MS = 5000;

let lastHash = 0;
let lastSentAt = 0;
let settleTimer;
// True for the whole of a driven run — search, page walk, rewind. The
// automatic path must stay out of the way throughout, not merely during the
// walk: the observer would otherwise post the previous report while the search
// is still resolving.
let driving = false;

// djb2 — only ever compared against itself, to tell "the grid actually changed"
// from "the page repainted the same rows".
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}

function scheduleCount(text) {
  const m = text.match(ANCHOR);
  return m ? m.length : 0;
}

// The report as the parser wants it: one cell per line. innerText already
// collapses the grid's markup that way, which is why the paste route works.
function readReport() {
  const text = (document.body && document.body.innerText) || '';
  const count = scheduleCount(text);
  return count > 0 ? { text, count } : null;
}

function send(report, trigger) {
  lastHash = hash(report.text);
  lastSentAt = Date.now();
  return chrome.runtime.sendMessage({
    type: 'wb-ingest',
    text: report.text,
    count: report.count,
    trigger,
  });
}

// Resolves once the page has stopped changing for `quiet` ms, or when the
// ceiling is reached. Paging has to wait for the rows to actually arrive:
// reading straight after the click would capture the page being replaced.
function settled(quiet = SETTLE_MS, ceiling = 20000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + ceiling;
    let last = null;
    let quietSince = Date.now();
    const tick = () => {
      const now = readReport()?.text ?? '';
      const h = hash(now);
      if (h !== last) {
        last = h;
        quietSince = Date.now();
      }
      if (Date.now() - quietSince >= quiet) return resolve(true);
      if (Date.now() > deadline) return resolve(false);
      setTimeout(tick, 250);
    };
    tick();
  });
}

// Resolves once the report's text differs from `before`, or gives up. Waiting
// for the page to *settle* is not enough after clicking "next": the grid is
// already still while the request is in flight, so the quiet window elapses,
// the same page is read again, and the walk stops thinking it reached the end.
// That is why it gave up after two pages on a thirty-page report.
function changed(before, timeout = 15000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeout;
    const tick = () => {
      if (hash(readReport()?.text ?? '') !== before) return resolve(true);
      if (Date.now() > deadline) return resolve(false);
      setTimeout(tick, 200);
    };
    tick();
  });
}

// Walks the grid page by page, sending each one. The page-size menu caps at
// whatever Infor chose to list; paging has no such ceiling. Every import adds
// to the report and a row seen twice is updated rather than duplicated, so an
// overlapping or repeated page costs nothing.
async function sweep(maxPages) {
  const seen = new Set();
  let pages = 0;
  let rows = 0;
  let imported = 0;
  const failures = [];

  // Saved and restored rather than forced off: the caller may already own the
  // flag for a longer run, and clearing it here would reopen the automatic
  // path for the rewind that follows.
  const wasDriving = driving;
  driving = true;
  try {
    for (let i = 0; i < maxPages; i++) {
      await settled();
      const report = readReport();
      if (!report) break;

      const h = hash(report.text);
      // The same content twice means the click did not actually advance — the
      // last page, or a "next" that is decorative. Either way, stop.
      if (seen.has(h)) break;
      seen.add(h);

      const result = await send(report, 'sweep');
      pages++;
      rows += report.count;
      // What the server actually stored, not what the page appeared to hold:
      // the two differ whenever a row fails to decode, and the summary would
      // otherwise claim an import that never happened.
      if (result?.ok) imported += Number(result.imported) || 0;
      else failures.push({ page: pages, error: result?.error ?? 'inconnu' });

      // Two jobs: the toolbar counts pages while the walk runs, so a long
      // report does not look like a frozen extension — and the traffic keeps
      // the service worker awake, which a thirty-page walk otherwise outlives.
      // Nobody answers it, hence the swallowed rejection: an unawaited one
      // surfaces in the page console.
      chrome.runtime.sendMessage({ type: 'wb-progress', page: pages, imported }).catch(() => {});

      // Checked before advancing, not after: turning a page we have no budget
      // to read leaves the grid parked somewhere nobody asked for.
      if (pages >= maxPages) break;
      if (!globalThis.wbMashup?.nextPage()) break;
      // A click that changes nothing is the last page, or a control that only
      // looks like "next". Either way there is nowhere left to go. The real
      // pager disables its button on the last page, so this wait is the
      // fallback for screens that do not — no reason to make it long.
      if (!(await changed(h, 8000))) break;
    }
  } finally {
    driving = wasDriving;
  }

  return { pages, rows, imported, failures };
}

// A search asked for on its own must not be posted by the automatic path a
// moment later. Recording the hash without sending is what makes the observer
// read the freshly drawn grid as already seen — the one place where "seen" and
// "sent" deliberately come apart.
async function hold() {
  await settled();
  const report = readReport();
  if (report) lastHash = hash(report.text);
}

// Puts the grid back on page one and waits for it, so the screen is left as it
// was found and the next run does not start midway through the report.
async function backToFirstPage() {
  const before = hash(readReport()?.text ?? '');
  if (!globalThis.wbMashup?.firstPage()) return false;
  await changed(before, 10000);
  await settled();
  return true;
}

async function autoEnabled() {
  try {
    const { auto } = await chrome.storage.sync.get({ auto: true });
    return auto !== false;
  } catch {
    return false;
  }
}

async function considerAutoSend() {
  // A driven run already sends every page it visits, and repaints the grid at
  // each step. Left alone, the observer would post those pages a second time —
  // harmless, since a row seen twice is updated rather than duplicated, but a
  // wasted round trip per page, and one stale post before the search resolves.
  if (driving) return;
  const report = readReport();
  if (!report) return;
  if (hash(report.text) === lastHash) return;
  if (Date.now() - lastSentAt < MIN_SEND_INTERVAL_MS) return;
  if (!(await autoEnabled())) return;
  send(report, 'auto');
}

function onMutation() {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(considerAutoSend, SETTLE_MS);
}

// A frame with no grid in it (the portal shell, the nav chrome) never starts an
// observer, so the common case costs nothing.
function start() {
  if (!document.body) return;
  new MutationObserver(onMutation).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  // Catch a grid that was already on screen when the extension loaded.
  setTimeout(considerAutoSend, SETTLE_MS);
}

// The toolbar button broadcasts to every frame. A frame with no grid stays
// silent rather than answering "not me": the broadcast delivers only the first
// reply, so an eager empty frame would beat the one actually holding the
// report. Silence everywhere leaves the caller with no responder, which it
// reads as "nothing found".
//
// A click sends even when the content is unchanged — dedup belongs to the
// automatic path; an explicit click means "send it now".
//
// `wb-search` and `wb-inspect` follow the same rule for the same reason: only
// the frame holding the search form answers. The result of a search is not
// reported back — pressing Search repaints the grid, which the observer above
// picks up and sends on its own.
chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg?.type === 'wb-scrape') {
    const report = readReport();
    if (!report) return false;
    send(report, 'manual');
    respond({ found: true, count: report.count });
    return true;
  }

  // Diagnosis. Answered by the frame holding the form *or* the grid: a probe
  // is often aimed precisely at something the resolver did not recognise, so
  // requiring a recognised form would refuse exactly the interesting cases.
  if (msg?.type === 'wb-probe' || msg?.type === 'wb-snapshot') {
    const mashup = globalThis.wbMashup;
    if (!mashup) return false;
    if (!mashup.present(msg.selectors ?? {}) && !readReport()) return false;
    respond(
      msg.type === 'wb-probe'
        ? { found: true, ...mashup.probe(msg.css ?? '*', msg.opts ?? {}) }
        : { found: true, ...mashup.snapshot() },
    );
    return true;
  }

  if (msg?.type === 'wb-search' || msg?.type === 'wb-inspect') {
    const mashup = globalThis.wbMashup;
    // Checked synchronously: the channel has to be claimed before awaiting,
    // and a frame with no form must leave it to the one that has it.
    if (!mashup?.present(msg.selectors ?? {})) return false;
    const selectors = msg.selectors ?? {};
    if (msg.type === 'wb-inspect') {
      respond({ found: true, ...mashup.inspect(selectors) });
      return true;
    }

    const criteria = msg.criteria ?? {};
    // Two ways to ask: prepare the grid and stop there, or prepare it and
    // import what it holds. Everything up to the click is identical, which is
    // why this is a flag rather than a second path.
    const wantsSend = msg.send !== false;
    driving = true;
    mashup
      .runSearch(criteria, selectors)
      .then(async (result) => {
        // Only a search that actually went out has anything to send. Beyond
        // that, always at least one page: a ceiling of 1 means "do not turn
        // pages", not "send nothing", and since the automatic path is held
        // back for the whole run, skipping this would leave the report unsent.
        const maxPages = Math.max(1, Number(criteria.maxPages) || 1);
        const swept = wantsSend && result?.clicked ? await sweep(maxPages) : null;
        if (!wantsSend) await hold();

        // A single page never left page one, so there is nothing to undo.
        const rewound = swept && swept.pages > 1 ? await backToFirstPage() : false;

        respond({ found: true, ...result, swept, rewound, maxPages, sent: wantsSend });
      })
      .catch((err) => respond({ found: true, error: String(err) }))
      .finally(() => {
        driving = false;
      });
    return true;
  }

  return false;
});

start();
