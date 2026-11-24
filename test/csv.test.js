// CSV export: csvEscape, buildCsv, getEmotionCsvKeys — organized by Right BICEP.
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, plain } = require('./helpers/load-app');

// Minimal RFC 4180 parser used as an independent cross-check of the writer.
function parseCsv(text) {
    const rows = []; let row = []; let cell = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (q) {
            if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
            else if (ch === '"') q = false;
            else cell += ch;
        } else if (ch === '"') q = true;
        else if (ch === ',') { row.push(cell); cell = ''; }
        else if (ch === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
        else cell += ch;
    }
    row.push(cell); rows.push(row);
    return rows;
}

const TS = Date.UTC(2026, 10, 23, 12, 0, 0); // 2026-11-23T12:00:00.000Z

describe('CSV export', () => {
    let app;
    beforeEach(() => { ({ app } = loadApp()); });

    describe('R: right results', () => {
        it('leaves plain cells untouched', () => {
            assert.equal(app.csvEscape('happy'), 'happy');
            assert.equal(app.csvEscape(7), '7');
        });

        it('quotes cells containing a comma', () => {
            assert.equal(app.csvEscape('tired, sad'), '"tired, sad"');
        });

        it('doubles embedded quotes and wraps the cell', () => {
            assert.equal(app.csvEscape('she said "hi"'), '"she said ""hi"""');
        });

        it('builds a header row and one row per entry', () => {
            const csv = app.buildCsv([{ id: 3, timestamp: TS, values: { energy: 5, note: 'ok' } }], ['energy', 'note']);
            assert.equal(csv, 'timestamp,id,energy,note\r\n2026-11-23T12:00:00.000Z,3,5,ok');
        });

        it('lists tracked emotions in category order with note last', () => {
            const keys = plain(app.getEmotionCsvKeys());
            assert.equal(keys[0], 'excitement');
            assert.equal(keys.at(-1), 'note');
            assert.equal(keys.length, 16); // 15 default emotions + note
        });
    });

    describe('B: boundary conditions (CORRECT)', () => {
        it('Existence: null and undefined become empty cells', () => {
            assert.equal(app.csvEscape(null), '');
            assert.equal(app.csvEscape(undefined), '');
        });

        it('Existence: 0 and false are kept, not blanked', () => {
            assert.equal(app.csvEscape(0), '0');
            assert.equal(app.csvEscape(false), 'false');
        });

        it('Existence: an empty string stays empty and unquoted', () => {
            assert.equal(app.csvEscape(''), '');
        });

        it('Conformance: quotes cells with CR, LF or CRLF line breaks', () => {
            assert.equal(app.csvEscape('a\nb'), '"a\nb"');
            assert.equal(app.csvEscape('a\rb'), '"a\rb"');
            assert.equal(app.csvEscape('a\r\nb'), '"a\r\nb"');
        });

        it('Conformance: a lone quote character is escaped', () => {
            assert.equal(app.csvEscape('"'), '""""');
        });

        it('Conformance: uses CRLF between records', () => {
            const csv = app.buildCsv([{ id: 1, timestamp: TS, values: {} }, { id: 2, timestamp: TS, values: {} }], ['note']);
            assert.equal(csv.split('\r\n').length, 3);
            assert.ok(!/[^\r]\n/.test(csv), 'no bare LF line endings');
        });

        it('Cardinality: zero entries yields only the header', () => {
            assert.equal(app.buildCsv([], ['energy', 'note']), 'timestamp,id,energy,note');
        });

        it('Existence: missing values object and missing keys produce blanks', () => {
            const csv = app.buildCsv([{ id: 1, timestamp: TS }], ['energy', 'note']);
            assert.equal(csv.split('\r\n')[1], '2026-11-23T12:00:00.000Z,1,,');
        });

        it('Existence: a missing id becomes an empty cell', () => {
            const csv = app.buildCsv([{ timestamp: TS, values: { energy: 2 } }], ['energy']);
            assert.equal(csv.split('\r\n')[1], '2026-11-23T12:00:00.000Z,,2');
        });

        it('Reference: only tracked emotions become columns', () => {
            app.setTrackedKeys(['crying', 'energy']);
            // category order (low: energy before crying), not the saved order
            assert.deepEqual(plain(app.getEmotionCsvKeys()), ['energy', 'crying', 'note']);
        });

        it('Unicode passes through unchanged', () => {
            assert.equal(app.csvEscape('café 😊'), 'café 😊');
        });
    });

    describe('I: inverse relationships', () => {
        it('parsing an escaped cell gives back the original text', () => {
            const samples = ['plain', 'a,b', 'quote " inside', '"wrapped"', 'line\r\nbreak', 'mixed, "all"\nof it', ''];
            for (const s of samples) {
                assert.deepEqual(parseCsv(app.csvEscape(s)), [[s]], `round trip of ${JSON.stringify(s)}`);
            }
        });

        it('parsing a built CSV gives back every entry value', () => {
            const entries = [
                { id: 1, timestamp: TS, values: { energy: 3, note: 'slept badly, "rough" night\nbetter later' } },
                { id: 2, timestamp: TS + 86400000, values: { energy: 9, note: null } }
            ];
            const rows = parseCsv(app.buildCsv(entries, ['energy', 'note']));
            assert.deepEqual(rows[0], ['timestamp', 'id', 'energy', 'note']);
            assert.equal(rows[1][3], entries[0].values.note);
            assert.equal(Number(rows[2][2]), 9);
            assert.equal(new Date(rows[2][0]).getTime(), entries[1].timestamp);
        });
    });

    describe('C: cross-checks', () => {
        it('every row has as many cells as the header, even with tricky notes', () => {
            const entries = Array.from({ length: 20 }, (_, i) => ({
                id: i + 1, timestamp: TS + i, values: { energy: (i % 10) + 1, note: i % 2 ? `a,b\n"${i}"` : null }
            }));
            const keys = plain(app.getEmotionCsvKeys());
            const rows = parseCsv(app.buildCsv(entries, keys));
            assert.equal(rows.length, entries.length + 1);
            for (const r of rows) assert.equal(r.length, keys.length + 2);
        });
    });

    describe('E: error conditions', () => {
        it('falls back to all default columns when the tracked list is corrupted', () => {
            app.localStorage.setItem('ll_tracked_emotions_v1', '{not json');
            assert.equal(app.getEmotionCsvKeys().length, 16);
        });

        it('rejects an entry with an invalid timestamp instead of writing garbage', () => {
            assert.throws(() => app.buildCsv([{ id: 1, timestamp: NaN, values: {} }], []), RangeError);
        });
    });

    describe('P: performance', () => {
        it('builds a CSV for 10,000 entries quickly', () => {
            const keys = plain(app.getEmotionCsvKeys());
            const entries = Array.from({ length: 10000 }, (_, i) => {
                const values = { note: i % 3 ? 'note, with "quotes"' : null };
                keys.forEach(k => { if (k !== 'note') values[k] = (i % 10) + 1; });
                return { id: i + 1, timestamp: TS + i * 60000, values };
            });
            const t0 = performance.now();
            const csv = app.buildCsv(entries, keys);
            const ms = performance.now() - t0;
            assert.equal(csv.split('\r\n').length, 10001);
            assert.ok(ms < 1000, `took ${ms.toFixed(0)} ms`);
        });
    });
});
