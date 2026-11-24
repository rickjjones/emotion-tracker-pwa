// Categories map: category id -> list of emotion keys
const CATEGORIES = {
    high: {
        title: 'High Moods',
        keys: ['excitement','talkative','inflated_self_confidence','sleep_high']
    },
    low: {
        title: 'Low Moods',
        keys: ['energy','unmotivated','sleep_low','guilt','indecisive','crying']
    },
    adhd: {
        title: 'ADHD',
        keys: ['impulsive','absent_minded','time_management','interrupting','overwhelmed']
    }
};

// Flat list helper (note kept separate)
const EMOTIONS = Object.values(CATEGORIES).reduce((acc, c) => acc.concat(c.keys), []).concat(['note']);

const LABELS = {
    excitement: 'Excitement',
    talkative: 'Talkative',
    inflated_self_confidence: 'Inflated self confidence',
    sleep_high: 'Sleep (high)',
    energy: 'Energy',
    unmotivated: 'Unmotivated',
    sleep_low: 'Sleep (low)',
    guilt: 'Guilt',
    indecisive: 'Indecisive',
    crying: 'Crying',
    impulsive: 'Impulsive',
    absent_minded: 'Absent minded',
    time_management: 'Time management',
    interrupting: 'Interrupting',
    overwhelmed: 'Overwhelmed',
    note: 'Note'
};

// Default labels are kept separately so "Reset to defaults" can restore them.
const DEFAULT_LABELS = Object.assign({}, LABELS);

// Shown above the rating form so the 1-10 scale has fixed anchors
const SCALE_HINT = 'Rate each from 1 (not at all) to 10 (extremely). Skip any you don\'t want to rate, and tap a number again to clear it.';

// Wording for the Clear All confirmation: say how much will be lost and how to keep it.
function clearAllConfirmText(count) {
    const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
    if (n === 0) return 'There are no entries to delete.';
    const what = n === 1 ? 'your 1 entry' : `all ${n} entries`;
    return `Delete ${what}? This cannot be undone. Export your entries first if you want a backup.`;
}

// ----- Rating scale, draft autosave, post-save summary -----

