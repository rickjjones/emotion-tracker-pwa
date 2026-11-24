// Faster logging helpers: draft autosave and the post-save summary — Right BICEP.
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, plain } = require('./helpers/load-app');

const LS_DRAFT = 'll_draft_v1';
const NOW = Date.UTC(2026, 10, 23, 21, 0);
const HOUR = 60 * 60 * 1000;

describe('Draft autosave', () => {
    let app, get, localStorage;
    beforeEach(() => { ({ app, get, localStorage } = loadApp()); });

    describe('R: right results', () => {
        it('a saved draft loads back with the same values', () => {
            assert.equal(app.saveDraft({ energy: 6, guilt: null, note: 'tired' }, NOW), true);
            assert.deepEqual(plain(app.loadDraft(NOW + 1000)), { energy: 6, guilt: null, note: 'tired' });
        });

        it('a note alone counts as content', () => {
            assert.equal(app.hasDraftContent({ energy: null, note: 'just a note' }), true);
        });

        it('a rating alone counts as content', () => {
            assert.equal(app.hasDraftContent({ energy: 1, note: null }), true);
        });
    });

    describe('B: boundary conditions (CORRECT)', () => {
        it('a draft exactly 12 hours old still loads (Time)', () => {
            app.saveDraft({ energy: 5 }, NOW);
            assert.ok(app.loadDraft(NOW + 12 * HOUR));
        });

        it('a draft older than 12 hours is ignored (Time)', () => {
            app.saveDraft({ energy: 5 }, NOW);
            assert.equal(app.loadDraft(NOW + 12 * HOUR + 1), null);
        });

        it('a draft dated in the future (clock change) is ignored (Ordering)', () => {
            app.saveDraft({ energy: 5 }, NOW + 2 * HOUR);
            assert.equal(app.loadDraft(NOW), null);
        });

        it('a whitespace-only note is not content (Range)', () => {
            assert.equal(app.hasDraftContent({ energy: null, note: '   ' }), false);
        });

        it('saving empty values removes an existing draft (Existence)', () => {
            app.saveDraft({ energy: 5 }, NOW);
            assert.equal(app.saveDraft({ energy: null, note: null }, NOW), false);
            assert.equal(localStorage.getItem(LS_DRAFT), null);
        });

        it('the draft lives under one versioned key (Conformance)', () => {
            app.saveDraft({ energy: 5 }, NOW);
            const raw = JSON.parse(localStorage.getItem(LS_DRAFT));
            assert.equal(raw.savedAt, NOW);
            assert.deepEqual(raw.values, { energy: 5 });
        });
    });

    describe('I: inverse relationships', () => {
        it('clearDraft undoes saveDraft', () => {
            app.saveDraft({ energy: 5 }, NOW);
            app.clearDraft();
            assert.equal(app.loadDraft(NOW), null);
        });
    });

    describe('C: cross-check by other means', () => {
        it('the 12 hour limit matches the DRAFT_MAX_AGE_MS constant', () => {
            assert.equal(get('DRAFT_MAX_AGE_MS'), 12 * HOUR);
        });

        it('a draft survives a reload of the app (new instance, same storage)', () => {
            app.saveDraft({ energy: 3, note: 'x' }, Date.now());
            const again = loadApp({ storage: Object.fromEntries(localStorage._map) });
            assert.deepEqual(plain(again.app.loadDraft()), { energy: 3, note: 'x' });
        });
    });

    describe('E: error conditions', () => {
        it('corrupt JSON in storage loads as no draft', () => {
            localStorage.setItem(LS_DRAFT, '{not json');
            assert.equal(app.loadDraft(NOW), null);
        });

        it('a stored draft with no values loads as no draft', () => {
            localStorage.setItem(LS_DRAFT, JSON.stringify({ savedAt: NOW }));
            assert.equal(app.loadDraft(NOW), null);
        });

        it('storage that throws makes save return false instead of crashing', () => {
            localStorage.failing = true;
            assert.equal(app.saveDraft({ energy: 5 }, NOW), false);
            assert.equal(app.loadDraft(NOW), null);
            assert.doesNotThrow(() => app.clearDraft());
        });

        for (const bad of [null, undefined, 'energy', 7, []]) {
            it(`hasDraftContent(${JSON.stringify(bad)}) is false`, () => {
                assert.equal(app.hasDraftContent(bad), false);
            });
        }

        it('NaN and Infinity ratings are not content', () => {
            assert.equal(app.hasDraftContent({ energy: NaN, guilt: Infinity }), false);
        });

        it('hasUnsavedInput is false when there is no form on the page', () => {
            assert.equal(app.hasUnsavedInput(), false);
        });
    });

    describe('P: performance', () => {
        it('1,000 save and load cycles finish in well under 200ms', () => {
            const values = { energy: 5, guilt: 2, note: 'n'.repeat(500) };
            const t0 = performance.now();
            for (let i = 0; i < 1000; i++) { app.saveDraft(values, NOW); app.loadDraft(NOW); }
            assert.ok(performance.now() - t0 < 200);
        });
    });
});

describe('Saved summary text', () => {
    let app;
    beforeEach(() => { ({ app } = loadApp()); });
    const at = new Date(2026, 10, 23, 21, 14).getTime();

    describe('R: right results', () => {
        it('counts ratings and mentions the note', () => {
            assert.match(app.savedSummaryText({ energy: 4, guilt: 2, crying: null, note: 'ok' }, at), /^Saved 2 ratings and a note at /);
        });

        it('includes the time of day', () => {
            assert.match(app.savedSummaryText({ energy: 4 }, at), /(9|21):14/);
        });
    });

    describe('B: boundary conditions (CORRECT)', () => {
        it('uses singular wording for one rating', () => {
            assert.match(app.savedSummaryText({ energy: 4, note: null }, at), /^Saved 1 rating at /);
        });

        it('a note with no ratings says just the note', () => {
            assert.match(app.savedSummaryText({ energy: null, note: 'hi' }, at), /^Saved a note at /);
        });

        it('all 15 default emotions rated reads "15 ratings" (Cardinality)', () => {
            const values = {};
            app.getAllEmotionKeys().filter(k => k !== 'note').forEach(k => { values[k] = 5; });
            assert.match(app.savedSummaryText(values, at), /^Saved 15 ratings at /);
        });
    });

    describe('C: cross-check by other means', () => {
        it('the rating count agrees with hasDraftContent on what counts as a rating', () => {
            const values = { a: 1, b: NaN, c: null, d: '5', note: '' };
            assert.match(app.savedSummaryText(values, at), /^Saved 1 rating at /);
            assert.equal(app.hasDraftContent({ b: NaN, c: null, d: '5', note: '' }), false);
        });
    });

    describe('E: error conditions', () => {
        it('null values describe an empty entry rather than throwing', () => {
            assert.match(app.savedSummaryText(null, at), /^Saved an empty entry at /);
        });
    });
});
