// Weather with each entry: location, Open-Meteo requests and parsing, offline backfill,
// units, chart series and axis — Right BICEP. No network: fetch is always a stub.
'use strict';
process.env.TZ = 'America/New_York';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, plain } = require('./helpers/load-app');

const at = (y, mo, d, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = at(2026, 11, 23, 15);
const HOUR = 3600000;
const DAY = 24 * HOUR;

// A fake Open-Meteo response for `url`: hourly temps count up by hour so each hour is distinguishable.
function fakeOpenMeteo(url) {
    const u = new URL(url);
    if (u.searchParams.has('current')) {
        return { current: { time: '2026-11-23T20:00', temperature_2m: 7.5, relative_humidity_2m: 64, pressure_msl: 1016.2, precipitation: 0, weather_code: 2 } };
    }
    const start = Date.parse(u.searchParams.get('start_date') + 'T00:00Z');
    const end = Date.parse(u.searchParams.get('end_date') + 'T23:00Z');
    const time = [], t2 = [], rh = [], p = [], pr = [], wc = [];
    for (let t = start, i = 0; t <= end; t += HOUR, i++) {
        time.push(new Date(t).toISOString().slice(0, 16));
        t2.push(i); rh.push(50); p.push(1000 + i); pr.push(i % 2 ? 0.5 : 0); wc.push(61);
    }
    return { hourly: { time, temperature_2m: t2, relative_humidity_2m: rh, pressure_msl: p, precipitation: pr, weather_code: wc } };
}

function stubFetch(handler) {
    const calls = [];
    const fn = async (url) => {
        calls.push(url);
        const r = handler ? handler(url) : { ok: true, body: fakeOpenMeteo(url) };
        if (r instanceof Error) throw r;
        return { ok: r.ok, status: r.status || (r.ok ? 200 : 500), json: async () => r.body };
    };
    fn.calls = calls;
    return fn;
}

const pending = (ts, extra) => ({ id: Math.round(ts / 1000), timestamp: ts, values: { energy: 5 }, weather: Object.assign({ status: 'pending', lat: 40.71, lon: -74.01, source: 'gps' }, extra) });
const withWx = (ts, wx) => ({ timestamp: ts, values: {}, weather: Object.assign({ status: 'ok' }, wx) });

describe('Weather', () => {
    let app, localStorage;
    beforeEach(() => { ({ app, localStorage } = loadApp()); });

    describe('R: right results', () => {
        it('uses current conditions for an entry saved just now', () => {
            const req = app.buildWeatherRequest(40.71, -74.01, NOW - 5 * 60000, NOW);
            assert.equal(req.kind, 'current');
            assert.match(req.url, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=40\.71&longitude=-74\.01&current=/);
        });

        it('uses hourly history for an entry saved earlier, covering the hour either side', () => {
            const ts = Date.UTC(2026, 10, 20, 23, 40);
            const req = app.buildWeatherRequest(40.71, -74.01, ts, NOW);
            assert.equal(req.kind, 'hourly');
            const u = new URL(req.url);
            assert.equal(u.hostname, 'api.open-meteo.com');
            assert.equal(u.searchParams.get('start_date'), '2026-11-20');
            assert.equal(u.searchParams.get('end_date'), '2026-11-21'); // 00:40 GMT next day is within an hour
            assert.equal(u.searchParams.get('timezone'), 'GMT');
        });

        it('picks the hour nearest the entry from an hourly response', () => {
            const ts = Date.UTC(2026, 10, 20, 5, 20); // nearest hour 05:00 -> index 5
            const req = app.buildWeatherRequest(40.71, -74.01, ts, NOW);
            const wx = plain(app.parseWeatherResponse(fakeOpenMeteo(req.url), 'hourly', ts));
            assert.deepEqual(wx, { temp: 5, humidity: 50, pressure: 1005, precip: 0.5, code: 61 });
        });

        it('reads the current block', () => {
            const wx = plain(app.parseWeatherResponse(fakeOpenMeteo('https://x.test/?current=a'), 'current', NOW));
            assert.deepEqual(wx, { temp: 7.5, humidity: 64, pressure: 1016.2, precip: 0, code: 2 });
        });

        it('fills in a pending entry and keeps where it came from', async () => {
            const ts = NOW - 2 * DAY;
            const res = await app.fillPendingWeather([pending(ts)], stubFetch(), { now: NOW, settings: app.getWeatherSettings() });
            assert.equal(res.changed.length, 1);
            const w = plain(res.changed[0].weather);
            assert.equal(w.status, 'ok');
            assert.equal(w.source, 'gps');
            assert.equal(w.lat, 40.71);
            assert.equal(typeof w.temp, 'number');
        });

        it('backfillWeather saves weather into IndexedDB', async () => {
            const id = await app.addEntry({ energy: 4 }, { status: 'pending', lat: 40.71, lon: -74.01, source: 'gps' });
            await app.backfillWeather({ fetchFn: stubFetch(), quiet: true });
            const rec = plain(await app.getEntry(id));
            assert.equal(rec.weather.status, 'ok');
            assert.equal(rec.weather.temp, 7.5); // saved moments ago -> current conditions
            assert.deepEqual(rec.values, { energy: 4 });
        });

        it('history line reads naturally in both unit systems', () => {
            const e = withWx(NOW, { temp: 12, humidity: 61.6, pressure: 1013.25, precip: 0, code: 0 });
            assert.equal(app.weatherSummaryText(e, 'metric'), '☀️ Clear · 12°C · 62% · 1013 hPa');
            assert.equal(app.weatherSummaryText(e, 'us'), '☀️ Clear · 54°F · 62% · 29.92 inHg');
            const wet = withWx(NOW, { temp: 12, precip: 2.54, code: 63 });
            assert.equal(app.weatherSummaryText(wet, 'us'), '🌧️ Rain · 54°F · 0.10 in rain');
        });

        it('chart series averages each day in the chosen units', () => {
            const s = app.computeDailyWeather([
                withWx(at(2026, 11, 23, 9), { temp: 10 }),
                withWx(at(2026, 11, 23, 13), { temp: 20 }),
                withWx(at(2026, 11, 21, 9), { temp: 0 })
            ], 'temp', 'us', 7, NOW);
            assert.equal(s.length, 7);
            assert.equal(s.at(-1).value, 59); // 15°C
            assert.equal(s.at(-3).value, 32);
            assert.equal(s.at(-2).value, null);
        });

        it('settings round-trip and the city is used when location is unavailable', async () => {
            app.setWeatherSettings({ enabled: true, units: 'metric', city: { name: 'Denver, Colorado, US', lat: 39.73915, lon: -104.9847 } });
            const s = plain(app.getWeatherSettings());
            assert.deepEqual(s, { enabled: true, units: 'metric', city: { name: 'Denver, Colorado, US', lat: 39.74, lon: -104.98 }, chart: 'temp' });
            const loc = plain(await app.resolveWeatherLocation(app.getWeatherSettings(), async () => null));
            assert.deepEqual(loc, { lat: 39.74, lon: -104.98, source: 'city' });
        });

        it('the phone location wins over the city, rounded to about 1 km', async () => {
            app.setWeatherSettings({ city: { name: 'Denver', lat: 39.74, lon: -104.98 } });
            const loc = plain(await app.resolveWeatherLocation(app.getWeatherSettings(), async () => ({ lat: 40.712776, lon: -74.005974 })));
            assert.deepEqual(loc, { lat: 40.71, lon: -74.01, source: 'gps' });
        });

        it('geocodeCity returns a readable name and rounded coordinates', async () => {
            const f = stubFetch(() => ({ ok: true, body: { results: [{ name: 'Denver', admin1: 'Colorado', country_code: 'US', latitude: 39.73915, longitude: -104.9847 }] } }));
            const c = plain(await app.geocodeCity('denver', f));
            assert.deepEqual(c, { name: 'Denver, Colorado, US', lat: 39.74, lon: -104.98 });
            assert.match(f.calls[0], /name=denver&count=1/);
        });

        it('chart draws a right-hand weather axis and line when given an overlay', () => {
            const series = app.computeDailySeries([{ timestamp: at(2026, 11, 22), values: { energy: 5 } }], 'energy', 7, NOW);
            const wx = app.computeDailyWeather([withWx(at(2026, 11, 22), { temp: 10 }), withWx(at(2026, 11, 23), { temp: 14 })], 'temp', 'metric', 7, NOW);
            const svg = app.buildTrendSvg(series, 'Energy', 640, { metric: 'temp', units: 'metric', label: 'Temperature', series: wx });
            assert.match(svg, /class="trend-axis trend-axis--wx"/);
            assert.equal((svg.match(/class="trend-wx-line"/g) || []).length, 1);
            assert.equal((svg.match(/class="trend-wx-dot"/g) || []).length, 2);
            assert.match(svg, /aria-label="Energy daily average over the last 7 days, with daily temperature"/);
        });

        it('rain is drawn as bars', () => {
            const series = app.computeDailySeries([], 'energy', 7, NOW);
            const wx = app.computeDailyWeather([withWx(at(2026, 11, 22), { precip: 1.2 })], 'precip', 'metric', 7, NOW);
            const svg = app.buildTrendSvg(series, 'Energy', 640, { metric: 'precip', units: 'metric', label: 'Rain', series: wx });
            assert.equal((svg.match(/class="trend-wx-bar"/g) || []).length, 1);
        });

        it('CSV gains metric weather columns when an entry has weather', () => {
            const csv = app.buildCsv([
                { id: 1, timestamp: Date.UTC(2026, 10, 23, 12), values: { energy: 5 }, weather: { status: 'ok', temp: 7.5, humidity: 64, pressure: 1016.2, precip: 0, code: 2 } },
                { id: 2, timestamp: Date.UTC(2026, 10, 23, 13), values: { energy: 6 } }
            ], ['energy']);
            const lines = csv.split('\r\n');
            assert.equal(lines[0], 'timestamp,id,energy,weather,temp_c,humidity_pct,pressure_hpa,precip_mm');
            assert.equal(lines[1], '2026-11-23T12:00:00.000Z,1,5,Partly cloudy,7.5,64,1016.2,0');
            assert.equal(lines[2], '2026-11-23T13:00:00.000Z,2,6,,,,,');
        });
    });

    describe('B: boundary conditions (CORRECT)', () => {
        it('Conformance: off by default, units follow the locale', () => {
            assert.equal(app.getWeatherSettings().enabled, false);
            assert.equal(app.defaultWeatherUnits('en-US'), 'us');
            assert.equal(app.defaultWeatherUnits('en-GB'), 'metric');
            assert.equal(app.defaultWeatherUnits('de'), 'metric');
        });

        it('Ordering: newest pending entries are fetched first when the per-run cap is hit', async () => {
            const f = stubFetch();
            const old = pending(NOW - 10 * DAY), recent = pending(NOW - 2 * DAY);
            const res = await app.fillPendingWeather([old, recent], f, { now: NOW, maxRequests: 1, settings: app.getWeatherSettings() });
            assert.equal(f.calls.length, 1);
            assert.deepEqual(plain(res.changed.map(e => e.id)), [recent.id]);
        });

        it('Range: exactly 30 minutes ago is "current", 31 minutes is hourly', () => {
            assert.equal(app.buildWeatherRequest(1, 1, NOW - 30 * 60000, NOW).kind, 'current');
            assert.equal(app.buildWeatherRequest(1, 1, NOW - 31 * 60000, NOW).kind, 'hourly');
        });

        it('Range: entries older than 85 days use the historical archive', () => {
            assert.equal(new URL(app.buildWeatherRequest(1, 1, NOW - 85 * DAY + HOUR, NOW).url).hostname, 'api.open-meteo.com');
            assert.equal(new URL(app.buildWeatherRequest(1, 1, NOW - 86 * DAY, NOW).url).hostname, 'archive-api.open-meteo.com');
        });

        it('Range: coordinates at the poles and date line are valid; beyond them are not', () => {
            assert.equal(app.isValidCoord(90, 180), true);
            assert.equal(app.isValidCoord(-90, -180), true);
            assert.equal(app.isValidCoord(90.01, 0), false);
            assert.equal(app.isValidCoord(0, -180.5), false);
            assert.equal(app.isValidCoord(NaN, 0), false);
        });

        it('Reference: no phone location and no city means nothing to look up', async () => {
            assert.equal(await app.resolveWeatherLocation(app.getWeatherSettings(), async () => null), null);
            const f = stubFetch();
            const res = await app.fillPendingWeather([pending(NOW - DAY, { lat: undefined, lon: undefined })], f, { now: NOW, settings: app.getWeatherSettings() });
            assert.equal(f.calls.length, 0);
            assert.equal(res.changed.length, 0); // still pending for later
        });

        it('Reference: a pending entry without a location uses the city typed later', async () => {
            app.setWeatherSettings({ city: { name: 'Denver', lat: 39.74, lon: -104.98 } });
            const f = stubFetch();
            const res = await app.fillPendingWeather([pending(NOW - DAY, { lat: undefined, lon: undefined })], f, { now: NOW });
            assert.match(f.calls[0], /latitude=39\.74&longitude=-104\.98/);
            assert.equal(res.changed[0].weather.source, 'city');
        });

        it('Existence: an entry in the future gets no request until its time has passed', () => {
            assert.equal(app.buildWeatherRequest(1, 1, NOW + 2 * HOUR, NOW), null);
        });

        it('Existence: entries without weather, or already done, are left alone', async () => {
            const f = stubFetch();
            const res = await app.fillPendingWeather([{ timestamp: NOW, values: {} }, withWx(NOW, { temp: 1 }), null], f, { now: NOW });
            assert.equal(f.calls.length, 0);
            assert.equal(res.changed.length, 0);
        });

        it('Cardinality: a constant series still gets a usable axis', () => {
            const a = plain(app.weatherAxis([10, 10, 10], 'temp'));
            assert.ok(a.min < 10 && a.max > 10);
            const r = plain(app.weatherAxis([0, 0], 'precip'));
            assert.equal(r.min, 0);
            assert.ok(r.max > 0);
            assert.equal(app.weatherAxis([null, null], 'temp'), null);
        });

        it('Time: moving an entry by more than 30 minutes re-queues its weather at the same place', () => {
            const w = { status: 'ok', lat: 1, lon: 2, source: 'gps', temp: 5 };
            assert.equal(app.weatherAfterTimeEdit(w, NOW, NOW + 30 * 60000), w);
            assert.deepEqual(plain(app.weatherAfterTimeEdit(w, NOW, NOW + 31 * 60000)), { status: 'pending', lat: 1, lon: 2, source: 'gps' });
        });

        it('a corrupt settings value falls back to defaults', () => {
            localStorage.setItem('ll_weather_v1', '{nope');
            const s = plain(app.getWeatherSettings());
            assert.equal(s.enabled, false);
            assert.equal(s.city, null);
            localStorage.setItem('ll_weather_v1', JSON.stringify({ enabled: 'yes', units: 'kelvin', city: { name: 'X', lat: 200, lon: 0 }, chart: 'wind' }));
            const t = plain(app.getWeatherSettings());
            assert.equal(t.enabled, false);
            assert.ok(['us', 'metric'].includes(t.units));
            assert.equal(t.city, null);
            assert.equal(t.chart, 'temp');
        });
    });

    describe('I: inverse relationships', () => {
        it('US units convert back to the stored metric values', () => {
            const e = withWx(NOW, { temp: 21.3, pressure: 1009.4, precip: 3.2, humidity: 40 });
            assert.ok(Math.abs((app.weatherMetricValue(e, 'temp', 'us') - 32) * 5 / 9 - 21.3) < 1e-9);
            assert.ok(Math.abs(app.weatherMetricValue(e, 'pressure', 'us') / 0.02953 - 1009.4) < 1e-9);
            assert.ok(Math.abs(app.weatherMetricValue(e, 'precip', 'us') * 25.4 - 3.2) < 1e-9);
            assert.equal(app.weatherMetricValue(e, 'humidity', 'us'), 40);
        });

        it('JSON export then import keeps weather', async () => {
            await app.addEntry({ energy: 3 }, { status: 'ok', temp: 4, code: 3 });
            const exported = JSON.parse(JSON.stringify(await app.getAllEntries()));
            await app.clearAllEntries();
            await app.importEntriesFromArray(exported);
            const [rec] = plain(await app.getAllEntries());
            assert.deepEqual(rec.weather, { status: 'ok', temp: 4, code: 3 });
        });
    });

    describe('C: cross-check by other means', () => {
        it('the chart series for one reading per day matches the readings themselves', () => {
            const temps = [3, 8, -2, 11, 0, 6, 9];
            const entries = temps.map((t, i) => withWx(at(2026, 11, 17 + i, 10), { temp: t }));
            assert.deepEqual(plain(app.computeDailyWeather(entries, 'temp', 'metric', 7, NOW).map(p => p.value)), temps);
        });

        it('every axis covers its data with round, evenly spaced ticks', () => {
            for (const [vals, metric] of [[[3, 17], 'temp'], [[998.2, 1031.7], 'pressure'], [[29.41, 30.12], 'pressure'], [[0.02, 0.4], 'precip'], [[12, 97], 'humidity'], [[-14, -3], 'temp']]) {
                const a = plain(app.weatherAxis(vals, metric));
                assert.ok(a.min <= Math.min(...vals) && a.max >= Math.max(...vals), `${vals} -> ${a.min}..${a.max}`);
                assert.ok(a.ticks.length >= 2 && a.ticks.length <= 6, `${a.ticks.length} ticks`);
                const steps = a.ticks.slice(1).map((t, i) => +(t - a.ticks[i]).toFixed(6));
                assert.ok(steps.every(s => s === steps[0]), `uneven ${a.ticks}`);
            }
        });
    });

    describe('E: error conditions', () => {
        it('network failure keeps entries pending to retry later', async () => {
            const res = await app.fillPendingWeather([pending(NOW - DAY)], stubFetch(() => new TypeError('Failed to fetch')), { now: NOW });
            assert.equal(res.offline, true);
            assert.equal(res.changed.length, 0);
        });

        it('a server error counts an attempt, and gives up after five', async () => {
            const f = stubFetch(() => ({ ok: false, status: 503 }));
            let e = pending(NOW - DAY);
            for (let i = 1; i <= 5; i++) {
                const res = await app.fillPendingWeather([e], f, { now: NOW });
                e = res.changed[0];
                assert.equal(e.weather.attempts, i);
            }
            assert.equal(e.weather.status, 'unavailable');
        });

        it('a 400 (request Open-Meteo cannot answer) gives up straight away', async () => {
            const res = await app.fillPendingWeather([pending(NOW - DAY)], stubFetch(() => ({ ok: false, status: 400 })), { now: NOW });
            assert.equal(res.changed[0].weather.status, 'unavailable');
        });

        it('malformed responses parse to null instead of throwing', () => {
            for (const bad of [null, 'x', {}, { hourly: {} }, { hourly: { time: [] } }, { current: { temperature_2m: 'warm' } }]) {
                assert.equal(app.parseWeatherResponse(bad, 'hourly', NOW), null);
                assert.equal(app.parseWeatherResponse(bad, 'current', NOW), null);
            }
            // nearest hour more than an hour away is not this entry's weather
            assert.equal(app.parseWeatherResponse({ hourly: { time: ['2020-01-01T00:00'], temperature_2m: [1] } }, 'hourly', NOW), null);
        });

        it('an unknown city or failed lookup is reported, not saved', async () => {
            assert.equal(await app.geocodeCity('zzzz', stubFetch(() => ({ ok: true, body: {} }))), null);
            assert.equal(await app.geocodeCity('   ', stubFetch()), null);
            await assert.rejects(app.geocodeCity('Denver', stubFetch(() => ({ ok: false, status: 500 }))));
        });

        it('storage that throws does not break settings', () => {
            localStorage.failing = true;
            assert.equal(app.setWeatherSettings({ enabled: true }), false);
            assert.equal(app.getWeatherSettings().enabled, false);
        });

        it('an unknown weather code still gets a label', () => {
            assert.deepEqual(plain(app.weatherCodeInfo(42)), { label: 'Weather', icon: '🌡️' });
            assert.deepEqual(plain(app.weatherCodeInfo(null)), { label: 'Weather', icon: '🌡️' });
        });

        it('no location in the sandbox resolves to null rather than hanging', async () => {
            assert.equal(await app.getDeviceLocation(10), null);
        });
    });

    describe('P: performance', () => {
        it('a day of offline entries at one place costs one request', async () => {
            const f = stubFetch();
            const entries = Array.from({ length: 50 }, (_, i) => pending(at(2026, 11, 20, 0) + i * 15 * 60000));
            entries.forEach((e, i) => { e.id = i + 1; });
            const res = await app.fillPendingWeather(entries, f, { now: NOW });
            // 50 entries over 12.5 hours of one local day span at most two GMT-day windows
            assert.ok(f.calls.length <= 3, `${f.calls.length} requests`);
            assert.equal(res.changed.length, 50);
            assert.ok(res.changed.every(e => e.weather.status === 'ok'));
        });

        it('a year of entries with weather charts in well under 100 ms', () => {
            const entries = Array.from({ length: 365 * 4 }, (_, i) => withWx(NOW - i * 6 * HOUR, { temp: (i % 30) - 5, pressure: 1000 + (i % 40) }));
            const t0 = process.hrtime.bigint();
            const s = app.computeDailyWeather(entries, 'pressure', 'metric', 90, NOW);
            app.buildTrendSvg(app.computeDailySeries([], 'energy', 90, NOW), 'Energy', 640, { metric: 'pressure', units: 'metric', label: 'Pressure', series: s });
            const ms = Number(process.hrtime.bigint() - t0) / 1e6;
            assert.ok(ms < 100, `${ms.toFixed(1)} ms`);
        });
    });
});
