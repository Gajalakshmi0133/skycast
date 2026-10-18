import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { config } from "./config.js";
import { collectAlertsForLocation, fetchImdDistrictWarnings } from "./alert-system.js";
import { createHttpClient } from "../js/core/http.js";
import { cache, cacheKeyFor, roundCoord } from "./cache.js";
import { apiStatus, newsApi, weatherApi } from "./provider-api.js";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

const securityHeaders = {
  "content-security-policy": "default-src 'self'; img-src 'self' data: https:; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://www.googletagmanager.com https://pagead2.googlesyndication.com https://*.adtrafficquality.google; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com; font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; connect-src 'self' https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://server.arcgisonline.com https://customer-api.open-meteo.com https://api.rainviewer.com https://tilecache.rainviewer.com https://gibs.earthdata.nasa.gov https://www.googletagmanager.com https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net https://*.googlesyndication.com https://*.adtrafficquality.google; frame-src https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://*.adtrafficquality.google https://www.google.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self';",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "geolocation=(self), microphone=(self), camera=(), interest-cohort=()",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-xss-protection": "0",
  "strict-transport-security": "max-age=31536000; includeSubDomains"
};

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "Content-Type"
};

const upstreamClient = createHttpClient({
  userAgent: config.userAgent,
  timeoutMs: config.upstream.timeoutMs,
  maxRetries: config.upstream.maxRetries,
  backoffBaseMs: config.upstream.backoffBaseMs
});
const appVersion = JSON.parse(await readFile(join(config.projectRoot, "package.json"), "utf8")).version;

const applySecurityHeaders = (response, extra = {}) => {
  Object.entries({ ...securityHeaders, ...extra }).forEach(([key, value]) => {
    response.setHeader(key, value);
  });
};

const json = (response, status, body, extraHeaders = {}) => {
  applySecurityHeaders(response, {
    ...corsHeaders,
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders
  });
  response.writeHead(status);
  response.end(JSON.stringify(body));
};

const weatherDescription = (code) => {
  if (code === 0) return ["Clear sky", "01d"];
  if ([1, 2].includes(code)) return ["Partly cloudy", "02d"];
  if (code === 3) return ["Overcast", "04d"];
  if ([45, 48].includes(code)) return ["Fog", "50d"];
  if ([51, 53, 55, 56, 57].includes(code)) return ["Drizzle", "09d"];
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return ["Rain", "10d"];
  if ([71, 73, 75, 77, 85, 86].includes(code)) return ["Snow", "13d"];
  if ([95, 96, 99].includes(code)) return ["Thunderstorm", "11d"];
  return ["Unknown", "03d"];
};

