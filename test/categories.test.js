// Category and label persistence, tracked emotions, and editor helpers — Right BICEP.
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, plain } = require('./helpers/load-app');

const LS_CATEGORIES = 'll_categories_v1';
const LS_TRACKED = 'll_tracked_emotions_v1';

const custom = () => ({
    version: 2,
    categories: { mood: { title: 'Mood', keys: ['calm', 'energy'] } },
    labels: { calm: 'Calm', energy: 'Get up and go' }
});

describe('Categories and labels', () => {
    let app, get, localStorage;
    beforeEach(() => { ({ app, get, localStorage } = loadApp()); });

    describe('R: right results', () => {
        it('uses the built-in categories when nothing is saved', () => {
            assert.deepEqual(Object.keys(plain(app.loadEffectiveCategories())), ['high', 'low', 'adhd']);
            assert.equal(app.getAllEmotionKeys().length, 16);
        });

        it('saved categories replace the defaults entirely (no merging back)', () => {
            assert.equal(app.setSavedCategories(custom()), true);
            assert.deepEqual(plain(app.loadEffectiveCategories()), { mood: { title: 'Mood', keys: ['calm', 'energy'] } });
            assert.deepEqual(plain(app.getAllEmotionKeys()), ['calm', 'energy', 'note']);
        });

        it('custom labels are applied on top of the default labels', () => {
            app.setSavedCategories(custom());
            const LABELS = get('LABELS');
            assert.equal(LABELS.energy, 'Get up and go');
            assert.equal(LABELS.calm, 'Calm');
            assert.equal(LABELS.guilt, 'Guilt', 'untouched defaults survive');
        });

        it('labels persist across a reload of the app', () => {
            app.setSavedCategories(custom());
            const raw = localStorage.getItem(LS_CATEGORIES);
            const reloaded = loadApp({ storage: { [LS_CATEGORIES]: raw } });
            assert.equal(reloaded.get('LABELS').energy, 'Get up and go');
        });

        it('tracked keys round trip through storage', () => {
            app.setTrackedKeys(['guilt', 'energy']);
            assert.deepEqual(plain(app.getTrackedKeys()), ['guilt', 'energy']);
        });

        it('slugify makes lowercase underscore ids', () => {
            assert.equal(app.slugify('  Racing Thoughts! '), 'racing_thoughts');
            assert.equal(app.slugify('Sleep (high)'), 'sleep_high');
        });

        it('uniqueCategoryId appends the first free number', () => {
            assert.equal(app.uniqueCategoryId('mood', new Set()), 'mood');
            assert.equal(app.uniqueCategoryId('mood', new Set(['mood', 'mood_2'])), 'mood_3');
        });
    });

    describe('B: boundary conditions (CORRECT)', () => {
        it('Conformance: reads the older v1 shape (bare category map)', () => {
            const cfg = app.normalizeCategoriesConfig({ high: { title: 'Up', keys: ['excitement'] } });
            assert.deepEqual(plain(cfg), { version: 2, categories: { high: { title: 'Up', keys: ['excitement'] } }, labels: {} });
        });

        it('Conformance: drops non-string and empty keys, and the reserved "note"', () => {
            const cfg = app.normalizeCategoriesConfig({ version: 2, categories: { a: { title: 'A', keys: ['x', '', 5, null, 'note'] } } });
            assert.deepEqual(plain(cfg.categories.a.keys), ['x']);
        });

        it('Cardinality: duplicate keys inside a category are collapsed, order kept', () => {
            const cfg = app.normalizeCategoriesConfig({ version: 2, categories: { a: { title: 'A', keys: ['y', 'x', 'y'] } } });
            assert.deepEqual(plain(cfg.categories.a.keys), ['y', 'x']);
        });

        it('Existence: a missing or empty title falls back to the category id', () => {
            const cfg = app.normalizeCategoriesConfig({ version: 2, categories: { focus: { title: '', keys: ['x'] } } });
            assert.equal(cfg.categories.focus.title, 'focus');
        });

        it('Existence: blank labels are ignored and labels are trimmed', () => {
            const cfg = app.normalizeCategoriesConfig({ version: 2, categories: { a: { keys: ['x', 'y'] } }, labels: { x: '  Ex  ', y: '   ', z: 7 } });
            assert.deepEqual(plain(cfg.labels), { x: 'Ex' });
        });

        it('Cardinality: a config with zero usable categories is rejected', () => {
            assert.equal(app.normalizeCategoriesConfig({ version: 2, categories: {} }), null);
            assert.equal(app.normalizeCategoriesConfig({ version: 2, categories: { a: { title: 'A' } } }), null);
        });

        it('Cardinality: an empty saved tracked list falls back to tracking everything', () => {
            localStorage.setItem(LS_TRACKED, '[]');
            assert.equal(app.getTrackedKeys().length, 15);
        });

        it('Reference: tracked keys that no longer exist in any category are dropped', () => {
            app.setSavedCategories(custom());
            app.setTrackedKeys(['calm', 'guilt']);
            assert.deepEqual(plain(app.getTrackedKeys()), ['calm']);
        });

        it('Reference: if no tracked key survives, track all current emotions', () => {
            app.setSavedCategories(custom());
            app.setTrackedKeys(['guilt']);
            assert.deepEqual(plain(app.getTrackedKeys()), ['calm', 'energy']);
        });

        it('Existence: "note" is never part of the default tracked set', () => {
            assert.ok(!app.getDefaultTracked().includes('note'));
        });

        it('slugify of empty, null or symbols-only input is an empty string', () => {
            assert.equal(app.slugify(''), '');
            assert.equal(app.slugify(null), '');
            assert.equal(app.slugify('!!!'), '');
        });

        it('uniqueCategoryId uses "category" when the base is empty', () => {
            assert.equal(app.uniqueCategoryId('', new Set()), 'category');
        });
    });

    describe('I: inverse relationships', () => {
        it('reset undoes a save: defaults and default labels come back', () => {
            app.setSavedCategories(custom());
            app.resetSavedCategories();
            assert.equal(localStorage.getItem(LS_CATEGORIES), null);
            assert.deepEqual(Object.keys(plain(app.loadEffectiveCategories())), ['high', 'low', 'adhd']);
            assert.equal(get('LABELS').energy, 'Energy');
            assert.equal(get('LABELS').calm, undefined);
        });

        it('normalizing an already normalized config changes nothing', () => {
            const once = plain(app.normalizeCategoriesConfig(custom()));
            const twice = plain(app.normalizeCategoriesConfig(once));
            assert.deepEqual(twice, once);
        });

        it('slugify is idempotent', () => {
            for (const s of ['Hello World', 'already_slug', '  -- Mixed__Case 42 --  ']) {
                assert.equal(app.slugify(app.slugify(s)), app.slugify(s));
            }
        });
    });

    describe('C: cross-checks', () => {
        it('getAllEmotionKeys matches the flattened effective categories plus note', () => {
            app.setSavedCategories({ version: 2, categories: { a: { title: 'A', keys: ['x', 'y'] }, b: { title: 'B', keys: ['z'] } } });
            const flat = Object.values(plain(app.loadEffectiveCategories())).flatMap(c => c.keys);
            assert.deepEqual(plain(app.getAllEmotionKeys()), [...flat, 'note']);
        });

        it('the default flat key list agrees with EMOTIONS', () => {
            assert.deepEqual(plain(app.getAllEmotionKeys()), plain(get('EMOTIONS')));
        });

        it('every default emotion key has a default label', () => {
            const DEFAULT_LABELS = get('DEFAULT_LABELS');
            for (const k of app.getAllEmotionKeys()) assert.ok(DEFAULT_LABELS[k], `label for ${k}`);
        });

        it('loadEffectiveCategories returns a copy, so edits do not leak into the defaults', () => {
            const cats = app.loadEffectiveCategories();
            cats.high.keys.push('mutated');
            assert.ok(!get('CATEGORIES').high.keys.includes('mutated'));
        });
    });

    describe('E: error conditions', () => {
        it('rejects non-object configs', () => {
            for (const bad of [null, undefined, 'str', 42, [], true]) {
                assert.equal(app.normalizeCategoriesConfig(bad), null, `input ${JSON.stringify(bad)}`);
            }
        });

        it('setSavedCategories refuses an invalid config and stores nothing', () => {
            assert.equal(app.setSavedCategories({ version: 2, categories: {} }), false);
            assert.equal(localStorage.getItem(LS_CATEGORIES), null);
        });

        it('corrupted saved categories fall back to the defaults', () => {
            localStorage.setItem(LS_CATEGORIES, '{"version":2,');
            assert.equal(app.getSavedCategories(), null);
            assert.deepEqual(Object.keys(plain(app.loadEffectiveCategories())), ['high', 'low', 'adhd']);
        });

        it('a non-array tracked value falls back to defaults', () => {
            localStorage.setItem(LS_TRACKED, '{"energy":true}');
            assert.equal(app.getTrackedKeys().length, 15);
        });

        it('keeps working when localStorage throws (private mode, quota)', () => {
            localStorage.failing = true;
            assert.equal(app.getTrackedKeys().length, 15);
            assert.equal(app.hasSavedTracked(), false);
            assert.doesNotThrow(() => app.setTrackedKeys(['energy']));
            assert.equal(app.setSavedCategories(custom()), false);
            assert.doesNotThrow(() => app.resetSavedCategories());
        });

        it('the app still loads when saved data is corrupted', () => {
            assert.doesNotThrow(() => loadApp({ storage: { [LS_CATEGORIES]: 'garbage', [LS_TRACKED]: 'garbage' } }));
        });
    });

    describe('P: performance', () => {
        it('normalizes a config with 200 categories x 50 keys quickly', () => {
            const categories = {};
            for (let c = 0; c < 200; c++) categories['c' + c] = { title: 'C' + c, keys: Array.from({ length: 50 }, (_, k) => `k${c}_${k}`) };
            const t0 = performance.now();
            const cfg = app.normalizeCategoriesConfig({ version: 2, categories });
            const ms = performance.now() - t0;
            assert.equal(Object.keys(cfg.categories).length, 200);
            assert.ok(ms < 200, `took ${ms.toFixed(0)} ms`);
        });
    });
});
