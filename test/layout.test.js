// Layout stage helpers: views, export sheet, Manage emotions, grouped history — Right BICEP.
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, plain } = require('./helpers/load-app');

const DAY = 86400000;
// Local noon, so day arithmetic never straddles midnight
const NOW = new Date(2026, 10, 23, 12, 0).getTime();

describe('View routing (parseViewHash)', () => {
    let app;
    beforeEach(() => { ({ app } = loadApp()); });

    describe('R: right results', () => {
        it('maps each tab hash to its view', () => {
            assert.equal(app.parseViewHash('#log'), 'log');
            assert.equal(app.parseViewHash('#history'), 'history');
            assert.equal(app.parseViewHash('#settings'), 'settings');
        });
    });

    describe('B: boundary conditions (CORRECT)', () => {
        it('an empty hash opens Log (Existence)', () => {
            assert.equal(app.parseViewHash(''), 'log');
            assert.equal(app.parseViewHash('#'), 'log');
        });

        it('is case-insensitive and works without the # (Conformance)', () => {
            assert.equal(app.parseViewHash('#HISTORY'), 'history');
            assert.equal(app.parseViewHash('settings'), 'settings');
        });
    });

    describe('E: error conditions', () => {
        for (const bad of ['#trends', '#history/2', null, undefined, 42]) {
            it(`falls back to Log for ${JSON.stringify(bad)}`, () => {
                assert.equal(app.parseViewHash(bad), 'log');
            });
        }
    });
});

describe('Export selection and file names', () => {
    let app;
    const entries = [
        { id: 1, timestamp: NOW - 2 * DAY, values: {}, exported: true },
        { id: 2, timestamp: NOW - DAY, values: {}, exported: false },
        { id: 3, timestamp: NOW, values: {} }
    ];
    beforeEach(() => { ({ app } = loadApp()); });

    describe('R: right results', () => {
        it('"all" returns every entry', () => {
            assert.deepEqual(plain(app.selectEntriesForExport(entries, 'all').map(e => e.id)), [1, 2, 3]);
        });

        it('"new" returns only entries not yet exported (missing flag counts as new)', () => {
            assert.deepEqual(plain(app.selectEntriesForExport(entries, 'new').map(e => e.id)), [2, 3]);
        });

        it('names files by scope, date and format', () => {
            const d = new Date(2026, 10, 23);
            assert.equal(app.exportFileName('csv', 'all', d), 'lifelens-all-2026-11-23.csv');
            assert.equal(app.exportFileName('json', 'new', d), 'lifelens-new-2026-11-23.json');
        });
    });

    describe('I: inverse relationships', () => {
        it('"new" plus the exported entries add back up to "all"', () => {
            const fresh = app.selectEntriesForExport(entries, 'new');
            const done = entries.filter(e => e.exported);
            assert.equal(fresh.length + done.length, app.selectEntriesForExport(entries, 'all').length);
        });

        it('"all" returns a copy, so sorting it leaves the caller\'s array alone', () => {
            const copy = app.selectEntriesForExport(entries, 'all');
            copy.reverse();
            assert.equal(entries[0].id, 1);
        });
    });

    describe('C: cross-check by other means', () => {
        it('"new" matches what getUnsyncedEntries reads from the database', async () => {
            await app.importEntriesFromArray(entries.map(({ id, ...rest }) => rest));
            const all = await app.getAllEntries();
            const viaHelper = app.selectEntriesForExport(all, 'new').map(e => e.id).sort();
            const viaDb = (await app.getUnsyncedEntries()).map(e => e.id).sort();
            assert.deepEqual(plain(viaHelper), plain(viaDb));
        });
    });

    describe('B: boundary conditions (CORRECT)', () => {
        it('no entries gives an empty selection (Cardinality)', () => {
            assert.deepEqual(plain(app.selectEntriesForExport([], 'new')), []);
        });

        it('an unknown format falls back to CSV (Conformance)', () => {
            assert.match(app.exportFileName('xml', 'all', new Date(NOW)), /\.csv$/);
        });
    });

    describe('E: error conditions', () => {
        it('a non-array is treated as no entries', () => {
            assert.deepEqual(plain(app.selectEntriesForExport(null, 'all')), []);
            assert.deepEqual(plain(app.selectEntriesForExport({}, 'new')), []);
        });

        it('an invalid date falls back to today instead of "NaN"', () => {
            assert.doesNotMatch(app.exportFileName('csv', 'all', new Date('nope')), /NaN/);
        });
    });
});