const openMeteo = async (path, params) => {
  const host = path === "/v1/search" ? "https://geocoding-api.open-meteo.com"
    : path === "/v1/air-quality" ? "https://air-quality-api.open-meteo.com"
      : config.keys.openMeteo ? "https://customer-api.open-meteo.com" : "https://api.open-meteo.com";
  const url = new URL(`${host}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") url.searchParams.set(key, value);
  });
  if (host === "https://customer-api.open-meteo.com") url.searchParams.set("apikey", config.keys.openMeteo);
  return upstreamClient.json(url.toString());
};

const finiteNumber = (value, fallback = null) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : fallback;
const epochForLocalTime = (value, offsetSeconds = 0) => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T?(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const utcMillis = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] || 0));
  return Math.floor((utcMillis - Number(offsetSeconds) * 1000) / 1000);
};

const coordinatesFromParams = async (params) => {
  if (params.lat !== undefined && params.lon !== undefined) {
    const lat = finiteNumber(params.lat);
    const lon = finiteNumber(params.lon);
    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new Error("Invalid coordinates.");
    return { lat, lon, name: "Selected location", country: "" };
  }
  if (!params.q) throw new Error("A location is required.");
  const query = String(params.q).trim();
  const candidates = [query];
  const beforeComma = query.split(",")[0].trim();
  if (beforeComma && beforeComma !== query) candidates.push(beforeComma);
  const words = query.split(/\s+/);
  while (words.length > 1) {
    words.pop();
    candidates.push(words.join(" "));
  }

  let place;
  for (const candidate of [...new Set(candidates)]) {
    const locations = await openMeteo("/v1/search", { name: candidate, count: 1, language: "en", format: "json" });
    place = locations.results?.[0];
    if (place) break;
  }
  if (!place) throw new Error("Location not found.");
  return { lat: place.latitude, lon: place.longitude, name: place.name, country: place.country_code || "" };
};

const currentFromOpenMeteo = async (params) => {
  const location = await coordinatesFromParams(params);
  const data = await openMeteo("/v1/forecast", {
    latitude: location.lat,
    longitude: location.lon,
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,dew_point_2m,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,cloud_cover,precipitation,weather_code,uv_index",
    daily: "sunrise,sunset",
    timezone: "auto"
  });
  const current = data.current;
  if (!current || !data.daily?.sunrise?.[0] || !data.daily?.sunset?.[0]) throw new Error("Current weather data is incomplete.");
  const [description, icon] = weatherDescription(current.weather_code);
  return {
    cod: 200,
    name: location.name,
    coord: { lat: location.lat, lon: location.lon },
    sys: { country: location.country, sunrise: epochForLocalTime(data.daily.sunrise[0], data.utc_offset_seconds), sunset: epochForLocalTime(data.daily.sunset[0], data.utc_offset_seconds) },
    weather: [{ main: description, description: description.toLowerCase(), icon }],
    main: { temp: finiteNumber(current.temperature_2m, 0), feels_like: finiteNumber(current.apparent_temperature, current.temperature_2m), dew_point: finiteNumber(current.dew_point_2m), humidity: finiteNumber(current.relative_humidity_2m, 0), pressure: finiteNumber(current.surface_pressure, 0) },
    wind: { speed: finiteNumber(current.wind_speed_10m, 0), deg: finiteNumber(current.wind_direction_10m, 0), gust: finiteNumber(current.wind_gusts_10m) },
    visibility: finiteNumber(current.visibility, 0),
    clouds: { all: finiteNumber(current.cloud_cover, 0) },
    rain: { "1h": finiteNumber(current.precipitation, 0) },
    uv_index: finiteNumber(current.uv_index, 0),
    timezone: data.timezone || "UTC",
    timezoneAbbreviation: data.timezone_abbreviation || "UTC",
    utcOffsetSeconds: data.utc_offset_seconds || 0
  };
};

const forecastFromOpenMeteo = async (params) => {
  const location = await coordinatesFromParams(params);
  const data = await openMeteo("/v1/forecast", {
    latitude: location.lat,
    longitude: location.lon,
    hourly: "temperature_2m,relative_humidity_2m,dew_point_2m,apparent_temperature,surface_pressure,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
    timezone: "auto",
    forecast_days: 7
  });
  if (!data.hourly?.time?.length) throw new Error("Forecast data is empty.");
  const list = data.hourly.time.slice(0, 56).map((time, index) => {
    const [description, icon] = weatherDescription(data.hourly.weather_code[index]);
    return {
      dt: epochForLocalTime(time, data.utc_offset_seconds),
      dt_txt: time.replace("T", " ") + ":00",
      local_time: time,
      main: { temp: finiteNumber(data.hourly.temperature_2m[index], 0), feels_like: finiteNumber(data.hourly.apparent_temperature[index], data.hourly.temperature_2m[index]), dew_point: finiteNumber(data.hourly.dew_point_2m[index]), pressure: finiteNumber(data.hourly.surface_pressure[index]), humidity: finiteNumber(data.hourly.relative_humidity_2m[index], 0) },
      pop: (data.hourly.precipitation_probability[index] || 0) / 100,
      wind: { speed: finiteNumber(data.hourly.wind_speed_10m[index], 0), deg: finiteNumber(data.hourly.wind_direction_10m[index]), gust: finiteNumber(data.hourly.wind_gusts_10m[index]) },
      clouds: { all: finiteNumber(data.hourly.cloud_cover[index]) },
      rain: { "1h": finiteNumber(data.hourly.precipitation?.[index], 0) },
      weather: [{ main: description, description: description.toLowerCase(), icon }]
    };
  });
  return {
    cod: "200",
    list,
    daily: data.daily,
    timezone: data.timezone || "UTC",
    timezoneAbbreviation: data.timezone_abbreviation || "UTC",
    utcOffsetSeconds: data.utc_offset_seconds || 0
  };
};

const airQualityFromOpenMeteo = async (params) => {
  const location = await coordinatesFromParams(params);
  const data = await openMeteo("/v1/air-quality", {
    latitude: location.lat,
    longitude: location.lon,
    current: "european_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone",
    timezone: "auto"
  });
  const current = data.current;
  if (!current) throw new Error("Air-quality data is empty.");
  const europeanAqi = finiteNumber(current.european_aqi, 0);
  const aqi = europeanAqi <= 20 ? 1 : europeanAqi <= 40 ? 2 : europeanAqi <= 60 ? 3 : europeanAqi <= 80 ? 4 : 5;
  return { list: [{ main: { aqi }, components: { pm2_5: finiteNumber(current.pm2_5, 0), pm10: finiteNumber(current.pm10, 0), co: finiteNumber(current.carbon_monoxide, 0), no2: finiteNumber(current.nitrogen_dioxide, 0), so2: finiteNumber(current.sulphur_dioxide, 0), o3: finiteNumber(current.ozone, 0) } }], provider: "Open-Meteo Air Quality" };
};

const geocodeFromOpenMeteo = async (params) => {
  const data = await openMeteo("/v1/search", { name: params.q, count: params.limit || 5, language: "en", format: "json" });
  return (data.results || []).map(place => ({
    name: place.name,
    state: place.admin1 || "",
    country: place.country_code || "",
    lat: place.latitude,
    lon: place.longitude
  }));
};

const alertsFromNws = async (params) => {
  const lat = finiteNumber(params.lat);
  const lon = finiteNumber(params.lon);
  if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new Error("Invalid coordinates.");

  let point;
  try {
    point = await upstreamClient.json(`https://api.weather.gov/points/${lat},${lon}`);
  } catch (error) {
    if (error?.status === 404) {
      return { alerts: [], provider: "NOAA/NWS", fetchedAt: new Date().toISOString() };
    }
    throw error;
  }
  const alertsUrl = point.properties?.forecastZone
    ? `https://api.weather.gov/alerts/active?point=${lat},${lon}`
    : null;
  if (!alertsUrl) return { alerts: [], provider: "NOAA/NWS", fetchedAt: new Date().toISOString() };
  const data = await upstreamClient.json(alertsUrl);
  const hazardPattern = /(thunder|storm|rain|flood|cyclone|hurricane|heat|cold|wind|fog|lightning|tornado|snow|ice|blizzard|fire)/i;
  return {
    alerts: (data.features || []).map(({ properties: alert = {} }) => ({
      id: String(alert.id || "").trim(),
      event: String(alert.event || "Weather alert").trim(),
      severity: String(alert.severity || "Unknown").trim(),
      urgency: String(alert.urgency || "Unknown").trim(),
      area: String(alert.areaDesc || "Affected area unavailable").trim(),
      start: String(alert.effective || alert.onset || "").trim(),
      end: String(alert.expires || "").trim(),
      sender: String(alert.senderName || "NOAA/NWS").trim(),
      description: String(alert.description || "").trim(),
      instruction: String(alert.instruction || "Follow instructions from local emergency management officials.").trim()
    })).filter(alert => alert.event && alert.description && hazardPattern.test(`${alert.event} ${alert.description}`)),
    provider: "NOAA/NWS",
    fetchedAt: new Date().toISOString()
  };
};

