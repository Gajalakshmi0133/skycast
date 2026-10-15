import test from "node:test";
import assert from "node:assert/strict";
import { onRequest as routeApi } from "../functions/api/[[path]].js";
import { onRequest as routeStatus } from "../functions/api/status.js";
import { onRequest as routeWeather } from "../functions/api/weather.js";
import { onRequest as routeNews } from "../functions/api/news.js";

const request = (path, method = "GET") => new Request(`https://skycast.example${path}`, { method });

test("Cloudflare API rejects unsupported methods and unknown endpoints", async () => {
  const methodResponse = await routeApi({ request: request("/api/forecast", "POST"), env: {} });
  assert.equal(methodResponse.status, 405);
  assert.equal(methodResponse.headers.get("allow"), "GET");

  const missingResponse = await routeApi({ request: request("/api/not-configured"), env: {} });
  assert.equal(missingResponse.status, 404);
});

test("Cloudflare status reports configuration without exposing credentials", async () => {
  const secret = "test-only-openweather-secret";
  const response = await routeStatus({
    request: request("/api/status"),
    env: { OPENWEATHER_API_KEY: secret, GNEWS_API_KEY: "test-only-gnews-secret" }
  });
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /"configured":true/);
  assert.match(body, /"newsConfigured":true/);
  assert.doesNotMatch(body, /test-only-(openweather|gnews)-secret/);
});

