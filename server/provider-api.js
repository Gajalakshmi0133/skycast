import { createHttpClient } from "../js/core/http.js";

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BACKOFF_BASE_MS = 400;
const newsCache = new Map();

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const jsonResponse = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  }
});

const messageFor = (error, isProduction, provider) => {
  if (isProduction) return provider === "weather" ? "Weather data is temporarily unavailable." : "Live news is temporarily unavailable.";
  if (provider === "weather") {
    if (error.status === 503 && error.message.includes("OPENWEATHER_API_KEY")) return error.message;
    if (error.status === 401 || error.status === 403) return "OpenWeather rejected the server key. Check OPENWEATHER_API_KEY and provider access.";
    if (error.status === 404) return "Location not found.";
    if (error.status === 400) return error.message;
    if (error.status) return `OpenWeather request failed (HTTP ${error.status}).`;
  } else {
    if (error.status === 503 && error.message.includes("GNEWS_API_KEY")) return error.message;
    if (error.status) return `GNews request failed (HTTP ${error.status}). Check GNEWS_API_KEY and provider access.`;
  }
  return error.message || (provider === "weather" ? "Weather data is temporarily unavailable." : "Live news is temporarily unavailable.");
};

const topics = {
  weather: ["weather", "storm", "cyclone", "rainfall", "flood", "drought", "forecast", "hurricane", "tornado"],
  environment: ["environment", "environmental", "climate", "pollution", "conservation", "biodiversity", "ecosystem", "wildlife", "deforestation"],
  climate: ["climate", "global warming", "greenhouse gas", "drought", "flood", "environment"],
  science: ["science", "scientific", "research", "climate", "environment", "weather"]
};

function queryFor(category, requestedQuery) {
  const topicQuery = (topics[category] || ["weather", "environment", "climate", "science"]).join(" OR ");
  return requestedQuery ? `(${requestedQuery}) AND (${topicQuery})` : topicQuery;
}

function keywordsFor(category) {
  return category === "all" ? Object.values(topics).flat() : topics[category] || topics.science;
}

function createClient(options = {}) {
  return options.httpClient || createHttpClient({
    timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    backoffBaseMs: options.backoffBaseMs || DEFAULT_BACKOFF_BASE_MS,
    ...(options.userAgent ? { userAgent: options.userAgent } : {})
  });
}

export function apiStatus(env = {}) {
  return {
    provider: "openweathermap",
    configured: Boolean(env.OPENWEATHER_API_KEY),
    apiKeyRequired: true,
    mapTilesEnabled: Boolean(env.OPENWEATHER_API_KEY),
    radarEnabled: true,
    weatherAlertsConfigured: true,
    newsConfigured: Boolean(env.GNEWS_API_KEY)
  };
}

export async function weatherApi(params, env = {}, options = {}) {
  const apiKey = env.OPENWEATHER_API_KEY;
  if (!apiKey) {
    const error = new Error(options.isProduction
      ? "Weather data is temporarily unavailable."
      : "Weather provider is not configured. Set OPENWEATHER_API_KEY in your server environment and restart.");
    error.status = 503;
    return jsonResponse({ cod: 503, message: error.message }, 503);
  }

  const coordinatesProvided = params.lat !== undefined || params.lon !== undefined;
  let location;
  if (coordinatesProvided) {
    const lat = number(params.lat);
    const lon = number(params.lon);
    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return jsonResponse({ cod: 400, message: "Invalid coordinates." }, 400);
    }
    location = { lat, lon };
  } else {
    const query = String(params.q || "").trim().slice(0, 120);
    if (!query) return jsonResponse({ cod: 400, message: "A location is required." }, 400);
    location = { q: query };
  }

  const url = new URL("https://api.openweathermap.org/data/2.5/weather");
  for (const [key, value] of Object.entries(location)) url.searchParams.set(key, value);
  url.searchParams.set("units", "metric");
  url.searchParams.set("appid", apiKey);

  try {
    const client = createClient(options);
    const data = await client.json(url.toString());
    if (!data.main || !Array.isArray(data.weather) || !data.weather[0] || !data.coord || !data.sys) {
      throw new Error("Current weather data is incomplete.");
    }
    return jsonResponse({ ...data, timezone: "UTC", utcOffsetSeconds: number(data.timezone) || 0 });
  } catch (error) {
    const status = error.status === 404 ? 404 : error.status === 400 ? 400 : error.status === 429 ? 503 : 502;
    if (status !== 404) console.error(`Current weather provider request failed (status ${error.status || "upstream"}).`);
    return jsonResponse({ cod: status, message: messageFor(error, options.isProduction, "weather") }, status);
  }
}

export async function newsApi(params, env = {}, options = {}) {
  const apiKey = env.GNEWS_API_KEY;
  if (!apiKey) {
    const message = options.isProduction
      ? "Live news is temporarily unavailable."
      : "News provider is not configured. Set GNEWS_API_KEY in your server environment and restart.";
    return jsonResponse({ cod: 503, message }, 503);
  }

  const category = String(params.category || "all").toLowerCase();
  const requestedQuery = String(params.q || "").trim().slice(0, 120);
  const cacheKey = `${category}|${requestedQuery.toLowerCase()}`;
  const cached = newsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return jsonResponse(cached.value, 200, { "cache-control": "public, max-age=300, stale-while-revalidate=600" });
  }

  const upstream = new URL("https://gnews.io/api/v4/search");
  upstream.searchParams.set("apikey", apiKey);
  upstream.searchParams.set("lang", "en");
  upstream.searchParams.set("max", "10");
  upstream.searchParams.set("q", queryFor(category, requestedQuery));
  upstream.searchParams.set("sortby", "publishedAt");

  try {
    const client = createClient(options);
    const body = await client.json(upstream.toString());
    if (body.errors) {
      const error = new Error("GNews returned an error response.");
      error.status = 502;
      throw error;
    }
    const keywords = keywordsFor(category);
    const articles = (body.articles || []).map((article) => ({
      title: String(article.title || "").trim(),
      description: String(article.description || "").trim(),
      link: String(article.url || "").trim(),
      image: String(article.image || "").trim(),
      publishedAt: String(article.publishedAt || "").trim(),
      source: String(article.source?.name || "").trim(),
      category: category === "all" ? "Verified news" : category
    })).filter((article) => {
      const text = `${article.title} ${article.description}`.toLowerCase();
      return article.title && /^https?:\/\//i.test(article.link) && article.source
        && keywords.some((keyword) => text.includes(keyword));
    });
    const value = { articles, provider: "GNews", fetchedAt: new Date().toISOString() };
    const ttl = Math.max(0, Number(env.CACHE_TTL_NEWS) || 600) * 1000;
    if (ttl > 0) newsCache.set(cacheKey, { value, expiresAt: Date.now() + ttl });
    if (newsCache.size > 100) newsCache.delete(newsCache.keys().next().value);
    return jsonResponse(value, 200, { "cache-control": "public, max-age=300, stale-while-revalidate=600" });
  } catch (error) {
    console.error(`News provider request failed (status ${error.status || "upstream"}).`);
    const status = error.status === 429 ? 503 : 502;
    return jsonResponse({ cod: status, message: messageFor(error, options.isProduction, "news") }, status);
  }
}
