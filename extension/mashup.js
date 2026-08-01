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

  // The mashup lays each criterion out as label-then-input, so the first field
  // *following* the label in document order is the right one. Climbing one
  // ancestor at a time keeps the search local before it widens to the toolbar.
  function fieldFor(labelEl) {
    if (labelEl.htmlFor) {
      const byFor = document.getElementById(labelEl.htmlFor);
      if (visible(byFor)) return byFor;
    }
    for (let node = labelEl, depth = 0; node && depth < 5; node = node.parentElement, depth++) {
      const candidates = Array.from(node.querySelectorAll(FIELD_SEL)).filter(visible);
      const following = candidates.filter(
        (el) => labelEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
      if (following.length) return following[0];
    }
    return null;
  }

  function findField(name, override) {
    if (override) {
      const el = document.querySelector(override);
      return visible(el) ? el : null;
    }
    for (const labelEl of labelElements(LABELS[name])) {
      const field = fieldFor(labelEl);
      if (field) return field;
    }
    return null;
  }

  function findSearchButton(override) {
    if (override) {
      const el = document.querySelector(override);
      return visible(el) ? el : null;
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
  function setValue(el, value) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    el.focus();
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
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

  async function setSelect(el, value) {
    const option = await waitFor(() => optionFor(el, value), OPTIONS_TIMEOUT_MS);
    if (!option) return false;
    setValue(el, option.value);
    return true;
  }

  // True when the field already holds the wanted value. Writing it again would
  // be a no-op at best and, for Facility, would needlessly reset every list
  // that depends on it.
  function holds(el, value) {
    if (el instanceof HTMLSelectElement) {
      const selected = el.selectedOptions[0];
      return Boolean(selected) && (key(selected.textContent) === key(value) || key(selected.value) === key(value));
    }
    return key(el.value) === key(value);
  }

  function isEmpty(el) {
    return !String(el.value ?? '').trim();
  }

  async function setText(el, value) {
    if (el instanceof HTMLSelectElement) return setSelect(el, value);
    setValue(el, value);
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
  function locate(selectors = {}) {
    const found = {
      facility: findField('facility', selectors.facility),
      workCenter: findField('workCenter', selectors.workCenter),
      dateFrom: findField('dateFrom', selectors.dateFrom),
      dateTo: findField('dateTo', selectors.dateTo),
      search: findSearchButton(selectors.search),
    };
    const any = Object.values(found).some(Boolean);
    return any ? found : null;
  }

  function describe(found) {
    const names = Object.keys(found);
    return {
      resolved: names.filter((n) => found[n]),
      missing: names.filter((n) => !found[n]),
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
    const found = locate(selectors);
    if (!found) return null;

    const filled = [];
    const kept = [];
    const failed = [];

    const apply = async (name, value) => {
      const el = found[name];
      if (!el || value === '' || value == null) return;
      if (holds(el, value)) return kept.push(name);
      if (await setText(el, value)) filled.push(name);
      else failed.push(name);
    };

    await apply('facility', criteria.facility);
    await apply('workCenter', criteria.workCenter);
    await apply('dateFrom', found.dateFrom && formatDate(dateFromOffset(criteria.fromOffset), found.dateFrom));
    await apply('dateTo', found.dateTo && formatDate(dateFromOffset(criteria.toOffset), found.dateTo));

    // Last look at the real form rather than at what we believe we wrote: a
    // cascade can still have blanked a field after the fact.
    const empty = ['facility', 'workCenter', 'dateFrom', 'dateTo'].filter(
      (name) => found[name] && isEmpty(found[name]),
    );

    const clicked = Boolean(found.search) && empty.length === 0;
    if (clicked) click(found.search);

    return { ...describe(found), filled, kept, failed, empty, clicked, url: location.href };
  }

  // Dry run for the options page: reports what the resolver sees without
  // touching a single field, so a broken selector map is diagnosed before it
  // fires a search with wrong criteria.
  function inspect(selectors = {}) {
    const found = locate(selectors);
    if (!found) return null;
    const preview = {};
    for (const [name, el] of Object.entries(found)) {
      if (!el) continue;
      preview[name] = {
        tag: el.tagName.toLowerCase(),
        type: el.type || null,
        value: el.value ?? norm(el.textContent).slice(0, 40),
      };
    }
    return { ...describe(found), preview, url: location.href };
  }

  // runSearch is async, but the "only the frame holding the form answers" rule
  // needs a synchronous verdict: a listener must decide whether to keep the
  // message channel open before it can await anything.
  const present = (selectors = {}) => locate(selectors) !== null;

  globalThis.wbMashup = { runSearch, inspect, present };
})();
