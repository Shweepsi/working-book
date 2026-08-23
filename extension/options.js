// Settings, set once and forgotten. Everything that decides *how* the import
// runs — page size, how many pages, how the fields are found — is fixed in the
// code: there was one right answer to each, and exposing them only ever left a
// stale value behind to break a later run.
//
// The addresses and the defaults live in config.js, loaded ahead of this file.

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

// The two shipped addresses come granted in `host_permissions`, so the common
// case needs nothing. Any *other* address the operator types does need asking,
// and a real click is the only context Chrome accepts a permission request
// from. Without it the background fetch is subject to CORS and the extension
// origin isn't on the Worker's allow-list.
async function ensurePermission(bases) {
  const origins = bases.map(wbOriginPattern);
  if (await chrome.permissions.contains({ origins })) return true;
  return chrome.permissions.request({ origins });
}

async function load() {
  const cfg = await wbConfig();
  $('apiBases').value = cfg.apiBases.join('\n');
  $('autoSearch').checked = cfg.autoSearch === true;
  $('searchEveryMin').value = cfg.searchEveryMin;
  $('facility').value = cfg.facility;
  $('workCenter').value = cfg.workCenter;
  $('fromOffset').value = cfg.fromOffset;
  $('toOffset').value = cfg.toOffset;
}

function readForm() {
  return {
    apiBases: wbParseBases($('apiBases').value),
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
  if (!cfg.apiBases.length) {
    say('Renseignez au moins une adresse de serveur.', 'err');
    return null;
  }
  for (const base of cfg.apiBases) {
    try {
      wbOriginPattern(base);
    } catch {
      say(`Adresse invalide : ${base}\nAttendu une URL complète, https:// comprise.`, 'err');
      return null;
    }
  }
  if (!(await ensurePermission(cfg.apiBases))) {
    say('Autorisation refusée : l’extension ne pourra pas joindre le serveur.', 'err');
    return null;
  }
  // `apiBase` was the single address of earlier versions. Left behind it would
  // be read again by any install that had not yet stored a list, and quietly
  // win over what was just saved here.
  await chrome.storage.sync.remove('apiBase');
  await chrome.storage.sync.set(cfg);
  $('apiBases').value = cfg.apiBases.join('\n');
  say('Réglages enregistrés.', 'ok');
  return cfg;
}

// Each address is tested on its own: the whole point of the list is that one
// server can be down while the other takes the report, and a single verdict
// for both would hide exactly that.
async function probe(base) {
  const name = wbHostOf(base);
  try {
    const res = await fetch(`${base}/api/health`);
    if (!res.ok) return { ok: false, line: `${name} : répond ${res.status} — vérifiez l’adresse.` };
    // /api/health only proves the Worker is up. Poke the real endpoint too,
    // with a body that parses to no records: it is rejected before anything is
    // written, so this can't touch the stored report.
    const ingest = await fetch(`${base}/api/schedules/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'test de connexion Working Book' }),
    });
    if (ingest.status === 422) return { ok: true, line: `${name} : connexion correcte — prêt à importer.` };
    return { ok: true, line: `${name} : joignable (réponse ${ingest.status}).` };
  } catch (err) {
    return { ok: false, line: `${name} : injoignable — ${err}` };
  }
}

async function test() {
  const cfg = await save();
  if (!cfg) return;
  say('Test en cours…');
  const results = await Promise.all(cfg.apiBases.map(probe));
  say(
    results.map((r) => r.line).join('\n'),
    results.every((r) => r.ok) ? 'ok' : 'err',
  );
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
