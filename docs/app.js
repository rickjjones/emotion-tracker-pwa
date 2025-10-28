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

function setTrackedKeys(keys) {
    try { localStorage.setItem(LS_TRACKED, JSON.stringify(keys)); } catch (e) { /* ignore */ }
}

// Editable categories persistence
function getSavedCategories() {
    try {
        const raw = localStorage.getItem(LS_CATEGORIES);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        return parsed;
    } catch (e) { return null; }
}

function setSavedCategories(obj) {
    try { localStorage.setItem(LS_CATEGORIES, JSON.stringify(obj)); } catch (e) { /* ignore */ }
}

function resetSavedCategories() { try { localStorage.removeItem(LS_CATEGORIES); } catch(e){} }

// Return the active categories object (saved override merged with defaults)
function loadEffectiveCategories() {
    const saved = getSavedCategories();
    if (!saved) return CATEGORIES;
    // merge: keep saved keys and labels; if saved category lacks keys use default
    const out = {};
    Object.entries(CATEGORIES).forEach(([id, def]) => {
        if (saved[id] && Array.isArray(saved[id].keys)) {
            out[id] = { title: (saved[id].title || def.title), keys: saved[id].keys.slice() };
        } else {
            out[id] = { title: def.title, keys: def.keys.slice() };
        }
    });
    // include any additional saved categories
    Object.keys(saved).forEach(k => { if (!out[k] && saved[k] && Array.isArray(saved[k].keys)) out[k] = { title: saved[k].title || k, keys: saved[k].keys.slice() }; });
    return out;
}

// Return flat list of emotion keys based on the effective categories (plus 'note')
function getAllEmotionKeys() {
    const cats = loadEffectiveCategories();
    return Object.values(cats).reduce((acc,c) => acc.concat(c.keys || []), []).concat(['note']);
}

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

async function addEntry(values) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const record = { timestamp: Date.now(), values, exported: false };
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

