// Settings, set once and forgotten. Everything that decides *how* the import
// runs — page size, how many pages, how the fields are found — is fixed in the
// code: there was one right answer to each, and exposing them only ever left a
// stale value behind to break a later run.

const DEFAULTS = {
  apiBase: 'https://working-book-api.loic-cancelotti.workers.dev',
  autoSearch: false,
  searchEveryMin: 15,
  facility: '221',
  workCenter: 'COATER',
  fromOffset: -7,
  toOffset: 14,
};

function intOr(value, fallback) {
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : fallback;
}

const $ = (id) => document.getElementById(id);
const status = $('status');

function say(message, kind) {
  status.textContent = message;
  status.className = kind ?? '';
}

function originPattern(apiBase) {
  return `${new URL(apiBase).origin}/*`;
}

// The default address ships granted in `host_permissions`, so the common case
// needs nothing. Any *other* address the operator types does need asking, and
// a real click is the only context Chrome accepts a permission request from.
// Without it the background fetch is subject to CORS and the extension origin
// isn't on the Worker's allow-list.
async function ensurePermission(apiBase) {
  const origins = [originPattern(apiBase)];
  if (await chrome.permissions.contains({ origins })) return true;
  return chrome.permissions.request({ origins });
}

async function load() {
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  $('apiBase').value = cfg.apiBase;
  $('autoSearch').checked = cfg.autoSearch === true;
  $('searchEveryMin').value = cfg.searchEveryMin;
  $('facility').value = cfg.facility;
  $('workCenter').value = cfg.workCenter;
  $('fromOffset').value = cfg.fromOffset;
  $('toOffset').value = cfg.toOffset;
}

function readForm() {
  return {
    apiBase: $('apiBase').value.trim().replace(/\/+$/, ''),
    autoSearch: $('autoSearch').checked,
    searchEveryMin: Math.max(1, intOr($('searchEveryMin').value, 15)),
    facility: $('facility').value.trim(),
    workCenter: $('workCenter').value.trim(),
    fromOffset: intOr($('fromOffset').value, -7),
    toOffset: intOr($('toOffset').value, 14),
  };
}

async function save() {
  const cfg = readForm();
  if (!cfg.apiBase) {
    say('Renseignez l’adresse du serveur.', 'err');
    return null;
  }
  try {
    originPattern(cfg.apiBase);
  } catch {
    say('Adresse invalide — attendu une URL complète, https:// comprise.', 'err');
    return null;
  }
  if (!(await ensurePermission(cfg.apiBase))) {
    say('Autorisation refusée : l’extension ne pourra pas joindre le serveur.', 'err');
    return null;
  }
  await chrome.storage.sync.set(cfg);
  say('Réglages enregistrés.', 'ok');
  return cfg;
}

async function test() {
  const cfg = await save();
  if (!cfg) return;
  say('Test en cours…');
  try {
    const res = await fetch(`${cfg.apiBase}/api/health`);
    if (!res.ok) {
      say(`Le serveur répond ${res.status}. Vérifiez l’adresse.`, 'err');
      return;
    }
    // /api/health only proves the Worker is up. Poke the real endpoint too, with
    // a body that parses to no records: it is rejected before anything is
    // written, so this can't touch the stored report.
    const probe = await fetch(`${cfg.apiBase}/api/schedules/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'test de connexion Working Book' }),
    });
    if (probe.status === 422) {
      say('Connexion correcte — prêt à importer.', 'ok');
    } else {
      say(`Serveur joignable (réponse ${probe.status}).`, 'ok');
    }
  } catch (err) {
    say(`Serveur injoignable : ${err}`, 'err');
  }
}

// A run walks away and finishes on its own; the account of it has to survive
// somewhere readable, not only in a badge that fades.
async function showLastRun() {
  const { lastRun } = await chrome.storage.local.get({ lastRun: null });
  if (!lastRun) return;
  const when = new Date(lastRun.at).toLocaleString('fr-FR');
  $('lastRun').textContent = `${when}\n${lastRun.text}`;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'lastRun' in changes) showLastRun();
});

$('save').addEventListener('click', save);
$('test').addEventListener('click', test);
load();
showLastRun();
