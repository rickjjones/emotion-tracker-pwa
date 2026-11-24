// Quick-win usability helpers: Clear All wording, scale legend, delete + Undo — Right BICEP.
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, plain } = require('./helpers/load-app');

describe('Clear All confirmation text', () => {
    let app;
    beforeEach(() => { ({ app } = loadApp()); });

    describe('R: right results', () => {
        it('names the number of entries that will be deleted', () => {
            assert.match(app.clearAllConfirmText(42), /Delete all 42 entries\?/);
        });

        it('says it cannot be undone and points to a backup', () => {
            const text = app.clearAllConfirmText(5);
            assert.match(text, /cannot be undone/);
            assert.match(text, /Export your entries first/);
        });
    });

    describe('B: boundary conditions (CORRECT)', () => {
        it('uses singular wording for exactly one entry', () => {
            assert.match(app.clearAllConfirmText(1), /Delete your 1 entry\?/);
        });

        it('reports nothing to delete for zero entries', () => {
            assert.equal(app.clearAllConfirmText(0), 'There are no entries to delete.');
        });

        it('handles large counts without changing the wording', () => {
            assert.match(app.clearAllConfirmText(100000), /all 100000 entries/);
        });

        it('rounds a fractional count down (Range)', () => {
            assert.match(app.clearAllConfirmText(2.9), /all 2 entries/);
        });
    });

    describe('I: inverse relationships', () => {
        it('a count of zero never produces a delete prompt', () => {
            assert.doesNotMatch(app.clearAllConfirmText(0), /Delete/);
        });
    });

    describe('C: cross-check by other means', () => {
        it('the number in the text matches the number of stored entries', async () => {
            await app.importEntriesFromArray([{ a: 1 }, { a: 2 }, { a: 3 }]);
            const count = (await app.getAllEntries()).length;
            const shown = Number(app.clearAllConfirmText(count).match(/all (\d+) entries/)[1]);
            assert.equal(shown, count);
        });
    });

    describe('E: error conditions', () => {
        for (const bad of [-1, NaN, Infinity, undefined, null, '7']) {
            it(`treats ${String(bad)} as no entries`, () => {
                assert.equal(app.clearAllConfirmText(bad), 'There are no entries to delete.');
            });
        }
    });

    describe('P: performance', () => {
        it('builds 10,000 messages in well under 100ms', () => {
            const t0 = performance.now();
            for (let i = 0; i < 10000; i++) app.clearAllConfirmText(i);
            assert.ok(performance.now() - t0 < 100);
        });
    });
});

describe('Rating scale legend', () => {
    it('R: anchors both ends of the 1-10 scale and explains skipping', () => {
        const { get } = loadApp();
        const hint = get('SCALE_HINT');
        assert.match(hint, /1 \(not at all\)/);
        assert.match(hint, /10 \(extremely\)/);
        assert.match(hint, /skip/i);
        assert.match(hint, /tap a number again to clear/);
    });
});

describe('Delete with Undo', () => {
    let app;
    const rec = { timestamp: Date.UTC(2026, 10, 20, 9, 0), values: { energy: 6, note: 'walk' }, exported: true };
    beforeEach(async () => {
        ({ app } = loadApp());
        await app.importEntriesFromArray([rec, { timestamp: rec.timestamp + 1000, values: { energy: 3 } }]);
    });

    describe('R: right results', () => {
        it('deleting removes only that entry', async () => {
            const [first] = await app.getAllEntries();
            await app.deleteEntry(first.id);
            const left = await app.getAllEntries();
            assert.equal(left.length, 1);
            assert.notEqual(left[0].id, first.id);
        });
    });

    describe('I: inverse relationships', () => {
        it('Undo (put the saved record back) restores the entry exactly, id included', async () => {
            const [first] = await app.getAllEntries();
            const saved = await app.getEntry(first.id);
            await app.deleteEntry(first.id);
            await app.updateEntry(saved);
            assert.deepEqual(plain(await app.getEntry(first.id)), plain(saved));
            assert.equal((await app.getAllEntries()).length, 2);
        });
    });

    describe('C: cross-check by other means', () => {
        it('a restored entry keeps its exported flag, so it is not exported twice', async () => {
            const [first] = await app.getAllEntries();
            const saved = await app.getEntry(first.id);
            await app.deleteEntry(first.id);
            await app.updateEntry(saved);
            const unsynced = await app.getUnsyncedEntries();
            assert.ok(!unsynced.some(e => e.id === first.id));
        });
    });

    describe('B: boundary conditions (CORRECT)', () => {
        it('deleting the last remaining entry and undoing leaves one entry (Cardinality)', async () => {
            const all = await app.getAllEntries();
            await app.deleteEntry(all[1].id);
            const saved = await app.getEntry(all[0].id);
            await app.deleteEntry(all[0].id);
            assert.equal((await app.getAllEntries()).length, 0);
            await app.updateEntry(saved);
            assert.equal((await app.getAllEntries()).length, 1);
        });
    });

    describe('E: error conditions', () => {
        it('deleting an id that does not exist leaves the store unchanged', async () => {
            await app.deleteEntry(99999);
            assert.equal((await app.getAllEntries()).length, 2);
        });
    });
});