// Build a 1-10 tap scale. The value lives in a hidden input with id `inputId`
// (and data-key), so code that reads inputs by id keeps working. Native radios
// give arrow-key navigation for free; tapping the selected number clears it.
function buildRatingScale(key, inputId, labelId, value) {
    const wrap = document.createElement('div');
    wrap.className = 'scale';
    wrap.setAttribute('role', 'radiogroup');
    wrap.setAttribute('aria-labelledby', labelId);
    wrap.setAttribute('aria-describedby', 'scale-hint');
    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.id = inputId;
    hidden.name = inputId;
    hidden.dataset.key = key;
    hidden.value = value === null || typeof value === 'undefined' ? '' : String(value);
    wrap.appendChild(hidden);
    for (let n = 1; n <= 10; n++) {
        const opt = document.createElement('label');
        opt.className = 'scale__opt';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'r_' + inputId;
        radio.value = String(n);
        radio.checked = hidden.value === String(n);
        radio.setAttribute('aria-label', String(n));
        radio.addEventListener('click', () => {
            if (hidden.value === radio.value) { radio.checked = false; hidden.value = ''; }
            else hidden.value = radio.value;
            hidden.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const face = document.createElement('span');
        face.textContent = String(n);
        face.setAttribute('aria-hidden', 'true');
        opt.appendChild(radio);
        opt.appendChild(face);
        wrap.appendChild(opt);
    }
    return wrap;
}

// Set a scale built by buildRatingScale to `value` (null clears it).
function setScaleValue(inputId, value) {
    const hidden = document.getElementById(inputId);
    if (!hidden) return;
    const v = value === null || typeof value === 'undefined' ? '' : String(value);
    hidden.value = v;
    document.querySelectorAll(`input[name="r_${inputId}"]`).forEach(r => { r.checked = r.value === v; });
}

const LS_DRAFT = 'll_draft_v1';
const DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000; // an older draft is probably stale

// True if a values object holds at least one rating or a note.
function hasDraftContent(values) {
    if (!values || typeof values !== 'object') return false;
    return Object.entries(values).some(([k, v]) => k === 'note'
        ? typeof v === 'string' && v.trim().length > 0
        : typeof v === 'number' && Number.isFinite(v));
}

// Keep unsaved form values so a reload or update doesn't lose them. Empty values remove the draft.
function saveDraft(values, now) {
    try {
        if (!hasDraftContent(values)) { localStorage.removeItem(LS_DRAFT); return false; }
        localStorage.setItem(LS_DRAFT, JSON.stringify({ savedAt: typeof now === 'number' ? now : Date.now(), values }));
        return true;
    } catch (e) { return false; }
}

// The saved draft's values, or null if none, unreadable, empty or older than DRAFT_MAX_AGE_MS.
function loadDraft(now) {
    try {
        const d = JSON.parse(localStorage.getItem(LS_DRAFT) || 'null');
        if (!d || typeof d.savedAt !== 'number' || !d.values || typeof d.values !== 'object') return null;
        const t = typeof now === 'number' ? now : Date.now();
        if (t - d.savedAt > DRAFT_MAX_AGE_MS || d.savedAt > t + 60000) return null;
        return hasDraftContent(d.values) ? d.values : null;
    } catch (e) { return null; }
}

function clearDraft() {
    try { localStorage.removeItem(LS_DRAFT); } catch (e) { /* ignore */ }
}

// e.g. "Saved 2 ratings and a note at 9:14 PM."
function savedSummaryText(values, ts) {
    const vals = values || {};
    const ratings = Object.entries(vals).filter(([k, v]) => k !== 'note' && typeof v === 'number' && Number.isFinite(v)).length;
    const hasNote = typeof vals.note === 'string' && vals.note.trim().length > 0;
    const parts = [];
    if (ratings) parts.push(ratings === 1 ? '1 rating' : `${ratings} ratings`);
    if (hasNote) parts.push('a note');
    const what = parts.length ? parts.join(' and ') : 'an empty entry';
    const time = new Date(typeof ts === 'number' ? ts : Date.now()).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `Saved ${what} at ${time}.`;
}

// Used by the update banner: don't auto-reload over a half-filled form.
function hasUnsavedInput() {
    const form = document.getElementById('emotion-form');
    if (!form || form.hidden) return false;
    return hasDraftContent(formToValues());
}

// localStorage key for tracked emotion keys
const LS_TRACKED = 'll_tracked_emotions_v1';
const LS_CATEGORIES = 'll_categories_v1';

function getDefaultTracked() {
    // default track all emotions except note (note always present)
    return getAllEmotionKeys().filter(k => k !== 'note');
}

function getTrackedKeys() {
    try {
        const raw = localStorage.getItem(LS_TRACKED);
        if (!raw) return getDefaultTracked();
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return getDefaultTracked();
        if (parsed.length === 0) return getDefaultTracked(); // avoid an empty saved set blocking the UI
        // ensure valid keys using effective categories (including edited ones)
        const allKeys = getAllEmotionKeys();
        const filtered = parsed.filter(k => allKeys.includes(k));
        return filtered.length ? filtered : getDefaultTracked();
    } catch (e) { return getDefaultTracked(); }
}

function hasSavedTracked() {
    try { return !!localStorage.getItem(LS_TRACKED); } catch (e) { return false; }
}

function setTrackedKeys(keys) {
    try { localStorage.setItem(LS_TRACKED, JSON.stringify(keys)); } catch (e) { /* ignore */ }
}

// --- Editable categories persistence ---
// Saved shape (v2):
//   { version: 2, categories: { <id>: { title, keys: [...] } }, labels: { <key>: <label> } }
// The saved categories are the complete list: defaults are NOT merged back in,
// so a category or emotion removed in the editor stays removed.
// Older saves (a bare { <id>: { title, keys } } object) are still read.
function normalizeCategoriesConfig(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const rawCats = (data.version === 2 && data.categories && typeof data.categories === 'object') ? data.categories : data;
    const rawLabels = (data.version === 2 && data.labels && typeof data.labels === 'object') ? data.labels : {};
    const categories = {};
    Object.keys(rawCats).forEach(id => {
        const c = rawCats[id];
        if (!c || typeof c !== 'object' || !Array.isArray(c.keys)) return;
        const keys = c.keys.filter(k => typeof k === 'string' && k && k !== 'note');
        categories[id] = { title: typeof c.title === 'string' && c.title ? c.title : id, keys: Array.from(new Set(keys)) };
    });
    if (!Object.keys(categories).length) return null;
    const labels = {};
    Object.keys(rawLabels).forEach(k => { if (typeof rawLabels[k] === 'string' && rawLabels[k].trim()) labels[k] = rawLabels[k].trim(); });
    return { version: 2, categories, labels };
}

function getSavedCategories() {
    try {
        const raw = localStorage.getItem(LS_CATEGORIES);
        if (!raw) return null;
        return normalizeCategoriesConfig(JSON.parse(raw));
    } catch (e) { return null; }
}

function setSavedCategories(obj) {
    const cfg = normalizeCategoriesConfig(obj);
    if (!cfg) return false;
    try { localStorage.setItem(LS_CATEGORIES, JSON.stringify(cfg)); } catch (e) { return false; }
    applyLabels();
    return true;
}

function resetSavedCategories() {
    try { localStorage.removeItem(LS_CATEGORIES); } catch (e) { /* ignore */ }
    applyLabels();
}

// Rebuild LABELS from the defaults plus any saved custom labels.
function applyLabels() {
    Object.keys(LABELS).forEach(k => { delete LABELS[k]; });
    Object.assign(LABELS, DEFAULT_LABELS);
    const saved = getSavedCategories();
    if (saved) Object.assign(LABELS, saved.labels);
}

function cloneCategories(cats) {
    const out = {};
    Object.entries(cats).forEach(([id, c]) => { out[id] = { title: c.title, keys: c.keys.slice() }; });
    return out;
}

// Return the active categories: the saved set if there is one, otherwise the defaults.
function loadEffectiveCategories() {
    const saved = getSavedCategories();
    return cloneCategories(saved ? saved.categories : CATEGORIES);
}

// Return flat list of emotion keys based on the effective categories (plus 'note')
function getAllEmotionKeys() {
    const cats = loadEffectiveCategories();
    return Object.values(cats).reduce((acc,c) => acc.concat(c.keys || []), []).concat(['note']);
}

applyLabels();

const DB_NAME = 'emotion-tracker-db';
const STORE_NAME = 'entries';
const DB_VERSION = 1;

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// `weather` is optional: { status: 'pending' } when weather recording is on.
async function addEntry(values, weather) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const record = { timestamp: Date.now(), values, exported: false };
        if (weather && typeof weather === 'object') record.weather = weather;
        const req = store.add(record);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function getAllEntries() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function clearAllEntries() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

// Turn one item from an imported JSON file into a record to store.
// Accepts full exported records ({ timestamp, values, exported }) or a bare values object.
function normalizeImportRecord(item) {
    const rec = {
        timestamp: item.timestamp || Date.now(),
        values: item.values || item,
        exported: item.exported || false
    };
    // keep weather from an earlier export
    if (item.values && item.weather && typeof item.weather === 'object' && !Array.isArray(item.weather)) rec.weather = item.weather;
    return rec;
}

async function importEntriesFromArray(arr) {
    if (!Array.isArray(arr)) throw new Error('Invalid import format');
    // validate everything before writing, so a bad item can't leave a partial import behind
    if (arr.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw new Error('Invalid import format');
    const records = arr.map(normalizeImportRecord);
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        records.forEach(record => store.add(record));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getEntry(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// Replace an existing record (must include its id)
async function updateEntry(record) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function deleteEntry(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// Return entries where exported !== true
async function getUnsyncedEntries() {
    const entries = await getAllEntries();
    return (entries || []).filter(e => !e.exported);
}

// Mark entries (by id array) as exported=true
async function markEntriesExported(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        ids.forEach(id => {
            const req = store.get(id);
            req.onsuccess = () => {
                const rec = req.result;
                if (rec) {
                    rec.exported = true;
                    store.put(rec);
                }
            };
        });
        tx.oncomplete = () => {
            try { localStorage.setItem('lastExportedIds', JSON.stringify(ids)); } catch(e) { /* ignore */ }
            resolve();
        };
        tx.onerror = () => reject(tx.error);
    });
}

// Utility: escape a CSV cell according to RFC4180
function csvEscape(cell) {
    if (cell === null || typeof cell === 'undefined') return '';
    const s = String(cell);
    if (/[\",\r\n]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

// Weather columns, added to CSV exports only when some entry has weather (always metric)
const CSV_WEATHER_COLUMNS = ['weather', 'temp_c', 'humidity_pct', 'pressure_hpa', 'precip_mm'];

// Build a CSV document (CRLF line endings) for the given entries and emotion columns
function buildCsv(entries, keys) {
    const withWeather = (entries || []).some(e => e && e.weather && e.weather.status === 'ok');
    const headers = ['timestamp', 'id', ...keys, ...(withWeather ? CSV_WEATHER_COLUMNS : [])];
    const rows = (entries || []).map(e => {
        const vals = e.values || {};
        const row = [new Date(e.timestamp).toISOString(), e.id || ''];
        keys.forEach(k => {
            const v = vals[k];
            row.push(v === null || typeof v === 'undefined' ? '' : v);
        });
        if (withWeather) {
            const w = e.weather && e.weather.status === 'ok' ? e.weather : null;
            if (!w) row.push('', '', '', '', '');
            else row.push(weatherCodeInfo(w.code).label, ...['temp', 'humidity', 'pressure', 'precip'].map(m => numOrNull(w[m]) === null ? '' : w[m]));
        }
        return row.map(csvEscape).join(',');
    });
    return [headers.map(csvEscape).join(','), ...rows].join('\r\n');
}

// Helper to get emotion keys for CSV (excluding 'note', then add 'note' at end)
function getEmotionCsvKeys() {
    // Return tracked emotion keys in category order, excluding 'note', then append 'note'
    const tracked = new Set(getTrackedKeys());
    const keys = [];
    const effective = loadEffectiveCategories();
    Object.values(effective).forEach(cat => {
        (cat.keys || []).forEach(k => { if (tracked.has(k)) keys.push(k); });
    });
    // ensure uniqueness and stable order
    const uniq = Array.from(new Set(keys));
    return [...uniq, 'note'];
}

// --- Categories editor UI ---
function slugify(str) {
    return String(str || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// One emotion in the Manage emotions dialog: show-on-form switch, label, optional key, remove.
function makeEmotionRow(key, label, visible) {
    const row = document.createElement('div');
    row.className = 'cat-edit__emotion';
    row.dataset.origKey = key || '';
    const show = document.createElement('input');
    show.type = 'checkbox';
    show.className = 'cat-edit__show';
    show.checked = visible !== false;
    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'cat-edit__label';
    labelInput.value = label || '';
    labelInput.placeholder = 'Emotion name';
    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.className = 'cat-edit__key';
    keyInput.value = key || '';
    keyInput.placeholder = 'key (auto)';
    keyInput.setAttribute('aria-label', 'Internal key');
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'icon-btn cat-edit__remove';
    rm.textContent = '✕';
    const name = () => labelInput.value.trim() || 'this emotion';
    const syncNames = () => {
        show.setAttribute('aria-label', `Show ${name()} on the form`);
        labelInput.setAttribute('aria-label', 'Emotion name');
        rm.setAttribute('aria-label', `Remove ${name()}`);
        rm.title = `Remove ${name()}`;
    };
    syncNames();
    labelInput.addEventListener('input', syncNames);
    rm.addEventListener('click', () => {
        const next = row.nextElementSibling || row.previousElementSibling;
        row.remove();
        const target = next && next.querySelector('.cat-edit__label');
        if (target) target.focus();
    });
    row.appendChild(show); row.appendChild(labelInput); row.appendChild(keyInput); row.appendChild(rm);
    return row;
}

// catId is the stable id of an existing category, or '' for a new one.
// catId is the stable id of an existing category, or '' for a new one.
function makeCategoryPanel(catId, cat, labels, tracked) {
    labels = labels || LABELS;
    const panel = document.createElement('fieldset');
    panel.className = 'cat-edit';
    panel.dataset.catId = catId || '';

    const titleRow = document.createElement('div');
    titleRow.className = 'cat-edit__head';
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'cat-edit__title';
    titleInput.value = cat ? (cat.title || catId) : '';
    titleInput.placeholder = 'Category name';
    titleInput.setAttribute('aria-label', 'Category name');
    titleRow.appendChild(titleInput);

    const removeCatBtn = document.createElement('button');
    removeCatBtn.textContent = 'Remove category';
    removeCatBtn.type = 'button';
    removeCatBtn.className = 'btn-small btn-danger';
    removeCatBtn.addEventListener('click', () => { panel.remove(); });
    titleRow.appendChild(removeCatBtn);
    panel.appendChild(titleRow);

    const keysContainer = document.createElement('div');
    keysContainer.className = 'cat-edit__emotions';
    ((cat && cat.keys) || []).forEach(k => keysContainer.appendChild(makeEmotionRow(k, labels[k] || k, !tracked || tracked.has(k))));
    panel.appendChild(keysContainer);

    const addKeyBtn = document.createElement('button');
    addKeyBtn.type = 'button';
    addKeyBtn.className = 'btn-small btn-secondary';
    addKeyBtn.textContent = '+ Add emotion';
    addKeyBtn.addEventListener('click', () => {
        const row = makeEmotionRow('', '', true);
        keysContainer.appendChild(row);
        row.querySelector('.cat-edit__label').focus();
    });
    panel.appendChild(addKeyBtn);
    return panel;
}

function renderCategoriesEditor(cats, labels, tracked) {
    const list = document.getElementById('categories-edit-list');
    if (!list) return;
    list.innerHTML = '';
    const shown = tracked || new Set(getTrackedKeys());
    Object.entries(cats || loadEffectiveCategories()).forEach(([catId, cat]) => {
        list.appendChild(makeCategoryPanel(catId, cat, labels, shown));
    });
}

function openCategoriesEditModal() {
    const modal = document.getElementById('categories-edit-modal');
    if (!modal) return;
    renderCategoriesEditor();
    openModal(modal);
}

function closeCategoriesEditModal() {
    closeModal(document.getElementById('categories-edit-modal'));
}

function uniqueCategoryId(base, taken) {
    let id = base || 'category';
    if (!taken.has(id)) return id;
    let n = 2;
    while (taken.has(id + '_' + n)) n++;
    return id + '_' + n;
}

// Turn the Manage emotions dialog's contents into a saved config.
// `panels` = [{ catId, title, rows: [{ key, origKey, label, visible }] }]. Pure, so it is unit tested.
// Returns { error } or { categories, labels, tracked, renamed }.
function buildEmotionConfig(panels, defaultLabels) {
    defaultLabels = defaultLabels || {};
    const categories = {};
    const labels = {};
    const tracked = [];
    const renamed = [];
    const list = Array.isArray(panels) ? panels : [];
    // existing categories keep their ids; reserve them before naming new ones
    const taken = new Set(list.map(p => p && p.catId).filter(Boolean));
    for (const panel of list) {
        if (!panel) continue;
        const title = String(panel.title || '').trim();
        const keys = [];
        (panel.rows || []).forEach(row => {
            const label = String(row.label || '').trim();
            const key = slugify(row.key) || slugify(label);
            if (!key) return;
            keys.push(key);
            if (row.visible !== false) tracked.push(key);
            if (row.origKey && row.origKey !== key) renamed.push(row.origKey);
            if (label && label !== defaultLabels[key]) labels[key] = label;
            else if (!label && !defaultLabels[key]) labels[key] = key;
        });
        if (!keys.length) continue; // empty categories are dropped
        let id = panel.catId;
        if (!id) { id = uniqueCategoryId(slugify(title), taken); taken.add(id); }
        categories[id] = { title: title || id, keys };
    }
    const allKeys = Object.values(categories).reduce((acc, c) => acc.concat(c.keys), []);
    if (!allKeys.length) return { error: 'Add at least one emotion' };
    if (allKeys.includes('note')) return { error: '"note" is reserved' };
    const dup = allKeys.filter((v, i, a) => a.indexOf(v) !== i);
    if (dup.length) return { error: 'Two emotions share the name or key: ' + Array.from(new Set(dup)).join(', ') };
    if (!tracked.length) return { error: 'Choose at least one emotion to show on the form' };
    return { categories, labels, tracked, renamed };
}

function readEmotionEditor() {
    const list = document.getElementById('categories-edit-list');
    if (!list) return [];
    return Array.from(list.querySelectorAll('.cat-edit')).map(panel => ({
        catId: panel.dataset.catId,
        title: panel.querySelector('.cat-edit__title').value,
        rows: Array.from(panel.querySelectorAll('.cat-edit__emotion')).map(row => ({
            key: row.querySelector('.cat-edit__key').value,
            origKey: row.dataset.origKey,
            label: row.querySelector('.cat-edit__label').value,
            visible: row.querySelector('.cat-edit__show').checked
        }))
    }));
}

function saveCategoriesEditModal() {
    const result = buildEmotionConfig(readEmotionEditor(), DEFAULT_LABELS);
    if (result.error) { flashMessage(result.error, true); return; }
    // past entries are stored by key, so changing a key detaches its history
    if (result.renamed.length) {
        if (!confirm('You changed the internal key of ' + result.renamed.join(', ') + '. Past entries recorded under the old key will not show under the new one. Continue?')) return;
    }
    if (!setSavedCategories({ version: 2, categories: result.categories, labels: result.labels })) { flashMessage('Could not save emotions', true); return; }
    setTrackedKeys(result.tracked);
    closeCategoriesEditModal();
    renderEmotionForm();
    flashMessage('Emotions saved');
}

function exportCategoriesConfig() {
    const cats = getSavedCategories() || { version: 2, categories: cloneCategories(CATEGORIES), labels: {} };
    const blob = new Blob([JSON.stringify(cats, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'categories-config.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

async function importCategoriesConfigFile(file) {
    try {
        const text = await file.text();
        const data = normalizeCategoriesConfig(JSON.parse(text));
        if (!data) { flashMessage('Invalid config file', true); return; }
        setSavedCategories(data);
        // imported emotions all start visible
        setTrackedKeys(getAllEmotionKeys().filter(k => k !== 'note'));
        renderCategoriesEditor();
        renderEmotionForm();
        flashMessage('Imported categories');
    } catch (e) { flashMessage('Import failed', true); }
}

// ----- Dialog helpers: focus moves in on open and returns to the opener on close -----
const modalOpeners = new Map();

function openModal(modal) {
    if (!modal) return;
    modalOpeners.set(modal.id, document.activeElement);
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    const first = modal.querySelector('.modal__panel input:not([type="hidden"]), .modal__panel button, .modal__panel select, .modal__panel textarea');
    if (first) first.focus();
}

function closeModal(modal) {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    const opener = modalOpeners.get(modal.id);
    modalOpeners.delete(modal.id);
    if (opener && typeof opener.focus === 'function' && document.body.contains(opener)) opener.focus();
}

// Escape closes the top dialog; Tab stays inside an open dialog.
document.addEventListener('keydown', (ev) => {
    const open = ['entry-edit-modal', 'export-modal', 'categories-edit-modal']
        .map(id => document.getElementById(id)).find(m => m && !m.hidden);
    if (!open) return;
    if (ev.key === 'Escape') {
        if (open.id === 'entry-edit-modal') closeEntryEditModal();
        else if (open.id === 'export-modal') closeModal(open);
        else closeCategoriesEditModal();
        return;
    }
    if (ev.key === 'Tab') {
        const items = Array.from(open.querySelectorAll('.modal__panel input:not([type="hidden"]), .modal__panel button, .modal__panel select, .modal__panel textarea, .modal__panel summary'))
            .filter(el => !el.disabled && el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    }
});

// Export unsynced entries to CSV and mark them as exported
// ----- Export -----

// 'all' = every entry; 'new' = entries not yet exported. Pure, so it is unit tested.
function selectEntriesForExport(entries, scope) {
    const list = Array.isArray(entries) ? entries : [];
    return scope === 'new' ? list.filter(e => e && !e.exported) : list.slice();
}

// e.g. lifelens-new-2026-11-23.csv
function exportFileName(format, scope, date) {
    const d = date instanceof Date && !isNaN(date) ? date : new Date();
    const ext = format === 'json' ? 'json' : 'csv';
    return `lifelens-${scope === 'new' ? 'new' : 'all'}-${dayKey(d.getTime())}.${ext}`;
}

function downloadText(name, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

// Download entries in the chosen format. Exporting only new entries marks them as exported.
async function runExport(format, scope) {
    const entries = selectEntriesForExport(await getAllEntries(), scope);
    if (!entries.length) {
        flashMessage(scope === 'new' ? 'No new entries since your last export' : 'No entries to export', true);
        return false;
    }
    const sorted = entries.slice().sort((a, b) => a.timestamp - b.timestamp);
    if (format === 'json') downloadText(exportFileName('json', scope), JSON.stringify(sorted, null, 2), 'application/json');
    else downloadText(exportFileName('csv', scope), buildCsv(sorted, getEmotionCsvKeys()), 'text/csv;charset=utf-8;');
    if (scope === 'new') {
        await markEntriesExported(sorted.map(e => e.id).filter(Boolean));
        await refreshViews();
    }
    flashMessage(`Exported ${sorted.length} ${sorted.length === 1 ? 'entry' : 'entries'}`);
    return true;
}

async function openExportModal() {
    const modal = document.getElementById('export-modal');
    if (!modal) return;
    const entries = await getAllEntries();
    document.getElementById('export-count-all').textContent = `(${entries.length})`;
    document.getElementById('export-count-new').textContent = `(${selectEntriesForExport(entries, 'new').length})`;
    openModal(modal);
}

function formToValues() {
    const values = {};
    // only include tracked emotions plus note
    const tracked = new Set(getTrackedKeys().concat(['note']));
    getAllEmotionKeys().forEach(key => {
        const el = document.getElementById(key);
        if (!el) { values[key] = null; return; }

        if (key === 'note') {
            const txt = (el.value || '').toString().trim();
            values[key] = txt.length ? txt : null;
            return;
        }

        if (!tracked.has(key)) { values[key] = null; return; }

        if (el && el.value) {
            const n = parseInt(el.value, 10);
            values[key] = Number.isFinite(n) ? Math.max(1, Math.min(10, n)) : null;
        } else {
            values[key] = null;
        }
    });
    return values;
}

// Ratings that were actually given, in category order. Pure, so it is unit tested.
function ratedPairs(values) {
    const vals = values || {};
    const order = getOrderedEmotionKeys([{ values: vals }]);
    return order.filter(k => typeof vals[k] === 'number' && Number.isFinite(vals[k])).map(k => [k, vals[k]]);
}

// "Today", "Yesterday", or e.g. "Mon, Nov 17" (with the year when it isn't this year).
function dayHeading(ts, now) {
    const n = new Date(typeof now === 'number' ? now : Date.now());
    const d = new Date(ts);
    const startOf = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((startOf(n) - startOf(d)) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    const opts = { weekday: 'short', month: 'short', day: 'numeric' };
    if (d.getFullYear() !== n.getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(undefined, opts);
}

// Newest first, grouped by local calendar day: [{ key, heading, entries }]
function groupEntriesByDay(entries, now) {
    const sorted = (Array.isArray(entries) ? entries : []).filter(e => e && Number.isFinite(e.timestamp))
        .sort((a, b) => b.timestamp - a.timestamp);
    const groups = [];
    sorted.forEach(e => {
        const key = dayKey(e.timestamp);
        let g = groups[groups.length - 1];
        if (!g || g.key !== key) { g = { key, heading: dayHeading(e.timestamp, now), entries: [] }; groups.push(g); }
        g.entries.push(e);
    });
    return groups;
}

const HISTORY_PAGE = 30;
let historyLimit = HISTORY_PAGE;

function renderEntriesList(entries) {
    const container = document.getElementById('emotion-display');
    if (!container) return;
    if (!entries || entries.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No entries yet.</p><button type="button" data-action="go-log">Log how you feel</button></div>';
        return;
    }
    const shown = entries.slice().sort((a, b) => b.timestamp - a.timestamp).slice(0, historyLimit);
    const wxUnits = getWeatherSettings().units;
    const html = groupEntriesByDay(shown).map(g => {
        const cards = g.entries.map(e => {
            const time = new Date(e.timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
            const pairs = ratedPairs(e.values);
            const chips = pairs.length
                ? `<ul class="chips">${pairs.map(([k, v]) => `<li class="chip">${escapeHtml(LABELS[k] || k)} <b>${escapeHtml(String(v))}</b></li>`).join('')}</ul>`
                : '<p class="entry__empty">No ratings</p>';
            const note = e.values && e.values.note ? String(e.values.note) : '';
            const long = note.length > 140 || note.split('\n').length > 3;
            const noteHtml = note
                ? `<div class="entry-note${long ? ' entry-note--clamped' : ''}"><p class="entry-note__text">${escapeHtml(note)}</p></div>${long ? `<button type="button" class="link-btn" data-action="toggle-note" aria-expanded="false">Show full note</button>` : ''}`
                : '';
            const exportedBadge = e.exported ? `<span class="badge-exported">Exported</span>` : '';
            const wxText = weatherSummaryText(e, wxUnits);
            const wxHtml = wxText ? `<p class="entry__weather${e.weather.status === 'pending' ? ' entry__weather--pending' : ''}">${escapeHtml(wxText)}</p>` : '';
            const actions = `<div class="entry__actions"><button type="button" class="btn-small btn-secondary" data-action="edit" data-id="${e.id}" aria-label="Edit entry from ${escapeHtml(g.heading)} ${escapeHtml(time)}">Edit</button><button type="button" class="btn-small btn-danger" data-action="delete" data-id="${e.id}" aria-label="Delete entry from ${escapeHtml(g.heading)} ${escapeHtml(time)}">Delete</button></div>`;
            return `<article class="entry"><div class="entry__meta"><span class="entry__time">${escapeHtml(time)}</span>${exportedBadge}</div>${chips}${wxHtml}${noteHtml}${actions}</article>`;
        }).join('');
        return `<section class="day"><h3 class="day__heading">${escapeHtml(g.heading)}</h3>${cards}</section>`;
    }).join('');
    const more = entries.length > historyLimit
        ? `<div class="history-more"><button type="button" class="btn-secondary" data-action="show-more">Show older entries (${entries.length - historyLimit} more)</button></div>`
        : '';
    container.innerHTML = html + more;
}

// --- Dynamic form rendering based on categories and tracked keys ---
function renderEmotionForm() {
    const form = document.getElementById('emotion-form');
    if (!form) return;
    form.innerHTML = '';

    const tracked = new Set(getTrackedKeys());

    // say what the numbers mean before the first rating
    const hint = document.createElement('p');
    hint.id = 'scale-hint';
    hint.className = 'scale-hint';
    hint.textContent = SCALE_HINT;
    form.appendChild(hint);

    const effective = loadEffectiveCategories();
    Object.entries(effective).forEach(([catId, cat]) => {
        // check if any key in this category is tracked
        const has = cat.keys.some(k => tracked.has(k));
        if (!has) return;
        const h = document.createElement('h2');
        h.className = `category category--${catId}`;
        h.textContent = cat.title;
        form.appendChild(h);

        cat.keys.forEach(k => {
            if (!tracked.has(k)) return;
            const row = document.createElement('div');
            row.className = 'emotion';
            row.classList.add('emotion--scale');
            // a radiogroup is named by aria-labelledby, so this is a plain text label
            const label = document.createElement('span');
            label.className = 'emotion__label';
            label.id = 'lbl_' + k;
            label.textContent = LABELS[k] || k;
            row.appendChild(label);
            row.appendChild(buildRatingScale(k, k, label.id, null));
            form.appendChild(row);
        });
    });

    // note row (always present)
    const noteRow = document.createElement('div');
    noteRow.className = 'emotion note-row';
    const noteLabel = document.createElement('label');
    noteLabel.setAttribute('for', 'note');
    noteLabel.textContent = LABELS.note || 'Note';
    const noteField = document.createElement('textarea');
    noteField.id = 'note';
    noteField.name = 'note';
    noteField.className = 'note-field';
    noteField.rows = 3;
    noteField.placeholder = 'Add a note...';
    noteRow.appendChild(noteLabel);
    noteRow.appendChild(noteField);
    form.appendChild(noteRow);

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = 'Save Emotions';
    form.appendChild(submit);

    // bring back anything typed before a reload, re-render or app update
    const draft = loadDraft();
    if (draft) {
        Object.entries(draft).forEach(([k, v]) => {
            if (k === 'note') noteField.value = v || '';
            else if (tracked.has(k)) setScaleValue(k, v);
        });
    }

    // wire submit handler (existing initUI also attaches to form submit)
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (s) {
        return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]);
    });
}

// After saving, swap the form for a one-line summary so the save is obvious
// and a second tap can't create a duplicate entry.
function showSavedSummary(id, values, ts) {
    const panel = document.getElementById('saved-summary');
    const form = document.getElementById('emotion-form');
    if (!panel || !form) { flashMessage('Saved'); return; }
    document.getElementById('saved-summary-text').textContent = savedSummaryText(values, ts);
    document.getElementById('saved-edit').dataset.id = String(id);
    form.hidden = true;
    panel.hidden = false;
    document.getElementById('saved-log-another').focus();
}

function hideSavedSummary(focusForm) {
    const panel = document.getElementById('saved-summary');
    const form = document.getElementById('emotion-form');
    if (panel) panel.hidden = true;
    if (form) {
        form.hidden = false;
        if (focusForm) {
            const first = form.querySelector('input[type="radio"], textarea');
            if (first) first.focus();
        }
    }
}

async function initUI() {
    const form = document.getElementById('emotion-form');
    // render form according to tracked emotions
    renderEmotionForm();
    if (form) {
        let saving = false;
        form.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            if (saving) return; // ignore a double tap while the first save runs
            const values = formToValues();
            if (!hasDraftContent(values)) { flashMessage('Rate at least one emotion or add a note', true); return; }
            saving = true;
            try {
                const wxOn = getWeatherSettings().enabled;
                const id = await addEntry(values, wxOn ? { status: 'pending' } : null);
                if (wxOn) captureWeatherForEntry(id); // runs in the background; the save doesn't wait
                clearDraft();
                // a "Restored your unsaved ratings" toast no longer applies
                document.querySelectorAll('#toast-region .toast').forEach(t => t.remove());
                renderEmotionForm(); // fresh, empty form for next time
                showSavedSummary(id, values, Date.now());
                await refreshViews();
            } catch (err) {
                console.error(err);
                flashMessage('Could not save. Your ratings are still here.', true);
            } finally {
                saving = false;
            }
        });
        // autosave a draft as the person rates or types
        const persist = () => saveDraft(formToValues());
        form.addEventListener('input', persist);
        form.addEventListener('change', persist);
        if (loadDraft()) flashMessage('Restored your unsaved ratings', false, {
            label: 'Discard',
            onClick: () => { clearDraft(); renderEmotionForm(); }
        });
    }

    const logAnother = document.getElementById('saved-log-another');
    if (logAnother) logAnother.addEventListener('click', () => hideSavedSummary(true));
    const editSaved = document.getElementById('saved-edit');
    if (editSaved) editSaved.addEventListener('click', async () => {
        const rec = await getEntry(Number(editSaved.dataset.id));
        if (rec) openEntryEditModal(rec); else flashMessage('Entry not found', true);
    });

    // wire the Manage emotions dialog
    const editBtn = document.getElementById('manage-emotions');
    if (editBtn) editBtn.addEventListener('click', () => openCategoriesEditModal());
    const editSave = document.getElementById('categories-edit-save');
    if (editSave) editSave.addEventListener('click', () => saveCategoriesEditModal());
    const editCancel = document.getElementById('categories-edit-cancel');
    if (editCancel) editCancel.addEventListener('click', () => closeCategoriesEditModal());
    const editBackdrop = document.getElementById('categories-edit-backdrop');
    if (editBackdrop) editBackdrop.addEventListener('click', () => closeCategoriesEditModal());
    const addCat = document.getElementById('add-category');
    if (addCat) addCat.addEventListener('click', () => {
        const list = document.getElementById('categories-edit-list');
        if (!list) return;
        const panel = makeCategoryPanel('', null);
        list.appendChild(panel);
        panel.querySelector('.cat-edit__emotions').appendChild(makeEmotionRow('', '', true));
        panel.querySelector('.cat-edit__title').focus();
    });
    const resetBtn = document.getElementById('reset-categories');
    // Reset only refills the editor; nothing is stored until Save.
    if (resetBtn) resetBtn.addEventListener('click', () => { renderCategoriesEditor(cloneCategories(CATEGORIES), DEFAULT_LABELS, new Set(Object.values(CATEGORIES).reduce((a, c) => a.concat(c.keys), []))); flashMessage('Defaults restored. Press Save to keep them.'); });
    const showKeys = document.getElementById('show-keys');
    if (showKeys) showKeys.addEventListener('change', () => {
        const modal = document.getElementById('categories-edit-modal');
        if (modal) modal.classList.toggle('show-keys', showKeys.checked);
    });
    const exportBtn = document.getElementById('export-categories');
    if (exportBtn) exportBtn.addEventListener('click', () => exportCategoriesConfig());
    const importCatsBtn = document.getElementById('import-categories');
    const importCatsFile = document.getElementById('import-categories-file');
    if (importCatsBtn && importCatsFile) importCatsBtn.addEventListener('click', () => { importCatsFile.value=''; importCatsFile.click(); });
    if (importCatsFile) importCatsFile.addEventListener('change', async (ev) => { const file = ev.target.files && ev.target.files[0]; if (!file) return; await importCategoriesConfigFile(file); });

    // Export sheet
    const openExport = document.getElementById('open-export');
    if (openExport) openExport.addEventListener('click', () => openExportModal());
    const exportModal = document.getElementById('export-modal');
    const exportForm = document.getElementById('export-form');
    if (exportForm) exportForm.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const format = exportForm.querySelector('input[name="export-format"]:checked').value;
        const scope = exportForm.querySelector('input[name="export-scope"]:checked').value;
        if (await runExport(format, scope)) closeModal(exportModal);
    });
    const exportCancel = document.getElementById('export-cancel');
    if (exportCancel) exportCancel.addEventListener('click', () => closeModal(exportModal));
    const exportBackdrop = document.getElementById('export-backdrop');
    if (exportBackdrop) exportBackdrop.addEventListener('click', () => closeModal(exportModal));

    const importFile = document.getElementById('import-file');
    const importBtn = document.getElementById('import-json');
    if (importBtn && importFile) importBtn.addEventListener('click', () => { importFile.value = ''; importFile.click(); });

    if (importFile) {
        importFile.addEventListener('change', async (ev) => {
            const file = ev.target.files && ev.target.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                await importEntriesFromArray(data);
                await refreshViews();
                flashMessage('Imported');
            } catch (err) {
                flashMessage('Import failed', true);
                console.error(err);
            }
        });
    }

    const clearBtn = document.getElementById('clear-all');
    if (clearBtn) clearBtn.addEventListener('click', async () => {
        const count = (await getAllEntries()).length;
        if (count === 0) { flashMessage(clearAllConfirmText(0)); return; }
        if (!confirm(clearAllConfirmText(count))) return;
        await clearAllEntries();
        await refreshViews();
        flashMessage('Cleared');
    });

    const undoBtn = document.getElementById('undo-last-export');
    if (undoBtn) undoBtn.addEventListener('click', async () => {
        const raw = localStorage.getItem('lastExportedIds');
        if (!raw) { flashMessage('No export to undo', true); return; }
        let ids;
        try { ids = JSON.parse(raw); } catch (e) { flashMessage('Nothing to undo', true); return; }
        if (!Array.isArray(ids) || ids.length === 0) { flashMessage('Nothing to undo', true); return; }
        const db = await openDb();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        ids.forEach(id => {
            const req = store.get(id);
            req.onsuccess = () => {
                const rec = req.result;
                if (rec) { rec.exported = false; store.put(rec); }
            };
        });
        tx.oncomplete = async () => {
            localStorage.removeItem('lastExportedIds');
            await refreshViews();
            flashMessage(`Marked ${ids.length} ${ids.length === 1 ? 'entry' : 'entries'} as not exported`);
        };
        tx.onerror = () => flashMessage('Undo failed', true);
    });

    initEntryEditing();
    initWeather();
    initTrends();
    initViews();
}

// ----- Log / History / Settings views -----
const VIEWS = ['log', 'history', 'settings'];

// '#history' -> 'history'; anything unknown -> 'log'. Pure, so it is unit tested.
function parseViewHash(hash) {
    const v = String(hash || '').replace(/^#/, '').toLowerCase();
    return VIEWS.includes(v) ? v : 'log';
}

async function showView(view, focusTab) {
    VIEWS.forEach(v => {
        const panel = document.getElementById('view-' + v);
        const tab = document.getElementById('tab-' + v);
        const active = v === view;
        if (panel) panel.hidden = !active;
        if (tab) {
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
            tab.tabIndex = active ? 0 : -1;
            if (active && focusTab) tab.focus();
        }
    });
    if (view === 'history') {
        historyLimit = HISTORY_PAGE;
        await refreshViews();
    }
}

function initViews() {
    const tabs = VIEWS.map(v => document.getElementById('tab-' + v)).filter(Boolean);
    tabs.forEach((tab, i) => {
        tab.addEventListener('click', () => {
            const view = tab.dataset.view;
            if (location.hash !== '#' + view) location.hash = view; else showView(view);
        });
        // arrow keys move between tabs (ARIA tabs pattern)
        tab.addEventListener('keydown', (ev) => {
            let j = null;
            if (ev.key === 'ArrowRight') j = (i + 1) % tabs.length;
            else if (ev.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
            else if (ev.key === 'Home') j = 0;
            else if (ev.key === 'End') j = tabs.length - 1;
            if (j === null) return;
            ev.preventDefault();
            location.hash = tabs[j].dataset.view;
            tabs[j].focus();
        });
    });
    window.addEventListener('hashchange', () => showView(parseViewHash(location.hash)));
    showView(parseViewHash(location.hash));
}

// ----- Dark mode helpers -----
function applyTheme(isDark) {
    try {
        const html = document.documentElement;
        if (isDark) html.classList.add('dark'); else html.classList.remove('dark');
        // update meta theme-color so mobile UI (status bar) matches
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', isDark ? '#0b1220' : '#2e7d32');
        const btn = document.getElementById('theme-toggle');
        if (btn) {
            btn.textContent = isDark ? '☀️' : '🌙';
            const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';
            btn.setAttribute('aria-label', label);
            btn.title = label;
        }
    } catch (e) { console.error(e); }
}

function initTheme() {
    // order: explicit localStorage preference -> prefers-color-scheme -> default light
    const stored = localStorage.getItem('ll_theme'); // 'dark' | 'light' | null
    let isDark = false;
    if (stored === 'dark') isDark = true;
    else if (stored === 'light') isDark = false;
    else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) isDark = true;
    applyTheme(isDark);

    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
        toggle.addEventListener('click', () => {
            const currentlyDark = document.documentElement.classList.contains('dark');
            const next = !currentlyDark;
            applyTheme(next);
            try { localStorage.setItem('ll_theme', next ? 'dark' : 'light'); } catch (e) { /* ignore */ }
        });
    }
}

// initialize theme early
try { initTheme(); } catch (e) { /* ignore */ }

// Show a short message in the shared live region (announced by screen readers).
// `action` = { label, onClick } adds a button, e.g. Undo, and keeps the toast up longer.
function flashMessage(text, isError, action) {
    let region = document.getElementById('toast-region');
    if (!region) {
        region = document.createElement('div');
        region.id = 'toast-region';
        region.className = 'toast-region';
        region.setAttribute('role', 'status');
        region.setAttribute('aria-live', 'polite');
        document.body.appendChild(region);
    }
    const toast = document.createElement('div');
    toast.className = 'toast' + (isError ? ' toast--error' : '');
    const msg = document.createElement('span');
    msg.textContent = text;
    toast.appendChild(msg);
    let timer = null;
    if (action && action.label && typeof action.onClick === 'function') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toast__action';
        btn.textContent = action.label;
        btn.addEventListener('click', () => {
            clearTimeout(timer);
            toast.remove();
            action.onClick();
        });
        toast.appendChild(btn);
    }
    region.appendChild(toast);
    timer = setTimeout(() => toast.remove(), action ? 6000 : 2500);
}

// ----- Shared helpers for history / trends -----

// Re-render whichever data views are currently visible after a change
async function refreshViews() {
    const history = document.getElementById('view-history');
    if (history && history.hidden) return; // rendered when the History tab opens
    const entries = await getAllEntries();
    renderEntriesList(entries);
    renderTrends(entries);
}

// Emotion keys in category order, followed by any extra keys found in the given entries
function getOrderedEmotionKeys(entries) {
    const keys = [];
    Object.values(loadEffectiveCategories()).forEach(c => (c.keys || []).forEach(k => { if (!keys.includes(k)) keys.push(k); }));
    (entries || []).forEach(e => Object.keys(e.values || {}).forEach(k => {
        if (k !== 'note' && !keys.includes(k)) keys.push(k);
    }));
    return keys;
}

function pad2(n) { return String(n).padStart(2, '0'); }

// Value for <input type="datetime-local"> in local time
function toDateTimeLocal(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// Local calendar-day key, e.g. "2026-11-23"
function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// ----- Edit / delete single entries -----

let editingEntry = null;

function initEntryEditing() {
    const display = document.getElementById('emotion-display');
    if (display) display.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('button[data-action]');
        if (!btn) return;
        if (btn.dataset.action === 'show-more') {
            historyLimit += HISTORY_PAGE;
            renderEntriesList(await getAllEntries());
            return;
        }
        if (btn.dataset.action === 'toggle-note') {
            const note = btn.previousElementSibling;
            const open = note.classList.toggle('entry-note--clamped') === false;
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
            btn.textContent = open ? 'Show less' : 'Show full note';
            return;
        }
        if (btn.dataset.action === 'go-log') { location.hash = 'log'; return; }
        const id = Number(btn.dataset.id);
        if (btn.dataset.action === 'edit') {
            const rec = await getEntry(id);
            if (rec) openEntryEditModal(rec); else flashMessage('Entry not found', true);
        } else if (btn.dataset.action === 'delete') {
            // delete straight away and offer Undo, instead of asking first
            const rec = await getEntry(id);
            if (!rec) { flashMessage('Entry not found', true); return; }
            await deleteEntry(id);
            await refreshViews();
            flashMessage('Entry deleted', false, {
                label: 'Undo',
                onClick: async () => {
                    await updateEntry(rec); // put() with the same id brings it back unchanged
                    await refreshViews();
                    flashMessage('Entry restored');
                }
            });
        }
    });

    const form = document.getElementById('entry-edit-form');
    if (form) form.addEventListener('submit', (ev) => { ev.preventDefault(); saveEntryEditModal(); });
    const cancel = document.getElementById('entry-edit-cancel');
    if (cancel) cancel.addEventListener('click', () => closeEntryEditModal());
    const backdrop = document.getElementById('entry-edit-backdrop');
    if (backdrop) backdrop.addEventListener('click', () => closeEntryEditModal());
}

function openEntryEditModal(rec) {
    const modal = document.getElementById('entry-edit-modal');
    const fields = document.getElementById('entry-edit-fields');
    if (!modal || !fields) return;
    editingEntry = rec;
    const vals = rec.values || {};
    // show tracked emotions plus anything this entry already has a value for
    const tracked = new Set(getTrackedKeys());
    const keys = getOrderedEmotionKeys([rec]).filter(k => tracked.has(k) || (vals[k] !== null && typeof vals[k] !== 'undefined'));

    fields.innerHTML = '';
    keys.forEach(k => {
        const row = document.createElement('div');
        row.className = 'emotion';
        row.classList.add('emotion--scale');
        const label = document.createElement('span');
        label.className = 'emotion__label';
        label.id = 'lbl_edit_' + k;
        label.textContent = LABELS[k] || k;
        row.appendChild(label);
        row.appendChild(buildRatingScale(k, 'edit_' + k, label.id, vals[k]));
        fields.appendChild(row);
    });

    document.getElementById('entry-edit-time').value = toDateTimeLocal(rec.timestamp);
    document.getElementById('entry-edit-note').value = vals.note || '';
    openModal(modal);
    const first = fields.querySelector('input[type="radio"]:checked') || fields.querySelector('input[type="radio"]') || document.getElementById('entry-edit-time');
    if (first) first.focus();
}

function closeEntryEditModal() {
    const modal = document.getElementById('entry-edit-modal');
    if (!modal) return;
    closeModal(modal);
    editingEntry = null;
}

async function saveEntryEditModal() {
    if (!editingEntry) return;
    const rec = Object.assign({}, editingEntry, { values: Object.assign({}, editingEntry.values) });
    document.querySelectorAll('#entry-edit-fields input[data-key]').forEach(input => {
        const n = parseInt(input.value, 10);
        rec.values[input.dataset.key] = Number.isFinite(n) ? Math.max(1, Math.min(10, n)) : null;
    });
    const note = document.getElementById('entry-edit-note').value.trim();
    rec.values.note = note.length ? note : null;
    const timeVal = document.getElementById('entry-edit-time').value;
    const ts = timeVal ? new Date(timeVal).getTime() : NaN;
    // weather may have arrived while the dialog was open; take the stored copy
    const stored = await getEntry(rec.id);
    if (stored && stored.weather) rec.weather = stored.weather;
    if (Number.isFinite(ts)) {
        if (rec.weather) rec.weather = weatherAfterTimeEdit(rec.weather, rec.timestamp, ts);
        rec.timestamp = ts;
    }
    // an edited entry no longer matches what was exported, so include it in the next unsynced export
    rec.exported = false;
    await updateEntry(rec);
    closeEntryEditModal();
    await refreshViews();
    flashMessage('Entry updated');
    if (rec.weather && rec.weather.status === 'pending') backfillWeather();
}

// ----- Weather -----
// An entry can carry a `weather` object:
//   { status: 'pending' | 'ok' | 'unavailable', lat, lon, source: 'gps' | 'city',
//     temp, humidity, pressure, precip, code, attempts }
// Values are stored metric (°C, %, hPa at sea level, mm in that hour) and converted for display.
// Weather comes from Open-Meteo (open-meteo.com), which needs no key or account.
// An entry saved offline stays 'pending' and is filled in from hourly history once online.

const LS_WEATHER = 'll_weather_v1';
const WX_FIELDS = 'temperature_2m,relative_humidity_2m,pressure_msl,precipitation,weather_code';
const WX_CURRENT_WINDOW_MS = 30 * 60 * 1000;  // this close to now, use current conditions
const WX_FORECAST_MAX_AGE_DAYS = 85;          // older than this, use the historical archive
const WX_MAX_ATTEMPTS = 5;                    // then give up on that entry
const WX_MAX_REQUESTS_PER_RUN = 10;
const WX_METRICS = ['temp', 'pressure', 'humidity', 'precip'];
const WX_METRIC_LABELS = { temp: 'Temperature', pressure: 'Pressure', humidity: 'Humidity', precip: 'Rain' };

// 'us' (°F, in, inHg) where that is the local habit, otherwise 'metric'.
function defaultWeatherUnits(locale) {
    const loc = String(locale || (typeof navigator !== 'undefined' && navigator.language) || '');
    return /-(US|LR|MM)\b/i.test(loc) ? 'us' : 'metric';
}

function isValidCoord(lat, lon) {
    return typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon)
        && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

// Two decimals is about 1 km: plenty for weather, and the exact spot is never stored or sent.
function roundCoord(v) { return Math.round(v * 100) / 100 + 0; }

function getWeatherSettings() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(LS_WEATHER) || 'null'); } catch (e) { s = null; }
    if (!s || typeof s !== 'object') s = {};
    const c = s.city;
    const city = c && typeof c.name === 'string' && c.name.trim() && isValidCoord(c.lat, c.lon)
        ? { name: c.name.trim(), lat: roundCoord(c.lat), lon: roundCoord(c.lon) } : null;
    return {
        enabled: s.enabled === true,
        units: s.units === 'us' || s.units === 'metric' ? s.units : defaultWeatherUnits(),
        city,
        chart: s.chart === 'none' || WX_METRICS.includes(s.chart) ? s.chart : 'temp'
    };
}

function setWeatherSettings(patch) {
    const next = Object.assign(getWeatherSettings(), patch || {});
    try { localStorage.setItem(LS_WEATHER, JSON.stringify(next)); } catch (e) { return false; }
    return true;
}

// The phone's location, rounded, or null if it is unavailable, refused or too slow.
function getDeviceLocation(timeoutMs) {
    const wait = timeoutMs || 10000;
    return new Promise(resolve => {
        const geo = typeof navigator !== 'undefined' && navigator.geolocation;
        if (!geo) { resolve(null); return; }
        let done = false;
        const finish = v => { if (!done) { done = true; resolve(v); } };
        setTimeout(() => finish(null), wait + 1000); // some browsers never call back
        try {
            geo.getCurrentPosition(
                p => finish({ lat: p.coords.latitude, lon: p.coords.longitude }),
                () => finish(null),
                { enableHighAccuracy: false, timeout: wait, maximumAge: 30 * 60 * 1000 });
        } catch (e) { finish(null); }
    });
}

// Where to look up weather: the phone's location first, then the city typed in Settings.
// `getDevice` is injectable for tests. Returns { lat, lon, source } or null.
async function resolveWeatherLocation(settings, getDevice) {
    const s = settings || getWeatherSettings();
    let dev = null;
    try { dev = await (getDevice || getDeviceLocation)(); } catch (e) { dev = null; }
    if (dev && isValidCoord(dev.lat, dev.lon)) return { lat: roundCoord(dev.lat), lon: roundCoord(dev.lon), source: 'gps' };
    if (s.city) return { lat: s.city.lat, lon: s.city.lon, source: 'city' };
    return null;
}

function utcDay(ts) { return new Date(ts).toISOString().slice(0, 10); }

// The Open-Meteo request for weather at `ts`: { kind: 'current' | 'hourly', url, key }.
// Entries with the same `key` can share one response. null for a time in the future.
function buildWeatherRequest(lat, lon, ts, now) {
    const n = typeof now === 'number' ? now : Date.now();
    if (!isValidCoord(lat, lon) || !Number.isFinite(ts)) return null;
    if (ts > n + WX_CURRENT_WINDOW_MS) return null; // not happened yet
    const loc = `latitude=${lat}&longitude=${lon}`;
    if (Math.abs(n - ts) <= WX_CURRENT_WINDOW_MS) {
        const url = `https://api.open-meteo.com/v1/forecast?${loc}&current=${WX_FIELDS}&timezone=GMT`;
        return { kind: 'current', url, key: url };
    }
    const host = (n - ts) / 86400000 > WX_FORECAST_MAX_AGE_DAYS
        ? 'https://archive-api.open-meteo.com/v1/archive'
        : 'https://api.open-meteo.com/v1/forecast';
    // a day either side of the nearest hour, in GMT
    const url = `${host}?${loc}&hourly=${WX_FIELDS}&start_date=${utcDay(ts - 3600000)}&end_date=${utcDay(ts + 3600000)}&timezone=GMT`;
    return { kind: 'hourly', url, key: url };
}

function numOrNull(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }

// Pull { temp, humidity, pressure, precip, code } for `ts` out of an Open-Meteo response, or null.
function parseWeatherResponse(json, kind, ts) {
    if (!json || typeof json !== 'object') return null;
    let row = null;
    if (kind === 'current') {
        row = json.current && typeof json.current === 'object' ? json.current : null;
    } else {
        const h = json.hourly;
        if (!h || !Array.isArray(h.time)) return null;
        let best = -1, bestDiff = Infinity;
        h.time.forEach((t, i) => {
            const at = Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(t) ? t : t + 'Z'); // GMT times come without a zone
            const d = Math.abs(at - ts);
            if (d < bestDiff) { bestDiff = d; best = i; }
        });
        if (best < 0 || bestDiff > 60 * 60000) return null;
        row = {};
        WX_FIELDS.split(',').forEach(f => { row[f] = Array.isArray(h[f]) ? h[f][best] : null; });
    }
    if (!row) return null;
    const wx = {
        temp: numOrNull(row.temperature_2m),
        humidity: numOrNull(row.relative_humidity_2m),
        pressure: numOrNull(row.pressure_msl),
        precip: numOrNull(row.precipitation),
        code: numOrNull(row.weather_code)
    };
    return wx.temp === null && wx.pressure === null && wx.humidity === null ? null : wx;
}

// WMO weather codes as used by Open-Meteo
function weatherCodeInfo(code) {
    const c = numOrNull(code);
    if (c === 0) return { label: 'Clear', icon: '☀️' };
    if (c === 1) return { label: 'Mostly clear', icon: '🌤️' };
    if (c === 2) return { label: 'Partly cloudy', icon: '⛅' };
    if (c === 3) return { label: 'Overcast', icon: '☁️' };
    if (c === 45 || c === 48) return { label: 'Fog', icon: '🌫️' };
    if (c >= 51 && c <= 57) return { label: 'Drizzle', icon: '🌦️' };
    if (c >= 61 && c <= 67) return { label: 'Rain', icon: '🌧️' };
    if (c >= 71 && c <= 77) return { label: 'Snow', icon: '🌨️' };
    if (c >= 80 && c <= 82) return { label: 'Showers', icon: '🌦️' };
    if (c === 85 || c === 86) return { label: 'Snow showers', icon: '🌨️' };
    if (c >= 95 && c <= 99) return { label: 'Thunderstorm', icon: '⛈️' };
    return { label: 'Weather', icon: '🌡️' };
}

// One weather value for an entry in the chosen units, or null.
function weatherMetricValue(entry, metric, units) {
    const w = entry && entry.weather;
    if (!w || w.status !== 'ok' || !WX_METRICS.includes(metric)) return null;
    const v = numOrNull(w[metric]);
    if (v === null) return null;
    if (units !== 'us') return v;
    if (metric === 'temp') return v * 9 / 5 + 32;
    if (metric === 'pressure') return v * 0.02953;
    if (metric === 'precip') return v / 25.4;
    return v;
}

function weatherUnit(metric, units) {
    const us = units === 'us';
    return { temp: us ? '°F' : '°C', pressure: us ? 'inHg' : 'hPa', humidity: '%', precip: us ? 'in' : 'mm' }[metric] || '';
}

// e.g. "54°F", "1013 hPa", "29.92 inHg", "62%", "0.4 mm"
function formatWeatherValue(metric, value, units) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '';
    const us = units === 'us';
    if (metric === 'temp') return `${Math.round(value)}${weatherUnit('temp', units)}`;
    if (metric === 'humidity') return `${Math.round(value)}%`;
    if (metric === 'pressure') return us ? `${value.toFixed(2)} inHg` : `${Math.round(value)} hPa`;
    if (metric === 'precip') return us ? `${value.toFixed(2)} in` : `${value.toFixed(1)} mm`;
    return String(value);
}

// The line shown under an entry in History, e.g. "☀️ Clear · 54°F · 62% · 1013 hPa".
function weatherSummaryText(entry, units) {
    const w = entry && entry.weather;
    if (!w) return '';
    if (w.status === 'pending') return 'Weather pending';
    if (w.status !== 'ok') return '';
    const info = weatherCodeInfo(w.code);
    const parts = [`${info.icon} ${info.label}`];
    ['temp', 'humidity', 'pressure'].forEach(m => {
        const v = weatherMetricValue(entry, m, units);
        if (v !== null) parts.push(formatWeatherValue(m, v, units));
    });
    const rain = weatherMetricValue(entry, 'precip', units);
    if (rain) parts.push(`${formatWeatherValue('precip', rain, units)} rain`);
    return parts.join(' · ');
}

// Moving an entry's time by more than half an hour means its weather is for the wrong hour:
// keep the place and fetch again.
function weatherAfterTimeEdit(weather, oldTs, newTs) {
    if (!weather || typeof weather !== 'object') return weather;
    if (!Number.isFinite(oldTs) || !Number.isFinite(newTs) || Math.abs(newTs - oldTs) <= WX_CURRENT_WINDOW_MS) return weather;
    const next = { status: 'pending' };
    if (isValidCoord(weather.lat, weather.lon)) { next.lat = weather.lat; next.lon = weather.lon; next.source = weather.source; }
    return next;
}

// Fill in pending weather for `entries` (no storage here, so it is unit tested).
// Groups entries that can share a response, so a day of offline entries costs one request.
// Returns { changed: [records to save], requests, offline }.
async function fillPendingWeather(entries, fetchFn, opts) {
    const o = opts || {};
    const now = typeof o.now === 'number' ? o.now : Date.now();
    const settings = o.settings || getWeatherSettings();
    const maxRequests = typeof o.maxRequests === 'number' ? o.maxRequests : WX_MAX_REQUESTS_PER_RUN;
    const groups = new Map();
    (Array.isArray(entries) ? entries : []).forEach(e => {
        const w = e && e.weather;
        if (!w || w.status !== 'pending' || !Number.isFinite(e.timestamp)) return;
        let loc = isValidCoord(w.lat, w.lon) ? { lat: w.lat, lon: w.lon, source: w.source || 'gps' } : null;
        if (!loc && settings.city) loc = { lat: settings.city.lat, lon: settings.city.lon, source: 'city' };
        if (!loc) return; // nothing to look up yet
        const req = buildWeatherRequest(loc.lat, loc.lon, e.timestamp, now);
        if (!req) return;
        if (!groups.has(req.key)) groups.set(req.key, { req, items: [] });
        groups.get(req.key).items.push({ e, loc });
    });
    // newest first: those are the entries someone is most likely looking at
    const ordered = Array.from(groups.values()).sort((a, b) =>
        Math.max(...b.items.map(i => i.e.timestamp)) - Math.max(...a.items.map(i => i.e.timestamp)));
    const changed = [];
    let requests = 0;
    const failOne = (e, loc, giveUp) => {
        const attempts = (e.weather.attempts || 0) + 1;
        const weather = Object.assign({}, e.weather, loc, { attempts });
        if (giveUp || attempts >= WX_MAX_ATTEMPTS) weather.status = 'unavailable';
        changed.push(Object.assign({}, e, { weather }));
    };
    for (const g of ordered) {
        if (requests >= maxRequests) break;
        requests++;
        let json;
        try {
            const resp = await fetchFn(g.req.url);
            if (!resp || !resp.ok) {
                const status = resp ? resp.status : 0;
                // 400 means Open-Meteo can't answer this request (e.g. a date out of range); don't retry forever
                g.items.forEach(({ e, loc }) => failOne(e, loc, status === 400));
                continue;
            }
            json = await resp.json();
        } catch (err) {
            return { changed, requests, offline: true }; // network gone: try again later
        }
        g.items.forEach(({ e, loc }) => {
            const wx = parseWeatherResponse(json, g.req.kind, e.timestamp);
            if (!wx) { failOne(e, loc, false); return; }
            const weather = Object.assign({ status: 'ok', lat: loc.lat, lon: loc.lon, source: loc.source }, wx);
            changed.push(Object.assign({}, e, { weather }));
        });
    }
    return { changed, requests, offline: false };
}

let wxBackfillRunning = false;

// Look up weather for every pending entry and save it. Safe to call often.
async function backfillWeather(opts) {
    const o = opts || {};
    if (wxBackfillRunning) return null;
    if (!o.fetchFn && typeof navigator !== 'undefined' && navigator.onLine === false) return null;
    const fetchFn = o.fetchFn || (typeof fetch === 'function' ? fetch : null);
    if (!fetchFn) return null;
    wxBackfillRunning = true;
    try {
        const result = await fillPendingWeather(await getAllEntries(), fetchFn, o);
        for (const rec of result.changed) {
            // don't overwrite a record that was deleted meanwhile
            const current = await getEntry(rec.id);
            if (current && current.weather && current.weather.status === 'pending') {
                await updateEntry(Object.assign({}, current, { weather: rec.weather }));
            }
        }
        if (result.changed.length && !o.quiet) await refreshViews();
        return result;
    } catch (e) {
        console.error(e);
        return null;
    } finally {
        wxBackfillRunning = false;
    }
}

// Right after a save: note where the entry was made, then try to fetch its weather.
async function captureWeatherForEntry(id) {
    try {
        const loc = await resolveWeatherLocation();
        const rec = await getEntry(id);
        if (!rec || !rec.weather || rec.weather.status !== 'pending') return;
        if (loc) {
            await updateEntry(Object.assign({}, rec, { weather: Object.assign({}, rec.weather, loc) }));
        } else {
            flashMessage('Couldn\'t get your location. Add a city in Settings to record weather.', true);
            return;
        }
        await backfillWeather();
    } catch (e) { console.error(e); }
}

// Look up a typed city with Open-Meteo's geocoding. Returns { name, lat, lon } or null.
async function geocodeCity(name, fetchFn) {
    const q = String(name || '').trim();
    if (!q) return null;
    const f = fetchFn || fetch;
    const resp = await f(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&format=json`);
    if (!resp || !resp.ok) throw new Error('Lookup failed');
    const data = await resp.json();
    const r = data && Array.isArray(data.results) ? data.results[0] : null;
    if (!r || !isValidCoord(r.latitude, r.longitude)) return null;
    const label = [r.name, r.admin1, r.country_code || r.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
    return { name: label || q, lat: roundCoord(r.latitude), lon: roundCoord(r.longitude) };
}

function renderWeatherSettings() {
    const s = getWeatherSettings();
    const enabled = document.getElementById('weather-enabled');
    if (!enabled) return;
    enabled.checked = s.enabled;
    const units = document.getElementById('weather-units');
    if (units) units.value = s.units;
    const city = document.getElementById('weather-city');
    if (city && document.activeElement !== city) city.value = s.city ? s.city.name : '';
    const status = document.getElementById('weather-city-status');
    if (status) status.textContent = s.city ? `Using ${s.city.name} when your location isn't available.` : 'No city set.';
}

function initWeather() {
    const enabled = document.getElementById('weather-enabled');
    if (enabled) enabled.addEventListener('change', async () => {
        setWeatherSettings({ enabled: enabled.checked });
        if (!enabled.checked) { flashMessage('Weather recording off'); return; }
        // ask for location now, while it's clear why, rather than on the next save
        const loc = await getDeviceLocation();
        if (loc) flashMessage('Weather will be saved with each entry');
        else if (getWeatherSettings().city) flashMessage(`Location unavailable. Using ${getWeatherSettings().city.name}.`);
        else flashMessage('Location unavailable. Add your city below to record weather.', true);
    });
    const units = document.getElementById('weather-units');
    if (units) units.addEventListener('change', async () => {
        setWeatherSettings({ units: units.value });
        await refreshViews();
    });
    const city = document.getElementById('weather-city');
    const findBtn = document.getElementById('weather-city-find');
    const status = document.getElementById('weather-city-status');
    const find = async () => {
        if (!city) return;
        const q = city.value.trim();
        if (!q) { setWeatherSettings({ city: null }); renderWeatherSettings(); return; }
        if (status) status.textContent = 'Looking up…';
        try {
            const found = await geocodeCity(q);
            if (!found) { if (status) status.textContent = `Couldn't find "${q}". Try adding the state or country.`; return; }
            setWeatherSettings({ city: found });
            city.value = found.name;
            renderWeatherSettings();
            backfillWeather();
        } catch (e) {
            if (status) status.textContent = 'Couldn\'t look up the city. Check your connection and try again.';
        }
    };
    if (findBtn) findBtn.addEventListener('click', find);
    if (city) city.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); find(); } });
    const overlay = document.getElementById('trends-weather');
    if (overlay) overlay.addEventListener('change', async () => {
        setWeatherSettings({ chart: overlay.value });
        renderTrends(await getAllEntries());
    });
    renderWeatherSettings();
    window.addEventListener('online', () => backfillWeather());
    setTimeout(() => backfillWeather(), 1500);
}

