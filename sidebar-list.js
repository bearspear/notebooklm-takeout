// List controller: the filter / sort / select toolbar shared by the side panel's
// result lists (see AGENT.md "Milestone 3b contracts"). Classic script; the pure
// logic lives in takeout-shared.js (NLME.listView and friends), this file is DOM only.

// Panel-session memory: stateKey -> saved shape { query, types, sort, selected: [keys], known: [keys] }.
// A redraw within the same panel session never waits on chrome.storage.
const _listStates = new Map();
let _lastListNotebookId = '';

const LIST_SAVE_DELAY_MS = 300;
const LIST_STATES_KEEP_NOTEBOOKS = 30;

// Saved list states of notebooks the user stopped using are removed, once per
// panel session: the most recent 30 notebooks stay (all tabs of one count
// once), and the notebook on screen always does. Nothing here may throw.
let _listStatesPruned = false;

async function pruneListStatesOnce(currentId) {
  if (_listStatesPruned) return;
  _listStatesPruned = true;
  try {
    const storage = chrome.storage.local;
    let keys;
    if (typeof storage.getKeys === 'function') {
      keys = await storage.getKeys();
    } else {
      keys = Object.keys((await storage.get(null)) || {});
    }
    keys = (keys || []).filter(k => typeof k === 'string' && k.startsWith('nlme.list.'));
    if (!keys.length) return;
    const stored = (await storage.get(keys)) || {};
    const meta = keys.map(key => ({ key, at: stored[key] && Number(stored[key].at) || 0 }));
    const doomed = NLME.pruneListStates(meta, { keep: LIST_STATES_KEEP_NOTEBOOKS, keepId: currentId });
    if (doomed.length) await storage.remove(doomed);
  } catch (_) { /* storage unavailable: old states stay */ }
}

