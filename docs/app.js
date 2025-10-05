const EMOTIONS = [
    // High Moods
    'excitement','talkative','inflated_self_confidence','sleep_high',
    // Low Moods
    'energy','unmotivated','sleep_low','guilt','indecisive','crying',
    // ADHD
    'impulsive','absent_minded','time_management','interrupting','overwhelmed',
    // Note
    'note'
];

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
            // keep original timestamp if present, otherwise set now
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

// Export unsynced entries to CSV and mark them as exported
async function exportUnsyncedToCsv() {
    const unsynced = await getUnsyncedEntries();
    if (!unsynced || unsynced.length === 0) {
        flashMessage('No unsynced entries to export', true);
        return;
    }

    // Use same CSV builder as exportEntriesToCsv but only for unsynced
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

    // Mark exported
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

// Utility: escape a CSV cell according to RFC4180
function csvEscape(cell) {
    if (cell === null || typeof cell === 'undefined') return '';
    const s = String(cell);
    // If contains special chars, wrap in quotes and escape quotes
    if (/[",\r\n]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

// Helper to get emotion keys for CSV (excluding 'note', then add 'note' at end)
function getEmotionCsvKeys() {
    return [...EMOTIONS.filter(k => k !== 'note'), 'note'];
}

// Export all entries to CSV with stable headers
async function exportEntriesToCsv() {
    const entries = await getAllEntries();
    if (!entries || entries.length === 0) {
        flashMessage('No entries to export', true);
        return;
    }

    // Define header order: timestamp, id, then each EMOTION (in defined order)
    const headers = ['timestamp', 'id', ...getEmotionCsvKeys()];

    // Build rows
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

function formToValues() {
    const values = {};
    EMOTIONS.forEach(key => {
        const el = document.getElementById(key);
        if (!el) { values[key] = null; return; }

        // Treat 'note' as free text; other fields are numeric 1-10
        if (key === 'note') {
            const txt = (el.value || '').toString().trim();
            values[key] = txt.length ? txt : null;
            return;
        }

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
    // show most recent first
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

// Escape HTML to avoid injection when rendering notes
function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (s) {
        return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]);
    });
}

async function initUI() {
    const form = document.getElementById('emotion-form');
    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const values = formToValues();
        await addEntry(values);
        // clear inputs
        EMOTIONS.forEach(k => {
            const el = document.getElementById(k);
            if (el) el.value = '';
        });
        const entries = await getAllEntries();
        renderEntriesList(entries);
        flashMessage('Saved');
    });

    const viewBtn = document.getElementById('view-history');
    const display = document.getElementById('emotion-display');
    // Hide history by default
    if (display) display.style.display = 'none';

    viewBtn.addEventListener('click', async () => {
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

    document.getElementById('export-json').addEventListener('click', () => {
        exportEntriesToJson();
    });

    // Export CSV button (new)
    const exportCsvBtn = document.getElementById('export-csv');
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', () => {
        exportEntriesToCsv();
    });

    // Export Unsynced button
    const exportUnsyncedBtn = document.getElementById('export-unsynced');
    if (exportUnsyncedBtn) exportUnsyncedBtn.addEventListener('click', () => {
        exportUnsyncedToCsv();
    });

    const importFile = document.getElementById('import-file');
    document.getElementById('import-json').addEventListener('click', () => {
        importFile.value = '';
        importFile.click();
    });

    importFile.addEventListener('change', async (ev) => {
        const file = ev.target.files && ev.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            await importEntriesFromArray(data);
            // Refresh history only if it's visible
            const entries = await getAllEntries();
            if (display && display.style.display !== 'none') {
                renderEntriesList(entries);
            }
            flashMessage('Imported');
        } catch (err) {
            flashMessage('Import failed', true);
            console.error(err);
        }
    });

    document.getElementById('clear-all').addEventListener('click', async () => {
        if (!confirm('Clear all emotion entries?')) return;
        await clearAllEntries();
        renderEntriesList([]);
        flashMessage('Cleared');
    });

    // Undo last export: read lastExportedIds from localStorage and mark exported=false for them
    const undoBtn = document.getElementById('undo-last-export');
    if (undoBtn) undoBtn.addEventListener('click', async () => {
        const raw = localStorage.getItem('lastExportedIds');
        if (!raw) { flashMessage('Nothing to undo', true); return; }
        let ids;
        try { ids = JSON.parse(raw); } catch (e) { flashMessage('Nothing to undo', true); return; }
        if (!Array.isArray(ids) || ids.length === 0) { flashMessage('Nothing to undo', true); return; }
        // revert
        const db = await openDb();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        ids.forEach(id => {
            const req = store.get(id);
            req.onsuccess = () => {
                const rec = req.result;
                if (rec) {
                    rec.exported = false;
                    store.put(rec);
                }
            };
        });
        tx.oncomplete = async () => {
            localStorage.removeItem('lastExportedIds');
            const entries = await getAllEntries();
            renderEntriesList(entries);
            flashMessage('Undo complete');
        };
        tx.onerror = () => {
            flashMessage('Undo failed', true);
        };
    });

    // initial render
    const entries = await getAllEntries();
    renderEntriesList(entries);

    // Menu toggle behavior: open/close and outside click to close
    const menuToggle = document.getElementById('menu-toggle');
    const menuFlyout = document.getElementById('menu-flyout');
    if (menuToggle && menuFlyout) {
        const toggleOpen = (ev) => {
            if (ev && ev.stopPropagation) ev.stopPropagation();
            const isHidden = menuFlyout.hasAttribute('hidden');
            if (!isHidden) {
                menuFlyout.setAttribute('hidden', '');
                menuToggle.setAttribute('aria-expanded', 'false');
            } else {
                menuFlyout.removeAttribute('hidden');
                menuToggle.setAttribute('aria-expanded', 'true');
                // move focus into the first button for a11y
                const firstBtn = menuFlyout.querySelector('button');
                if (firstBtn) firstBtn.focus();
            }
        };

        // handle both click and touchstart for better mobile reliability
        menuToggle.addEventListener('click', toggleOpen);
        menuToggle.addEventListener('touchstart', (ev) => { ev.preventDefault(); toggleOpen(ev); }, { passive: false });

        // prevent clicks inside the flyout from bubbling up and closing it
        menuFlyout.addEventListener('click', (ev) => { ev.stopPropagation(); });
        menuFlyout.addEventListener('touchstart', (ev) => { ev.stopPropagation(); }, { passive: true });

        // close when clicking anywhere outside
        document.addEventListener('click', (ev) => {
            if (!menuFlyout.contains(ev.target) && ev.target !== menuToggle) {
                menuFlyout.setAttribute('hidden', '');
                menuToggle.setAttribute('aria-expanded', 'false');
            }
        });

        // ESC to close
        document.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') {
                if (!menuFlyout.hasAttribute('hidden')) {
                    menuFlyout.setAttribute('hidden', '');
                    menuToggle.setAttribute('aria-expanded', 'false');
                    menuToggle.focus();
                }
            }
        });
    }
}

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