// ----- Trends chart -----

const LS_TRENDS = 'll_trends_v1';

function getTrendsPrefs() {
    try {
        const p = JSON.parse(localStorage.getItem(LS_TRENDS) || '{}');
        return { days: [7, 30, 90].includes(p.days) ? p.days : 30, key: typeof p.key === 'string' ? p.key : null };
    } catch (e) { return { days: 30, key: null }; }
}

function setTrendsPrefs(p) {
    try { localStorage.setItem(LS_TRENDS, JSON.stringify(p)); } catch (e) { /* ignore */ }
}

function initTrends() {
    const section = document.getElementById('view-history');
    if (!section) return;
    document.querySelectorAll('#trends-range button[data-days]').forEach(btn => {
        btn.addEventListener('click', async () => {
            setTrendsPrefs(Object.assign(getTrendsPrefs(), { days: Number(btn.dataset.days) }));
            renderTrends(await getAllEntries());
        });
    });
    let resizeTimer = null;
    window.addEventListener('resize', () => {
        if (section.hidden) return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(async () => renderTrends(await getAllEntries()), 150);
    });
    const select = document.getElementById('trends-emotion');
    if (select) select.addEventListener('change', async () => {
        setTrendsPrefs(Object.assign(getTrendsPrefs(), { key: select.value }));
        renderTrends(await getAllEntries());
    });
}

