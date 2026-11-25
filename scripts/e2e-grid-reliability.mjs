// End-to-end check of the Suivi workbook's reliability, one "tablet" against the
// Worker: a shift that can't open says so, the day's other postes open offline,
// refused edits are kept (not lost), and a batch whose answer was lost is not
// written twice.
//
//   APP=https://feat-suivi-fiabilite.working-book.pages.dev/#grid DATE=2099-03-01 \
//   API=https://working-book-api-dev.<account>.workers.dev \
//   PLAYWRIGHT_DIR=/path/containing/node_modules/ node scripts/e2e-grid-reliability.mjs
//
// Same needs as e2e-grid.mjs (fonts, WebGL). Use a DATE no one has: it writes
// that day's workbooks on the dev Worker (clean them afterwards).
import { createRequire } from 'node:module';
const require = createRequire(process.env.PLAYWRIGHT_DIR ?? import.meta.url);
const { chromium } = require('playwright');

const APP = process.env.APP ?? 'http://localhost:5173/#grid';
const DATE = process.env.DATE ?? '2099-03-01';
const API = process.env.API;
if (!API) throw new Error('API= the Worker the app talks to');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let failures = 0;
const check = (ok, what) => { log(ok ? 'PASS' : 'FAIL', what); if (!ok) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});

async function tablet(shiftKey) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(([date, key]) => {
    // Only the first load: later ones keep what the app stored since.
    if (localStorage.getItem('wb.date') === null) localStorage.setItem('wb.date', JSON.stringify(date));
    if (localStorage.getItem('wb.shiftKey') === null) localStorage.setItem('wb.shiftKey', JSON.stringify(key));
    window.__msgs = [];
    const top = window.top;
    window.addEventListener('message', (e) => top.__msgs.push({ type: e.data?.type, changes: e.data?.changes }));
  }, [DATE, shiftKey]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('pageerror', e.message));
  await page.goto(APP);
  await waitOpened(page);
  return { ctx, page };
}

async function waitOpened(page, n = 1, tries = 90) {
  for (let i = 0; i < tries; i++) {
    if ((await page.evaluate(() => window.__msgs.filter((m) => m.type === 'gridcraft:opened').length)) >= n) return true;
    await sleep(1000);
  }
  return false;
}

const poste = (page) => page.evaluate(() => document.querySelector('.shift-chip.active .shift-poste')?.textContent?.trim());
const storage = (page, prefix) => page.evaluate((p) => Object.keys(localStorage).filter((k) => k.startsWith(p)), prefix);

async function typeAt(page, col, row, text) {
  await page.bringToFront();
  await page.keyboard.press('Control+Home');
  for (let i = 0; i < col.charCodeAt(0) - 65; i++) await page.keyboard.press('ArrowRight');
  for (let i = 1; i < row; i++) await page.keyboard.press('ArrowDown');
  await sleep(200);
  await page.keyboard.type(text, { delay: 110 });
  await page.keyboard.press('Enter');
  await sleep(400);
}

async function doc(p) {
  const j = await (await fetch(`${API}/api/grid/doc?date=${DATE}&poste=${p}`)).json();
  return { seq: j.seq, cells: Object.fromEntries(j.changes.map((c) => [`${c.sheet}!${c.cell}`, { v: c.c?.v?.v ?? c.c?.f ?? null, seq: c.seq }])) };
}

const text = (page, sel) => page.locator(sel).first().innerText().catch(() => null);
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);

// ---- 1. the day's other postes are read ahead, and open offline ------------
// Another tablet opens the neighbour first, so that it exists on the Worker.
const first = await tablet('M');
const pM = await poste(first.page);
log('first tablet: poste', pM, 'date', DATE);
await first.ctx.close();

// Which shift chips exist: the ones other than M.
const t = await tablet('A');
const pA = await poste(t.page);
log('tablet: poste', pA);
await sleep(7000); // the read-ahead starts 3 s after the shift opens
const snaps = await storage(t.page, 'wb.grid.snapshot.');
log('snapshots kept:', snaps.join(', '));
check(snaps.some((k) => k.endsWith(`${DATE}.${pM}`)), `the neighbour ${pM} was read ahead (snapshot kept)`);

await t.ctx.setOffline(true);
await t.page.locator('.shift-chip', { hasText: new RegExp(`^\\s*\\S*\\s*${pM}\\b`) }).first().click().catch(() => {});
// Fallback: any chip that is not the active one and whose poste is pM.
const chips = await t.page.locator('.shift-chip').all();
for (const c of chips) {
  if ((await c.locator('.shift-poste').innerText().catch(() => '')).trim() === pM) {
    await c.click();
    break;
  }
}
await sleep(4000);
const nowPoste = await poste(t.page);
check(nowPoste === pM, `switched to poste ${pM} offline (now ${nowPoste})`);
check(!(await visible(t.page, '.gc-blocked')), 'a read-ahead poste opens offline: no blocking message');
check(/Hors ligne/.test((await text(t.page, '.gc-status')) ?? ''), 'the bar says « Hors ligne » over the open workbook');

