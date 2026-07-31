const DEFAULTS = { apiBase: '', auto: true };

const $ = (id) => document.getElementById(id);
const status = $('status');

function say(message, kind) {
  status.textContent = message;
  status.className = kind ?? '';
}

function originPattern(apiBase) {
  return `${new URL(apiBase).origin}/*`;
}

// The Worker's address is chosen by the operator, so it can't be baked into
// `host_permissions`. It is requested here instead, from a real click — which
// is the only context Chrome accepts a permission request from. Without it the
// background fetch is subject to CORS and the extension origin isn't on the
// Worker's allow-list.
async function ensurePermission(apiBase) {
  const origins = [originPattern(apiBase)];
  if (await chrome.permissions.contains({ origins })) return true;
  return chrome.permissions.request({ origins });
}

async function load() {
  const cfg = await chrome.storage.sync.get(DEFAULTS);
  $('apiBase').value = cfg.apiBase;
  $('auto').checked = cfg.auto !== false;
}

function readForm() {
  return {
    apiBase: $('apiBase').value.trim().replace(/\/+$/, ''),
    auto: $('auto').checked,
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

$('save').addEventListener('click', save);
$('test').addEventListener('click', test);
load();
