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
  chrome.runtime.sendMessage({
    type: 'wb-ingest',
    text: report.text,
    count: report.count,
    trigger,
  });
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

  if (msg?.type === 'wb-search' || msg?.type === 'wb-inspect') {
    const mashup = globalThis.wbMashup;
    // Checked synchronously: the channel has to be claimed before awaiting,
    // and a frame with no form must leave it to the one that has it.
    if (!mashup?.present(msg.selectors ?? {})) return false;
    const selectors = msg.selectors ?? {};
    const run =
      msg.type === 'wb-search'
        ? mashup.runSearch(msg.criteria ?? {}, selectors)
        : mashup.inspect(selectors);
    Promise.resolve(run).then((result) => respond({ found: true, ...result }));
    return true;
  }

  return false;
});

start();