// Build per-day averages for one emotion over the last `days` days (today included)
// `now` defaults to the current time; tests pass a fixed value.
function computeDailySeries(entries, key, days, now) {
    return computeDailyValues(entries, e => (e.values ? e.values[key] : null), days, now);
}

// Daily buckets of any per-entry number (`getValue(entry)` returns a number or null).
// Each point: { date, avg, count, min, max, sum }.
function computeDailyValues(entries, getValue, days, now) {
    const today = new Date(typeof now === 'number' ? now : Date.now());
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
    const buckets = new Map();
    (entries || []).forEach(e => {
        const v = e ? getValue(e) : null;
        if (typeof v !== 'number' || !Number.isFinite(v) || e.timestamp < start.getTime()) return;
        const k = dayKey(e.timestamp);
        const b = buckets.get(k) || { sum: 0, count: 0, min: v, max: v };
        b.sum += v; b.count += 1; b.min = Math.min(b.min, v); b.max = Math.max(b.max, v);
        buckets.set(k, b);
    });
    const series = [];
    for (let i = 0; i < days; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const b = buckets.get(dayKey(d.getTime()));
        series.push({ date: d, avg: b ? b.sum / b.count : null, count: b ? b.count : 0, min: b ? b.min : null, max: b ? b.max : null, sum: b ? b.sum : null });
    }
    return series;
}

