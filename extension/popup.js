// The panel behind the toolbar icon. Declaring a popup means the browser no
// longer fires chrome.action.onClicked at all, so the run has to start from a
// button in here — which is the trade: the account of the last run is readable
// without hovering, and a long walk shows its progress instead of a badge.

const DEFAULTS = {
  facility: '221',
  workCenter: 'COATER',
  fromOffset: -14,
  toOffset: 14,
  rowsPerPage: -1,
  maxPages: 20,
  apiBase: '',
};

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
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  // A search touches nothing but the Mingle screen, so it stays available even
  // with no server configured; only the import has anywhere to send to.
  configured = Boolean(cfg.apiBase);
  running(false);
  if (!configured) {
    $('criteria').textContent = 'Adresse du serveur non renseignée — ouvrez les réglages.';
    return;
  }
  $('criteria').textContent = [
    `${cfg.facility} · ${cfg.workCenter}`,
    `Fenêtre ${windowOf(cfg.fromOffset, cfg.toOffset)}`,
    `${cfg.rowsPerPage < 0 ? 'Maximum' : cfg.rowsPerPage} ligne(s) par page · ${cfg.maxPages} page(s) au plus`,
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

async function snapshot() {
  say('Relevé en cours…');
  const s = await chrome.runtime.sendMessage({ type: 'wb-snapshot-form' });
  if (!s) {
    say('Aucune page Mingle ne répond — ouvrez l’écran PMS230.', 'err');
    return;
  }
  const text = JSON.stringify(s, null, 1);
  try {
    await navigator.clipboard.writeText(text);
    say(`Relevé copié (${text.length} caractères).`, 'ok');
  } catch {
    say('Copie refusée — utilisez le bouton des réglages.', 'err');
  }
}

$('version').textContent = `v${chrome.runtime.getManifest().version}`;
$('run').addEventListener('click', () => launch(true));
$('search').addEventListener('click', () => launch(false));
$('snapshot').addEventListener('click', snapshot);
$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());

showCriteria();
showLastRun();
restoreProgress();
