/**
 * SkyCast - server configuration.
 *
 * Reads `.env` from the project root (a tiny hand-rolled parser so the project
 * keeps zero runtime dependencies) and layers real process environment
 * variables on top, so platform-provided secrets always win.
 *
 * Every secret stays here on the server. Nothing in this module is imported by
 * browser code.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = join(SERVER_DIR, "..");

/**
 * Parse a dotenv file into a plain object.
 * Supports `KEY=value`, `export KEY=value`, `#` comments, blank lines,
 * single/double quoted values and trailing comments on unquoted values.
 *
 * @param {string} raw
 * @returns {Record<string, string>}
 */
export function parseEnvFile(raw) {
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const withoutExport = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const separatorIndex = withoutExport.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = withoutExport.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = withoutExport.slice(separatorIndex + 1).trim();
    let inSingle = false;
    let inDouble = false;
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      if (char === "'" && !inDouble) {
        inSingle = !inSingle;
      } else if (char === '"' && !inSingle) {
        inDouble = !inDouble;
      } else if (!inSingle && !inDouble && char === "#" && (index === 0 || /\s/.test(value[index - 1]))) {
        value = value.slice(0, index).trim();
        break;
      }
    }

    const isQuoted =
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1);

    if (isQuoted) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }
  return result;
}

/** Load `.env` (if present) without clobbering real environment variables. */
function loadEnv() {
  const envPath = join(PROJECT_ROOT, ".env");
  const fileEnv = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, "utf8")) : {};
  for (const [key, value] of Object.entries(fileEnv)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return process.env;
}

const env = loadEnv();

/** @param {string} key @param {string} fallback */
const text = (key, fallback = "") => {
  const value = env[key];
  return value === undefined || value === null || String(value).trim() === "" ? fallback : String(value).trim();
};

/** @param {string} key @param {number} fallback */
const number = (key, fallback) => {
  const parsed = Number(text(key));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

/** @param {string} key @param {boolean} fallback */
const boolean = (key, fallback) => {
  const value = text(key).toLowerCase();
  if (!value) return fallback;
  return value === "true" || value === "1" || value === "yes" || value === "on";
};

export const config = {
  projectRoot: PROJECT_ROOT,
  // Port 0 asks Node for an ephemeral listener, which makes the same-origin
  // browser app unreachable at its documented URL. Use the app default instead.
  port: number("PORT", 3000) || 3000,
  host: text("HOST", "127.0.0.1"),
  isProduction: text("NODE_ENV", "development").toLowerCase() === "production",
  offlineMode: boolean("OFFLINE_MODE", false),
  forceHttps: boolean("FORCE_HTTPS", false),

  /** Sent as User-Agent upstream. Official US APIs reject requests without a contact. */
  userAgent: `SkyCast/2.0 (+${text("SITE_URL", "https://skycast.pages.dev")}; ${text("SKYCAST_CONTACT", "skycast@example.com")})`,

  providers: {
    weather: "openweathermap",
    news: "gnews",
    map: text("MAP_PROVIDER", "carto").toLowerCase(),
    mapTilerEnabled: text("MAP_API_KEY").length > 0,
    firmsEnabled: text("FIRMS_MAP_KEY").length > 0,
  },

  keys: {
    map: text("MAP_API_KEY"),
    openWeather: text("OPENWEATHER_API_KEY"),
    openMeteo: text("OPEN_METEO_API_KEY"),
    news: text("GNEWS_API_KEY"),
    satellite: text("SATELLITE_API_KEY"),
    firms: text("FIRMS_MAP_KEY"),
  },

  /**
   * Cache lifetimes in milliseconds. Each provider is polled at its own
   * documented cadence rather than on a single global timer.
   */
  cacheTtl: {
    weather: number("CACHE_TTL_WEATHER", 300) * 1000,
    forecast: number("CACHE_TTL_FORECAST", 900) * 1000,
    airQuality: number("CACHE_TTL_AIR_QUALITY", 1800) * 1000,
    radar: number("CACHE_TTL_RADAR", 120) * 1000,
    satelliteMetadata: number("CACHE_TTL_SATELLITE_METADATA", 3600) * 1000,
    earthquakes: number("CACHE_TTL_EARTHQUAKES", 120) * 1000,
    alerts: number("CACHE_TTL_ALERTS", 300) * 1000,
    storms: number("CACHE_TTL_STORMS", 900) * 1000,
    fires: number("CACHE_TTL_FIRES", 900) * 1000,
    news: number("CACHE_TTL_NEWS", 600) * 1000,
    geocode: number("CACHE_TTL_GEOCODE", 86400) * 1000,
    ocean: number("CACHE_TTL_OCEAN", 1800) * 1000,
  },

  cacheStaleMaxAgeMs: number("CACHE_STALE_MAX_AGE", 21600) * 1000,
  upstream: {
    timeoutMs: number("UPSTREAM_TIMEOUT_MS", 12000) || 12000,
    maxRetries: number("UPSTREAM_MAX_RETRIES", 2),
    backoffBaseMs: number("UPSTREAM_BACKOFF_BASE_MS", 400),
  },
  rateLimitPerMinute: number("RATE_LIMIT_PER_MINUTE", 240),
};

/**
 * Provider availability summary, safe to expose to the browser: it reports
 * *whether* a provider is configured, never the secret itself.
 */
export const providerStatus = () => ({
  weather: config.providers.weather,
  news: config.providers.news,
  map: config.providers.map,
  mapTiler: config.providers.mapTilerEnabled,
  firms: config.providers.firmsEnabled,
  offlineMode: config.offlineMode,
});