function createListController({ tab, container, items, titleOf, typeOf, defaultSelected = 'none', rowHtml, onChange, canSelect }) {
  if (container._listController) container._listController.destroy();

  const esc = NLME.escapeHtml;
  const accessors = { titleOf, typeOf };
  const list = items || [];
  const keys = NLME.listItemKeys(list, accessors);
  const keyIndex = new Map(keys.map((k, i) => [k, i]));
  // Each item remembers its key in the whole list (non-enumerable, so copies never
  // carry it): a job record made from a selection or a retry then uses the same
  // keys a fresh scan gives, duplicates ("#2") included.
  list.forEach((item, i) => {
    try { Object.defineProperty(item, '_listKey', { value: keys[i], configurable: true, writable: true }); } catch (_) { /* frozen or primitive: the record computes its own */ }
  });
  const selectable = list.map(item => (canSelect ? !!canSelect(item) : true));
  const chipTypes = NLME.listView(list, {}, accessors).types; // the whole list, never filtered

  // Current state
  let query = '';
  let activeTypes = new Set();
  let sort = 'notebook';
  let selected = new Set();
  let order = list.map((_, i) => i); // visible indices in display order
  // The id is only trusted once the active tab has confirmed it; until then the previous
  // render's id is a guess used for the instant in-memory restore, and nothing is saved.
  const guessedId = _lastListNotebookId;
  let notebookId = '';
  let touched = false;   // the user has changed something: stored state must not overwrite it
  let destroyed = false;
  let saveTimer = null;
  let appliedKey = null; // state key already applied from memory or storage
  let guessApplied = false; // state from the guessed notebook is on screen

  const stateKey = () => NLME.listStateKey(notebookId, tab);
  const defaultKeys = () => keys.filter((_, i) => selectable[i] && defaultSelected === 'all');

  // ---- Markup ----

  const chipsHtml = chipTypes.length >= 2
    ? chipTypes.map((c, i) =>
        `<button type="button" class="chip" data-chip="${i}" aria-pressed="false">${esc(c.type)} (${c.count})</button>`).join('')
    : '';

  container.innerHTML = `
    <div class="list-toolbar">
      <input type="search" class="list-search" placeholder="Filter by title or type" aria-label="Filter by title or type" autocomplete="off">
      <div class="list-chips" role="group" aria-label="Filter by type"${chipsHtml ? '' : ' hidden'}>${chipsHtml}</div>
      <div class="list-controls">
        <label class="list-select-visible-label"><input type="checkbox" class="list-select-visible"> <span>Select all visible</span></label>
        <select class="list-sort" aria-label="Sort order">
          <option value="notebook">Notebook order</option>
          <option value="title">Title A–Z</option>
          <option value="type">Type</option>
        </select>
      </div>
      <div class="list-summary" aria-live="polite"></div>
    </div>
    <div class="list-rows">${list.map((item, i) => `
      <div class="list-row scan-item${selectable[i] ? '' : ' disabled'}" data-index="${i}">
        <input type="checkbox" class="row-check" aria-label="Select ${esc(titleOf(item))}"${selectable[i] ? '' : ' disabled'}>
        ${rowHtml(item, i)}
      </div>`).join('')}
    </div>
    <p class="empty-message list-empty" hidden>Nothing matches the filter.</p>`;

  const searchEl = container.querySelector('.list-search');
  const chipEls = Array.from(container.querySelectorAll('.chip'));
  const sortEl = container.querySelector('.list-sort');
  const allEl = container.querySelector('.list-select-visible');
  const summaryEl = container.querySelector('.list-summary');
  const rowsEl = container.querySelector('.list-rows');
  const emptyEl = container.querySelector('.list-empty');
  const rowEls = Array.from(rowsEl.querySelectorAll('.list-row'));
  // Drawn while a job runs (a scan inside the job redraws the list): start
  // inert like the controls runExclusive disabled; its finally re-enables
  // everything carrying the data-job-disabled mark.
  if (document.body.classList.contains('job-running')) {
    container.querySelectorAll('button, input, select').forEach(el => {
      if (!el.disabled) { el.disabled = true; el.setAttribute('data-job-disabled', ''); }
    });
  }
  // data-key is set through the DOM: keys contain a NUL, which the HTML parser would replace
  rowEls.forEach((row, i) => row.setAttribute('data-key', keys[i]));

  // ---- State ----

  function savedShape() {
    // known: every key at save time, so restoreListState can tell a new item from an unticked one
    // at: when it was saved, for pruneListStates
    return { query, types: [...activeTypes], sort, selected: [...selected], known: [...keys], at: Date.now() };
  }

  function persist() {
    if (!notebookId) return; // no notebook id: nothing is stored
    _listStates.set(stateKey(), savedShape());
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, LIST_SAVE_DELAY_MS);
  }

  function flushSave() {
    if (saveTimer === null) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      chrome.storage.local.set({ [stateKey()]: savedShape() }).catch(() => {});
    } catch (_) { /* storage unavailable */ }
  }

  function applyState(saved) {
    const s = NLME.restoreListState(saved, {
      keys,
      types: chipTypes.map(c => c.type),
      defaultSelected
    });
    query = s.query;
    activeTypes = new Set(s.types);
    sort = s.sort;
    selected = new Set([...s.selected].filter(k => selectable[keyIndex.get(k)]));
    searchEl.value = query;
    sortEl.value = sort;
    update(false);
  }

  function resetToDefaults() {
    query = '';
    activeTypes = new Set();
    sort = 'notebook';
    selected = new Set(defaultKeys());
    searchEl.value = '';
    sortEl.value = 'notebook';
    update(false);
  }

  // ---- Rendering ----

  // changed: a user-visible change that should notify the tab and be saved
  function update(changed) {
    const view = NLME.listView(list, { query, types: [...activeTypes], sort }, accessors);
    order = view.indices;
    const visibleKeys = order.map(i => keys[i]);
    selected = NLME.pruneSelection(selected, visibleKeys);

    // Reorder the row nodes to match, hidden rows after the visible ones
    const shown = new Set(order);
    // Move only the nodes that are out of place: re-inserting a focused row would blur it
    let cursor = rowsEl.firstElementChild;
    const place = row => {
      if (row === cursor) cursor = cursor.nextElementSibling;
      else rowsEl.insertBefore(row, cursor);
    };
    order.forEach(i => place(rowEls[i]));
    rowEls.forEach((row, i) => { if (!shown.has(i)) place(row); });
    rowEls.forEach((row, i) => {
      row.hidden = !shown.has(i);
      row.querySelector('.row-check').checked = selected.has(keys[i]);
    });
    emptyEl.hidden = order.length > 0 || list.length === 0;

    chipEls.forEach((el, i) => el.setAttribute('aria-pressed', String(activeTypes.has(chipTypes[i].type))));

    const selectableVisible = order.filter(i => selectable[i]).length;
    // Marked by a job (see above): stays disabled until the job ends, unless
    // nothing is selectable, which must outlast the job's blanket re-enable
    if (selectableVisible === 0) allEl.removeAttribute('data-job-disabled');
    allEl.disabled = selectableVisible === 0 || allEl.hasAttribute('data-job-disabled');
    allEl.checked = selectableVisible > 0 && selected.size === selectableVisible;
    allEl.indeterminate = selected.size > 0 && selected.size < selectableVisible;
    summaryEl.textContent = NLME.listSummary({ shown: order.length, total: list.length, selected: selected.size });

    if (changed) persist();
    if (onChange) onChange(controller);
  }

  // ---- Events (delegated on the container; removed in destroy) ----

  function userChange() {
    touched = true;
    update(true);
  }

  function setRowSelected(i, on) {
    if (!selectable[i]) return;
    if (on) selected.add(keys[i]); else selected.delete(keys[i]);
  }

  const onInput = e => {
    if (e.target === searchEl) { query = searchEl.value; userChange(); }
  };

  const onChangeEvent = e => {
    const t = e.target;
    if (t === sortEl) {
      sort = sortEl.value;
      userChange();
    } else if (t === allEl) {
      order.forEach(i => setRowSelected(i, allEl.checked));
      userChange();
    } else if (t.classList && t.classList.contains('row-check')) {
      setRowSelected(Number(t.closest('.list-row').dataset.index), t.checked);
      userChange();
    }
  };

  const onClick = e => {
    const chip = e.target.closest('.chip');
    if (chip && container.contains(chip)) {
      const type = chipTypes[Number(chip.dataset.chip)].type;
      if (activeTypes.has(type)) activeTypes.delete(type); else activeTypes.add(type);
      userChange();
      return;
    }
    // A click on a row anywhere but a button, the checkbox or other controls toggles its checkbox
    const row = e.target.closest('.list-row');
    if (!row || !container.contains(row) || e.target.closest('button, input, select, a, label')) return;
    const i = Number(row.dataset.index);
    if (!selectable[i]) return;
    setRowSelected(i, !selected.has(keys[i]));
    userChange();
  };

  container.addEventListener('input', onInput);
  container.addEventListener('change', onChangeEvent);
  container.addEventListener('click', onClick);

  const controller = {
    items: list,
    selectedItems() {
      return order.filter(i => selected.has(keys[i])).map(i => list[i]);
    },
    selectedCount() {
      return selected.size;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      flushSave();
      container.removeEventListener('input', onInput);
      container.removeEventListener('change', onChangeEvent);
      container.removeEventListener('click', onClick);
      if (container._listController === controller) container._listController = null;
    }
  };
  container._listController = controller;

  // ---- Initial state: memory first (instant), then storage once the notebook id is known ----

  const guessKey = NLME.listStateKey(guessedId, tab);
  const remembered = guessedId ? _listStates.get(guessKey) : null;
  if (remembered) {
    appliedKey = guessKey;
    guessApplied = true;
    applyState(remembered);
  } else {
    selected = new Set(defaultKeys());
    update(false);
  }

  (async () => {
    let id = '';
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      id = NLME.notebookIdFromUrl(activeTab && activeTab.url);
    } catch (_) { /* no active tab */ }
    if (destroyed) return;
    notebookId = id;
    _lastListNotebookId = id;
    if (id) pruneListStatesOnce(id); // not awaited: the restore below never waits on it
    if (!id) {
      if (guessApplied && !touched) resetToDefaults();
      return;
    }
    if (touched) { persist(); return; }
    if (appliedKey === stateKey()) { guessApplied = false; return; }
    appliedKey = stateKey();
    let saved = _listStates.get(stateKey());
    if (!saved) {
      try {
        const res = await chrome.storage.local.get(stateKey());
        saved = res && res[stateKey()];
      } catch (_) { /* storage unavailable */ }
      if (destroyed || touched) return;
    }
    if (saved) {
      _listStates.set(stateKey(), saved); // a later redraw restores instantly instead of flashing the defaults
      applyState(saved);
    } else if (guessApplied) {
      resetToDefaults(); // the previous notebook's filter is on screen
    }
    guessApplied = false;
  })();

  return controller;
}