const alertsWithCache = async (params) => {
  const lat = roundCoord(params.lat);
  const lon = roundCoord(params.lon);
  if (lat === null || lon === null) throw new Error("Invalid coordinates.");
  const key = cacheKeyFor("alerts", { lat, lon });
  const result = await cache.getOrLoad(key, {
    ttlMs: config.cacheTtl.alerts,
    loader: async () => {
      const nws = await alertsFromNws({ lat, lon });
      const imd = await fetchImdDistrictWarnings(upstreamClient, lat, lon);
      const merged = await collectAlertsForLocation({
        lat,
        lon,
        fetchNws: async () => (nws.alerts || []).map(alert => ({ ...alert, provider: "NOAA/NWS" })),
        fetchImd: async () => imd
      });
      return {
        alerts: merged.alerts,
        provider: merged.alerts.length ? (merged.provider || "Official alert providers") : (nws.provider || "NOAA/NWS"),
        fetchedAt: merged.fetchedAt,
        meta: merged.meta
      };
    },
    allowStale: false
  });
  return { ...result.value, cached: result.cached, stale: result.stale, ageSeconds: result.ageSeconds };
};

async function weatherProxy(loader, response, label) {
  try {
    json(response, 200, await loader());
  } catch (error) {
    console.error(`${label} request failed (status ${error.status || "upstream"}).`);
    const isLocationError = error.message === "Location not found.";
    const isInputError = error.message === "A location is required." || error.message === "Invalid coordinates.";
    const status = isLocationError ? 404 : isInputError ? 400 : error.status || 502;
    const serviceName = label[0].toUpperCase() + label.slice(1);
    const message = isLocationError || isInputError
      ? error.message
      : status === 429 || status === 503
        ? `${serviceName} service is busy or temporarily unavailable. Please try again shortly.`
        : `${serviceName} data is temporarily unavailable.`;
    json(response, status, {
      cod: status,
      message
    });
  }
}

