// IndexedDB entry storage, JSON import/export round trips and the unsynced-export flags — Right BICEP.
// Uses fake-indexeddb (a dev-only dependency); the shipped app has none.
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, plain } = require('./helpers/load-app');

const TS = Date.UTC(2026, 10, 23, 12);
const strip = (records) => plain(records).map(({ id, ...rest }) => rest);

describe('Entry storage', () => {
    let app, localStorage;
    beforeEach(() => { ({ app, localStorage } = loadApp()); });

    describe('R: right results', () => {
        it('a new entry is stored unexported with a timestamp and an id', async () => {
            const before = Date.now();
            const id = await app.addEntry({ energy: 5, note: 'ok' });
            const rec = plain(await app.getEntry(id));
            assert.equal(typeof id, 'number');
            assert.deepEqual(rec.values, { energy: 5, note: 'ok' });
            assert.equal(rec.exported, false);
            assert.ok(rec.timestamp >= before && rec.timestamp <= Date.now());
        });

        it('new entries count as unsynced', async () => {
            await app.addEntry({ energy: 1 });
            await app.addEntry({ energy: 2 });
            assert.equal((await app.getUnsyncedEntries()).length, 2);
        });

        it('marking entries exported removes them from the unsynced list', async () => {
            const a = await app.addEntry({ energy: 1 });
            const b = await app.addEntry({ energy: 2 });
            await app.markEntriesExported([a]);
            const unsynced = plain(await app.getUnsyncedEntries());
            assert.deepEqual(unsynced.map(e => e.id), [b]);
            assert.equal((await app.getEntry(a)).exported, true);
        });

        it('remembers the last exported ids so the export can be undone', async () => {
            const a = await app.addEntry({ energy: 1 });
            await app.markEntriesExported([a]);
            assert.deepEqual(JSON.parse(localStorage.getItem('lastExportedIds')), [a]);
        });

        it('updateEntry replaces a record and deleteEntry removes only that one', async () => {
            const a = await app.addEntry({ energy: 1 });
            const b = await app.addEntry({ energy: 2 });
            const rec = plain(await app.getEntry(a));
            await app.updateEntry({ ...rec, values: { energy: 9 } });
            assert.equal((await app.getEntry(a)).values.energy, 9);
            await app.deleteEntry(a);
            assert.equal(await app.getEntry(a), undefined);
            assert.ok(await app.getEntry(b));
        });

        it('normalizes imported records and bare value objects', () => {
            assert.deepEqual(plain(app.normalizeImportRecord({ timestamp: TS, values: { energy: 3 }, exported: true })),
                { timestamp: TS, values: { energy: 3 }, exported: true });
            const bare = plain(app.normalizeImportRecord({ energy: 4 }));
            assert.deepEqual(bare.values, { energy: 4 });
            assert.equal(bare.exported, false);
        });
    });

    describe('B: boundary conditions (CORRECT)', () => {
        it('Cardinality: an empty database has no entries and nothing unsynced', async () => {
            assert.deepEqual(plain(await app.getAllEntries()), []);
            assert.deepEqual(plain(await app.getUnsyncedEntries()), []);
        });

        it('Cardinality: marking an empty or missing id list is a no-op', async () => {
            await app.addEntry({ energy: 1 });
            await app.markEntriesExported([]);
            await app.markEntriesExported(undefined);
            assert.equal((await app.getUnsyncedEntries()).length, 1);
            assert.equal(localStorage.getItem('lastExportedIds'), null);
        });

        it('Reference: marking ids that do not exist creates nothing', async () => {
            await app.markEntriesExported([999]);
            assert.equal((await app.getAllEntries()).length, 0);
        });

        it('Cardinality: importing an empty array adds nothing', async () => {
            await app.importEntriesFromArray([]);
            assert.equal((await app.getAllEntries()).length, 0);
        });

        it('Existence: imported records without a timestamp get the current time', () => {
            const before = Date.now();
            const rec = app.normalizeImportRecord({ values: { energy: 2 } });
            assert.ok(rec.timestamp >= before);
        });

        it('Conformance: imported ids are ignored, so imports never overwrite existing entries', async () => {
            const existing = await app.addEntry({ energy: 1 });
            await app.importEntriesFromArray([{ id: existing, timestamp: TS, values: { energy: 8 } }]);
            assert.equal((await app.getEntry(existing)).values.energy, 1);
            assert.equal((await app.getAllEntries()).length, 2);
        });

        it('Ordering: the exported flag survives the order of operations add -> export -> edit', async () => {
            const id = await app.addEntry({ energy: 1 });
            await app.markEntriesExported([id]);
            // editing marks it unsynced again (as saveEntryEditModal does)
            await app.updateEntry({ ...plain(await app.getEntry(id)), exported: false });
            assert.equal((await app.getUnsyncedEntries()).length, 1);
        });
    });

    describe('I: inverse relationships', () => {
        it('JSON export then import into a fresh database restores the same entries', async () => {
            await app.addEntry({ energy: 3, note: 'comma, "quote"\nnewline' });
            await app.addEntry({ energy: null, guilt: 7, note: null });
            const exported = JSON.stringify(await app.getAllEntries(), null, 2);

            const fresh = loadApp().app;
            await fresh.importEntriesFromArray(JSON.parse(exported));
            assert.deepEqual(strip(await fresh.getAllEntries()), strip(JSON.parse(exported)));
        });

        it('an export round trip preserves exported flags', async () => {
            const a = await app.addEntry({ energy: 1 });
            await app.addEntry({ energy: 2 });
            await app.markEntriesExported([a]);
            const fresh = loadApp().app;
            await fresh.importEntriesFromArray(JSON.parse(JSON.stringify(await app.getAllEntries())));
            assert.equal((await fresh.getUnsyncedEntries()).length, 1);
        });

        it('add then delete leaves the database as it was', async () => {
            await app.addEntry({ energy: 1 });
            const before = strip(await app.getAllEntries());
            const id = await app.addEntry({ energy: 2 });
            await app.deleteEntry(id);
            assert.deepEqual(strip(await app.getAllEntries()), before);
        });

        it('clearAllEntries empties the store', async () => {
            await app.importEntriesFromArray([{ energy: 1 }, { energy: 2 }]);
            await app.clearAllEntries();
            assert.equal((await app.getAllEntries()).length, 0);
        });
    });

    describe('C: cross-checks', () => {
        it('unsynced + exported always add up to all entries', async () => {
            const ids = [];
            for (let i = 0; i < 10; i++) ids.push(await app.addEntry({ energy: i + 1 }));
            await app.markEntriesExported(ids.filter((_, i) => i % 3 === 0));
            const all = await app.getAllEntries();
            const unsynced = await app.getUnsyncedEntries();
            const exported = all.filter(e => e.exported === true);
            assert.equal(unsynced.length + exported.length, all.length);
            assert.equal(exported.length, 4);
        });

        it('an import of N items adds exactly N entries', async () => {
            await app.addEntry({ energy: 1 });
            await app.importEntriesFromArray(Array.from({ length: 25 }, (_, i) => ({ timestamp: TS + i, values: { energy: 5 } })));
            assert.equal((await app.getAllEntries()).length, 26);
        });
    });

    describe('E: error conditions', () => {
        it('rejects an import that is not an array', async () => {
            for (const bad of [null, {}, 'entries', 5]) {
                await assert.rejects(app.importEntriesFromArray(bad), /Invalid import format/);
            }
        });

        it('rejects an import with a bad item and stores none of it (no partial imports)', async () => {
            for (const bad of [null, 'text', 7, [1, 2]]) {
                await assert.rejects(app.importEntriesFromArray([{ energy: 1 }, bad]), /Invalid import format/);
            }
            assert.equal((await app.getAllEntries()).length, 0);
        });

        it('surfaces a database that cannot be opened', async () => {
            const brokenIdb = {
                open() {
                    const req = {};
                    setTimeout(() => { req.error = new Error('blocked'); req.onerror && req.onerror(); });
                    return req;
                }
            };
            const { app: broken } = loadApp({ indexedDB: brokenIdb });
            await assert.rejects(broken.addEntry({ energy: 1 }), /blocked/);
            await assert.rejects(broken.getAllEntries(), /blocked/);
        });

        it('still marks entries exported when localStorage is unavailable', async () => {
            const id = await app.addEntry({ energy: 1 });
            localStorage.failing = true;
            await app.markEntriesExported([id]);
            assert.equal((await app.getEntry(id)).exported, true);
        });
    });

    describe('P: performance', () => {
        it('imports and reads back 5,000 entries quickly', async () => {
            const items = Array.from({ length: 5000 }, (_, i) => ({ timestamp: TS + i * 60000, values: { energy: (i % 10) + 1 } }));
            const t0 = performance.now();
            await app.importEntriesFromArray(items);
            const all = await app.getAllEntries();
            const ms = performance.now() - t0;
            assert.equal(all.length, 5000);
            assert.ok(ms < 5000, `took ${ms.toFixed(0)} ms`);
        });

        it('marks 1,000 entries exported in one transaction quickly', async () => {
            await app.importEntriesFromArray(Array.from({ length: 1000 }, () => ({ energy: 1 })));
            const ids = (await app.getAllEntries()).map(e => e.id);
            const t0 = performance.now();
            await app.markEntriesExported(ids);
            assert.ok(performance.now() - t0 < 3000);
            assert.equal((await app.getUnsyncedEntries()).length, 0);
        });
    });
});
