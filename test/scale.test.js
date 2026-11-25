// The 1-5 rating scale and the one-time conversion of 1-10 entries — Right BICEP.
// Covers the mapping itself, the IndexedDB v1 -> v2 upgrade, JSON imports, drafts and the Trends axis.
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory } = require('fake-indexeddb');
const { loadApp, plain } = require('./helpers/load-app');

const TS = Date.UTC(2026, 10, 25, 12);
const NOW = new Date(2026, 10, 25, 20, 0).getTime();
const at = (y, mo, d, h = 12) => new Date(y, mo - 1, d, h, 0).getTime();

// Build the database exactly as the 1-10 version of the app left it (version 1, no scale marker).
function seedV1(factory, records) {
    return new Promise((resolve, reject) => {
        const req = factory.open('emotion-tracker-db', 1);
        req.onupgradeneeded = () => {
            const store = req.result.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
            store.createIndex('timestamp', 'timestamp', { unique: false });
            records.forEach(r => store.add(r));
        };
        req.onsuccess = () => { req.result.close(); resolve(); };
        req.onerror = () => reject(req.error);
    });
}

const byId = (entries) => plain(entries).sort((a, b) => a.id - b.id);
const yTicks = (svg) => [...svg.matchAll(/<text class="trend-axis" x="\d+" y="[\d.]+" text-anchor="end">(\d+)<\/text>/g)].map(m => +m[1]);
const dotYs = (svg) => [...svg.matchAll(/<circle class="trend-dot" cx="[\d.]+" cy="(-?[\d.]+)"/g)].map(m => +m[1]);
const gridYs = (svg) => [...svg.matchAll(/<line class="trend-grid" x1="\d+" x2="\d+" y1="([\d.]+)"/g)].map(m => +m[1]);

