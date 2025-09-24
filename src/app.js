const EMOTIONS = ['happiness','sadness','anger','fear','surprise','disgust','anticipation','trust','joy','calm'];
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
        const record = { timestamp: Date.now(), values };
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
                values: item.values || item
            };
            store.add(record);
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
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
    EMOTIONS.forEach(key => {
        const el = document.getElementById(key);
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
        const values = Object.entries(e.values || {}).map(([k,v]) => `<li>${k}: ${v === null ? '—' : v}</li>`).join('');
        return `<div class="entry"><strong>${date.toLocaleString()}</strong><ul>${values}</ul></div>`;
    }).join('');
    container.innerHTML = html;
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

    document.getElementById('view-history').addEventListener('click', async () => {
        const entries = await getAllEntries();
        renderEntriesList(entries);
    });

    document.getElementById('export-json').addEventListener('click', () => {
        exportEntriesToJson();
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
            const entries = await getAllEntries();
            renderEntriesList(entries);
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

    // initial render
    const entries = await getAllEntries();
    renderEntriesList(entries);
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