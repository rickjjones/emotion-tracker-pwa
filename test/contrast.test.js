// Color tokens in docs/styles.css meet WCAG 2.2 AA contrast in both themes — Right BICEP.
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'docs', 'styles.css'), 'utf8');

// Read the custom properties declared in one rule block, e.g. ':root' or 'html.dark'.
function tokens(selector) {
    const start = CSS.indexOf(selector + '{');
    assert.ok(start >= 0, `no ${selector} block`);
    const body = CSS.slice(start, CSS.indexOf('}', start));
    const out = {};
    for (const m of body.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2];
    return out;
}

function luminance(hex) {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

// [foreground token, background token] pairs that carry normal-size text
const PAIRS = [
    ['on-accent', 'accent'],     // button labels
    ['chip-text', 'chip-bg'],    // category headings
    ['text', 'panel'],
    ['muted', 'panel'],          // helper text, scale legend
    ['placeholder', 'input-bg'], // "Add a note..."
    ['danger', 'panel'],         // Delete / Clear All outlines
    ['wx', 'card']               // weather axis labels and line on the trends chart
];
const AA = 4.5;

describe('Theme contrast', () => {
    const light = tokens(':root');
    const dark = Object.assign({}, light, tokens('html.dark'));

    describe('R: right results', () => {
        for (const [theme, t] of [['light', light], ['dark', dark]]) {
            for (const [fg, bg] of PAIRS) {
                it(`${theme}: --${fg} on --${bg} is at least ${AA}:1`, () => {
                    const r = contrast(t[fg], t[bg]);
                    assert.ok(r >= AA, `${t[fg]} on ${t[bg]} is ${r.toFixed(2)}:1`);
                });
            }
        }
    });

    describe('B: boundary conditions (CORRECT)', () => {
        it('every token the checks need exists in both themes (Existence)', () => {
            for (const t of [light, dark]) for (const [fg, bg] of PAIRS) {
                assert.ok(t[fg] && t[bg], `missing --${fg} or --${bg}`);
            }
        });
    });

    describe('C: cross-check by other means', () => {
        it('the contrast formula matches known reference values', () => {
            assert.equal(contrast('#000000', '#ffffff').toFixed(1), '21.0');
            assert.equal(contrast('#777777', '#ffffff').toFixed(2), '4.48'); // classic just-fails-AA gray
        });
    });

    describe('I: inverse relationships', () => {
        it('contrast is symmetric in foreground and background', () => {
            assert.equal(contrast(light.accent, light['on-accent']), contrast(light['on-accent'], light.accent));
        });
    });

    describe('E: error conditions', () => {
        it('the old accent #4CAF50 would fail with white text (guards against a revert)', () => {
            assert.ok(contrast('#ffffff', '#4CAF50') < AA);
        });
    });
});
