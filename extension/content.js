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

// How long the grid has to stop changing before it is read, when nothing
// better is known. The mashup repaints in bursts as a search resolves; reading
// on the first mutation would ship a half-drawn table. Only the fallback now:
// when the pager can be read, the walk waits for the rows it announces instead.
const SETTLE_MS = 2000;

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
  return chrome.runtime.sendMessage({
    type: 'wb-ingest',
    text: report.text,
    count: report.count,
    trigger,
  });
}

// How long the grid has to go without a DOM mutation once every other signal
// says the page is complete. Not a guard against a half-drawn page — the row
// count is — but against reading between two frames of the same repaint.
const QUIET_MS = 300;
const READY_CEILING_MS = 20000;
// A busy indicator that never clears is decoration, not a signal; past this it
// is ignored and reported, rather than stalling every page to the ceiling.
const BUSY_MAX_MS = 4000;

// Rows the current page should hold, from what the pager displays. Null when
// the pager does not say — the last page's remainder needs the result count.
function expectedRows(p) {
  if (!p?.pageSize) return null;
  const { pageSize, page, pages, total } = p;
  if (page && pages && page < pages) return pageSize;
  if (page && total) {
    return page * pageSize <= total ? pageSize : Math.max(0, total - (page - 1) * pageSize) || null;
  }
  if (pages === 1 && total) return total;
  return null;
}

