// The panel behind the toolbar icon. Declaring a popup means the browser no
// longer fires chrome.action.onClicked at all, so the run has to start from a
// button in here — which is the trade: the account of the last run is readable
// without hovering, and a long walk shows its progress instead of a badge.

// The criteria and the addresses both come from config.js, loaded ahead of
// this file.

const $ = (id) => document.getElementById(id);

function say(message, kind) {
  $('status').textContent = message;
  $('status').className = kind ?? '';
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// The same arithmetic the run itself does, shown before it runs: an operator
// should be able to see which window is about to be asked for, not discover it
// afterwards in the report.
function windowOf(fromOffset, toOffset) {
  const at = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + Number(days || 0));
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  };
  return `${at(fromOffset)} → ${at(toOffset)}`;
}

async function showCriteria() {
  const cfg = await wbConfig();
  // A search touches nothing but the Mingle screen, so it stays available even
  // with no server configured; only the import has anywhere to send to.
  configured = cfg.apiBases.length > 0;
  running(false);
  if (!configured) {
    // No button leads here any more, so the way back has to be spelled out.
    $('criteria').textContent =
      'Adresse du serveur non renseignée.\nClic droit sur l’icône → Options.';
    return;
  }
  $('criteria').textContent = [
    `${cfg.facility} · ${cfg.workCenter}`,
    `Fenêtre ${windowOf(cfg.fromOffset, cfg.toOffset)}`,
    // Shown before the run, like the criteria: the page goes to every one of
    // these, and finding that out afterwards is finding it out too late.
    `→ ${cfg.apiBases.map(wbHostOf).join(', ')}`,
  ].join('\n');
}

async function showLastRun() {
  const { lastRun } = await chrome.storage.local.get({ lastRun: null });
  if (!lastRun) return;
  $('when').textContent = new Date(lastRun.at).toLocaleString('fr-FR');
  $('last').textContent = lastRun.text;
  $('last').className = lastRun.kind === 'ok' ? 'ok' : lastRun.kind === 'err' ? 'err' : '';
}

// Two ways to press: prepare the grid, or prepare it and import it. Both walk
// the same path in the content script — the difference is only whether the
// pages are sent — so the panel treats them as one button in two moods.
const LABELS = { run: 'Rapport auto', search: 'Lancer la recherche' };
const BUSY = { run: 'Import en cours…', search: 'Recherche en cours…' };

let configured = true;

function running(on, which) {
  for (const id of Object.keys(LABELS)) {
    $(id).disabled = on || (id === 'run' && !configured);
    $(id).textContent = on && id === which ? BUSY[id] : LABELS[id];
  }
}

// A run outlives the popup: closing it does not stop anything, and reopening
// has to pick the progress back up rather than pretend nothing is happening.
async function restoreProgress() {
  const { runState } = await chrome.storage.local.get({ runState: null });
  if (!runState?.running) return;
  running(true, 'run');
  say(`Page ${runState.page} — ${runState.imported} ligne(s) importée(s).`);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'wb-progress') return false;
  running(true, 'run');
  say(`Page ${msg.page} — ${msg.imported} ligne(s) importée(s).`);
  return false;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('lastRun' in changes) {
    showLastRun();
    running(false);
  }
});

async function launch(send) {
  running(true, send ? 'run' : 'search');
  say(send ? 'Recherche en cours…' : 'Remplissage des critères…');
  try {
    const summary = await chrome.runtime.sendMessage({ type: 'wb-run-all', send });
    say(summary?.text ?? 'Terminé.', summary?.kind === 'ok' ? 'ok' : 'err');
  } catch (err) {
    say(`Interrompu : ${err}`, 'err');
  } finally {
    running(false);
    showLastRun();
  }
}

$('version').textContent = `v${chrome.runtime.getManifest().version}`;
$('run').addEventListener('click', () => launch(true));
$('search').addEventListener('click', () => launch(false));

// Awaited in order, not fired together. showCriteria() ends on running(false)
// and restoreProgress() may follow with running(true) — started in parallel,
// whichever storage area answered last had the final say, and chrome.storage
// .sync is routinely the slower of the two. The panel then showed "Page 4 —
// 120 lignes importées" above an enabled button, inviting a second walk over
// the grid the first one was still driving.
(async () => {
  await showCriteria();
  await showLastRun();
  await restoreProgress();
})();