// ---- 2. a poste nobody opened can't open offline: it says so ---------------
const others = [];
for (const c of await t.page.locator('.shift-chip').all()) others.push((await c.locator('.shift-poste').innerText().catch(() => '')).trim());
log('chips:', others.join(','));
// One nobody opened: the Worker still has no template for it (a peek doesn't start it).
let unopened;
for (const p of others) {
  if (!p || p === pM || p === pA) continue;
  const j = await (await fetch(`${API}/api/grid/doc?date=${DATE}&poste=${p}&peek=1`)).json();
  if (j.template_id === null) {
    unopened = p;
    break;
  }
}
if (unopened) {
  for (const c of await t.page.locator('.shift-chip').all()) {
    if ((await c.locator('.shift-poste').innerText().catch(() => '')).trim() === unopened) {
      await c.click();
      break;
    }
  }
  await sleep(3000);
  check(await visible(t.page, '.gc-blocked'), `poste ${unopened} (never opened): the blocking message shows`);
  const inert = await t.page.evaluate(() => document.querySelector('.gc iframe')?.inert ?? null);
  check(inert === true, 'the frame behind is inert (nothing typed there can be taken for an edit)');
  await t.ctx.setOffline(false);
  await sleep(12000);
  check(!(await visible(t.page, '.gc-blocked')), 'back online, the message goes and the poste opens by itself');
} else {
  log('SKIP: no third poste chip to test the blocking message');
  await t.ctx.setOffline(false);
}
await t.ctx.close();

// ---- 3. refused edits are kept, shown, sent again on demand ---------------
const r = await tablet('N');
const pR = await poste(r.page);
log('refusal tablet: poste', pR);
let refuse = true;
await r.page.route('**/api/grid/doc?*', async (route) => {
  if (route.request().method() === 'POST' && refuse) return route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"test"}' });
  return route.continue();
});
await typeAt(r.page, 'C', 3, 'refus');
await sleep(2500);
check(/refusée/.test((await text(r.page, '.gc-status')) ?? ''), 'a refused edit shows a bar with its count');
check((await storage(r.page, 'wb.grid.held.')).length === 1, 'the refused edit is kept on the device');
check((await storage(r.page, 'wb.grid.outbox.')).length === 0, '…and is no longer in the send queue');
await r.page.reload();
await waitOpened(r.page);
await sleep(1500);
check(/refusée/.test((await text(r.page, '.gc-status')) ?? ''), 'after a reload the refused edit is still there (it used to be lost)');
refuse = false;
await r.page.locator('.gc-status button', { hasText: 'Renvoyer' }).click();
await sleep(3000);
check(!(await visible(r.page, '.gc-status')), '« Renvoyer » sends it: the bar goes');
const afterResend = await doc(pR);
check(Object.values(afterResend.cells).some((c) => c.v === 'refus'), 'the Worker now has the edit');

// ---- 4. a batch whose answer is lost is not written twice -----------------
let reached = 0;
let lose = true;
await r.page.unroute('**/api/grid/doc?*');
await r.page.route('**/api/grid/doc?*', async (route) => {
  if (route.request().method() === 'POST' && lose) {
    await route.fetch(); // the Worker gets it and writes it…
    reached++;
    lose = false;
    return route.abort('failed'); // …the answer never arrives
  }
  return route.continue();
});
// The button took the focus: back into the workbook, as an operator's tap would.
await r.page.locator('.gc iframe').click({ position: { x: 700, y: 400 } });
await typeAt(r.page, 'D', 4, 'unefois');
await sleep(9000); // first try, then the retry after 2 s
const d = await doc(pR);
const cell = Object.entries(d.cells).find(([, c]) => c.v === 'unefois');
log('server cell:', JSON.stringify(cell), 'doc seq', d.seq, 'attempts that reached the Worker:', reached);
check(!!cell, 'the edit reached the Worker');
check(reached === 1 && cell && cell[1].seq === d.seq && d.seq === afterResend.seq + 1, 'the retry did not write it a second time (seq advanced once)');
await r.ctx.close();

// ---- 5. Worker: the same batch twice — even at once — is written once --------
const post = (batch) =>
  fetch(`${API}/api/grid/doc?date=${DATE}&poste=${pR}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client: 'e2e',
      batch,
      changes: [
        { sheet: 'Suivi', cell: 'F6', c: { v: { t: 'Text', v: 'a' } } },
        { sheet: 'Suivi', cell: 'bad', c: null },
        { sheet: 'Suivi', cell: 'F7', c: { v: { t: 'Text', v: 'b' } } },
      ],
    }),
  }).then((res) => res.json());
const before = (await doc(pR)).seq;
const [x, y] = await Promise.all([post(`t${Date.now()}`.slice(0, 20)), Promise.resolve(null)]);
const id = `u${Date.now()}`;
const [p1, p2] = await Promise.all([post(id), post(id)]);
const p3 = await post(id);
const want = JSON.stringify([before + 3, null, before + 4]);
log('seqs', JSON.stringify(p1.seqs), JSON.stringify(p2.seqs), JSON.stringify(p3.seqs), 'before', before, 'first', JSON.stringify(x.seqs));
check(JSON.stringify(p1.seqs) === JSON.stringify(p2.seqs) && JSON.stringify(p2.seqs) === JSON.stringify(p3.seqs), 'two sends at once and a third later all get the same answer');
check(JSON.stringify(p1.seqs) === want && (await doc(pR)).seq === before + 4, 'and the cells were written once (a refused cell takes no number)');

await browser.close();
log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