// Daily weather for the chart: [{ date, value }] where value is the day's average,
// or its total for rain. null on days without weather.
function computeDailyWeather(entries, metric, units, days, now) {
    const pts = computeDailyValues(entries, e => weatherMetricValue(e, metric, units), days, now);
    // rain per entry is that hour's rain, so the day's figure is an average hourly amount
    return pts.map(p => ({ date: p.date, value: p.avg, count: p.count }));
}

// Round axis ticks covering [lo, hi]: { min, max, ticks }. Rain axes start at 0. null without data.
function weatherAxis(values, metric) {
    const vals = (values || []).filter(v => typeof v === 'number' && Number.isFinite(v));
    if (!vals.length) return null;
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (metric === 'precip') lo = 0;
    if (metric === 'humidity') { lo = Math.max(0, lo); hi = Math.min(100, hi); }
    if (hi - lo < 1e-9) {
        const pad = metric === 'precip' ? Math.max(hi, 0.1) : Math.max(Math.abs(hi) * 0.01, metric === 'pressure' ? 0.1 : 1);
        if (metric !== 'precip') lo -= pad;
        hi += pad;
    }
    const raw = (hi - lo) / 3;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(st => st >= raw);
    const min = Math.floor(lo / step + 1e-9) * step;
    const max = Math.ceil(hi / step - 1e-9) * step;
    const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9) + (step / mag === 2.5 ? 1 : 0));
    const ticks = [];
    for (let t = min; t <= max + step / 2; t += step) ticks.push(Number(t.toFixed(decimals)));
    return { min: ticks[0], max: ticks[ticks.length - 1], ticks, decimals };
}

