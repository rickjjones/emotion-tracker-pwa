// App icons: manifest, page head and service worker all point at real files of the right size — Right BICEP.
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DOCS = path.join(__dirname, '..', 'docs');
const manifest = JSON.parse(fs.readFileSync(path.join(DOCS, 'manifest.json'), 'utf8'));
const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(DOCS, 'sw.js'), 'utf8');

// Width and height from a PNG's IHDR chunk.
function pngSize(file) {
    const buf = fs.readFileSync(path.join(DOCS, file));
    assert.equal(buf.toString('ascii', 1, 4), 'PNG', `${file} is not a PNG`);
    return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

const swAssets = [...sw.match(/const ASSETS = \[([\s\S]*?)\]/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
const headIcons = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)].map(m => m[1]);

describe('app icons', () => {
    it('Right: every manifest icon exists and PNG sizes match what the manifest claims', () => {
        for (const icon of manifest.icons) {
            assert.ok(fs.existsSync(path.join(DOCS, icon.src)), `missing ${icon.src}`);
            if (icon.type === 'image/png') {
                const [w, h] = pngSize(icon.src);
                assert.equal(`${w}x${h}`, icon.sizes, icon.src);
            }
        }
    });

    it('Right: the manifest offers 192 and 512 PNGs plus a maskable icon (installability)', () => {
        const png = manifest.icons.filter(i => i.type === 'image/png');
        assert.ok(png.some(i => i.sizes === '192x192'));
        assert.ok(png.some(i => i.sizes === '512x512'));
        assert.ok(manifest.icons.some(i => (i.purpose || '').split(' ').includes('maskable')));
    });

    it('Cross-check: every icon the page head links is a real file, and the apple-touch-icon is 180x180', () => {
        assert.ok(headIcons.length >= 2);
        for (const href of headIcons) assert.ok(fs.existsSync(path.join(DOCS, href)), `missing ${href}`);
        const apple = html.match(/<link rel="apple-touch-icon"[^>]*href="([^"]+)"/)[1];
        assert.deepEqual(pngSize(apple), [180, 180]);
    });

    it('Inverse: the service worker precaches every manifest and head icon, so they work offline', () => {
        for (const src of [...manifest.icons.map(i => i.src), ...headIcons]) {
            assert.ok(swAssets.includes(src), `${src} not in sw.js ASSETS`);
        }
    });

    it('Existence: every precached asset exists, so install does not fail on a 404', () => {
        for (const a of swAssets.filter(a => a !== './')) {
            assert.ok(fs.existsSync(path.join(DOCS, a)), `sw.js lists missing ${a}`);
        }
    });
});