test("Cloudflare weather proxy keeps the OpenWeather key out of its response", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "test-only-openweather-secret";
  let upstreamUrl;
  globalThis.fetch = async (url) => {
    upstreamUrl = String(url);
    return Response.json({
      cod: 200,
      name: "London",
      coord: { lat: 51.5, lon: -0.1 },
      sys: { country: "GB", sunrise: 1, sunset: 2 },
      weather: [{ main: "Clouds", description: "overcast clouds", icon: "04d" }],
      main: { temp: 12, feels_like: 11, humidity: 70, pressure: 1012 }
    });
  };
  try {
    const response = await routeWeather({
      request: request("/api/weather?q=London"),
      env: { OPENWEATHER_API_KEY: secret }
    });
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(upstreamUrl, /api\.openweathermap\.org/);
    assert.match(upstreamUrl, new RegExp(encodeURIComponent(secret)));
    assert.doesNotMatch(body, /test-only-openweather-secret/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Cloudflare GNews proxy keeps its key out of its response", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "test-only-gnews-secret";
  let upstreamUrl;
  globalThis.fetch = async (url) => {
    upstreamUrl = String(url);
    return Response.json({ articles: [] });
  };
  try {
    const response = await routeNews({
      request: request("/api/news?category=all"),
      env: { GNEWS_API_KEY: secret }
    });
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(upstreamUrl, /gnews\.io\/api\/v4\/search/);
    assert.match(upstreamUrl, new RegExp(encodeURIComponent(secret)));
    assert.doesNotMatch(body, /test-only-gnews-secret/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Cloudflare geocoding proxy uses the provider and preserves the frontend response shape", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamUrl;
  globalThis.fetch = async (url) => {
    upstreamUrl = String(url);
    return Response.json({
      results: [{ name: "London", admin1: "England", country_code: "GB", latitude: 51.5, longitude: -0.1 }]
    });
  };
  try {
    const response = await routeApi({ request: request("/api/geocode?q=London&limit=2"), env: {} });
    assert.equal(response.status, 200);
    assert.match(upstreamUrl, /geocoding-api\.open-meteo\.com/);
    assert.deepEqual(await response.json(), [{
      name: "London", state: "England", country: "GB", lat: 51.5, lon: -0.1
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Cloudflare forecast, air-quality, and UV routes return the data shapes used by the frontend", async () => {
  const originalFetch = globalThis.fetch;
  const times = Array.from({ length: 56 }, (_, index) => `2026-10-${String(12 + Math.floor(index / 24)).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00`);
  globalThis.fetch = async (url) => {
    const target = new URL(String(url));
    if (target.hostname === "air-quality-api.open-meteo.com") {
      return Response.json({
        current: {
          european_aqi: 35, pm10: 8, pm2_5: 4, carbon_monoxide: 100,
          nitrogen_dioxide: 5, sulphur_dioxide: 2, ozone: 60
        }
      });
    }
    if (target.hostname === "api.open-meteo.com" && target.searchParams.has("hourly")) {
      const values = Object.fromEntries([
        "temperature_2m", "relative_humidity_2m", "dew_point_2m", "apparent_temperature",
        "surface_pressure", "precipitation_probability", "precipitation", "weather_code",
        "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "cloud_cover"
      ].map(key => [key, Array(56).fill(key === "weather_code" ? 0 : 12)]));
      return Response.json({
        hourly: { time: times, ...values },
        daily: { time: ["2026-10-12"], temperature_2m_max: [16], temperature_2m_min: [8] },
        timezone: "Europe/London",
        utc_offset_seconds: 3600
      });
    }
    return Response.json({
      current: {
        temperature_2m: 12, relative_humidity_2m: 70, apparent_temperature: 11,
        dew_point_2m: 6, surface_pressure: 1012, wind_speed_10m: 3,
        wind_direction_10m: 180, wind_gusts_10m: 5, visibility: 10000,
        cloud_cover: 50, precipitation: 0, weather_code: 0, uv_index: 2
      },
      daily: { sunrise: ["2026-10-12T07:00"], sunset: ["2026-10-12T18:00"] },
      timezone: "Europe/London",
      timezone_abbreviation: "BST",
      utc_offset_seconds: 3600
    });
  };
  try {
    const forecast = await routeApi({ request: request("/api/forecast?lat=51.5&lon=-0.1"), env: {} });
    const forecastBody = await forecast.json();
    assert.equal(forecast.status, 200);
    assert.equal(forecastBody.list.length, 56);
    assert.equal(forecastBody.timezone, "Europe/London");

    const airQuality = await routeApi({ request: request("/api/air-quality?lat=51.5&lon=-0.1"), env: {} });
    const airQualityBody = await airQuality.json();
    assert.equal(airQuality.status, 200);
    assert.equal(airQualityBody.list[0].main.aqi, 2);
    assert.equal(airQualityBody.provider, "Open-Meteo Air Quality");

    const uv = await routeApi({ request: request("/api/uv?lat=51.5&lon=-0.1"), env: {} });
    assert.equal(uv.status, 200);
    assert.deepEqual(await uv.json(), { value: 2 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Cloudflare NOAA alerts handle out-of-coverage locations without failing", async () => {
  const originalFetch = globalThis.fetch;
  let contactHeader;
  globalThis.fetch = async (_url, init) => {
    contactHeader = new Headers(init.headers).get("user-agent");
    return new Response("not covered", { status: 404 });
  };
  try {
    const response = await routeApi({
      request: request("/api/alerts?lat=48.8&lon=2.3"),
      env: { SKYCAST_CONTACT: "test@example.com" }
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(contactHeader, "SkyCast/2.0 (+https://skycastio.netlify.app; test@example.com)");
    assert.deepEqual(body.alerts, []);
    assert.equal(body.provider, "NOAA/NWS");
    assert.ok(Number.isFinite(Date.parse(body.fetchedAt)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Cloudflare map tile proxy keeps its configured key on the upstream request only", async () => {
  const originalFetch = globalThis.fetch;
  const secret = "test-only-openweather-secret";
  let upstreamUrl;
  globalThis.fetch = async (url) => {
    upstreamUrl = String(url);
    return new Response(Uint8Array.from([137, 80, 78, 71]), {
      headers: { "content-type": "image/png" }
    });
  };
  try {
    const response = await routeApi({
      request: request("/api/map/temp_new/1/0/0.png"),
      env: { OPENWEATHER_API_KEY: secret }
    });
    assert.equal(response.status, 200);
    assert.match(upstreamUrl, /tile\.openweathermap\.org/);
    assert.match(upstreamUrl, new RegExp(encodeURIComponent(secret)));
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [137, 80, 78, 71]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Cloudflare map tile proxy reports missing credentials without exposing keys", async () => {
  const secret = "test-only-openweather-secret";
  const response = await routeApi({
    request: request("/api/map/temp_new/1/0/0.png"),
    env: {}
  });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), new RegExp(secret));
});
