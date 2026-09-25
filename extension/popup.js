// The panel behind the toolbar icon. Declaring a popup means the browser no
// longer fires chrome.action.onClicked at all, so the run has to start from a
// button in here — which is the trade: the account of the last run is readable
// without hovering, and a long walk shows its progress instead of a badge.

// The criteria and the addresses both come from config.js, loaded ahead of
// this file.

const $ = (id) => document.getElementById(id);

// Progress while a run is in flight: what the walk is doing, and how far it
// has got. The verdict replaces it once the run is over.
function say(title, detail = '') {
  $('statusTitle').textContent = title;
  $('statusDetail').textContent = detail;
  $('status').hidden = false;
  $('result').hidden = true;
}

function plural(n, one, many) {
  return `${n} ${n > 1 ? many : one}`;
}

// The pressed button already says what is running; this says how far.
function sayPage(page, imported) {
  say(`Page ${page}`, plural(Number(imported) || 0, 'ligne importée', 'lignes importées'));
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// How a run ended, in three words an operator can read across the room. The
// details — criteria written, timings, pager — stay in the tooltip and the
// options page, where someone looking into a run goes for them.
const VERDICTS = { ok: 'Terminé OK', warn: 'Terminé — avertissement', err: 'NOK' };

function verdict(summary) {
  const kind = VERDICTS[summary?.kind] ? summary.kind : 'err';
  // A summary stored before `headline` existed still has its first line.
  const headline = summary?.headline ?? String(summary?.text ?? '').split('\n')[0];
  const at = summary?.at ? new Date(summary.at) : new Date();
  $('status').hidden = true;
  $('result').className = `result ${kind}`;
  $('verdict').textContent = VERDICTS[kind];
  $('meta').textContent = [summary?.meta, `${pad(at.getHours())}:${pad(at.getMinutes())}`].filter(Boolean).join(' · ');
  $('headline').textContent = headline;
  $('reasons').replaceChildren(...(summary?.reasons ?? []).map((r) => el('li', { textContent: r })));
  $('result').hidden = false;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// The window is stored as offsets from today, never as dates: a stored
// 20260718 would silently go stale the next morning. The panel shows and takes
// real dates — that is what an operator thinks in — and turns whatever is
// picked back into offsets, so a window chosen today still slides tomorrow.
const DAY_MS = 24 * 60 * 60 * 1000;

function dayAt(offset) {
  const d = new Date();
  d.setHours(12, 0, 0, 0); // noon: a DST change can't push the day over an edge
  d.setDate(d.getDate() + Number(offset || 0));
  return d;
}

function isoOf(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function offsetOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round((new Date(y, m - 1, d, 12) - dayAt(0)) / DAY_MS);
}

function relative(offset) {
  if (!offset) return 'J';
  return `J${offset > 0 ? '+' : '−'}${Math.abs(offset)}`;
}

function showWindow(fromOffset, toOffset) {
  $('from').value = isoOf(dayAt(fromOffset));
  $('to').value = isoOf(dayAt(toOffset));
  $('relative').textContent = `${relative(fromOffset)} → ${relative(toOffset)}`;
}

// A start past the end is not refused, it drags the other bound along: the
// field being edited is the one the operator means.
async function saveWindow(changed) {
  if (!$('from').value || !$('to').value) return;
  let fromOffset = offsetOf($('from').value);
  let toOffset = offsetOf($('to').value);
  if (fromOffset > toOffset) {
    if (changed === 'from') toOffset = fromOffset;
    else fromOffset = toOffset;
  }
  showWindow(fromOffset, toOffset);
  await chrome.storage.sync.set({ fromOffset, toOffset });
}

async function showCriteria() {
  const cfg = await wbConfig();
  // A search touches nothing but the Mingle screen, so it stays available even
  // with no server configured; only the import has anywhere to send to.
  configured = cfg.apiBases.length > 0;
  showWindow(cfg.fromOffset, cfg.toOffset);
  // No button leads to the server settings any more, so the way back has to be
  // spelled out. The window stays editable: a search needs no server.
  $('unconfigured').hidden = configured;
  running(false);
}

// Two ways to press: prepare the grid, or prepare it and import it. Both walk
// the same path in the content script — the difference is only whether the
// pages are sent — so the panel treats them as one button in two moods.
const LABELS = { run: 'Rapport auto', search: 'Lancer la recherche' };
const BUSY = { run: 'Import en cours…', search: 'Recherche en cours…' };

let configured = true;

function running(on, which) {
  for (const id of Object.keys(LABELS)) {
    const busy = on && id === which;
    $(id).disabled = on || (id === 'run' && !configured);
    $(id).textContent = busy ? BUSY[id] : LABELS[id];
    $(id).setAttribute('aria-busy', String(busy));
  }
  // The walk reads the window once, at the start; changing it mid-run would
  // show a window the run in flight is not using.
  $('from').disabled = on;
  $('to').disabled = on;
}

// A run outlives the popup: closing it does not stop anything, and reopening
// has to pick the progress back up rather than pretend nothing is happening.
//
// It does not outlive everything. The worker buries any runState it finds at
// browser startup, but a service worker can also die alone, mid-walk, with no
// startup to follow — and nothing would ever erase what it wrote. The stamp on
// each page settles it: pages are minutes apart at the very worst, so a stamp
// this old is a walk that died, and the buttons must not stay locked over one.
const STALE_RUN_MS = 10 * 60 * 1000;

async function restoreProgress() {
  const { runState } = await chrome.storage.local.get({ runState: null });
  if (!runState?.running) return;
  // No stamp is a runState written before stamps existed — that walk is long
  // over, whatever else is true of it.
  if (!runState.at || Date.now() - runState.at > STALE_RUN_MS) {
    chrome.storage.local.remove('runState');
    return;
  }
  running(true, 'run');
  sayPage(runState.page, runState.imported);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'wb-progress') return false;
  running(true, 'run');
  sayPage(msg.page, msg.imported);
  return false;
});

// publish() writing lastRun is the one signal a walk is over. The panel no
// longer keeps a record of past runs — the tooltip and the options page do —
// but it still listens for the signal: the buttons unlock, and the status says
// how the walk ended instead of staying frozen on its last page count.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('lastRun' in changes) {
    running(false);
    const run = changes.lastRun.newValue;
    if (run) verdict(run);
  }
});

async function launch(send) {
  // The pressed button carries the spinner and says what is running; the
  // card below only appears once there are pages to count.
  running(true, send ? 'run' : 'search');
  $('status').hidden = true;
  $('result').hidden = true;
  try {
    const summary = await chrome.runtime.sendMessage({ type: 'wb-run-all', send });
    verdict(summary ?? { kind: 'err', headline: 'Aucune réponse de l’extension' });
  } catch (err) {
    verdict({ kind: 'err', headline: 'Interrompu', reasons: [String(err)] });
  } finally {
    running(false);
  }
}

$('version').textContent = `v${chrome.runtime.getManifest().version}`;
$('run').addEventListener('click', () => launch(true));
$('search').addEventListener('click', () => launch(false));
$('from').addEventListener('change', () => saveWindow('from'));
$('to').addEventListener('change', () => saveWindow('to'));

// Awaited in order, not fired together. showCriteria() ends on running(false)
// and restoreProgress() may follow with running(true) — started in parallel,
// whichever storage area answered last had the final say, and chrome.storage
// .sync is routinely the slower of the two. The panel then showed "Page 4 —
// 120 lignes importées" above an enabled button, inviting a second walk over
// the grid the first one was still driving.
(async () => {
  await showCriteria();
  await restoreProgress();
})();