describe('Manage emotions (buildEmotionConfig)', () => {
    let app, get;
    beforeEach(() => { ({ app, get } = loadApp()); });
    const panel = (catId, title, rows) => ({ catId, title, rows });
    const row = (label, opts = {}) => Object.assign({ key: '', origKey: '', label, visible: true }, opts);

    describe('R: right results', () => {
        it('builds categories, labels and the shown list from the dialog', () => {
            const r = app.buildEmotionConfig([
                panel('mood', 'Mood', [row('Calm', { key: 'calm', origKey: 'calm' }), row('Wired', { key: 'wired', origKey: 'wired', visible: false })])
            ], {});
            assert.deepEqual(plain(r.categories), { mood: { title: 'Mood', keys: ['calm', 'wired'] } });
            assert.deepEqual(plain(r.labels), { calm: 'Calm', wired: 'Wired' });
            assert.deepEqual(plain(r.tracked), ['calm']);
            assert.deepEqual(plain(r.renamed), []);
        });

        it('a new emotion with no key gets one from its name', () => {
            const r = app.buildEmotionConfig([panel('adhd', 'ADHD', [row('Really Restless!')])], {});
            assert.deepEqual(plain(r.categories.adhd.keys), ['really_restless']);
        });

        it('renaming a default emotion keeps its key and stores only the new label', () => {
            const r = app.buildEmotionConfig([panel('high', 'High Moods', [row('Buzzing', { key: 'excitement', origKey: 'excitement' })])], get('DEFAULT_LABELS'));
            assert.deepEqual(plain(r.categories.high.keys), ['excitement']);
            assert.equal(r.labels.excitement, 'Buzzing');
        });

        it('an unchanged default label is not stored as a custom label', () => {
            const r = app.buildEmotionConfig([panel('low', 'Low Moods', [row('Guilt', { key: 'guilt', origKey: 'guilt' })])], get('DEFAULT_LABELS'));
            assert.deepEqual(plain(r.labels), {});
        });
    });

    describe('B: boundary conditions (CORRECT)', () => {
        it('empty categories are dropped (Cardinality)', () => {
            const r = app.buildEmotionConfig([panel('a', 'A', [row('One')]), panel('b', 'B', [row('   ')])], {});
            assert.deepEqual(Object.keys(plain(r.categories)), ['a']);
        });

        it('a new category gets an id from its name that avoids existing ids (Existence)', () => {
            const r = app.buildEmotionConfig([panel('sleep', 'Sleep', [row('Hours')]), panel('', 'Sleep', [row('Naps')])], {});
            assert.deepEqual(Object.keys(plain(r.categories)), ['sleep', 'sleep_2']);
        });

        it('changing a key is reported so the user can be warned (Reference)', () => {
            const r = app.buildEmotionConfig([panel('x', 'X', [row('Energy', { key: 'vigour', origKey: 'energy' })])], {});
            assert.deepEqual(plain(r.renamed), ['energy']);
        });

        it('hiding every emotion is refused (Range)', () => {
            const r = app.buildEmotionConfig([panel('x', 'X', [row('A', { visible: false }), row('B', { visible: false })])], {});
            assert.match(r.error, /at least one emotion to show/);
        });
    });

    describe('I: inverse relationships', () => {
        it('feeding the default categories back in reproduces them exactly', () => {
            const CATEGORIES = get('CATEGORIES');
            const LABELS = get('DEFAULT_LABELS');
            const panels = Object.entries(CATEGORIES).map(([id, c]) => panel(id, c.title, c.keys.map(k => row(LABELS[k], { key: k, origKey: k }))));
            const r = app.buildEmotionConfig(panels, LABELS);
            assert.deepEqual(plain(r.categories), plain(CATEGORIES));
            assert.deepEqual(plain(r.labels), {});
        });
    });

    describe('C: cross-check by other means', () => {
        it('the result saves and loads through the existing config code unchanged', () => {
            const r = app.buildEmotionConfig([panel('mood', 'Mood', [row('Calm'), row('Tense')])], {});
            assert.equal(app.setSavedCategories({ version: 2, categories: r.categories, labels: r.labels }), true);
            assert.deepEqual(plain(app.loadEffectiveCategories()), plain(r.categories));
        });
    });

    describe('E: error conditions', () => {
        it('no emotions at all is refused', () => {
            assert.match(app.buildEmotionConfig([], {}).error, /at least one emotion/);
            assert.match(app.buildEmotionConfig(null, {}).error, /at least one emotion/);
        });

        it('an emotion called "note" is refused because the note field uses that key', () => {
            assert.match(app.buildEmotionConfig([panel('x', 'X', [row('Note')])], {}).error, /reserved/);
        });

        it('two emotions with the same name are refused', () => {
            const r = app.buildEmotionConfig([panel('a', 'A', [row('Calm')]), panel('b', 'B', [row('calm')])], {});
            assert.match(r.error, /share the name or key: calm/);
        });
    });

    describe('P: performance', () => {
        it('handles 50 categories of 20 emotions in well under 100ms', () => {
            const panels = Array.from({ length: 50 }, (_, c) => panel('c' + c, 'Cat ' + c, Array.from({ length: 20 }, (_, e) => row(`E ${c} ${e}`))));
            const t0 = performance.now();
            const r = app.buildEmotionConfig(panels, {});
            assert.equal(r.tracked.length, 1000);
            assert.ok(performance.now() - t0 < 100);
        });
    });
});

