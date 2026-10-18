import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const port = 43123;

async function waitForServer(child, expectedPort) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Server did not start listening on port ${expectedPort}.`));
    }, 10000);

    const onData = (chunk) => {
      const output = chunk.toString();
      if (output.includes(`SkyCast listening on http://127.0.0.1:${expectedPort}`)) {
        clearTimeout(timeout);
        child.stdout.off('data', onData);
        child.stderr.off('data', onError);
        resolve();
      }
    };

    const onError = (chunk) => {
      const output = chunk.toString();
      if (output.includes('EADDRINUSE') || output.includes('Error:')) {
        clearTimeout(timeout);
        child.stdout.off('data', onData);
        child.stderr.off('data', onError);
        reject(new Error(output.trim()));
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onError);
    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        child.stdout.off('data', onData);
        child.stderr.off('data', onError);
        reject(new Error(`Server exited with code ${code}.`));
      }
    });
  });
}

async function withServer(callback) {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      NODE_ENV: 'development',
      FORCE_HTTPS: 'false',
      RATE_LIMIT_PER_MINUTE: '10000',
      OPENWEATHER_API_KEY: '',
      OPEN_METEO_API_KEY: '',
      GNEWS_API_KEY: '',
      RAINVIEWER_COMMERCIAL_LICENSE_CONFIRMED: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer(child, port);
    await callback();
  } finally {
    child.kill('SIGTERM');
    await delay(200);
  }
}

test('server responds with expected status and homepage', async () => {
  await withServer(async () => {
    const statusResponse = await fetch(`http://127.0.0.1:${port}/api/status`);
    assert.equal(statusResponse.status, 200, 'API status should return 200');
    const statusBody = await statusResponse.json();
    assert.equal(statusBody.provider, 'openweathermap', 'Current weather should use the configured OpenWeather provider');
    assert.equal(statusBody.configured, false, 'Weather key status should not expose a missing key as configured');
    assert.equal(statusBody.apiKeyRequired, true);
    assert.equal(statusBody.newsConfigured, false);
    assert.equal(statusBody.mapWeatherDataConfigured, false);
    assert.equal(statusBody.radarEnabled, false);
    assert.equal(statusResponse.headers.get('access-control-allow-origin'), '*');

    const weatherResponse = await fetch(`http://127.0.0.1:${port}/api/weather?q=London`);
    assert.equal(weatherResponse.status, 503);
    assert.match((await weatherResponse.json()).message, /OPENWEATHER_API_KEY/);
    assert.equal(weatherResponse.headers.get('access-control-allow-origin'), '*');

    const newsResponse = await fetch(`http://127.0.0.1:${port}/api/news`);
    assert.equal(newsResponse.status, 503);
    assert.match((await newsResponse.json()).message, /GNEWS_API_KEY/);
    assert.equal(newsResponse.headers.get('access-control-allow-origin'), '*');

    const mapResponse = await fetch(`http://127.0.0.1:${port}/api/map-data?bounds=-1,50,1,52`);
    assert.equal(mapResponse.status, 503);
    assert.match((await mapResponse.json()).message, /customer API key/);
    const radarResponse = await fetch(`http://127.0.0.1:${port}/api/radar/metadata`);
    assert.equal(radarResponse.status, 503);
    assert.match((await radarResponse.json()).message, /ad-supported commercial use/);

    const homeResponse = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(homeResponse.status, 200, 'Home page should return 200');
    const html = await homeResponse.text();
    assert.match(html, /SkyCast/i, 'Home page should include the SkyCast app shell');
    assert.match(html, /style\.css\?v=11/);
    assert.match(html, /script\.js\?v=13/);
    assert.match(html, /name="skycast-version" content="2\.0\.0"/);
    assert.match(html, /assets\/favicon\.svg/);
    assert.match(html, /id="mobileMenuToggle"/);
    assert.match(html, /id="navBackdrop"/);
    assert.match(html, /id="not-found-page"/);
    assert.match(html, /data-app-version/);
    assert.match(html, /id="settings-page"/);
    assert.match(html, /data-page="saved"/);
    assert.match(html, /id="forecast-page"/);
    assert.match(html, /id="analytics-page"/);
    assert.match(html, /id="comparison-page"/);
    assert.match(html, /id="forecastTimeline"/);
    assert.match(html, /id="mapOpacity"/);
    assert.match(html, /id="mapBasemap"/);
    assert.match(html, /data-map-mode="precipitation"/);
    assert.match(html, /id="radarFrameSlider"/);

    const scriptResponse = await fetch(`http://127.0.0.1:${port}/js/script.js`);
    const script = await scriptResponse.text();
    assert.match(script, /window\.location\.port !== "3000"/);
    assert.match(script, /:3000\/api/);
    assert.match(script, /function downloadForecastCsv/);
    assert.match(script, /function renderComparison/);
    assert.match(script, /function renderForecastAnalytics/);
    assert.doesNotMatch(script, /OPENWEATHER_API_KEY|GNEWS_API_KEY|localhost:\d+|127\.0\.0\.1:\d+/);
    const serviceWorkerResponse = await fetch(`http://127.0.0.1:${port}/sw.js`);
    const serviceWorker = await serviceWorkerResponse.text();
    assert.match(serviceWorker, /skycast-shell-v13/);
    assert.match(serviceWorker, /assets\/favicon\.svg/);

    const privacyResponse = await fetch(`http://127.0.0.1:${port}/privacy-policy.html`);
    assert.equal(privacyResponse.status, 200, 'Privacy policy should be served');
    const privacyHtml = await privacyResponse.text();
    assert.match(privacyHtml, /Privacy Policy/i, 'Privacy policy should be readable');
    assert.match(privacyHtml, /class="policy-page"/);
    assert.match(privacyHtml, /Google AdSense loader/);
    assert.match(privacyHtml, /Owner action required/);

    const notFoundResponse = await fetch(`http://127.0.0.1:${port}/unknown-page`);
    assert.equal(notFoundResponse.status, 404);
    assert.match(notFoundResponse.headers.get('content-type'), /text\/html/);
    assert.match(await notFoundResponse.text(), /We can't find that page/);
  });
});