// Resolves once the grid holds the page that was asked for — or gives up.
//
// Four signals, each stamped with the moment it fired so the account of a run
// shows which ones this screen actually provides:
//   changed  the report differs from `before` — the click did something.
//            Without it the walk stopped after two pages on a thirty-page
//            report: the grid is perfectly still while the request is in
//            flight, so a quiet window alone reads the same page twice.
//   idle     no busy indicator on the grid.
//   full     the grid holds as many rows as the pager says this page has.
//   quiet    QUIET_MS without a mutation under the grid, and the text stable
//            across two reads.
// When the pager can be read, the page is ready at changed ∧ idle ∧ full ∧
// quiet: no timer at all, only the ceiling. When it cannot, the old rule
// applies — SETTLE_MS without change — so an unreadable pager costs what it
// always cost, never a wrong read.
// `expectPage` is the page number the pager should show once the click has
// landed. On the real screen "next" is not disabled on the last page: it
// wraps to page one, and the text fingerprint alone did not recognise it — so
// the walk read two pages twice. The page number is what settles it: a
// different number is not the page asked for, however much the rows changed.
// It also stands in for the row count on the last page, where the pager gives
// no total to compute one from.
function pageReady({ before = null, expectPage = null, changeWithin = 8000, ceiling = READY_CEILING_MS } = {}) {
  const m = globalThis.wbMashup;
  const t0 = performance.now();
  const at = () => Math.round(performance.now() - t0);
  const log = {
    ok: false,
    mode: null,
    ms: null,
    changedAt: before == null ? 0 : null,
    idleAt: null,
    fullAt: null,
    expected: null,
    rows: null,
    count: null,
    busy: null,
    busyIgnored: false,
    pager: null,
  };

  // Mutations are counted only under the grid's container: the portal around
  // it never stops moving. Observed from body, because the container itself
  // can be replaced by a repaint.
  let lastMutation = performance.now();
  const observer = new MutationObserver((list) => {
    const root = m?.gridRoot?.() ?? document.body;
    for (const x of list) {
      if (root.contains(x.target)) {
        lastMutation = performance.now();
        return;
      }
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });

  return new Promise((resolve) => {
    const done = (ok, mode) => {
      observer.disconnect();
      resolve({ ...log, ok, mode, ms: at() });
    };
    let lastHash = null;
    let busySince = null;
    const tick = () => {
      const elapsed = at();
      const report = readReport();
      const h = hash(report?.text ?? '');
      const pager = m?.pagerState?.() ?? null;
      if (pager) log.pager = pager;
      const pageKnown = expectPage != null && pager?.page != null;
      const onPage = pageKnown ? pager.page === expectPage : null;

      if ((before != null && h === before) || onPage === false) {
        if (elapsed >= changeWithin) {
          return done(false, onPage === false && pager.page < expectPage ? 'wrapped' : 'unchanged');
        }
        return setTimeout(tick, 150);
      }
      if (log.changedAt == null) log.changedAt = elapsed;

      const busy = m?.busyIndicator?.() ?? null;
      if (busy) {
        log.busy = busy;
        busySince ??= elapsed;
        log.idleAt = null;
      } else {
        busySince = null;
        log.idleAt ??= elapsed;
      }
      const busyBlocks = busy && elapsed - busySince < BUSY_MAX_MS;
      if (busy && !busyBlocks) log.busyIgnored = true;

      const expected = expectedRows(pager);
      log.expected = expected;
      log.rows = m?.gridRows?.() ?? null;
      log.count = report?.count ?? 0;
      const seen = log.rows || log.count;
      // With a row count to check against, the page is full when it is met.
      // Without one but with the page number confirmed, the same render that
      // wrote the number wrote the rows, so any row at all is the page.
      const full = expected != null ? seen >= expected : onPage === true && seen > 0;
      log.fullAt = full ? log.fullAt ?? elapsed : null;

      const stable = h === lastHash;
      lastHash = h;
      const quietFor = performance.now() - lastMutation;
      const mode = expected != null ? 'exact' : onPage === true ? 'page' : 'fallback';
      const need = mode === 'fallback' ? SETTLE_MS : QUIET_MS;

      if (!busyBlocks && stable && quietFor >= need && (full || mode === 'fallback')) {
        return done(true, mode);
      }
      if (elapsed >= ceiling) return done(true, 'timeout');
      setTimeout(tick, 150);
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
  // Mirrors that refused at least one page. A set, not a list: the same server
  // failing on all thirty pages is one thing gone wrong, said once.
  const refused = new Set();
  // One entry per page read: which signals fired, when, and what the pager
  // said. This is what the test build is for.
  const timings = [];
  // Page numbers already read, when the pager gives them. The fingerprint
  // below missed a page shown twice — the screen is never quite in the same
  // state — while the number is exact.
  const seenPages = new Set();

  let before = null;
  let expectPage = null;
  for (let i = 0; i < maxPages; i++) {
    // After a click, a report that never changes, or a page number that is
    // not the one asked for, is the end of the walk: a "next" that wraps
    // around, or one that only looks like "next". No reason to wait long.
    const ready = await pageReady({ before, expectPage, changeWithin: 8000 });
    timings.push(ready);
    console.info('[Working Book] page', pages + 1, ready);
    if (!ready.ok) break;
    const report = readReport();
    if (!report) break;

    const pageNo = ready.pager?.page ?? null;
    if (pageNo != null) {
      if (seenPages.has(pageNo)) break;
      seenPages.add(pageNo);
    }
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
    // The counts above are the reference server's. The others are posted to in
    // the same breath, and one of them lagging behind shows up nowhere else.
    for (const target of result?.targets ?? []) {
      if (!target.ok && !target.primary) refused.add(target.host);
    }

    // Two jobs: the toolbar counts pages while the walk runs, so a long
    // report does not look like a frozen extension — and the traffic keeps
    // the service worker awake, which a thirty-page walk otherwise outlives.
    // Nobody answers it, hence the swallowed rejection: an unawaited one
    // surfaces in the page console.
    chrome.runtime.sendMessage({ type: 'wb-progress', page: pages, imported }).catch(() => {});

    // Checked before advancing, not after: turning a page we have no budget
    // to read leaves the grid parked somewhere nobody asked for.
    if (pages >= maxPages) break;
    // The pager's word beats the button's: on this screen "next" stays
    // clickable on the last page and wraps to the first.
    const { page, pages: pageCount } = ready.pager ?? {};
    if (page != null && pageCount != null && page >= pageCount) break;
    if (!globalThis.wbMashup?.nextPage()) break;
    before = h;
    expectPage = pageNo != null ? pageNo + 1 : null;
  }

  return { pages, rows, imported, failures, refused: [...refused], timings };
}

// Puts the grid back on page one and waits for it, so the screen is left as it
// was found and the next run does not start midway through the report.
async function backToFirstPage() {
  const before = hash(readReport()?.text ?? '');
  if (!globalThis.wbMashup?.firstPage()) return false;
  await pageReady({ before, expectPage: 1, changeWithin: 10000 });
  return true;
}

// The popup broadcasts to every frame. A frame with no grid stays silent
// rather than answering "not me": the broadcast delivers only the first reply,
// so an eager empty frame would beat the one actually holding the report.
// Silence everywhere leaves the caller with no responder, which it reads as
// "nothing found".
// What the readiness probes read right now, with nothing driven. The debug
// view for the test build: opened on a PMS230 screen, it shows in one glance
// which signals this screen provides and what the pager's wording looks like.
function probe() {
  const m = globalThis.wbMashup;
  const root = m?.gridRoot?.() ?? null;
  const report = readReport();
  const pager = m?.pagerState?.() ?? null;
  return {
    frame: location.href,
    grid: root ? `${root.tagName.toLowerCase()}${root.id ? `#${root.id}` : ''}.${String(root.className).trim().split(/\s+/).slice(0, 3).join('.')}` : null,
    rows: m?.gridRows?.() ?? null,
    count: report?.count ?? 0,
    busy: m?.busyIndicator?.() ?? null,
    pager,
    expected: expectedRows(pager),
    nextButton: Boolean(m?.nextPageButton?.()),
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg?.type === 'wb-probe') {
    // Only the frame that holds a grid or a pager answers, for the same reason
    // as below: the broadcast keeps the first reply.
    const m = globalThis.wbMashup;
    if (!readReport() && !m?.gridRoot?.() && !m?.pagerState?.()) return false;
    respond({ found: true, ...probe() });
    return true;
  }

  if (msg?.type === 'wb-scrape') {
    const report = readReport();
    if (!report) return false;
    send(report, 'manual');
    respond({ found: true, count: report.count });
    return true;
  }

  if (msg?.type === 'wb-search') {
    const mashup = globalThis.wbMashup;
    // Checked synchronously: the channel has to be claimed before awaiting,
    // and a frame with no form must leave it to the one that has it.
    if (!mashup?.locate()) return false;

    const criteria = msg.criteria ?? {};
    // Two ways to ask: prepare the grid and stop there, or prepare it and
    // import what it holds. Everything up to the click is identical, which is
    // why this is a flag rather than a second path.
    const wantsSend = msg.send !== false;
    mashup
      .runSearch(criteria)
      .then(async (result) => {
        // Only a search that actually went out has anything to send. Beyond
        // that, always at least one page: a ceiling of 1 means "do not turn
        // pages", not "send nothing".
        const maxPages = Math.max(1, Number(criteria.maxPages) || 1);
        const swept = wantsSend && result?.clicked ? await sweep(maxPages) : null;

        // A single page never left page one, so there is nothing to undo.
        const rewound = swept && swept.pages > 1 ? await backToFirstPage() : false;

        respond({ found: true, ...result, swept, rewound, maxPages, sent: wantsSend });
      })
      .catch((err) => respond({ found: true, error: String(err) }));
    return true;
  }

  return false;
});