async function sendApiResponse(apiResponse, response) {
  applySecurityHeaders(response, {
    ...corsHeaders,
    ...Object.fromEntries(apiResponse.headers.entries())
  });
  response.writeHead(apiResponse.status);
  response.end(Buffer.from(await apiResponse.arrayBuffer()));
}

const rateLimitStore = new Map();
const weatherMapCache = new Map();
let radarMetadataCache = null;

function isRateLimited(request) {
  const ip = request.headers["x-forwarded-for"]?.toString().split(",")[0].trim() || request.socket.remoteAddress || "unknown";
  const localAddresses = ["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"];
  if (localAddresses.includes(ip)) return false;

  const now = Date.now();
  const bucket = rateLimitStore.get(ip) || [];
  const recent = bucket.filter(timestamp => now - timestamp < 60000);
  recent.push(now);
  rateLimitStore.set(ip, recent);
  return recent.length > config.rateLimitPerMinute;
}

async function serveStatic(pathname, response) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const file = normalize(join(config.projectRoot, requested));
  if (!file.startsWith(config.projectRoot)) {
    json(response, 403, { message: "Forbidden" });
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("Not a file");
    const headers = {
      "content-type": mime[extname(file)] || "application/octet-stream",
      "cache-control": pathname === "/index.html" || pathname === "/privacy-policy.html" ? "no-cache" : "public, max-age=86400, immutable"
    };
    applySecurityHeaders(response, headers);
    response.writeHead(200);
    const contents = await readFile(file);
    response.end(requested === "/index.html"
      ? contents.toString().replaceAll("__SKYCAST_VERSION__", appVersion)
      : contents);
  } catch {
    try {
      const notFound = await readFile(join(config.projectRoot, "404.html"));
      applySecurityHeaders(response, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache"
      });
      response.writeHead(404);
      response.end(notFound);
    } catch (error) {
      console.error("Custom not-found page could not be served:", error);
      json(response, 404, { message: "Not found" });
    }
  }
}

function mapGrid(boundsValue) {
  const bounds = String(boundsValue || "").split(",").map(Number);
  if (bounds.length !== 4 || !bounds.every(Number.isFinite)) {
    throw Object.assign(new Error("Map bounds must be west,south,east,north."), { status: 400 });
  }
  const [west, south, east, north] = bounds;
  if (west < -180 || west > 180 || east < -180 || east > 180 || south < -85 || north > 85 || south >= north) {
    throw Object.assign(new Error("Map bounds are outside supported coordinates."), { status: 400 });
  }
  let longitudeSpan = east - west;
  if (longitudeSpan <= 0) longitudeSpan += 360;
  longitudeSpan = Math.min(360, longitudeSpan);
  return Array.from({ length: 35 }, (_, index) => {
    const row = Math.floor(index / 7);
    const column = index % 7;
    const rawLongitude = west + (longitudeSpan * column) / 6;
    return {
      latitude: north - ((north - south) * row) / 4,
      longitude: ((rawLongitude + 180) % 360 + 360) % 360 - 180
    };
  });
}