async function importEntriesFromArray(arr) {
    if (!Array.isArray(arr)) throw new Error('Invalid import format');
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        arr.forEach(item => {
            const record = {
                timestamp: item.timestamp || Date.now(),
                values: item.values || item,
                exported: item.exported || false
            };
            store.add(record);
        });
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
function renderCategoriesEditor() {
    const list = document.getElementById('categories-edit-list');
    if (!list) return;
    list.innerHTML = '';
    const cats = loadEffectiveCategories();
    Object.entries(cats).forEach(([catId, cat]) => {
        const panel = document.createElement('div');
        panel.className = 'cat-edit';
        panel.style.border = '1px solid rgba(0,0,0,0.06)';
        panel.style.padding = '8px';
        panel.style.margin = '8px 0';

        const titleRow = document.createElement('div');
        titleRow.style.display = 'flex';
        titleRow.style.gap = '8px';
        const titleInput = document.createElement('input');
        titleInput.value = cat.title || catId;
        titleInput.dataset.catId = catId;
        titleInput.placeholder = 'Category title';
        titleRow.appendChild(titleInput);

        const removeCatBtn = document.createElement('button');
        removeCatBtn.textContent = 'Remove category';
        removeCatBtn.type = 'button';
        removeCatBtn.addEventListener('click', () => { panel.remove(); });
        titleRow.appendChild(removeCatBtn);

        panel.appendChild(titleRow);

        const keysContainer = document.createElement('div');
        cat.keys.forEach(k => {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.gap = '8px';
            const keyInput = document.createElement('input');
            keyInput.value = k;
            keyInput.placeholder = 'key (internal id)';
            const labelInput = document.createElement('input');
            labelInput.value = LABELS[k] || k;
            labelInput.placeholder = 'label';
            const rm = document.createElement('button'); rm.type='button'; rm.textContent='Remove'; rm.addEventListener('click', () => row.remove());
            row.appendChild(keyInput); row.appendChild(labelInput); row.appendChild(rm);
            keysContainer.appendChild(row);
        });

        const addKeyBtn = document.createElement('button'); addKeyBtn.type='button'; addKeyBtn.textContent='Add emotion'; addKeyBtn.addEventListener('click', () => {
            const row = document.createElement('div'); row.style.display='flex'; row.style.gap='8px';
            const keyInput = document.createElement('input'); keyInput.placeholder='key (internal id)';
            const labelInput = document.createElement('input'); labelInput.placeholder='label';
            const rm = document.createElement('button'); rm.type='button'; rm.textContent='Remove'; rm.addEventListener('click', () => row.remove());
            row.appendChild(keyInput); row.appendChild(labelInput); row.appendChild(rm);
            keysContainer.appendChild(row);
        });

        panel.appendChild(keysContainer);
        panel.appendChild(addKeyBtn);
        list.appendChild(panel);
    });
}

function openCategoriesEditModal() {
    const modal = document.getElementById('categories-edit-modal');
    if (!modal) return;
    renderCategoriesEditor();
    modal.hidden = false; modal.setAttribute('aria-hidden','false');
}

function closeCategoriesEditModal() {
    const modal = document.getElementById('categories-edit-modal'); if (!modal) return; modal.hidden = true; modal.setAttribute('aria-hidden','true');
}

function saveCategoriesEditModal() {
    const list = document.getElementById('categories-edit-list'); if (!list) return;
    const panels = Array.from(list.children);
    const out = {};
    panels.forEach(panel => {
        const titleInput = panel.querySelector('input[placeholder="Category title"]') || panel.querySelector('input');
        const title = titleInput ? titleInput.value.trim() : '';
        const keyRows = Array.from(panel.querySelectorAll('div > div, div')).filter(n => n.querySelectorAll); // best effort
        const keys = [];
        // gather inputs inside panel (all input pairs)
        const inputs = panel.querySelectorAll('input');
        const catIdRaw = (title || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
        for (let i=1;i<inputs.length;i+=2) {
            const key = (inputs[i-1].value || '').trim();
            const label = (inputs[i].value || '').trim();
            if (key) { keys.push(key); LABELS[key] = label || key; }
        }
        if (keys.length) out[catIdRaw || ('cat_' + Math.random().toString(36).slice(2,8))] = { title: title || catIdRaw, keys };
    });
    // persist and re-render
    // validate for duplicate keys
    const allKeys = Object.values(out).reduce((acc,c) => acc.concat(c.keys), []);
    const dup = allKeys.filter((v,i,a) => a.indexOf(v) !== i);
    if (dup.length) { flashMessage('Duplicate keys found: ' + Array.from(new Set(dup)).join(', '), true); return; }

    // warn if relabeling existing keys (simple detection)
    const prevKeys = getAllEmotionKeys();
    const renamed = allKeys.filter(k => prevKeys.includes(k) === false);
    if (renamed.length) {
        // polite warning but allow saving
        if (!confirm('You added or renamed keys. Existing stored entries may not map to the new keys. Continue?')) return;
    }

    setSavedCategories(out);
    closeCategoriesEditModal();
    renderEmotionForm();
}

function exportCategoriesConfig() {
    const cats = getSavedCategories() || CATEGORIES;
    const blob = new Blob([JSON.stringify(cats, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'categories-config.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

async function importCategoriesConfigFile(file) {
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        // basic shape check
        if (typeof data !== 'object' || Array.isArray(data)) { flashMessage('Invalid config file', true); return; }
        setSavedCategories(data);
        renderCategoriesEditor();
        flashMessage('Imported categories');
    } catch (e) { flashMessage('Import failed', true); }
}

// Keyboard handling for modals (Escape to close) and basic focus trap
document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
        const mod1 = document.getElementById('categories-modal');
        const mod2 = document.getElementById('categories-edit-modal');
        if (mod2 && !mod2.hidden) { closeCategoriesEditModal(); }
        else if (mod1 && !mod1.hidden) { closeCategoriesModal(); }
    }
});

// Export all entries to CSV with stable headers
async function exportEntriesToCsv() {
    const entries = await getAllEntries();
    if (!entries || entries.length === 0) {
        flashMessage('No entries to export', true);
        return;
    }

    const headers = ['timestamp', 'id', ...getEmotionCsvKeys()];
    const rows = entries.map(e => {
        const row = [];
        row.push(new Date(e.timestamp).toISOString());
        row.push(e.id || '');
        const vals = e.values || {};
        getEmotionCsvKeys().forEach(k => {
            const v = vals[k];
            row.push(v === null || typeof v === 'undefined' ? '' : v);
        });
        return row.map(csvEscape).join(',');
    });

    const csv = [headers.map(csvEscape).join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `emotion-entries-${new Date().toISOString()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

// Export unsynced entries to CSV and mark them as exported
async function exportUnsyncedToCsv() {
    const unsynced = await getUnsyncedEntries();
    if (!unsynced || unsynced.length === 0) {
        flashMessage('No unsynced entries to export', true);
        return;
    }
    const headers = ['timestamp', 'id', ...getEmotionCsvKeys()];
    const rows = unsynced.map(e => {
        const row = [];
        row.push(new Date(e.timestamp).toISOString());
        row.push(e.id || '');
        const vals = e.values || {};
        getEmotionCsvKeys().forEach(k => {
            const v = vals[k];
            row.push(v === null || typeof v === 'undefined' ? '' : v);
        });
        return row.map(csvEscape).join(',');
    });

    const csv = [headers.map(csvEscape).join(','), ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `emotion-unsynced-${new Date().toISOString()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    const ids = unsynced.map(e => e.id).filter(Boolean);
    await markEntriesExported(ids);
    flashMessage(`Exported ${ids.length} entries`);
}

async function exportEntriesToJson() {
    const entries = await getAllEntries();
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `emotion-entries-${new Date().toISOString()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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

function renderEntriesList(entries) {
    const container = document.getElementById('emotion-display');
    if (!container) return;
    if (!entries || entries.length === 0) {
        container.innerHTML = '<p>No entries yet.</p>';
        return;
    }
    const sorted = entries.slice().sort((a,b) => b.timestamp - a.timestamp);
    const html = sorted.map(e => {
        const date = new Date(e.timestamp);
        const pairs = Object.entries(e.values || {});
        const items = pairs.filter(([k]) => k !== 'note').map(([k,v]) => {
            const label = LABELS[k] || k;
            return `<li><strong>${escapeHtml(label)}:</strong> ${v === null ? '—' : escapeHtml(String(v))}</li>`;
        }).join('');
        const noteHtml = (e.values && e.values.note) ? `<div class="entry-note"><strong>Note:</strong><div class="note-text">${escapeHtml(e.values.note)}</div></div>` : '';
        const exportedBadge = e.exported ? `<span class="badge-exported">Exported</span>` : '';
        return `<div class="entry"><div class="entry__meta"><strong>${date.toLocaleString()}</strong>${exportedBadge}</div><ul>${items}</ul>${noteHtml}</div>`;
    }).join('');
    container.innerHTML = html;
}

// --- Dynamic form rendering based on categories and tracked keys ---
function renderEmotionForm() {
    const form = document.getElementById('emotion-form');
    if (!form) return;
    form.innerHTML = '';

    const tracked = new Set(getTrackedKeys());

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
            const label = document.createElement('label');
            label.setAttribute('for', k);
            label.textContent = LABELS[k] || k;
            const input = document.createElement('input');
            input.type = 'number';
            input.id = k;
            input.name = k;
            input.min = 1;
            input.max = 10;
            row.appendChild(label);
            row.appendChild(input);
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

    // wire submit handler (existing initUI also attaches to form submit)
}

function openCategoriesModal() {
    const modal = document.getElementById('categories-modal');
    const list = document.getElementById('categories-list');
    if (!modal || !list) return;
    list.innerHTML = '';
    const tracked = new Set(getTrackedKeys());

    const effective = loadEffectiveCategories();
    Object.entries(effective).forEach(([catId, cat]) => {
        const group = document.createElement('fieldset');
        const legend = document.createElement('legend');
        legend.textContent = cat.title;
        group.appendChild(legend);
        cat.keys.forEach(k => {
            const id = `chk_${k}`;
            const wrap = document.createElement('div');
            wrap.style.display = 'flex';
            wrap.style.alignItems = 'center';
            wrap.style.gap = '8px';
            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.id = id;
            chk.value = k;
            chk.checked = tracked.has(k);
            const lbl = document.createElement('label');
            lbl.setAttribute('for', id);
            lbl.textContent = LABELS[k] || k;
            wrap.appendChild(chk);
            wrap.appendChild(lbl);
            group.appendChild(wrap);
        });
        list.appendChild(group);
    });

    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
}

function closeCategoriesModal() {
    const modal = document.getElementById('categories-modal');
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
}

function saveCategoriesFromModal() {
    const list = document.getElementById('categories-list');
    if (!list) return;
    const checked = Array.from(list.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.value);
    if (!checked || checked.length === 0) { flashMessage('Select at least one emotion to track', true); return; }
    setTrackedKeys(checked);
    closeCategoriesModal();
    renderEmotionForm();
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (s) {
        return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]);
    });
}

async function initUI() {
    const form = document.getElementById('emotion-form');
    // render form according to tracked emotions
    renderEmotionForm();
    if (form) {
        form.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const values = formToValues();
            await addEntry(values);
    getAllEmotionKeys().forEach(k => {
        const el = document.getElementById(k);
        if (el) el.value = '';
        });
            const entries = await getAllEntries();
            renderEntriesList(entries);
            flashMessage('Saved');
        });
    }

    // wire customize categories modal
    const customize = document.getElementById('customize-emotions');
    if (customize) customize.addEventListener('click', () => openCategoriesModal());
    const saveBtn = document.getElementById('categories-save');
    if (saveBtn) saveBtn.addEventListener('click', () => saveCategoriesFromModal());
    const cancelBtn = document.getElementById('categories-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => closeCategoriesModal());
    const backdrop = document.getElementById('categories-backdrop');
    if (backdrop) backdrop.addEventListener('click', () => closeCategoriesModal());

    // wire categories edit modal
    const editBtn = document.getElementById('edit-categories');
    if (editBtn) editBtn.addEventListener('click', () => openCategoriesEditModal());
    const editSave = document.getElementById('categories-edit-save');
    if (editSave) editSave.addEventListener('click', () => saveCategoriesEditModal());
    const editCancel = document.getElementById('categories-edit-cancel');
    if (editCancel) editCancel.addEventListener('click', () => closeCategoriesEditModal());
    const editBackdrop = document.getElementById('categories-edit-backdrop');
    if (editBackdrop) editBackdrop.addEventListener('click', () => closeCategoriesEditModal());
    const addCat = document.getElementById('add-category');
    if (addCat) addCat.addEventListener('click', () => {
        // append an empty panel and re-render to allow editing
        const list = document.getElementById('categories-edit-list');
        if (!list) return;
        const panel = document.createElement('div'); panel.className='cat-edit'; panel.style.border='1px solid rgba(0,0,0,0.06)'; panel.style.padding='8px'; panel.style.margin='8px 0';
        const titleRow = document.createElement('div'); titleRow.style.display='flex'; titleRow.style.gap='8px';
        const titleInput = document.createElement('input'); titleInput.placeholder='Category title'; titleRow.appendChild(titleInput);
        const removeCatBtn = document.createElement('button'); removeCatBtn.textContent='Remove category'; removeCatBtn.type='button'; removeCatBtn.addEventListener('click', () => panel.remove()); titleRow.appendChild(removeCatBtn);
        panel.appendChild(titleRow);
        const keysContainer = document.createElement('div'); panel.appendChild(keysContainer);
        const addKeyBtn = document.createElement('button'); addKeyBtn.type='button'; addKeyBtn.textContent='Add emotion'; addKeyBtn.addEventListener('click', () => {
            const row = document.createElement('div'); row.style.display='flex'; row.style.gap='8px';
            const keyInput = document.createElement('input'); keyInput.placeholder='key (internal id)';
            const labelInput = document.createElement('input'); labelInput.placeholder='label';
            const rm = document.createElement('button'); rm.type='button'; rm.textContent='Remove'; rm.addEventListener('click', () => row.remove());
            row.appendChild(keyInput); row.appendChild(labelInput); row.appendChild(rm);
            keysContainer.appendChild(row);
        });
        panel.appendChild(addKeyBtn);
        list.appendChild(panel);
    });
    const resetBtn = document.getElementById('reset-categories');
    if (resetBtn) resetBtn.addEventListener('click', () => { resetSavedCategories(); renderCategoriesEditor(); flashMessage('Reset to defaults'); });
    const exportBtn = document.getElementById('export-categories');
    if (exportBtn) exportBtn.addEventListener('click', () => exportCategoriesConfig());
    const importCatsBtn = document.getElementById('import-categories');
    const importCatsFile = document.getElementById('import-categories-file');
    if (importCatsBtn && importCatsFile) importCatsBtn.addEventListener('click', () => { importCatsFile.value=''; importCatsFile.click(); });
    if (importCatsFile) importCatsFile.addEventListener('change', async (ev) => { const file = ev.target.files && ev.target.files[0]; if (!file) return; await importCategoriesConfigFile(file); });

    const viewBtn = document.getElementById('view-history');
    const display = document.getElementById('emotion-display');
    if (display) display.style.display = 'none';

    if (viewBtn) viewBtn.addEventListener('click', async () => {
        if (!display) return;
        if (display.style.display === 'none' || display.style.display === '') {
            const entries = await getAllEntries();
            renderEntriesList(entries);
            display.style.display = 'block';
            viewBtn.textContent = 'Hide History';
        } else {
            display.style.display = 'none';
            viewBtn.textContent = 'View History';
        }
    });

    const exportJsonBtn = document.getElementById('export-json');
    if (exportJsonBtn) exportJsonBtn.addEventListener('click', () => exportEntriesToJson());

    const exportCsvBtn = document.getElementById('export-csv');
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', () => exportEntriesToCsv());

    const exportUnsyncedBtn = document.getElementById('export-unsynced');
    if (exportUnsyncedBtn) exportUnsyncedBtn.addEventListener('click', () => exportUnsyncedToCsv());

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
                const entries = await getAllEntries();
                if (display && display.style.display !== 'none') renderEntriesList(entries);
                flashMessage('Imported');
            } catch (err) {
                flashMessage('Import failed', true);
                console.error(err);
            }
        });
    }

    const clearBtn = document.getElementById('clear-all');
    if (clearBtn) clearBtn.addEventListener('click', async () => {
        if (!confirm('Clear all emotion entries?')) return;
        await clearAllEntries();
        renderEntriesList([]);
        flashMessage('Cleared');
    });

    const undoBtn = document.getElementById('undo-last-export');
    if (undoBtn) undoBtn.addEventListener('click', async () => {
        const raw = localStorage.getItem('lastExportedIds');
        if (!raw) { flashMessage('Nothing to undo', true); return; }
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
            const entries = await getAllEntries();
            renderEntriesList(entries);
            flashMessage('Undo complete');
        };
        tx.onerror = () => flashMessage('Undo failed', true);
    });

    const entries = await getAllEntries();
    renderEntriesList(entries);
}

// ----- Dark mode helpers -----
function applyTheme(isDark) {
    try {
        const html = document.documentElement;
        if (isDark) html.classList.add('dark'); else html.classList.remove('dark');
        // update meta theme-color so mobile UI (status bar) matches
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', isDark ? '#0b1220' : '#4CAF50');
        const btn = document.getElementById('theme-toggle');
        if (btn) btn.textContent = isDark ? '☀️' : '🌙';
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

function flashMessage(text, isError) {
    const container = document.createElement('div');
    container.textContent = text;
    container.style.position = 'fixed';
    container.style.right = '16px';
    container.style.bottom = '16px';
    container.style.background = isError ? '#c0392b' : '#2ecc71';
    container.style.color = '#fff';
    container.style.padding = '8px 12px';
    container.style.borderRadius = '6px';
    container.style.boxShadow = '0 2px 6px rgba(0,0,0,.2)';
    document.body.appendChild(container);
    setTimeout(() => container.remove(), 2500);
}

document.addEventListener('DOMContentLoaded', initUI);