// The addresses the extension posts to, and the one place they are decided.
//
// The service worker, the popup and the options page all need the same answer
// to "where does a report go?", and each used to carry its own copy of the
// defaults. Three copies of one address is three chances to drift; the reading
// of stored settings is now subtle enough — a list, with a migration behind it
// — that it cannot live in triplicate.
//
// Loaded as a classic script: `importScripts()` in the service worker, a plain
// `<script>` ahead of the page scripts elsewhere.

// Both Workers run the same code over their own D1. Shipping the pair as the
// default is deliberate: a report that lands only in production leaves the dev
// database stale, and every test run there starts by hand-copying a day of
// schedules back. Sending twice costs one extra request per page.
const WB_PROD = 'https://working-book-api.loic-cancelotti.workers.dev';
const WB_DEV = 'https://working-book-api-dev.loic-cancelotti.workers.dev';

const WB_DEFAULTS = {
  // First in the list is the reference: its answer is what the badge counts
  // and what the run reports as imported. The others are mirrors — their
  // refusal is said out loud, but it does not make the run a failure.
  apiBases: [WB_PROD, WB_DEV],
  // Search criteria. The dates are offsets in days from today, not fixed
  // dates: a hard-coded 20260718 would silently go stale the next morning and
  // the operator would never know the window had drifted.
  autoSearch: false,
  searchEveryMin: 15,
  facility: '221',
  workCenter: 'COATER',
  fromOffset: -7,
  toOffset: 14,
};

function wbCleanBase(value) {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

// Accepts what the options page holds (one address per line) and what storage
// holds (an array), because the same list travels through both.
function wbParseBases(value) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(/[\s,;]+/);
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const base = wbCleanBase(item);
    // A duplicated address would post the same page twice to the same D1 —
    // harmless, since a row seen twice is updated, but it would also count its
    // import twice in the summary.
    if (!base || seen.has(base)) continue;
    seen.add(base);
    out.push(base);
  }
  return out;
}

function wbOriginPattern(base) {
  return `${new URL(base).origin}/*`;
}

function wbHostOf(base) {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}

// Installs made before the list existed only ever stored `apiBase`. No list at
// all — and a list emptied down to nothing, which the options page refuses to
// save — falls back to the shipped pair rather than to sending nowhere.
function wbBasesFrom(stored) {
  const listed = wbParseBases(stored.apiBases);
  if (listed.length) return listed;
  const legacy = wbCleanBase(stored.apiBase);
  // The shipped address was never a choice — it is what came in the box, so it
  // adopts the new default and starts feeding dev too. An address someone
  // typed *is* a decision, and an update has no business widening it.
  if (legacy && legacy !== WB_PROD) return [legacy];
  return [...WB_DEFAULTS.apiBases];
}

async function wbConfig() {
  // The list is asked for with an empty default on purpose. Handing
  // `storage.sync.get` the real default would give back the shipped pair for an
  // install that never stored a list — indistinguishable from one that did —
  // and the migration below would never see the single address it exists for.
  const stored = await chrome.storage.sync.get({ ...WB_DEFAULTS, apiBases: null, apiBase: '' });
  return { ...WB_DEFAULTS, ...stored, apiBases: wbBasesFrom(stored) };
}