async function mapWeatherData(params) {
  if (!config.keys.openMeteo) {
    throw Object.assign(new Error("Weather map data requires an Open-Meteo customer API key for this ad-supported deployment."), { status: 503 });
  }
  const points = mapGrid(params.bounds);
  const key = points.map(point => `${point.latitude.toFixed(2)},${point.longitude.toFixed(2)}`).join("|");
  const cached = weatherMapCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const url = new URL("https://customer-api.open-meteo.com/v1/forecast");
  url.searchParams.set("apikey", config.keys.openMeteo);
  url.searchParams.set("latitude", points.map(point => point.latitude.toFixed(3)).join(","));
  url.searchParams.set("longitude", points.map(point => point.longitude.toFixed(3)).join(","));
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m,cloud_cover,precipitation");
  url.searchParams.set("wind_speed_unit", "kmh");
  url.searchParams.set("timezone", "UTC");
  const data = await upstreamClient.json(url.toString());
  const locations = Array.isArray(data) ? data : [data];
  const values = points.map((point, index) => {
    const current = locations[index]?.current;
    if (!current) return null;
    return {
      lat: point.latitude, lon: point.longitude, time: current.time || null,
      temperature: finiteNumber(current.temperature_2m),
      humidity: finiteNumber(current.relative_humidity_2m),
      pressure: finiteNumber(current.surface_pressure),
      windSpeed: finiteNumber(current.wind_speed_10m),
      windDirection: finiteNumber(current.wind_direction_10m),
      clouds: finiteNumber(current.cloud_cover),
      precipitation: finiteNumber(current.precipitation)
    };
  }).filter(point => point && [
    point.temperature, point.humidity, point.pressure, point.windSpeed,
    point.windDirection, point.clouds, point.precipitation
  ].some(Number.isFinite));
  if (!values.length) throw new Error("Weather map data is empty.");
  const value = {
    points: values, provider: "Open-Meteo", dataType: "weather-model analysis",
    updatedAt: new Date().toISOString(), modelTime: locations[0]?.current?.time || null
  };
  weatherMapCache.set(key, { value, expiresAt: Date.now() + 300_000 });
  if (weatherMapCache.size > 100) weatherMapCache.delete(weatherMapCache.keys().next().value);
  return value;
}

const radarLicenseConfirmed = () => String(process.env.RAINVIEWER_COMMERCIAL_LICENSE_CONFIRMED || "").toLowerCase() === "true";

async function radarMetadata() {
  if (!radarLicenseConfirmed()) {
    throw Object.assign(new Error("RainViewer radar is disabled: its free API terms do not permit ad-supported commercial use. Obtain commercial permission before enabling it."), { status: 503 });
  }
  if (radarMetadataCache && radarMetadataCache.expiresAt > Date.now()) return radarMetadataCache.value;
  const metadata = await upstreamClient.json("https://api.rainviewer.com/public/weather-maps.json");
  const host = String(metadata.host || "");
  const generated = finiteNumber(metadata.generated);
  if (host !== "https://tilecache.rainviewer.com" || !Number.isInteger(generated) || generated > Date.now() / 1000 + 60) {
    throw new Error("RainViewer returned invalid radar metadata.");
  }
  const frames = (metadata.radar?.past || []).filter(frame => Number.isInteger(Number(frame.time))
    && Number(frame.time) <= Date.now() / 1000
    && /^\/v2\/radar\/[A-Za-z0-9_-]+$/.test(String(frame.path || "")))
    .map(frame => ({ time: Number(frame.time), path: frame.path }));
  const value = { host, generated, frames, provider: "RainViewer" };
  radarMetadataCache = { value, expiresAt: Date.now() + 60_000 };
  return value;
}

async function serveRadarCoverage(zoom, x, y, response) {
  if (!radarLicenseConfirmed()) throw Object.assign(new Error("RainViewer radar is disabled pending commercial permission."), { status: 503 });
  const z = Number(zoom);
  const tileX = Number(x);
  const tileY = Number(y);
  const scale = 2 ** z;
  if (![z, tileX, tileY].every(Number.isInteger) || z < 0 || z > 7 || tileX < 0 || tileX >= scale || tileY < 0 || tileY >= scale) {
    throw Object.assign(new Error("Invalid RainViewer coverage tile."), { status: 400 });
  }
  const image = await upstreamClient.binary(`https://tilecache.rainviewer.com/v2/coverage/0/256/${z}/${tileX}/${tileY}/0/0_0.png`);
  applySecurityHeaders(response, {
    ...corsHeaders, "content-type": "image/png", "cache-control": "public, max-age=86400"
  });
  response.writeHead(200);
  response.end(Buffer.from(image));
}