describe('1-5 rating scale', () => {
    let app, get;
    beforeEach(() => { ({ app, get } = loadApp()); });

    describe('R: right results', () => {
        it('the scale runs 1 to 5', () => {
            assert.equal(get('SCALE_MAX'), 5);
        });

        it('maps every old rating to the expected new one', () => {
            const mapped = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(v => app.toScale5(v));
            assert.deepEqual(mapped, [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
        });

        it('converts the ratings in a values object and leaves the note alone', () => {
            assert.deepEqual(plain(app.valuesToScale5({ energy: 7, guilt: 10, focus: null, note: 'slept 9 hours' })),
                { energy: 4, guilt: 5, focus: null, note: 'slept 9 hours' });
        });

        it('new entries are stored with the scale marker', async () => {
            const id = await app.addEntry({ energy: 4 });
            const rec = plain(await app.getEntry(id));
            assert.equal(rec.scale, 5);
            assert.deepEqual(rec.values, { energy: 4 });
            assert.equal(rec.legacyValues10, undefined);
        });

        it('upgrading a 1-10 database converts every saved entry once', async () => {
            const factory = new IDBFactory();
            await seedV1(factory, [
                { timestamp: TS, values: { energy: 10, anxiety: 3, note: 'hi' }, exported: true },
                { timestamp: TS + 1, values: { energy: 1, focus: null }, exported: false, weather: { status: 'ok', temp: 50 } }
            ]);
            const { app: upgraded } = loadApp({ indexedDB: factory });
            const [a, b] = byId(await upgraded.getAllEntries());
            assert.deepEqual(a.values, { energy: 5, anxiety: 2, note: 'hi' });
            assert.deepEqual(b.values, { energy: 1, focus: null });
            assert.equal(a.scale, 5);
            assert.equal(a.exported, true, 'export flag is kept');
            assert.deepEqual(b.weather, { status: 'ok', temp: 50 }, 'weather is kept');
        });

        it('the Trends axis is labelled 1 to 5', () => {
            const series = app.computeDailySeries([{ timestamp: at(2026, 11, 25), values: { energy: 3 } }], 'energy', 7, NOW);
            assert.deepEqual(yTicks(app.buildTrendSvg(series, 'Energy', 640, null)), [1, 2, 3, 4, 5]);
        });
    });

    describe('B: boundary conditions (CORRECT)', () => {
        it('Range: the ends of the old scale land on the ends of the new one', () => {
            assert.equal(app.toScale5(1), 1);
            assert.equal(app.toScale5(10), 5);
        });

        it('Range: out-of-range or fractional old values are clamped into 1-5', () => {
            assert.equal(app.toScale5(0), 1);
            assert.equal(app.toScale5(-3), 1);
            assert.equal(app.toScale5(14), 5);
            assert.equal(app.toScale5(6.5), 4);
        });

        it('Existence: null, missing and non-numeric values pass through untouched', () => {
            assert.equal(app.toScale5(null), null);
            assert.equal(app.toScale5(undefined), undefined);
            assert.equal(app.toScale5('7'), '7');
            assert.ok(Number.isNaN(app.toScale5(NaN)));
        });

        it('Cardinality: an empty 1-10 database upgrades to an empty list', async () => {
            const factory = new IDBFactory();
            await seedV1(factory, []);
            const { app: upgraded } = loadApp({ indexedDB: factory });
            assert.deepEqual(plain(await upgraded.getAllEntries()), []);
        });

        it('Conformance: a record already on the 1-5 scale is returned as is', () => {
            const rec = { timestamp: TS, values: { energy: 2 }, scale: 5 };
            assert.equal(app.migrateRecordToScale5(rec), rec);
        });

        it('Range: a 5 is drawn on the top grid line and a 1 on the bottom one', () => {
            const series = app.computeDailySeries([
                { timestamp: at(2026, 11, 24), values: { energy: 1 } },
                { timestamp: at(2026, 11, 25), values: { energy: 5 } }
            ], 'energy', 7, NOW);
            const svg = app.buildTrendSvg(series, 'Energy', 640, null);
            const grid = gridYs(svg);
            assert.deepEqual(dotYs(svg), [Math.max(...grid), Math.min(...grid)]);
        });
    });

    describe('I: inverse relationships', () => {
        it('the original 1-10 ratings are kept beside the converted ones', () => {
            const out = plain(app.migrateRecordToScale5({ timestamp: TS, values: { energy: 7, note: 'x' } }));
            assert.deepEqual(out.legacyValues10, { energy: 7, note: 'x' });
            assert.deepEqual(out.values, { energy: 4, note: 'x' });
        });

        it('exporting then re-importing a 1-5 entry does not convert it a second time', async () => {
            await app.addEntry({ energy: 4 });
            const exported = JSON.parse(JSON.stringify(plain(await app.getAllEntries())));
            await app.clearAllEntries();
            await app.importEntriesFromArray(exported);
            const [rec] = plain(await app.getAllEntries());
            assert.deepEqual(rec.values, { energy: 4 });
            assert.equal(rec.scale, 5);
        });

        it('an upgraded entry keeps its 1-10 originals through an export and import', async () => {
            const factory = new IDBFactory();
            await seedV1(factory, [{ timestamp: TS, values: { energy: 9 }, exported: false }]);
            const { app: upgraded } = loadApp({ indexedDB: factory });
            const exported = JSON.parse(JSON.stringify(plain(await upgraded.getAllEntries())));
            await upgraded.clearAllEntries();
            await upgraded.importEntriesFromArray(exported);
            const [rec] = plain(await upgraded.getAllEntries());
            assert.deepEqual(rec.values, { energy: 5 });
            assert.deepEqual(rec.legacyValues10, { energy: 9 });
        });

        it('a draft saved on the new scale loads back unchanged', () => {
            app.saveDraft({ energy: 5, note: 'n' }, NOW);
            assert.deepEqual(plain(app.loadDraft(NOW)), { energy: 5, note: 'n' });
        });
    });

    describe('C: cross-checks', () => {
        it('the mapping agrees with a straight linear rescale of 1-10 onto 1-5 at every value', () => {
            for (let v = 1; v <= 10; v++) {
                assert.equal(app.toScale5(v), Math.round(1 + (v - 1) * 4 / 9), `old ${v}`);
            }
        });

        it('every new point covers exactly two old points', () => {
            const counts = {};
            for (let v = 1; v <= 10; v++) counts[app.toScale5(v)] = (counts[app.toScale5(v)] || 0) + 1;
            assert.deepEqual(counts, { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2 });
        });

        it('an import of an old 1-10 export matches what the database upgrade produces', async () => {
            const old = [{ timestamp: TS, values: { energy: 6, guilt: 2, note: 'n' }, exported: false }];
            const factory = new IDBFactory();
            await seedV1(factory, old);
            const { app: upgraded } = loadApp({ indexedDB: factory });
            await app.importEntriesFromArray(old);
            const strip = (list) => plain(list).map(({ id, ...rest }) => rest);
            assert.deepEqual(strip(await app.getAllEntries()), strip(await upgraded.getAllEntries()));
        });
    });

    describe('E: error conditions', () => {
        it('a draft left by the 1-10 app is converted instead of showing a 9 that no button matches', () => {
            const { app: fresh } = loadApp({ storage: { ll_draft_v1: JSON.stringify({ savedAt: NOW, values: { energy: 9, note: 'half done' } }) } });
            assert.deepEqual(plain(fresh.loadDraft(NOW)), { energy: 5, note: 'half done' });
        });

        it('odd stored records (no values, null values) survive the upgrade', async () => {
            const factory = new IDBFactory();
            await seedV1(factory, [{ timestamp: TS }, { timestamp: TS + 1, values: null }, { timestamp: TS + 2, values: { energy: 8 } }]);
            const { app: upgraded } = loadApp({ indexedDB: factory });
            const list = byId(await upgraded.getAllEntries());
            assert.equal(list.length, 3);
            assert.equal(list[0].values, undefined);
            assert.equal(list[1].values, null);
            assert.deepEqual(list[2].values, { energy: 4 });
        });

        it('a stray out-of-range rating is drawn inside the chart, not off the top', () => {
            const series = app.computeDailySeries([{ timestamp: at(2026, 11, 25), values: { energy: 8 } }], 'energy', 7, NOW);
            const svg = app.buildTrendSvg(series, 'Energy', 640, null);
            assert.deepEqual(dotYs(svg), [Math.min(...gridYs(svg))]);
        });

        it('opening the database a second time does not convert entries again', async () => {
            const factory = new IDBFactory();
            await seedV1(factory, [{ timestamp: TS, values: { energy: 10 } }]);
            await loadApp({ indexedDB: factory }).app.getAllEntries();
            const [rec] = plain(await loadApp({ indexedDB: factory }).app.getAllEntries());
            assert.deepEqual(rec.values, { energy: 5 }, '10 -> 5, not 10 -> 5 -> 3');
        });
    });

    describe('P: performance', () => {
        it('upgrades 5,000 stored entries in under 2 seconds', async () => {
            const factory = new IDBFactory();
            await seedV1(factory, Array.from({ length: 5000 }, (_, i) => ({ timestamp: TS + i, values: { energy: (i % 10) + 1, note: null } })));
            const t0 = performance.now();
            const { app: upgraded } = loadApp({ indexedDB: factory });
            const list = await upgraded.getAllEntries();
            const ms = performance.now() - t0;
            assert.equal(list.length, 5000);
            assert.ok(list.every(e => e.values.energy >= 1 && e.values.energy <= 5));
            assert.ok(ms < 2000, `took ${ms.toFixed(0)}ms`);
        });
    });
});