function renderTrends(entries) {
    const select = document.getElementById('trends-emotion');
    const chart = document.getElementById('trends-chart');
    const summary = document.getElementById('trends-summary');
    if (!select || !chart || !summary) return;
    const prefs = getTrendsPrefs();

    document.querySelectorAll('#trends-range button[data-days]').forEach(btn => {
        const active = Number(btn.dataset.days) === prefs.days;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    // options: tracked emotions plus any emotion that has recorded data
    const tracked = new Set(getTrackedKeys());
    const withData = new Set();
    (entries || []).forEach(e => Object.entries(e.values || {}).forEach(([k, v]) => { if (k !== 'note' && typeof v === 'number') withData.add(k); }));
    const keys = getOrderedEmotionKeys(entries).filter(k => tracked.has(k) || withData.has(k));
    let key = keys.includes(prefs.key) ? prefs.key : (keys.find(k => withData.has(k)) || keys[0]);
    select.innerHTML = keys.map(k => `<option value="${escapeHtml(k)}">${escapeHtml(LABELS[k] || k)}</option>`).join('');
    if (key) select.value = key;

    if (!key) { chart.innerHTML = ''; summary.textContent = 'No emotions to chart yet.'; return; }

    const series = computeDailySeries(entries, key, prefs.days);

    // weather overlay: only offered once some entry has weather
    const wx = getWeatherSettings();
    const hasWeather = (entries || []).some(e => e && e.weather && e.weather.status === 'ok');
    const wxWrap = document.getElementById('trends-weather-wrap');
    const wxSelect = document.getElementById('trends-weather');
    if (wxWrap) wxWrap.hidden = !hasWeather;
    if (wxSelect) wxSelect.value = wx.chart;
    let overlay = null;
    if (hasWeather && wx.chart !== 'none') {
        overlay = { metric: wx.chart, units: wx.units, label: WX_METRIC_LABELS[wx.chart], series: computeDailyWeather(entries, wx.chart, wx.units, prefs.days) };
        if (!overlay.series.some(p => p.value !== null)) overlay.series = null;
    }
    chart.innerHTML = buildTrendSvg(series, LABELS[key] || key, chart.clientWidth, overlay);
    const legend = document.getElementById('trends-legend');
    if (legend) {
        legend.hidden = !overlay;
        legend.innerHTML = overlay
            ? `<span class="trends__key"><span class="trends__swatch" aria-hidden="true"></span>${escapeHtml(LABELS[key] || key)} (1–10, left)</span>`
              + `<span class="trends__key"><span class="trends__swatch trends__swatch--wx${overlay.metric === 'precip' ? ' trends__swatch--bar' : ''}" aria-hidden="true"></span>${escapeHtml(overlay.label)} (${escapeHtml(weatherUnit(overlay.metric, overlay.units))}, right)</span>`
              + (overlay.series ? '' : `<span class="trends__key">No weather in this range yet</span>`)
            : '';
    }

    const st = summarizeSeries(series);
    let wxSummary = '';
    if (overlay && overlay.series) {
        const vals = overlay.series.filter(p => p.value !== null);
        const avg = vals.reduce((a, p) => a + p.value * p.count, 0) / vals.reduce((a, p) => a + p.count, 0);
        wxSummary = ` · ${overlay.label.toLowerCase()} averaged ${formatWeatherValue(overlay.metric, avg, overlay.units)}${overlay.metric === 'precip' ? ' an hour' : ''}`;
    }
    if (!st) {
        summary.textContent = `No ${LABELS[key] || key} ratings in the last ${prefs.days} days.`;
        return;
    }
    summary.textContent = `Average ${st.avg.toFixed(1)} · range ${st.min}–${st.max} · ${st.total} ${st.total === 1 ? 'rating' : 'ratings'} on ${st.daysWithData} of ${prefs.days} days${wxSummary}`;
}

// Overall stats for a daily series: rating-weighted average, min, max, counts. null if no data.
function summarizeSeries(series) {
    const withVals = (series || []).filter(p => p.avg !== null);
    if (!withVals.length) return null;
    const total = withVals.reduce((a, p) => a + p.count, 0);
    const avg = withVals.reduce((a, p) => a + p.avg * p.count, 0) / total;
    let min = Infinity, max = -Infinity;
    withVals.forEach(p => { if (p.min < min) min = p.min; if (p.max > max) max = p.max; });
    return { avg, min, max, total, daysWithData: withVals.length };
}

// Dependency-free SVG line chart; scale is fixed at 1–10. Gaps in the data break the line.
// `overlay` (optional) = { metric, units, label, series: [{ date, value }] } draws weather on a right-hand axis.
function buildTrendSvg(series, label, width, overlay) {
    // draw at the container's real width so text stays readable on phones
    const W = Math.max(280, Math.round(width || 640)), H = W < 480 ? 200 : 260;
    const wxSeries = overlay && Array.isArray(overlay.series) && overlay.series.length === series.length ? overlay.series : null;
    const axis = wxSeries ? weatherAxis(wxSeries.map(p => p.value), overlay.metric) : null;
    const m = { top: 14, right: axis ? 46 : 16, bottom: 30, left: 30 };
    const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
    const n = series.length;
    const x = i => m.left + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = v => m.top + ih - ((v - 1) / 9) * ih;
    const fmt = d => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

    let grid = '';
    [1, 4, 7, 10].forEach(v => {
        grid += `<line class="trend-grid" x1="${m.left}" x2="${W - m.right}" y1="${y(v)}" y2="${y(v)}"/>`;
        grid += `<text class="trend-axis" x="${m.left - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    });

    // x labels: every day for 7 days, otherwise ~6 evenly spaced
    const maxLabels = W < 480 ? 4 : 6;
    const step = n <= 7 ? 1 : Math.ceil((n - 1) / (maxLabels - 1));
    let xLabels = '';
    for (let i = 0; i < n; i += step) {
        const d = series[i].date;
        const text = n <= 7 ? d.toLocaleDateString(undefined, { weekday: 'short' }) : fmt(d);
        xLabels += `<text class="trend-axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">${escapeHtml(text)}</text>`;
    }

    // solid line between consecutive days; faint dashed line bridging days with no entries
    let lines = '';
    let prev = -1;
    series.forEach((p, i) => {
        if (p.avg === null) return;
        if (prev >= 0) {
            const cls = i - prev === 1 ? 'trend-line' : 'trend-line trend-line--gap';
            lines += `<line class="${cls}" x1="${x(prev).toFixed(1)}" y1="${y(series[prev].avg).toFixed(1)}" x2="${x(i).toFixed(1)}" y2="${y(p.avg).toFixed(1)}"/>`;
        }
        prev = i;
    });

    // weather goes underneath the mood line
    let wx = '';
    if (axis) {
        const yw = v => m.top + ih - ((v - axis.min) / (axis.max - axis.min)) * ih;
        const short = { temp: '°', humidity: '%', pressure: '', precip: '' }[overlay.metric] || '';
        axis.ticks.forEach(t => {
            wx += `<text class="trend-axis trend-axis--wx" x="${W - m.right + 6}" y="${(yw(t) + 4).toFixed(1)}" text-anchor="start">${escapeHtml(t.toFixed(axis.decimals) + short)}</text>`;
        });
        const tipFor = p => `${fmt(p.date)}: ${overlay.label} ${formatWeatherValue(overlay.metric, p.value, overlay.units)}${overlay.metric === 'precip' ? ' an hour' : ''}`;
        if (overlay.metric === 'precip') {
            const bw = Math.max(2, Math.min(14, (iw / n) * 0.6));
            wxSeries.forEach((p, i) => {
                if (p.value === null || p.value <= 0) return; // dry days: no bar
                const top = yw(p.value), base = yw(axis.min);
                wx += `<rect class="trend-wx-bar" x="${(x(i) - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, base - top).toFixed(1)}"><title>${escapeHtml(tipFor(p))}</title></rect>`;
            });
        } else {
            let pw = -1;
            wxSeries.forEach((p, i) => {
                if (p.value === null) return;
                if (pw >= 0) {
                    const cls = i - pw === 1 ? 'trend-wx-line' : 'trend-wx-line trend-line--gap';
                    wx += `<line class="${cls}" x1="${x(pw).toFixed(1)}" y1="${yw(wxSeries[pw].value).toFixed(1)}" x2="${x(i).toFixed(1)}" y2="${yw(p.value).toFixed(1)}"/>`;
                }
                pw = i;
            });
            wxSeries.forEach((p, i) => {
                if (p.value === null) return;
                wx += `<circle class="trend-wx-dot" cx="${x(i).toFixed(1)}" cy="${yw(p.value).toFixed(1)}" r="3"><title>${escapeHtml(tipFor(p))}</title></circle>`;
            });
        }
    }

    const r = n > 60 ? 3 : 4;
    const dots = series.map((p, i) => {
        if (p.avg === null) return '';
        const tip = `${fmt(p.date)}: ${p.avg.toFixed(1)}` + (p.count > 1 ? ` (avg of ${p.count}, ${p.min}–${p.max})` : '');
        return `<circle class="trend-dot" cx="${x(i).toFixed(1)}" cy="${y(p.avg).toFixed(1)}" r="${r}"><title>${escapeHtml(tip)}</title></circle>`;
    }).join('');

    const aria = `${label} daily average over the last ${n} days` + (axis ? `, with daily ${overlay.label.toLowerCase()}` : '');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(aria)}" aria-describedby="trends-summary">${grid}${xLabels}${wx}${lines}${dots}</svg>`;
}

document.addEventListener('DOMContentLoaded', initUI);