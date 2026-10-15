import { createHttpClient } from "../../js/core/http.js";

const weatherCodes = (code) => {
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

const finiteNumber = (value, fallback = null) => value !== null && value !== undefined
  && value !== "" && Number.isFinite(Number(value)) ? Number(value) : fallback;

const epochForLocalTime = (value, offsetSeconds = 0) => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T?(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const utcMillis = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] || 0)
  );
  return Math.floor((utcMillis - Number(offsetSeconds) * 1000) / 1000);
};

const json = (body, status = 200, headers = {}) => Response.json(body, {
  status,
  headers: { "cache-control": "no-store", ...headers }
});

function createClient(env) {
  return createHttpClient({
    timeoutMs: Number(env.UPSTREAM_TIMEOUT_MS) || 12_000,
    maxRetries: Number(env.UPSTREAM_MAX_RETRIES) || 2,
    backoffBaseMs: Number(env.UPSTREAM_BACKOFF_BASE_MS) || 400,
    userAgent: `SkyCast/2.0 (+${env.SITE_URL || "https://skycast.pages.dev"}; ${env.SKYCAST_CONTACT || "skycast@example.com"})`
  });
}

function makeOpenMeteo(client) {
  return async (path, params) => {
    const host = path === "/v1/search" ? "https://geocoding-api.open-meteo.com"
      : path === "/v1/air-quality" ? "https://air-quality-api.open-meteo.com"
        : "https://api.open-meteo.com";
    const url = new URL(`${host}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined && value !== "") url.searchParams.set(key, value);
    }
    return client.json(url.toString());
  };
}

async function coordinatesFromParams(params, openMeteo) {
  if (params.lat !== undefined && params.lon !== undefined) {
    const lat = finiteNumber(params.lat);
    const lon = finiteNumber(params.lon);
    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw Object.assign(new Error("Invalid coordinates."), { status: 400 });
    }
    return { lat, lon, name: "Selected location", country: "" };
  }
  if (!params.q) throw Object.assign(new Error("A location is required."), { status: 400 });

  const query = String(params.q).trim().slice(0, 120);
  const candidates = [query];
  const beforeComma = query.split(",")[0].trim();
  if (beforeComma && beforeComma !== query) candidates.push(beforeComma);
  const words = query.split(/\s+/);
  while (words.length > 1) {
    words.pop();
    candidates.push(words.join(" "));
  }

  let place;
  for (const candidate of new Set(candidates)) {
    const locations = await openMeteo("/v1/search", {
      name: candidate,
      count: 1,
      language: "en",
      format: "json"
    });
    place = locations.results?.[0];
    if (place) break;
  }
  if (!place) throw Object.assign(new Error("Location not found."), { status: 404 });
  return { lat: place.latitude, lon: place.longitude, name: place.name, country: place.country_code || "" };
}

async function currentFromOpenMeteo(params, openMeteo) {
  const location = await coordinatesFromParams(params, openMeteo);
  const data = await openMeteo("/v1/forecast", {
    latitude: location.lat,
    longitude: location.lon,
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,dew_point_2m,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,cloud_cover,precipitation,weather_code,uv_index",
    daily: "sunrise,sunset",
    timezone: "auto"
  });
  const current = data.current;
  if (!current || !data.daily?.sunrise?.[0] || !data.daily?.sunset?.[0]) {
    throw new Error("Current weather data is incomplete.");
  }
  const [description, icon] = weatherCodes(current.weather_code);
  return {
    cod: 200,
    name: location.name,
    coord: { lat: location.lat, lon: location.lon },
    sys: {
      country: location.country,
      sunrise: epochForLocalTime(data.daily.sunrise[0], data.utc_offset_seconds),
      sunset: epochForLocalTime(data.daily.sunset[0], data.utc_offset_seconds)
    },
    weather: [{ main: description, description: description.toLowerCase(), icon }],
    main: {
      temp: finiteNumber(current.temperature_2m, 0),
      feels_like: finiteNumber(current.apparent_temperature, current.temperature_2m),
      dew_point: finiteNumber(current.dew_point_2m),
      humidity: finiteNumber(current.relative_humidity_2m, 0),
      pressure: finiteNumber(current.surface_pressure, 0)
    },
    wind: {
      speed: finiteNumber(current.wind_speed_10m, 0),
      deg: finiteNumber(current.wind_direction_10m, 0),
      gust: finiteNumber(current.wind_gusts_10m)
    },
    visibility: finiteNumber(current.visibility, 0),
    clouds: { all: finiteNumber(current.cloud_cover, 0) },
    rain: { "1h": finiteNumber(current.precipitation, 0) },
    uv_index: finiteNumber(current.uv_index, 0),
    timezone: data.timezone || "UTC",
    timezoneAbbreviation: data.timezone_abbreviation || "UTC",
    utcOffsetSeconds: data.utc_offset_seconds || 0
  };
}

async function forecastFromOpenMeteo(params, openMeteo) {
  const location = await coordinatesFromParams(params, openMeteo);
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
    const [description, icon] = weatherCodes(data.hourly.weather_code[index]);
    return {
      dt: epochForLocalTime(time, data.utc_offset_seconds),
      dt_txt: `${time.replace("T", " ")}:00`,
      local_time: time,
      main: {
        temp: finiteNumber(data.hourly.temperature_2m[index], 0),
        feels_like: finiteNumber(data.hourly.apparent_temperature[index], data.hourly.temperature_2m[index]),
        dew_point: finiteNumber(data.hourly.dew_point_2m[index]),
        pressure: finiteNumber(data.hourly.surface_pressure[index]),
        humidity: finiteNumber(data.hourly.relative_humidity_2m[index], 0)
      },
      pop: (data.hourly.precipitation_probability[index] || 0) / 100,
      wind: {
        speed: finiteNumber(data.hourly.wind_speed_10m[index], 0),
        deg: finiteNumber(data.hourly.wind_direction_10m[index]),
        gust: finiteNumber(data.hourly.wind_gusts_10m[index])
      },
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
}

async function airQualityFromOpenMeteo(params, openMeteo) {
  const location = await coordinatesFromParams(params, openMeteo);
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
  return {
    list: [{
      main: { aqi },
      components: {
        pm2_5: finiteNumber(current.pm2_5, 0),
        pm10: finiteNumber(current.pm10, 0),
        co: finiteNumber(current.carbon_monoxide, 0),
        no2: finiteNumber(current.nitrogen_dioxide, 0),
        so2: finiteNumber(current.sulphur_dioxide, 0),
        o3: finiteNumber(current.ozone, 0)
      }
    }],
    provider: "Open-Meteo Air Quality"
  };
}

async function alertsFromNws(params, client) {
  const lat = finiteNumber(params.lat);
  const lon = finiteNumber(params.lon);
  if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw Object.assign(new Error("Invalid coordinates."), { status: 400 });
  }
  let point;
  try {
    point = await client.json(`https://api.weather.gov/points/${lat},${lon}`);
  } catch (error) {
    if (error.status === 404) {
      return { alerts: [], provider: "NOAA/NWS", fetchedAt: new Date().toISOString() };
    }
    throw error;
  }
  if (!point.properties?.forecastZone) {
    return { alerts: [], provider: "NOAA/NWS", fetchedAt: new Date().toISOString() };
  }
  const data = await client.json(`https://api.weather.gov/alerts/active?point=${lat},${lon}`);
  const hazardPattern = /(thunder|storm|rain|flood|cyclone|hurricane|heat|cold|wind|fog|lightning|tornado|snow|ice|blizzard|fire)/i;
  const alerts = (data.features || []).map(({ properties: alert = {} }) => ({
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
  })).filter(alert => alert.event && alert.description && hazardPattern.test(`${alert.event} ${alert.description}`));
  return { alerts, provider: "NOAA/NWS", fetchedAt: new Date().toISOString() };
}

const humidityTileCache = new Map();
const tileLayers = new Set(["temp_new", "precipitation_new", "clouds_new", "humidity_new", "pressure_new", "wind_new"]);

async function mapTile(layer, zoom, x, y, env, client, openMeteo) {
  const z = Number(zoom);
  const tileX = Number(x);
  const tileY = Number(y);
  if (![z, tileX, tileY].every(Number.isInteger) || z < 0 || z > 18 || tileX < 0 || tileY < 0) {
    return json({ cod: 400, message: "Invalid map tile." }, 400);
  }
  if (!tileLayers.has(layer)) return json({ cod: 404, message: "Map layer is unavailable." }, 404);
  if (!env.OPENWEATHER_API_KEY) {
    return json({ cod: 503, message: "Weather map provider is not configured." }, 503);
  }

  if (layer === "humidity_new") {
    const key = `${z}/${tileX}/${tileY}`;
    const cached = humidityTileCache.get(key);
    let svg = cached?.expiresAt > Date.now() ? cached.svg : null;
    if (!svg) {
      const scale = 2 ** z;
      const longitude = (tileX / scale) * 360 - 180;
      const mercator = Math.PI * (1 - (2 * tileY) / scale);
      const latitude = (180 / Math.PI) * Math.atan(Math.sinh(mercator));
      const data = await openMeteo("/v1/forecast", {
        latitude,
        longitude,
        current: "relative_humidity_2m",
        timezone: "UTC"
      });
      const value = finiteNumber(data.current?.relative_humidity_2m);
      if (value === null) throw new Error("Humidity data is unavailable.");
      const hue = Math.max(205, 55 - (value * 1.5));
      svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="hsl(${hue} 78% 48%)" fill-opacity=".48"/></svg>`;
      humidityTileCache.set(key, { svg, expiresAt: Date.now() + 600_000 });
      if (humidityTileCache.size > 500) humidityTileCache.delete(humidityTileCache.keys().next().value);
    }
    return new Response(svg, {
      headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=600" }
    });
  }

  const upstream = `https://tile.openweathermap.org/map/${layer}/${z}/${tileX}/${tileY}.png?appid=${encodeURIComponent(env.OPENWEATHER_API_KEY)}`;
  const image = await client.binary(upstream);
  return new Response(image, {
    headers: {
      "content-type": "image/png",
      "cache-control": layer === "precipitation_new" ? "public, max-age=300" : "public, max-age=600"
    }
  });
}

function errorResponse(error, endpoint) {
  console.error(`${endpoint} request failed (status ${error.status || error.kind || "upstream"}).`);
  const status = error.status === 400 || error.status === 404 ? error.status : error.status === 429 ? 503 : 502;
  const messages = {
    400: error.message,
    404: error.message === "Location not found." ? error.message : "Requested resource was not found.",
    502: endpoint === "alerts" ? "Official weather alerts are temporarily unavailable."
      : endpoint === "map" ? "This map layer is temporarily unavailable."
        : "Weather data is temporarily unavailable.",
    503: endpoint === "map" ? error.message : "Weather data is temporarily unavailable."
  };
  return json({ cod: status, message: messages[status] || "Weather data is temporarily unavailable." }, status);
}

export async function onRequest({ request, env = {} }) {
  if (request.method !== "GET") {
    return json({ cod: 405, message: "Method not allowed." }, 405, { allow: "GET" });
  }
  const pathname = new URL(request.url).pathname;
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const client = createClient(env);
  const openMeteo = makeOpenMeteo(client);

  try {
    if (pathname === "/api/forecast") return json(await forecastFromOpenMeteo(params, openMeteo));
    if (pathname === "/api/geocode") {
      const data = await openMeteo("/v1/search", {
        name: String(params.q || "").slice(0, 120),
        count: Math.min(10, Math.max(1, finiteNumber(params.limit, 5))),
        language: "en",
        format: "json"
      });
      return json((data.results || []).map(place => ({
        name: place.name,
        state: place.admin1 || "",
        country: place.country_code || "",
        lat: place.latitude,
        lon: place.longitude
      })));
    }
    if (pathname === "/api/air-quality") return json(await airQualityFromOpenMeteo(params, openMeteo));
    if (pathname === "/api/uv") return json({ value: (await currentFromOpenMeteo(params, openMeteo)).uv_index });
    if (pathname === "/api/alerts") {
      try {
        return json(await alertsFromNws(params, client));
      } catch (error) {
        if (error.status === 400) throw error;
        console.error(`NOAA/NWS alerts request failed (status ${error.status || error.kind || "upstream"}).`);
        return json({ cod: 502, message: "Official weather alerts are temporarily unavailable." }, 502);
      }
    }

    const tile = pathname.match(/^\/api\/map\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if (tile) {
      try {
        return await mapTile(tile[1], tile[2], tile[3], tile[4], env, client, openMeteo);
      } catch (error) {
        console.error(`Map tile request failed (status ${error.status || error.kind || "upstream"}).`);
        return json({ cod: 503, message: "This map layer is temporarily unavailable." }, 503);
      }
    }
    return json({ cod: 404, message: "API endpoint not found." }, 404);
  } catch (error) {
    return errorResponse(error, pathname.split("/").filter(Boolean).at(-1) || "api");
  }
}
