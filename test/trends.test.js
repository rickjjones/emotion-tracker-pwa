// Trend daily averaging, summary stats, chart output and date helpers — Right BICEP.
'use strict';
// Each test file runs in its own process. Use a zone with daylight saving time so the
// calendar-day logic is tested against 23- and 25-hour days.
process.env.TZ = 'America/New_York';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, plain } = require('./helpers/load-app');

// Local-time helper: at(2026, 11, 23, 9) = Nov 23 2026 09:00 local
const at = (y, mo, d, h = 12, mi = 0, s = 0, ms = 0) => new Date(y, mo - 1, d, h, mi, s, ms).getTime();
const NOW = at(2026, 11, 23, 15);
const entry = (ts, values) => ({ timestamp: ts, values });

describe('Trends', () => {
    let app, localStorage;
    beforeEach(() => { ({ app, localStorage } = loadApp()); });

    describe('R: right results', () => {
        it('averages several ratings on the same day', () => {
            const s = app.computeDailySeries([
                entry(at(2026, 11, 23, 8), { energy: 2 }),
                entry(at(2026, 11, 23, 12), { energy: 4 }),
                entry(at(2026, 11, 23, 14), { energy: 9 })
            ], 'energy', 7, NOW);
            const today = s.at(-1);
            assert.equal(today.avg, 5);
            assert.equal(today.count, 3);
            assert.equal(today.min, 2);
            assert.equal(today.max, 9);
        });

        it('returns exactly `days` points, oldest first, ending today', () => {
            for (const days of [7, 30, 90]) {
                const s = app.computeDailySeries([], 'energy', days, NOW);
                assert.equal(s.length, days);
                assert.equal(app.dayKey(s.at(-1).date.getTime()), '2026-11-23');
            }
            assert.equal(app.dayKey(app.computeDailySeries([], 'energy', 7, NOW)[0].date.getTime()), '2026-11-17');
        });

        it('days without ratings are empty, not zero', () => {
            const s = app.computeDailySeries([entry(at(2026, 11, 20), { energy: 6 })], 'energy', 7, NOW);
            assert.deepEqual(plain(s.map(p => p.avg)), [null, null, null, 6, null, null, null]);
            assert.equal(s[0].count, 0);
            assert.equal(s[0].min, null);
        });

        it('summary average is weighted by rating count, not by day', () => {
            // day 1: one rating of 10; day 2: three ratings of 1 -> overall (10+1+1+1)/4 = 3.25
            const s = app.computeDailySeries([
                entry(at(2026, 11, 22), { energy: 10 }),
                entry(at(2026, 11, 23, 8), { energy: 1 }), entry(at(2026, 11, 23, 9), { energy: 1 }), entry(at(2026, 11, 23, 10), { energy: 1 })
            ], 'energy', 7, NOW);
            const st = plain(app.summarizeSeries(s));
            assert.deepEqual(st, { avg: 3.25, min: 1, max: 10, total: 4, daysWithData: 2 });
        });

        it('dayKey and toDateTimeLocal format in local time', () => {
            const ts = at(2026, 3, 5, 7, 9);
            assert.equal(app.dayKey(ts), '2026-03-05');
            assert.equal(app.toDateTimeLocal(ts), '2026-03-05T07:09');
        });

        it('orders chart keys by category, then extra keys found in entries', () => {
            const keys = plain(app.getOrderedEmotionKeys([entry(NOW, { legacy_key: 3, note: 'x' })]));
            assert.equal(keys[0], 'excitement');
            assert.equal(keys.at(-1), 'legacy_key');
            assert.ok(!keys.includes('note'));
        });
    });

    describe('B: boundary conditions (CORRECT)', () => {
        it('Range: includes a rating at the very start of the window', () => {
            const s = app.computeDailySeries([entry(at(2026, 11, 17, 0), { energy: 4 })], 'energy', 7, NOW);
            assert.equal(s[0].avg, 4);
        });

        it('Range: excludes a rating one millisecond before the window', () => {
            const s = app.computeDailySeries([entry(at(2026, 11, 17, 0) - 1, { energy: 4 })], 'energy', 7, NOW);
            assert.equal(app.summarizeSeries(s), null);
        });

        it('Range: includes a rating at 23:59:59.999 today', () => {
            const s = app.computeDailySeries([entry(at(2026, 11, 23, 23, 59, 59, 999), { energy: 8 })], 'energy', 7, NOW);
            assert.equal(s.at(-1).avg, 8);
        });

        it('Range: ratings dated in the future are not plotted', () => {
            const s = app.computeDailySeries([entry(at(2026, 11, 25), { energy: 8 })], 'energy', 7, NOW);
            assert.equal(app.summarizeSeries(s), null);
        });

        it('Time: a DST change (Nov 1 2026) still gives one point per calendar day', () => {
            const now = at(2026, 11, 3, 12);
            const s = app.computeDailySeries([
                entry(at(2026, 11, 1, 0, 30), { energy: 2 }),   // before clocks fall back
                entry(at(2026, 11, 1, 23, 30), { energy: 4 })   // after; same calendar day
            ], 'energy', 7, now);
            const keys = s.map(p => app.dayKey(p.date.getTime()));
            assert.deepEqual(plain(keys), ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']);
            assert.equal(s[4].avg, 3);
            assert.equal(s[4].count, 2);
        });

        it('Time: spring-forward day (Mar 8 2026) is a single bucket', () => {
            const now = at(2026, 3, 9, 12);
            const s = app.computeDailySeries([entry(at(2026, 3, 8, 1, 30), { energy: 1 }), entry(at(2026, 3, 8, 3, 30), { energy: 3 })], 'energy', 7, now);
            assert.equal(s.length, 7);
            assert.equal(s[5].avg, 2);
            assert.equal(new Set(s.map(p => app.dayKey(p.date.getTime()))).size, 7);
        });

        it('Time: windows crossing a month and a year end', () => {
            const s = app.computeDailySeries([], 'energy', 7, at(2027, 1, 2));
            assert.equal(app.dayKey(s[0].date.getTime()), '2026-12-27');
            assert.equal(app.dayKey(s.at(-1).date.getTime()), '2027-01-02');
        });

        it('Conformance: only finite numbers count; null, strings and NaN are skipped', () => {
            const s = app.computeDailySeries([
                entry(NOW, { energy: null }), entry(NOW, { energy: '7' }), entry(NOW, { energy: NaN }),
                entry(NOW, { energy: Infinity }), entry(NOW, {}), { timestamp: NOW }, entry(NOW, { energy: 5 })
            ], 'energy', 7, NOW);
            assert.equal(s.at(-1).count, 1);
            assert.equal(s.at(-1).avg, 5);
        });

        it('Range: the 1 and 10 extremes are averaged exactly', () => {
            const s = app.computeDailySeries([entry(NOW, { energy: 1 }), entry(NOW, { energy: 10 })], 'energy', 7, NOW);
            assert.equal(s.at(-1).avg, 5.5);
        });

        it('Cardinality: a 1-day window has a single point', () => {
            const s = app.computeDailySeries([entry(NOW, { energy: 7 })], 'energy', 1, NOW);
            assert.equal(s.length, 1);
            assert.equal(s[0].avg, 7);
        });

        it('Existence: no entries (or null) gives an all-empty series and null summary', () => {
            assert.equal(app.summarizeSeries(app.computeDailySeries(null, 'energy', 30, NOW)), null);
            assert.equal(app.summarizeSeries([]), null);
            assert.equal(app.summarizeSeries(null), null);
        });

        it('Range: trend preferences accept only 7, 30 or 90 days', () => {
            assert.equal(app.getTrendsPrefs().days, 30);
            for (const days of [7, 30, 90]) {
                app.setTrendsPrefs({ days, key: 'energy' });
                assert.deepEqual(plain(app.getTrendsPrefs()), { days, key: 'energy' });
            }
            for (const days of [0, 14, -7, '30', null]) {
                app.setTrendsPrefs({ days, key: 5 });
                assert.deepEqual(plain(app.getTrendsPrefs()), { days: 30, key: null });
            }
        });

        it('Cardinality: a chart with one point does not divide by zero', () => {
            const svg = app.buildTrendSvg(app.computeDailySeries([entry(NOW, { energy: 5 })], 'energy', 1, NOW), 'Energy', 640);
            assert.ok(!svg.includes('NaN'));
            assert.equal((svg.match(/<circle /g) || []).length, 1);
        });
    });

    describe('I: inverse relationships', () => {
        it('parsing toDateTimeLocal gives back the time to the minute', () => {
            for (const ts of [at(2026, 11, 23, 9, 41, 33), at(2026, 3, 8, 3, 15), at(2026, 1, 1, 0, 0)]) {
                assert.equal(new Date(app.toDateTimeLocal(ts)).getTime(), Math.floor(ts / 60000) * 60000);
            }
        });

        it('each series date maps back to its own day key', () => {
            const s = app.computeDailySeries([], 'energy', 90, NOW);
            for (const p of s) assert.equal(app.dayKey(p.date.getTime()), app.dayKey(new Date(p.date).setHours(12)));
        });
    });

    describe('C: cross-checks', () => {
        it('summary matches a brute-force average of the raw ratings in the window', () => {
            // deterministic pseudo-random ratings spread over 120 days
            let seed = 42; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
            const entries = Array.from({ length: 500 }, () => entry(NOW - Math.floor(rnd() * 120 * 86400000), { energy: 1 + Math.floor(rnd() * 10) }));
            for (const days of [7, 30, 90]) {
                const start = at(2026, 11, 23 - (days - 1), 0);
                const inWin = entries.filter(e => e.timestamp >= start).map(e => e.values.energy);
                const st = app.summarizeSeries(app.computeDailySeries(entries, 'energy', days, NOW));
                assert.equal(st.total, inWin.length, `${days}d count`);
                assert.ok(Math.abs(st.avg - inWin.reduce((a, b) => a + b, 0) / inWin.length) < 1e-9, `${days}d avg`);
                assert.equal(st.min, Math.min(...inWin));
                assert.equal(st.max, Math.max(...inWin));
            }
        });

        it('per-day counts add up to the summary total', () => {
            const entries = [entry(at(2026, 11, 20), { energy: 3 }), entry(at(2026, 11, 20, 18), { energy: 5 }), entry(at(2026, 11, 22), { energy: 7 })];
            const s = app.computeDailySeries(entries, 'energy', 30, NOW);
            assert.equal(s.reduce((a, p) => a + p.count, 0), app.summarizeSeries(s).total);
        });

        it('the chart draws one dot per day with data and a dashed line across gaps', () => {
            const s = app.computeDailySeries([entry(at(2026, 11, 18), { energy: 3 }), entry(at(2026, 11, 19), { energy: 5 }), entry(at(2026, 11, 22), { energy: 7 })], 'energy', 7, NOW);
            const svg = app.buildTrendSvg(s, 'Energy', 640);
            assert.equal((svg.match(/<circle /g) || []).length, 3);
            assert.equal((svg.match(/class="trend-line"/g) || []).length, 1);
            assert.equal((svg.match(/trend-line--gap/g) || []).length, 1);
        });
    });

    describe('E: error conditions', () => {
        it('corrupted or unavailable trend prefs fall back to 30 days', () => {
            localStorage.setItem('ll_trends_v1', 'not json');
            assert.deepEqual(plain(app.getTrendsPrefs()), { days: 30, key: null });
            localStorage.failing = true;
            assert.deepEqual(plain(app.getTrendsPrefs()), { days: 30, key: null });
            assert.doesNotThrow(() => app.setTrendsPrefs({ days: 7 }));
        });

        it('escapes emotion labels in the chart so custom names cannot inject markup', () => {
            const svg = app.buildTrendSvg(app.computeDailySeries([], 'x', 7, NOW), '<img onerror=alert(1)>"', 640);
            assert.ok(!svg.includes('<img'));
            assert.ok(svg.includes('&lt;img onerror=alert(1)&gt;&quot;'));
        });

        it('escapeHtml neutralizes every special character', () => {
            assert.equal(app.escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
        });

        it('a missing or tiny chart width is clamped to a readable minimum', () => {
            const s = app.computeDailySeries([], 'energy', 7, NOW);
            assert.match(app.buildTrendSvg(s, 'E', 0), /viewBox="0 0 640 /);
            assert.match(app.buildTrendSvg(s, 'E', 100), /viewBox="0 0 280 /);
        });
    });

    describe('P: performance', () => {
        it('averages 50,000 entries over 90 days quickly', () => {
            const entries = Array.from({ length: 50000 }, (_, i) => entry(NOW - (i % (120 * 24)) * 3600000, { energy: (i % 10) + 1 }));
            const t0 = performance.now();
            const s = app.computeDailySeries(entries, 'energy', 90, NOW);
            app.summarizeSeries(s);
            const ms = performance.now() - t0;
            assert.equal(s.length, 90);
            assert.ok(ms < 1000, `took ${ms.toFixed(0)} ms`);
        });

        it('renders a 90-day chart quickly', () => {
            const entries = Array.from({ length: 90 }, (_, i) => entry(NOW - i * 86400000, { energy: (i % 10) + 1 }));
            const t0 = performance.now();
            const svg = app.buildTrendSvg(app.computeDailySeries(entries, 'energy', 90, NOW), 'Energy', 640);
            assert.ok(performance.now() - t0 < 200);
            assert.equal((svg.match(/<circle /g) || []).length, 90);
        });
    });
});