describe('Grouped history', () => {
    let app;
    beforeEach(() => { ({ app } = loadApp()); });

    describe('R: right results', () => {
        it('labels today and yesterday by name', () => {
            assert.equal(app.dayHeading(NOW - 3600000, NOW), 'Today');
            assert.equal(app.dayHeading(NOW - DAY, NOW), 'Yesterday');
        });

        it('groups entries by day, newest day and newest entry first', () => {
            const groups = app.groupEntriesByDay([
                { id: 1, timestamp: NOW - DAY - 3600000 },
                { id: 2, timestamp: NOW - 3600000 },
                { id: 3, timestamp: NOW - 7200000 },
                { id: 4, timestamp: NOW - DAY }
            ], NOW);
            assert.deepEqual(plain(groups.map(g => g.heading)), ['Today', 'Yesterday']);
            assert.deepEqual(plain(groups.map(g => g.entries.map(e => e.id))), [[2, 3], [4, 1]]);
        });

        it('ratedPairs keeps only given ratings, in category order', () => {
            assert.deepEqual(plain(app.ratedPairs({ guilt: 2, excitement: 7, talkative: null, note: 'x' })), [['excitement', 7], ['guilt', 2]]);
        });
    });

    describe('B: boundary conditions (CORRECT)', () => {
        it('one minute after midnight is a new day (Time)', () => {
            const midnight = new Date(2026, 10, 23, 0, 0).getTime();
            assert.equal(app.dayHeading(midnight + 60000, NOW), 'Today');
            assert.equal(app.dayHeading(midnight - 60000, NOW), 'Yesterday');
        });

        it('older days show weekday and date, and the year only when it differs (Conformance)', () => {
            const lastWeek = app.dayHeading(NOW - 5 * DAY, NOW);
            assert.doesNotMatch(lastWeek, /2026/);
            assert.match(app.dayHeading(new Date(2025, 5, 1).getTime(), NOW), /2025/);
        });

        it('a rating of 1 and 10 both count; 0 ratings gives an empty list (Range)', () => {
            assert.equal(app.ratedPairs({ energy: 1, guilt: 10 }).length, 2);
            assert.deepEqual(plain(app.ratedPairs({ energy: null })), []);
        });

        it('emotions no longer in any category still show (Existence)', () => {
            assert.deepEqual(plain(app.ratedPairs({ retired_key: 4 })), [['retired_key', 4]]);
        });
    });

    describe('C: cross-check by other means', () => {
        it('the number of grouped entries equals the number put in', () => {
            const list = Array.from({ length: 50 }, (_, i) => ({ id: i, timestamp: NOW - i * 0.3 * DAY }));
            const groups = app.groupEntriesByDay(list, NOW);
            assert.equal(groups.reduce((n, g) => n + g.entries.length, 0), 50);
            assert.equal(new Set(groups.map(g => g.key)).size, groups.length, 'each day appears once');
        });
    });

    describe('E: error conditions', () => {
        it('skips entries without a usable timestamp', () => {
            const groups = app.groupEntriesByDay([{ id: 1 }, null, { id: 2, timestamp: NaN }, { id: 3, timestamp: NOW }], NOW);
            assert.deepEqual(plain(groups.map(g => g.entries.map(e => e.id))), [[3]]);
        });

        it('non-arrays and missing values give empty results', () => {
            assert.deepEqual(plain(app.groupEntriesByDay(undefined, NOW)), []);
            assert.deepEqual(plain(app.ratedPairs(null)), []);
        });
    });

    describe('P: performance', () => {
        it('groups two years of entries (2,000) in well under 200ms', () => {
            const list = Array.from({ length: 2000 }, (_, i) => ({ id: i, timestamp: NOW - i * 0.36 * DAY }));
            const t0 = performance.now();
            app.groupEntriesByDay(list, NOW);
            assert.ok(performance.now() - t0 < 200);
        });
    });
});
