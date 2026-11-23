// Loads docs/app.js into an isolated VM context with small browser stand-ins,
// so the shipped app stays a plain script with no build step or dependencies.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');

const APP_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'app.js'), 'utf8');
const APP_SCRIPT = new vm.Script(APP_SRC, { filename: 'docs/app.js' });

// In-memory localStorage. `failing` makes every call throw, like Safari private mode
// or a full quota.
function createLocalStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    const ls = {
        failing: false,
        getItem(k) { if (ls.failing) throw new Error('storage disabled'); return map.has(k) ? map.get(k) : null; },
        setItem(k, v) { if (ls.failing) throw new Error('QuotaExceededError'); map.set(k, String(v)); },
        removeItem(k) { if (ls.failing) throw new Error('storage disabled'); map.delete(k); },
        clear() { map.clear(); },
        get length() { return map.size; },
        _map: map
    };
    return ls;
}

// Just enough DOM for app.js to load: no element exists, so UI code paths no-op.
function createDocument() {
    const el = () => ({
        style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        setAttribute() {}, appendChild() {}, addEventListener() {}, remove() {}, click() {}, querySelector: () => null
    });
    return {
        documentElement: el(),
        body: el(),
        addEventListener() {},
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: el
    };
}

/**
 * Load a fresh copy of the app.
 * @param {object} [opts]
 * @param {object} [opts.storage] initial localStorage contents
 * @param {object} [opts.indexedDB] replacement IndexedDB factory (defaults to a fresh fake)
 */
function loadApp(opts = {}) {
    const localStorage = createLocalStorage(opts.storage);
    const sandbox = {
        console,
        Date,                 // share the host Date so tests can reason about times
        setTimeout, clearTimeout,
        localStorage,
        indexedDB: opts.indexedDB || new IDBFactory(),
        IDBKeyRange,
        document: createDocument(),
        window: { matchMedia: () => ({ matches: false }), addEventListener() {} },
        confirm: () => true,
        Blob: globalThis.Blob,
        URL: globalThis.URL
    };
    const ctx = vm.createContext(sandbox);
    APP_SCRIPT.runInContext(ctx);
    // `get('CATEGORIES')` reads top-level const/let bindings, which are not context properties.
    const get = (expr) => vm.runInContext(expr, ctx);
    return { app: ctx, get, localStorage };
}

// Values created inside the VM have that realm's prototypes; clone into this realm
// so assert.deepStrictEqual compares structure only.
function plain(value) { return structuredClone(value); }

module.exports = { loadApp, plain, createLocalStorage };
