// End-to-end check of the GridCraft tab: two "tablets" (browser contexts) on
// the same shift's shared workbook. A types, B must receive it; edits on both
// at once must all land; B's Ctrl+Z must not undo A's edit.
//
//   APP=http://localhost:5173/#grid DATE=2026-10-30 \
//   API=https://working-book-api-dev.<account>.workers.dev \
//   PLAYWRIGHT_DIR=/path/containing/node_modules/ node scripts/e2e-grid.mjs /tmp/out
//
// Needs Playwright's Chromium with fonts available (a font-less container
// crashes the renderer: set FONTCONFIG_FILE) and WebGL (SwiftShader is enough).
// Pick a DATE no one has used: each run fills that day's workbook.
// GridCraft up to v0.7.0-shared shows the template's import warnings in a
// message box that takes the first click and keystrokes, hence the priming
// below (harmless once the build keeps them in the info bar only).
import { createRequire } from 'node:module';
const require = createRequire(process.env.PLAYWRIGHT_DIR ?? import.meta.url);
const { chromium } = require('playwright');

const OUT = process.argv[2];
const APP = process.env.APP ?? 'http://localhost:5173/#grid';
const DATE = process.env.DATE ?? '2026-10-20';
const API = process.env.API;
if (!API) throw new Error('API= the Worker the app talks to');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let failures = 0;
const check = (ok, what) => { log(ok ? 'PASS' : 'FAIL', what); if (!ok) failures++; };

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});

async function tablet(name) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(([date]) => {
    localStorage.setItem('wb.date', JSON.stringify(date));
    localStorage.setItem('wb.shiftKey', JSON.stringify('M'));
    window.__msgs = [];
    const top = window.top;
    window.addEventListener('message', (e) => top.__msgs.push({ dir: window === top ? 'in' : 'out', type: e.data?.type, changes: e.data?.changes }));
  }, [DATE]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(name, 'pageerror', e.message));
  page.on('crash', () => log(name, 'CRASH'));
  await page.goto(APP);
  for (let i = 0; i < 90; i++) {
    const st = await page.evaluate(() => document.querySelector('.gc .sync-label')?.textContent ?? 'none');
    if (st === 'Partagé') break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(Number(process.env.SETTLE ?? 2500));
  return page;
}

// Suivi sheet cell centres in page coordinates (see screenshots).
const COL = { B: 118, C: 206, D: 266, J: 637, K: 697 };
const ROW = { 3: 414, 4: 436, 5: 457 };
async function typeAt(page, col, row, text) {
  await page.bringToFront();
  const x = COL[col], y = ROW[row];
  await page.mouse.move(x - 25, y - 12); await page.waitForTimeout(100);
  await page.mouse.move(x, y, { steps: 5 }); await page.waitForTimeout(100);
  await page.mouse.down(); await page.waitForTimeout(100); await page.mouse.up();
  await page.waitForTimeout(500);
  await page.keyboard.type(text, { delay: 110 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
}
const fmt = (c) => `${c.sheet}!${c.cell}=${JSON.stringify(c.c?.v?.v ?? c.c?.f ?? null)}`;
const sentCells = (page) => page.evaluate(() => window.__msgs.filter((m) => m.type === 'gridcraft:changes').flatMap((m) => m.changes)).then((l) => l.map(fmt));
const appliedCells = (page) => page.evaluate(() => window.__msgs.filter((m) => m.type === 'gridcraft:apply').flatMap((m) => m.changes)).then((l) => l.map(fmt));
async function server(poste) {
  const r = await fetch(`${API}/api/grid/doc?date=${DATE}&poste=${poste}`);
  const j = await r.json();
  return Object.fromEntries(j.changes.map((c) => [`${c.sheet}!${c.cell}`, c.c?.v?.v ?? c.c?.f ?? null]));
}

const A = await tablet('A');
const B = await tablet('B');
const poste = (await A.evaluate(() => document.querySelector('.shift-chip.active .shift-poste')?.textContent))?.trim();
log('poste', poste, 'date', DATE);

// 1. First edit on A goes through (frame focused on open).
// Priming: whatever the import message box leaves of a click and a key, then
// Escape (no edit).
for (const P of [A, B]) {
  await P.bringToFront();
  await P.mouse.move(44, 351, { steps: 3 }); await P.mouse.down(); await P.mouse.up(); await P.waitForTimeout(400);
  await P.keyboard.type('x', { delay: 100 }); await P.waitForTimeout(300);
  await P.keyboard.press('Escape'); await P.waitForTimeout(400);
}
await typeAt(A, 'C', 4, '50');
await A.screenshot({ path: `${OUT}/A-first.png` });
await A.waitForTimeout(1500);
check((await sentCells(A)).includes('Suivi!C4=50'), `A first edit C4=50 sent (${(await sentCells(A)).join(' ')})`);

// 2. B receives it.
await B.waitForTimeout(4000);
check((await appliedCells(B)).includes('Suivi!C4=50'), `B applied C4=50 (${(await appliedCells(B)).join(' ')})`);

// 3. Different cells edited back to back on both tablets.
await typeAt(A, 'D', 4, '4500');
await typeAt(B, 'J', 4, '30');
await A.waitForTimeout(6000);
let s = await server(poste);
check(s['Suivi!D4'] === 4500 && s['Suivi!J4'] === 30, `server has D4=4500 and J4=30 (${JSON.stringify(s)})`);
check((await appliedCells(A)).includes('Suivi!J4=30'), 'A applied J4=30 from B');
check((await appliedCells(B)).includes('Suivi!D4=4500'), 'B applied D4=4500 from A');

// 4. B undoes its own J4 after having received A's D4: D4 must survive.
await B.bringToFront();
await B.keyboard.press('Control+z');
await B.waitForTimeout(5000);
s = await server(poste);
check(s['Suivi!D4'] === 4500, `after B's undo, D4 still 4500 (${s['Suivi!D4']})`);
check(s['Suivi!J4'] === null || s['Suivi!J4'] === undefined, `after B's undo, J4 emptied (${s['Suivi!J4']})`);
log('B sent:', (await sentCells(B)).join(' '));

await A.screenshot({ path: `${OUT}/A-final.png` });
await B.screenshot({ path: `${OUT}/B-final.png` });
log(failures ? `${failures} FAIL` : 'ALL PASS');
await browser.close();
process.exit(failures ? 1 : 0);
