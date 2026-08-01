// Drives the PMS230 Operator Mashup search form: fills the four criteria and
// presses Search.
//
// Fields are found by the *label the operator reads* — "Facility", "Work
// Center", "From Start Date", "To Start Date" — never by id or class. Infor
// generates those (`m3h5_38_88c6fb67…`) and they turn over between releases,
// while the labels are part of the screen's published contract. An explicit
// selector map in the options overrides the heuristic when a screen defeats it.
//
// Nothing here talks to the network. It runs in the M3 grid's own frame, next
// to content.js, and the two share one isolated world — hence the single
// namespace object rather than bare globals.

(() => {
  const LABELS = {
    facility: ['Facility'],
    workCenter: ['Work Center', 'Work Centre', 'Centre de charge'],
    dateFrom: ['From Start Date'],
    dateTo: ['To Start Date'],
  };

  const SEARCH_LABELS = ['Search', 'Rechercher'];

  // Checkboxes and buttons are excluded: "Incl. Completed" sits in the same
  // toolbar and would otherwise be picked up as a date field's neighbour.
  const FIELD_SEL =
    'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), select, textarea';

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const key = (s) => norm(s).toLowerCase().replace(/[:*]+$/, '');

  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // Infor's design system (Soho) hides the native <select> and paints a
  // div[role=combobox] on top of it. The hidden select is still the control —
  // it holds the options and the value the mashup reads on Search — so
  // measuring it on screen is the wrong test. Requiring visibility is what
  // made Work Center resolve to the decorative div, which has no value at all.
  function reachable(el) {
    if (!el) return false;
    // Any <select>, even one momentarily without options: Angular empties and
    // refills the Work Center list as Facility changes, and rejecting it mid
    // rebuild handed the criterion to the decorative div painted over it.
    if (el.tagName === 'SELECT') return true;
    return visible(el);
  }

  // Only these three can be written to. Anything else that reaches a write is
  // a resolution mistake, and must be reported as one rather than throwing:
  // the native value setter rejects a foreign element, and that exception took
  // down the whole run right after Facility.
  const writable = (el) =>
    Boolean(el) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);

  // Every element whose own text is exactly one of `names`. Exact match, not
  // "contains": "From Start Date" would otherwise also match a container that
  // holds both date labels.
  function labelElements(names) {
    const wanted = names.map(key);
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (wanted.includes(key(node.nodeValue)) && node.parentElement) {
        out.push(node.parentElement);
      }
    }
    return out.filter(visible);
  }

  // A control that is not a plain <input>/<select>. Work Center is one of
  // these on the real screen, which is why "the next field after the label"
  // walked straight past it and landed on From Start Date's input — two
  // criteria pointing at one element, and Work Center never written.
  const COMBO_SEL =
    '[role=combobox], [role=listbox], [aria-haspopup=listbox], [aria-haspopup=true], [class*=combo i], [class*=dropdown i], [class*=lookup i], [class*=select i]';

  // The grid carries a filter input per column, and the last criterion's search
  // region would otherwise run right into them.
  const GRID_SEL = 'table, [role=grid], [role=treegrid]';

  // The screen keeps other datagrids around, hidden — a PMS060 lookup among
  // them, complete with its own pager. Anything inside one of these is not the
  // report on screen, whatever its markup says.
  const HIDDEN_SEL = '.hidden, [hidden], [aria-hidden=true]';
  const inHidden = (el) => Boolean(el?.closest?.(HIDDEN_SEL));

  const precedes = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  // querySelectorAll stops at a shadow boundary, and Infor's controls are
  // wrappers: the Work Center list came back as an empty <div> because the
  // real <select> — the one holding COATER, COMBINE, FLOAT… — sits inside it.
  function deepQueryAll(root, sel, depth = 0) {
    const out = Array.from(root.querySelectorAll(sel));
    if (depth > 4) return out;
    // The root's own shadow root first: when drilling into a wrapper, that is
    // exactly where the control hides, and querySelectorAll never reaches it.
    if (root.shadowRoot) out.push(...deepQueryAll(root.shadowRoot, sel, depth + 1));
    for (const node of root.querySelectorAll('*')) {
      if (node.shadowRoot) out.push(...deepQueryAll(node.shadowRoot, sel, depth + 1));
    }
    return out;
  }

  // A container is never the thing to write into. Given one, return the actual
  // form control it wraps; given a control already, return it unchanged.
  function drill(el) {
    if (!el || el.matches(FIELD_SEL)) return el;
    return deepQueryAll(el, FIELD_SEL).find(reachable) ?? el;
  }

  // Each criterion's control lives between its own label and the next one.
  // Bounding the search that way is what keeps a missing control *missing*
  // rather than silently borrowing its neighbour's.
  function labelsInOrder() {
    const found = [];
    for (const name of Object.keys(LABELS)) {
      const el = labelElements(LABELS[name])[0];
      if (el) found.push({ name, el });
    }
    return found.sort((a, b) => (precedes(a.el, b.el) ? -1 : 1));
  }

  function inRegion(el, label, nextLabel) {
    // An ancestor of a label technically starts before it, so a container
    // wrapping the *next* criterion would otherwise count as inside this one —
    // and drilling into it would hand back the neighbour's control.
    if (el.contains(label)) return false;
    if (!precedes(label, el)) return false;
    if (!nextLabel) return true;
    if (el.contains(nextLabel)) return false;
    return precedes(el, nextLabel);
  }

  function overrideField(css) {
    const el = css ? document.querySelector(css) : null;
    return reachable(el) ? el : null;
  }

  // Resolves all four criteria at once. One element can only ever be claimed by
  // one criterion: the collision above was invisible precisely because each
  // field was resolved on its own.
  function resolveFields(selectors = {}) {
    const found = { facility: null, workCenter: null, dateFrom: null, dateTo: null };
    const regions = {};
    const claimed = new Set();

    const claim = (name, el) => {
      found[name] = el;
      if (el) claimed.add(el);
    };

    for (const name of Object.keys(found)) {
      if (selectors[name]) claim(name, overrideField(selectors[name]));
    }

    const ordered = labelsInOrder();
    ordered.forEach(({ name, el: label }, i) => {
      // Recorded even when an override already claimed the field, so a bad
      // manual selector can still be diagnosed against its own region.
      regions[name] = label;
      if (found[name]) return;
      const next = ordered[i + 1]?.el ?? null;

      const usable = (el) => reachable(el) && !claimed.has(el) && !el.closest?.(GRID_SEL);

      // `for` is trusted only when it points inside this criterion's own
      // region: on this screen both date labels carry for="endDate", so an
      // unchecked lookup would hand both dates the same element.
      if (label.htmlFor) {
        const byFor = document.getElementById(label.htmlFor);
        if (byFor && usable(byFor) && inRegion(byFor, label, next)) {
          return claim(name, drill(byFor));
        }
      }

      // Everything sitting in this criterion's own region, in document order.
      // Membership is tested on nodes of the main tree only: an element inside
      // a shadow root has no comparable position, so it is reached by drilling
      // into its host instead.
      const local = [];
      for (const el of document.querySelectorAll('*')) {
        if (usable(el) && inRegion(el, label, next)) local.push(el);
      }

      // A real control if there is one; failing that, a wrapper drilled down to
      // the control it hides; failing that, a combobox that genuinely is a div.
      const direct = local.find((el) => el.matches(FIELD_SEL));
      const wrapped = direct ? null : local.map(drill).find((el) => el?.matches(FIELD_SEL));
      const combo = direct || wrapped ? null : local.find((el) => el.matches(COMBO_SEL));
      claim(name, direct ?? wrapped ?? combo ?? null);
    });

    return { found, regions };
  }

  function findSearchButton(override) {
    if (override) {
      const el = document.querySelector(override);
      return reachable(el) ? el : null;
    }
    const wanted = SEARCH_LABELS.map(key);
    const matches = Array.from(
      document.querySelectorAll('button, input[type=button], input[type=submit], a, span, div'),
    ).filter((el) => {
      const text = el.tagName === 'INPUT' ? el.value : el.textContent;
      return wanted.includes(key(text)) && visible(el);
    });
    // A wrapper matches on its child's text too. The innermost element is the
    // one that actually carries the click handler.
    matches.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
    return matches[0] ?? null;
  }

  // Assigning `.value` moves the pixels but not the framework's state: Angular
  // and React both cache the last value they wrote and would discard ours on
  // the next render. Going through the prototype's native setter and then
  // firing the events they listen for is what makes the write stick.
  const isSelect = (el) => Boolean(el) && el.tagName === 'SELECT';

  function setValue(el, value) {
    if (!writable(el)) return false;
    const proto =
      el.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : isSelect(el)
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    el.focus();
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // Work Center is a dependent list: writing Facility makes the mashup refetch
  // it, and it sits empty for as long as that round trip takes. Writing into
  // the empty list is what cleared the field and made Search fail with
  // "Facility, Work Center and Start Dates must be entered".
  const OPTIONS_TIMEOUT_MS = 8000;

  function optionFor(el, value) {
    const target = key(value);
    return (
      Array.from(el.options).find(
        (o) => key(o.textContent) === target || key(o.value) === target,
      ) ?? null
    );
  }

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function waitFor(probe, timeout) {
    return new Promise((resolve) => {
      const deadline = Date.now() + timeout;
      const tick = () => {
        const hit = probe();
        if (hit) return resolve(hit);
        if (Date.now() > deadline) return resolve(null);
        setTimeout(tick, 150);
      };
      tick();
    });
  }

  // Takes a *getter*, not an element. Writing Facility makes Angular rebuild
  // the Work Center list, and a reference captured beforehand then points at a
  // detached node: the wait would sit out its full timeout watching an element
  // no longer in the page, fail, and leave the criterion unset. That is why a
  // first run stopped after Facility and a second one — with Facility already
  // right, so nothing rebuilt — went through.
  async function setSelect(getEl, value) {
    const hit = await waitFor(() => {
      const el = getEl();
      if (!isSelect(el)) return null;
      const option = optionFor(el, value);
      return option ? { el, option } : null;
    }, OPTIONS_TIMEOUT_MS);
    if (!hit) return false;
    setValue(hit.el, hit.option.value);
    return true;
  }

  // True when the field already holds the wanted value. Writing it again would
  // be a no-op at best and, for Facility, would needlessly reset every list
  // that depends on it.
  function holds(el, value) {
    if (isSelect(el)) {
      const selected = el.selectedOptions[0];
      return Boolean(selected) && (key(selected.textContent) === key(value) || key(selected.value) === key(value));
    }
    return key(el.value) === key(value);
  }

  function isEmpty(el) {
    return !String(el.value ?? '').trim();
  }

  function setText(el, value) {
    if (!setValue(el, value)) return false;
    // M3 inputs commit on blur or on Enter; a value left "being typed" is
    // ignored by the search that follows.
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    el.blur();
    return true;
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  // The mashup shows dates as YYYYMMDD (20260718), so that is what it is fed —
  // unless the control is a real <input type=date>, which only accepts ISO.
  function formatDate(date, el) {
    const ymd = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
    if (el && el.type === 'date') return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    return ymd;
  }

  function dateFromOffset(days) {
    const d = new Date();
    d.setDate(d.getDate() + Number(days || 0));
    return d;
  }

  function click(el) {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    }
    el.click();
  }

  // Returns null when this frame holds no search form — the portal shell and
  // the nav chrome both run this file, and neither should answer.
  const CRITERIA = ['facility', 'workCenter', 'dateFrom', 'dateTo'];
  const PARTS = [...CRITERIA, 'search'];

  function locate(selectors = {}) {
    const { found, regions } = resolveFields(selectors);
    found.search = findSearchButton(selectors.search);
    if (!PARTS.some((name) => found[name])) return null;
    return { found, regions };
  }

  function describe(found) {
    return {
      resolved: PARTS.filter((n) => found[n]),
      missing: PARTS.filter((n) => !found[n]),
    };
  }

  // Fills what it can and presses Search — but only once every criterion the
  // mashup requires actually holds a value. Clicking on a half-filled form was
  // the visible failure: the screen answered "Facility, Work Center and Start
  // Dates must be entered" and wiped the result grid.
  //
  // Order matters. Facility goes first because the lists below depend on it,
  // and each write is skipped when the field already holds the wanted value —
  // which is the common case, and the cheapest way to not disturb a form that
  // was already correct.
  async function runSearch(criteria = {}, selectors = {}) {
    if (!locate(selectors)) return null;

    // Resolved afresh on every read. Angular rebuilds the dependent controls
    // as Facility changes, so an element captured once goes stale mid-run.
    const fieldOf = (name) => locate(selectors)?.found[name] ?? null;

    const filled = [];
    const kept = [];
    const failed = [];

    const apply = async (name, value) => {
      if (value === '' || value == null) return;
      const el = fieldOf(name);
      if (!el) return;
      if (holds(el, value)) return kept.push(name);

      if (!writable(el)) return failed.push(name);
      const ok = isSelect(el)
        ? await setSelect(() => fieldOf(name), value)
        : setText(el, value);
      if (ok) filled.push(name);
      else failed.push(name);
    };

    const dateFor = (name, offset) => {
      const el = fieldOf(name);
      return el ? formatDate(dateFromOffset(offset), el) : null;
    };

    await apply('facility', criteria.facility);
    await apply('workCenter', criteria.workCenter);
    await apply('dateFrom', dateFor('dateFrom', criteria.fromOffset));
    await apply('dateTo', dateFor('dateTo', criteria.toOffset));

    // Last look at the real form rather than at what we believe we wrote: a
    // cascade can still have blanked a field after the fact.
    const found = locate(selectors)?.found ?? {};
    const empty = CRITERIA.filter((name) => found[name] && isEmpty(found[name]));

    const clicked = Boolean(found.search) && empty.length === 0;
    if (clicked) click(found.search);

    // Only worth doing once a search is on its way: before that there is no
    // grid, hence no pager to widen.
    const rows =
      clicked && criteria.maxRows !== false
        ? await maximiseRows(PAGER_TIMEOUT_MS, criteria.rowsPerPage)
        : null;

    return { ...describe(found), filled, kept, failed, empty, clicked, rows, url: location.href };
  }

  // The pager sits under the grid and defaults to 5 rows. Since the report is
  // read from what the grid has actually rendered, that default is not a
  // display preference — it decides how much of the report gets imported at
  // all. Raising it to the largest offering is the cheapest way to widen that.
  const PAGER_RE = /records?\s+per\s+page/i;

  // At least two options: a page-size menu offers a choice by definition. The
  // pager area also holds single-option selects — a page number, a bound value
  // — and writing 50 into one of those reports success while the grid stays on
  // 5 rows, which is exactly what happened.
  const numericOptions = (el) =>
    el.options.length >= 2 &&
    Array.from(el.options).every((o) => /^\d+$/.test(norm(o.value || o.textContent)));

  // The pager is Soho too: the native <select> is hidden and "5 Records per
  // page" is painted in a sibling subtree, not inside the select's own
  // container. Matching on the container's text therefore found nothing.
  // Starting from the text and climbing to the nearest numeric select is what
  // actually crosses that gap.
  function pagerSelect() {
    // Only pagers the operator can actually see. The hidden PMS060 lookup grid
    // carries the same wording, and writing 50 into its page-size select was
    // reported as a success while the visible grid stayed on 5 rows.
    const anchors = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el || !PAGER_RE.test(node.nodeValue ?? '')) continue;
      if (!visible(el) || inHidden(el)) continue;
      anchors.push(el);
    }

    // Several numeric selects can sit around the pager — one of them holding
    // nothing but the current value. The page-size list is the richest of
    // them, so candidates are collected and compared rather than taking the
    // first that matches.
    // Climb one level at a time and stop at the first that yields anything.
    // Going all the way up reaches the datagrid container, whose column filters
    // include numeric selects — 50 was landing in one of those.
    for (const anchor of anchors) {
      for (let node = anchor, depth = 0; node && depth < 6; node = node.parentElement, depth++) {
        const here = deepQueryAll(node, 'select').filter((el) => numericOptions(el) && !inHidden(el));
        if (here.length) return here.sort((a, b) => b.options.length - a.options.length)[0];
      }
    }

    // Some builds label the control only for screen readers.
    return (
      Array.from(document.querySelectorAll('select')).find(
        (el) =>
          PAGER_RE.test(el.getAttribute('aria-label') ?? '') && numericOptions(el) && !inHidden(el),
      ) ?? null
    );
  }

  function largestOption(el) {
    const numeric = Array.from(el.options)
      .map((o) => ({ o, n: Number(norm(o.value || o.textContent)) }))
      .filter(({ n }) => Number.isFinite(n) && n > 0);
    numeric.sort((a, b) => b.n - a.n);
    return numeric[0] ?? null;
  }

  // Runs after the search, once the grid — and with it the pager — exists.
  // The wait is longer than the one on the criteria: the pager is only drawn
  // when the rows come back from the server, well after the click.
  const PAGER_TIMEOUT_MS = 20000;

  // The menu only lists what Infor chose to list. Nothing stops a larger value
  // being put in the select: the grid asks the server for that page size, and
  // the list is a convenience, not a constraint. Soho may repaint over it, so
  // the write is read back and reported honestly rather than assumed.
  function forceOption(el, want) {
    const existing = optionFor(el, String(want));
    if (existing) return { option: existing, injected: false };
    const option = document.createElement('option');
    option.value = String(want);
    option.textContent = String(want);
    el.appendChild(option);
    return { option, injected: true };
  }

  // The pager's own markup, for the cases where the right control could not be
  // identified. Cheaper than another round of guessing.
  function pagerMarkup() {
    const anchor = Array.from(document.querySelectorAll('*')).find(
      (node) =>
        node.children.length === 0 &&
        PAGER_RE.test(node.textContent ?? '') &&
        visible(node) &&
        !inHidden(node),
    );
    if (!anchor) return null;
    let around = anchor.closest('div') ?? anchor.parentElement;
    if (around && !around.querySelector('select, button') && around.parentElement) {
      around = around.parentElement;
    }
    const html = around?.outerHTML ?? '';
    if (html.length <= 2400) return html;

    // A datagrid container runs to tens of thousands of characters and its
    // pager sits at the very end, so slicing from the start returned the table
    // header three times over. Cut a window around the wording instead.
    const at = html.search(PAGER_RE);
    if (at < 0) return html.slice(0, 2400);
    return `…${html.slice(Math.max(0, at - 1200), at + 1200)}…`;
  }

  // Soho's page-size control is not always a <select>. On the PMS230 grid it is
  // a button that opens a popupmenu of <li> items — nothing to assign to, so it
  // has to be driven the way an operator would: open it, click the entry.
  const MENU_SEL = 'ul.popupmenu, [role=menu], [role=listbox]';

  function pagerTrigger() {
    return (
      Array.from(document.querySelectorAll('button, a, [role=button], [class*=pagesize i]')).find(
        (el) => visible(el) && !inHidden(el) && PAGER_RE.test(el.textContent ?? ''),
      ) ?? null
    );
  }

  // The innermost clickable only. Listing `li` alongside `li a` returns each
  // entry twice, and clicking the outer `li` never reaches the handler bound to
  // the anchor inside it — the menu closes with nothing chosen.
  function menuItems(menu) {
    const pick = (sel) =>
      Array.from(menu.querySelectorAll(sel))
        .map((el) => ({ el, n: Number(norm(el.textContent)) }))
        .filter(({ el, n }) => Number.isFinite(n) && n > 0 && visible(el));

    const inner = pick('li a, li button, [role=menuitem] a, [role=option] a');
    return inner.length ? inner : pick('li, [role=menuitem], [role=option]');
  }

  async function setRowsViaMenu(target) {
    const trigger = pagerTrigger();
    if (!trigger) return null;

    click(trigger);
    const menu = await waitFor(
      () =>
        Array.from(document.querySelectorAll(MENU_SEL)).find(
          (m) => visible(m) && !inHidden(m) && menuItems(m).length >= 2,
        ),
      4000,
    );
    // Null, not a verdict: the caller must be free to fall through to a native
    // select on screens that use one.
    if (!menu) return null;

    const items = menuItems(menu);
    const options = items.map(({ n }) => String(n));
    const wanted = Number(target) > 0 ? Number(target) : Math.max(...items.map(({ n }) => n));
    // A value the menu does not list cannot be clicked into existence; the
    // largest entry is the honest best effort, and the page walk covers the rest.
    const pick =
      items.find(({ n }) => n === wanted) ??
      items.reduce((a, b) => (b.n > a.n ? b : a));

    click(pick.el);
    await delay(800);
    return {
      changed: true,
      rows: pick.n,
      wanted,
      via: 'menu',
      options,
      reason: pick.n === wanted ? undefined : 'capped',
    };
  }

  async function maximiseRows(timeout = PAGER_TIMEOUT_MS, target = 0) {
    // Wait for the pager to be drawn at all, then prefer the popupmenu: on this
    // grid it *is* the page-size control, and going for a select first is how
    // 50 kept landing in an unrelated one.
    await waitFor(() => pagerTrigger() ?? pagerSelect(), timeout);

    const viaMenu = await setRowsViaMenu(target);
    if (viaMenu) return viaMenu;

    const el = pagerSelect();
    if (!el) return { changed: false, reason: 'no_pager', markup: pagerMarkup() };
    // Reported whatever happens: when the largest offering turns out to be the
    // 5 the grid already showed, the only useful question is what the control
    // actually contained.
    const seen = {
      id: el.id || null,
      cls: norm(typeof el.className === 'string' ? el.className : '').slice(0, 60) || null,
      options: Array.from(el.options).map((o) => norm(o.value || o.textContent)).slice(0, 20),
    };

    const best = largestOption(el);
    const wanted = Number(target) > 0 ? Number(target) : best?.n ?? 0;
    if (!wanted) return { changed: false, reason: 'no_option', ...seen };

    if (holds(el, String(wanted))) {
      return { changed: false, rows: wanted, reason: 'already', ...seen };
    }

    const { option, injected } = forceOption(el, wanted);
    setValue(el, option.value);

    // Read back after a beat: an injected value is exactly the kind of thing a
    // component library discards on its next render, and claiming success
    // without checking would hide a silently truncated import.
    await delay(800);
    const now = pagerSelect() ?? el;
    const applied = Number(norm(now.value)) || 0;

    return {
      changed: applied === wanted,
      rows: applied,
      wanted,
      injected,
      reason: applied === wanted ? undefined : 'rejected',
      // Having to inject a value the menu should already offer means this is
      // probably not the page-size control at all — the screen lists 5 to 50.
      // The markup settles it instead of another blind attempt.
      markup: injected ? pagerMarkup() : null,
      ...seen,
    };
  }

  // Paging beats the page-size menu: the largest offering is whatever Infor
  // chose to list, while walking the pages has no ceiling at all. The server
  // side already expects this — every import adds to the report and a row seen
  // twice is updated, not duplicated (key `schedule|MO`), so overlapping pages
  // are harmless.
  // Soho draws the pager buttons as an icon plus a screen-reader label, so
  // neither the class nor aria-label necessarily carries "next". The accessible
  // name, the title, and the icon reference all have to be considered — and
  // "last page" must not be mistaken for it.
  const NEXT_RE = /\b(next|suivant|suivante)\b/i;
  const LAST_RE = /\b(last|dernier|dernière|first|previous|précédent)\b/i;

  function looksLikeNext(el) {
    const label = `${el.getAttribute?.('aria-label') ?? ''} ${el.getAttribute?.('title') ?? ''} ${norm(el.textContent)}`;
    if (LAST_RE.test(label)) return false;
    if (NEXT_RE.test(label)) return true;
    if (NEXT_RE.test(el.className ?? '') && !LAST_RE.test(el.className ?? '')) return true;
    const icon = el.querySelector?.('use')?.getAttribute('href') ?? '';
    return NEXT_RE.test(icon);
  }

  const NEXT_SEL = 'button, a, [role=button], li';

  function disabled(el) {
    return (
      el.disabled === true ||
      el.getAttribute('aria-disabled') === 'true' ||
      el.classList.contains('is-disabled') ||
      el.classList.contains('disabled') ||
      Boolean(el.closest('[disabled], [aria-disabled=true], .is-disabled, .disabled'))
    );
  }

  function nextPageButton() {
    const hits = [];
    for (const el of document.querySelectorAll(NEXT_SEL)) {
      if (!visible(el) || disabled(el) || inHidden(el)) continue;
      // "Records per page" also lives in the pager; a control that opens a
      // list is not the one that advances.
      if (PAGER_RE.test(el.textContent ?? '')) continue;
      if (looksLikeNext(el)) hits.push(el);
    }
    // Innermost wins: an <li> and the <a> inside it both match, and clicking
    // the wrapper never reaches the handler bound to the anchor.
    hits.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
    return hits[0] ?? null;
  }

  // Returns false when there is no next page to go to — the caller uses that
  // to stop, alongside its own check that the content actually changed.
  function nextPage() {
    const btn = nextPageButton();
    if (!btn) return false;
    click(btn);
    return true;
  }

  // Dry run for the options page: reports what the resolver sees without
  // touching a single field, so a broken selector map is diagnosed before it
  // fires a search with wrong criteria.
  function inspect(selectors = {}) {
    const located = locate(selectors);
    if (!located) return null;
    const { found, regions } = located;

    const preview = {};
    for (const name of PARTS) {
      const el = found[name];
      if (!el) continue;
      preview[name] = {
        tag: el.tagName.toLowerCase(),
        type: el.type || null,
        role: el.getAttribute?.('role') || null,
        id: el.id || null,
        cls: norm(typeof el.className === 'string' ? el.className : '').slice(0, 60) || null,
        value: el.value ?? norm(el.textContent).slice(0, 40),
      };
    }

    // Markup goes back for a criterion that is missing, or resolved onto
    // something that is not a form control at all — the case that hid the Work
    // Center failure, where a decorative div reported itself as recognised.
    //
    // An empty *control* is not suspicious: a Soho select starts with nothing
    // selected and a datepicker starts blank. Flagging those too buried the
    // real signal under the markup of three healthy fields.
    const markup = {};
    for (const name of CRITERIA) {
      const el = found[name];
      if (el && el.matches(FIELD_SEL)) continue;
      const label = regions[name];
      if (!label) continue;
      const around = label.parentElement?.parentElement ?? label.parentElement ?? label;
      markup[name] = around.outerHTML.slice(0, 2000);
    }

    return { ...describe(found), preview, markup, url: location.href };
  }

  // runSearch is async, but the "only the frame holding the form answers" rule
  // needs a synchronous verdict: a listener must decide whether to keep the
  // message channel open before it can await anything.
  const present = (selectors = {}) => locate(selectors) !== null;


  globalThis.wbMashup = { runSearch, inspect, present, maximiseRows, nextPage, nextPageButton };
})();
