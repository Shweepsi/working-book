const DEFAULTS = {
  apiBase: '',
  auto: true,
  autoSearch: false,
  searchEveryMin: 15,
  facility: '221',
  workCenter: 'COATER',
  fromOffset: -14,
  toOffset: 14,
  selectors: {},
};

const SELECTOR_FIELDS = ['facility', 'workCenter', 'dateFrom', 'dateTo', 'search'];

// The selector map is edited as `field = css`, one per line: a JSON textarea
// would put an operator one missing brace away from a config that silently
// resets to nothing.
function parseSelectors(raw) {
  const out = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const at = trimmed.indexOf('=');
    if (at < 0) throw new Error(`ligne sans « = » : ${trimmed}`);
    const field = trimmed.slice(0, at).trim();
    const css = trimmed.slice(at + 1).trim();
    if (!SELECTOR_FIELDS.includes(field)) throw new Error(`champ inconnu : ${field}`);
    if (!css) continue;
    // Fail here rather than in the frame, where a bad selector would look like
    // a field that simply wasn't found.
    document.querySelector(css);
    out[field] = css;
  }
  return out;
}

function formatSelectors(map) {
  return Object.entries(map ?? {})
    .map(([field, css]) => `${field} = ${css}`)
    .join('\n');
}

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
  $('autoSearch').checked = cfg.autoSearch === true;
  $('searchEveryMin').value = cfg.searchEveryMin;
  $('facility').value = cfg.facility;
  $('workCenter').value = cfg.workCenter;
  $('fromOffset').value = cfg.fromOffset;
  $('toOffset').value = cfg.toOffset;
  $('selectors').value = formatSelectors(cfg.selectors);
}

function readForm() {
  return {
    apiBase: $('apiBase').value.trim().replace(/\/+$/, ''),
    auto: $('auto').checked,
    autoSearch: $('autoSearch').checked,
    searchEveryMin: Math.max(1, intOr($('searchEveryMin').value, 15)),
    facility: $('facility').value.trim(),
    workCenter: $('workCenter').value.trim(),
    fromOffset: intOr($('fromOffset').value, -14),
    toOffset: intOr($('toOffset').value, 14),
    selectors: parseSelectors($('selectors').value),
  };
}

async function save() {
  let cfg;
  try {
    cfg = readForm();
  } catch (err) {
    say(`Sélecteurs manuels — ${err.message}`, 'err');
    return null;
  }
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

const FIELD_LABELS = {
  facility: 'Facility',
  workCenter: 'Work Center',
  dateFrom: 'From Start Date',
  dateTo: 'To Start Date',
  search: 'bouton Search',
};

const named = (keys) => keys.map((k) => FIELD_LABELS[k] ?? k).join(', ');

// The whole point of this button: it says which criteria the extension can
// actually reach, on the real screen, before any of them is written to.
async function inspect() {
  if (!(await save())) return;
  say('Lecture de l’écran…');
  const found = await chrome.runtime.sendMessage({ type: 'wb-inspect-form' });
  if (!found) {
    say(
      'Aucun formulaire de recherche trouvé.\n' +
        'Ouvrez l’onglet Mingle sur l’écran PMS230 et réessayez.',
      'err',
    );
    return;
  }
  const lines = found.resolved.map(
    (k) => `  ✓ ${FIELD_LABELS[k]} — ${found.preview[k].tag} = « ${found.preview[k].value} »`,
  );
  if (found.missing.length) lines.push(`  ✗ non trouvé : ${named(found.missing)}`);
  say(
    `${found.resolved.length}/5 éléments reconnus :\n${lines.join('\n')}`,
    found.missing.length ? 'err' : 'ok',
  );
}

async function searchNow() {
  if (!(await save())) return;
  say('Recherche en cours…');
  const { answered } = await chrome.runtime.sendMessage({ type: 'wb-run-search' });
  say(
    answered
      ? 'Recherche lancée. Le rapport part dès que la grille se stabilise.'
      : 'Aucun formulaire de recherche trouvé — ouvrez l’écran PMS230 dans Mingle.',
    answered ? 'ok' : 'err',
  );
}

$('save').addEventListener('click', save);
$('test').addEventListener('click', test);
$('inspect').addEventListener('click', inspect);
$('search').addEventListener('click', searchNow);
load();