const server = createServer(async (request, response) => {
  const protocol = request.headers["x-forwarded-proto"] || "http";
  const url = new URL(request.url, `${protocol}://${request.headers.host || "localhost"}`);

  if (config.forceHttps && protocol !== "https") {
    const redirectUrl = new URL(request.url, `https://${request.headers.host || "localhost"}`);
    applySecurityHeaders(response, {
      location: redirectUrl.toString(),
      "cache-control": "no-store"
    });
    response.writeHead(301);
    response.end();
    return;
  }

  if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    applySecurityHeaders(response, { ...corsHeaders, "content-length": "0" });
    response.writeHead(204);
    response.end();
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    if (isRateLimited(request)) {
      json(response, 429, { cod: 429, message: "Too many API requests. Please slow down and try again later." });
      return;
    }
  }

  if (url.pathname === "/api/status") {
    return sendApiResponse(new Response(JSON.stringify(apiStatus(process.env)), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    }), response);
  }
  const params = Object.fromEntries(url.searchParams);
  if (url.pathname === "/api/weather") return sendApiResponse(await weatherApi(params, process.env, {
    httpClient: upstreamClient,
    isProduction: config.isProduction
  }), response);
  if (url.pathname === "/api/forecast") return weatherProxy(() => forecastFromOpenMeteo(params), response, "forecast");
  if (url.pathname === "/api/geocode") return weatherProxy(() => geocodeFromOpenMeteo(params), response, "geocoding");
  if (url.pathname === "/api/air-quality") return weatherProxy(() => airQualityFromOpenMeteo(params), response, "air quality");
  if (url.pathname === "/api/uv") return weatherProxy(async () => ({ value: (await currentFromOpenMeteo(params)).uv_index }), response, "UV");
  if (url.pathname === "/api/alerts") {
    try {
      return json(response, 200, await alertsWithCache(params));
    } catch (error) {
      console.error("NOAA/NWS alerts request failed:", error);
      return json(response, 502, { cod: 502, message: "Official weather alerts are temporarily unavailable." });
    }
  }
  if (url.pathname === "/api/news") {
    return sendApiResponse(await newsApi(params, process.env, {
      httpClient: upstreamClient,
      isProduction: config.isProduction,
      userAgent: config.userAgent,
      timeoutMs: config.upstream.timeoutMs,
      maxRetries: config.upstream.maxRetries,
      backoffBaseMs: config.upstream.backoffBaseMs
    }), response);
  }
  if (url.pathname === "/api/map-data") {
    try {
      const data = await mapWeatherData(params);
      return json(response, 200, data, { "cache-control": "public, max-age=300, stale-while-revalidate=600" });
    } catch (error) {
      console.error(`Weather map data request failed (status ${error.status || "upstream"}).`);
      const status = error.status === 400 || error.status === 503 ? error.status : 502;
      return json(response, status, {
        cod: status,
        message: status === 400 || status === 503 ? error.message : "Weather map data is temporarily unavailable."
      });
    }
  }
  if (url.pathname === "/api/radar/metadata") {
    try {
      const data = await radarMetadata();
      return json(response, 200, data, { "cache-control": "public, max-age=60" });
    } catch (error) {
      const status = error.status || 502;
      console.error(`Radar metadata request failed (status ${status}).`);
      return json(response, status, { cod: status, message: error.message || "Radar metadata is temporarily unavailable." });
    }
  }
  const coverageMatch = url.pathname.match(/^\/api\/radar\/coverage\/(\d+)\/(\d+)\/(\d+)\.png$/);
  if (coverageMatch) {
    try {
      return await serveRadarCoverage(coverageMatch[1], coverageMatch[2], coverageMatch[3], response);
    } catch (error) {
      const status = error.status || 502;
      console.error(`Radar coverage request failed (status ${status}).`);
      return json(response, status, { cod: status, message: error.message || "Radar coverage data is temporarily unavailable." });
    }
  }
  return serveStatic(url.pathname, response);
});

server.listen(config.port, config.host, () => {
  console.log(`SkyCast listening on http://${config.host}:${config.port}`);
});
