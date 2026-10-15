/**
 * SkyCast - Weather Application
 * (c) 2026 SkyCast. All rights reserved.
 * Unauthorized copying of this file, via any medium is strictly prohibited.
 * Proprietary and confidential.
 */
const configuredApiBase = document.querySelector('meta[name="skycast-api-base"]')?.content.trim().replace(/\/+$/, "");
const isDirectFileOpen = window.location.protocol === "file:" || window.location.hostname === "";
const isLocalStaticServer = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)
  && window.location.port
  && window.location.port !== "3000";
const localApiHost = window.location.hostname.includes(":")
  ? `[${window.location.hostname}]`
  : window.location.hostname;
const apiBase = configuredApiBase || (isLocalStaticServer
  ? `${window.location.protocol}//${localApiHost}:3000/api`
  : "/api");
let weatherChart = null;
let forecastTimeChart = null;
let analyticsCharts = [];
let weatherMap = null;
let mapMarker = null;
let mapLayers = {};
let mapMode = "temperature";
let mapRefreshIntervals = {};
let mapLayerProviderReady = false;
let particleInterval = null;
let particleResizeBound = false;
let currentUnits = localStorage.getItem("units") || "metric";
let notificationMessages = [];
let latestWeatherData = null;
let latestForecastData = null;
let latestAqiHtml = "";
let latestUvHtml = "";
let aqiChart = null;
let newsCategory = "all";
let newsSearchTimer = null;
let forecastPlaybackTimer = null;
let alertRefreshInterval = null;
let alertCoordinates = null;
const notifiedAlertIds = new Set();
const DEFAULT_CITY = "London";
const skycons = new Skycons({"color": "#38bdf8", "resizeClear": true});

function apiUrl(path, params = {}) {
  const query = new URLSearchParams(params);
  return `${apiBase}/${path}?${query}`;
}

function getSearchInput() {
  return document.getElementById("globalCityInput");
}

async function fetchJson(url) {
  try {
    const response = await fetch(url);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("json")) {
      throw new Error("SkyCast service is temporarily unavailable.");
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Weather data is temporarily unavailable.");
    return data;
  } catch (error) {
    if (error instanceof TypeError || error.name === "AbortError") {
      const message = isDirectFileOpen
        ? "SkyCast was opened directly from disk. Start the local app server and load the page from the running site to fetch live weather data."
        : isLocalStaticServer
          ? "Weather service is unreachable. Start SkyCast with `npm run dev` on port 3000, then try again."
          : "SkyCast service is temporarily unavailable. Please try again shortly.";
      throw new Error(message);
    }
    throw error;
  }
}

const safetyTopics = [
  { title: "Thunderstorms", icon: "fa-cloud-bolt", summary: "Lightning, gusty winds and hail can develop quickly.", before: "Review local alerts and bring loose outdoor items inside.", during: "Go indoors, stay away from windows and avoid plumbing or corded devices.", after: "Wait for official all-clear guidance before going outside." },
  { title: "Heatwaves", icon: "fa-sun", summary: "Extended heat can cause heat exhaustion and heat stroke.", before: "Plan cooling breaks, check on vulnerable people and keep water available.", during: "Stay cool and hydrated; never leave people or pets in parked vehicles.", after: "Continue monitoring symptoms and seek medical help for confusion or fainting." },
  { title: "Heavy Rain", icon: "fa-cloud-showers-heavy", summary: "Intense rainfall can reduce visibility and make roads hazardous.", before: "Clear drains where safe and avoid unnecessary travel.", during: "Slow down, avoid driving through standing water and move indoors if conditions worsen.", after: "Watch for damaged roads, downed wires and contaminated water." },
  { title: "Flooding", icon: "fa-house-flood-water", summary: "Floodwater can rise rapidly and hide dangerous debris or currents.", before: "Know higher ground and prepare a go-bag with essential medicines.", during: "Move to higher ground; never walk or drive through floodwater.", after: "Return only when officials say it is safe and avoid floodwater contact." },
  { title: "Lightning", icon: "fa-bolt", summary: "Lightning can strike outside the area of heavy rain.", before: "Plan an indoor shelter and postpone exposed outdoor activities.", during: "If you hear thunder, go indoors and wait 30 minutes after the last thunder.", after: "Give first aid only when the scene is safe and call emergency services." },
  { title: "Cyclones", icon: "fa-hurricane", summary: "Tropical systems can bring destructive wind, rain and storm surge.", before: "Follow evacuation guidance and secure windows, doors and outdoor items.", during: "Shelter in a small interior room away from windows and do not go outside in the eye.", after: "Avoid downed lines, damaged structures and floodwater." },
  { title: "Wildfires", icon: "fa-fire", summary: "Smoke can travel far and fire conditions can change rapidly.", before: "Know evacuation routes and prepare masks, medicines and pet supplies.", during: "Follow evacuation orders and keep windows closed when smoke is present.", after: "Return only after officials approve it and watch for hot spots." },
  { title: "Extreme Cold", icon: "fa-snowflake", summary: "Cold exposure and ice can threaten health, travel and utilities.", before: "Insulate exposed pipes, charge devices and check heating equipment.", during: "Stay warm and dry; limit travel and check on neighbors who need help.", after: "Avoid downed lines and report utility damage through official channels." }
];

function showPage(pageId, event) {
  event?.preventDefault();
  const targetPageId = pageId === "saved" ? "dashboard" : pageId;
  if (pageId !== "forecast" && forecastPlaybackTimer) toggleForecastPlayback();

  // Hide all sections
  document.querySelectorAll('.page-section').forEach(section => {
    section.style.display = 'none';
  });
  
  // Show selected section
  const target = document.getElementById(`${targetPageId}-page`);
  if (target) {
    target.style.display = 'block';
    target.classList.add('animate__animated', 'animate__fadeIn');
  }

  // Update nav links
  document.querySelectorAll('.nav-link').forEach(link => {
    const active = link.dataset.page === pageId;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  // Special handling for map when switching to maps page
  if (targetPageId === 'maps' && weatherMap) {
    setTimeout(() => {
      weatherMap.invalidateSize();
    }, 100);
  } else if (targetPageId === 'maps' && !weatherMap) {
    const mapContainer = document.getElementById("map");
    if (mapContainer) {
      mapContainer.innerHTML = '<div class="map-empty-state"><i class="fas fa-map-location-dot"></i><strong>Search a location to explore the map</strong><span>The OpenStreetMap basemap and configured weather overlays will appear here.</span></div>';
    }
  }

  if (pageId === "comparison") renderComparison();
  if (pageId === "analytics") renderForecastAnalytics();
  if (pageId === "forecast") renderForecastStudio();

  if (pageId === "saved") {
    const section = document.getElementById("favoritesSection");
    if (section) section.style.display = "block";
    if (section?.offsetParent) {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
  }

  const content = document.querySelector(".content-scroll");
  if (content) content.scrollTo({ top: 0, behavior: "smooth" });
}

function toggleSidebar() {
  const collapsed = document.body.classList.toggle("sidebar-collapsed");
  const button = document.getElementById("sidebarCollapse");
  if (!button) return;
  button.setAttribute("aria-expanded", String(!collapsed));
  button.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
  button.innerHTML = `<i class="fas fa-angles-${collapsed ? "right" : "left"}"></i>`;
}

document.addEventListener("DOMContentLoaded", () => {
  renderSafetyCards();
  setupNews();
  updateClock();
  setInterval(updateClock, 1000);
  document.getElementById("unitToggle").textContent = currentUnits === "metric" ? "°C" : "°F";
  updateUnitSettingsLabel();
  registerServiceWorker();
  
  // Weather and official alerts refresh on separate provider cadences.
  setInterval(() => {
    const city = getSearchInput().value.trim();
    if (city) getWeather(city);
  }, 600000);

  const urlParams = new URLSearchParams(window.location.search);
  const city = urlParams.get("city");
  if (city) {
    getSearchInput().value = city;
    getWeather(city);
  } else if (urlParams.has("lat") && urlParams.has("lon")) {
    getWeatherByCoords(urlParams.get("lat"), urlParams.get("lon"));
  } else {
    getSearchInput().value = DEFAULT_CITY;
    getWeather(DEFAULT_CITY);
  }
  displayFavorites();

  // City suggestions with debounce
  let debounceTimer;
  getSearchInput().addEventListener("input", (event) => {
    clearTimeout(debounceTimer);
    const query = event.target.value.trim();
    if (query.length < 3) return;

    debounceTimer = setTimeout(async () => {
      try {
        const data = await fetchJson(apiUrl("geocode", { q: query, limit: 5 }));
        const datalist = document.getElementById("globalCitySuggestions");
        if (datalist) datalist.innerHTML = data.map(item => `<option value="${escapeHtml(item.name)}${item.state ? `, ${escapeHtml(item.state)}` : ""}, ${escapeHtml(item.country)}">`).join("");
      } catch (error) {
        console.warn("City suggestions unavailable:", error.message);
      }
    }, 350);
  });
});

function updateClock() {
  const clockElement = document.getElementById("realTimeClock");
  if (clockElement) {
    const now = new Date();
    clockElement.innerHTML = `
      <div class="fw-bold">${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
      <div>${now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</div>
    `;
  }
  const localTime = document.getElementById("cityLocalTime");
  if (localTime && latestWeatherData) {
    localTime.textContent = `${formatCityDateTime(new Date(), latestWeatherData, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    })} · ${cityTimezoneLabel(latestWeatherData)}`;
  }
}

function formatCityDateTime(date, weather, options = {}) {
  const timeZone = weather?.timezone;
  if (typeof timeZone === "string" && timeZone !== "UTC") {
    try {
      return new Intl.DateTimeFormat([], { ...options, timeZone }).format(date);
    } catch {
      // Fall back to the provider's UTC offset when it has no valid IANA zone.
    }
  }
  const offsetSeconds = Number(weather?.utcOffsetSeconds) || 0;
  return new Intl.DateTimeFormat([], { ...options, timeZone: "UTC" }).format(new Date(date.getTime() + offsetSeconds * 1000));
}

function cityTimezoneLabel(weather) {
  if (typeof weather?.timezone === "string" && weather.timezone !== "UTC") return weather.timezone;
  const offset = Number(weather?.utcOffsetSeconds) || 0;
  const sign = offset >= 0 ? "+" : "−";
  const minutes = Math.abs(offset) / 60;
  return offset === 0 ? "UTC" : `UTC${sign}${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function startVoiceSearch() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert("Voice Search is not supported in your browser.");
    return;
  }

  const recognition = new SpeechRecognition();
  const btn = document.querySelector(".voice-search-button");

  recognition.onstart = () => {
    btn.innerHTML = '<i class="fas fa-microphone-alt animate__animated animate__pulse animate__infinite text-danger"></i>';
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    getSearchInput().value = transcript;
    getWeather(transcript);
  };

  recognition.onerror = () => {
    btn.innerHTML = '<i class="fas fa-microphone"></i>';
  };

  recognition.onend = () => {
    btn.innerHTML = '<i class="fas fa-microphone"></i>';
  };

  recognition.start();
}

async function getWeatherByCoords(lat, lon) {
  setDataStatus("Loading local weather", "loading");
  try {
    const currentData = await fetchJson(apiUrl("weather", { lat, lon, units: "metric" }));

    if (currentData.cod !== 200) {
      throw new Error(currentData.message);
    }

    const forecastData = await fetchJson(apiUrl("forecast", { lat, lon, units: "metric" }));
    currentData.timezone = forecastData.timezone || currentData.timezone;
    currentData.timezoneAbbreviation = forecastData.timezoneAbbreviation || currentData.timezoneAbbreviation;
    currentData.utcOffsetSeconds = forecastData.utcOffsetSeconds ?? currentData.utcOffsetSeconds;
    latestWeatherData = currentData;
    latestForecastData = forecastData;
    const locationName = [currentData.name, currentData.sys?.country].filter(Boolean).join(", ");
    getSearchInput().value = locationName;
    const globalInput = document.getElementById("globalCityInput");
    if (globalInput) globalInput.value = locationName;
    const locationUrl = new URL(window.location.href);
    locationUrl.searchParams.delete("city");
    locationUrl.searchParams.set("lat", String(lat));
    locationUrl.searchParams.set("lon", String(lon));
    window.history.replaceState({}, "", locationUrl);

    displayCurrent(currentData);
    displayForecast(forecastData);
    displayHourly(forecastData);
    fetchExtendedForecast(lat, lon);
    renderChart(forecastData);
    renderForecastStudio();
    renderForecastAnalytics();
    renderActivityRecommendation(currentData, forecastData);
    document.getElementById("visualsContainer").style.display = "block";
    document.getElementById("hourlyContainer").style.display = "block";
    setDataStatus("Live data");
    loadOptionalLocationData(currentData);
  } catch (err) {
    console.error("Geolocation weather error:", err);
    setDataStatus("Weather unavailable", "error");
    document.getElementById("weatherContainer").innerHTML = `<div class="col-md-8"><div class="weather-card error-state" role="alert"><i class="fas fa-triangle-exclamation"></i><h4>Weather could not be loaded</h4><p>${escapeHtml(err.message)}</p><button class="btn btn-outline-light btn-sm" type="button" onclick="refreshWeather()"><i class="fas fa-rotate-right me-2"></i>Try again</button></div></div>`;
  }
}

function displayHourly(data) {
  const hourlyList = document.getElementById("hourlyList");
  let hourlyHTML = "";
  
  // Show each hourly sample for the next 24 hours; the strip scrolls on mobile.
  const next24h = nextForecastHours(data);

  next24h.forEach(item => {
    const time = formatForecastTime(item, data.timezone);
    hourlyHTML += `
      <div class="text-center" style="min-width: 80px;">
        <p class="mb-1 small opacity-75">${time}</p>
        <canvas id="hourlySkycon-${item.dt}" width="40" height="40" aria-label="${item.weather[0].description}"></canvas>
        <p class="mb-0 fw-bold">${formatTemperature(item.main.temp)}</p>
      </div>`;
    setTimeout(() => setSkycon(`hourlySkycon-${item.dt}`, item.weather[0].main), 0);
  });

  hourlyList.innerHTML = hourlyHTML;
}

function nextForecastHours(data = latestForecastData) {
  if (!data?.list) return [];
  const now = Math.floor(Date.now() / 3600000) * 3600;
  const future = data.list.filter(item => item.dt >= now);
  return (future.length ? future : data.list).slice(0, 24);
}

function selectedForecastItem() {
  const range = document.getElementById("forecastTimeline");
  const hours = nextForecastHours();
  if (!range || !hours.length) return null;
  range.max = String(hours.length - 1);
  range.disabled = false;
  return hours[Number(range.value)] || hours[0];
}

function renderForecastStudio() {
  const data = latestForecastData;
  const hours = nextForecastHours(data);
  const range = document.getElementById("forecastTimeline");
  if (!data || !hours.length || !range) return;
  document.getElementById("forecastDetailStrip")?.replaceChildren();
  range.max = String(hours.length - 1);
  range.disabled = false;
  range.value = String(Math.min(Number(range.value), hours.length - 1));
  renderSelectedForecast();

  const canvas = document.getElementById("forecastTimeChart");
  if (!canvas || typeof Chart === "undefined") return;
  forecastTimeChart?.destroy();
  const labels = hours.map(item => formatForecastTime(item, data.timezone));
  forecastTimeChart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: `Temperature (°${currentUnits === "metric" ? "C" : "F"})`,
          data: hours.map(item => currentUnits === "metric" ? item.main.temp : item.main.temp * 9 / 5 + 32),
          borderColor: "#55c7f7",
          backgroundColor: "rgba(85, 199, 247, 0.12)",
          yAxisID: "temperature",
          fill: true,
          tension: 0.35
        },
        {
          label: "Precipitation chance (%)",
          data: hours.map(item => Math.round((item.pop || 0) * 100)),
          borderColor: "#a78bfa",
          backgroundColor: "rgba(167, 139, 250, 0.08)",
          yAxisID: "probability",
          tension: 0.3
        }
      ]
    },
    options: chartOptions({
      scales: {
        y: { display: false },
        temperature: { type: "linear", position: "left", grid: { color: "rgba(166,181,201,.12)" }, ticks: { color: document.body.classList.contains("light-mode") ? "#5d6e83" : "#a6b5c9" } },
        probability: { type: "linear", position: "right", min: 0, max: 100, grid: { drawOnChartArea: false }, ticks: { color: document.body.classList.contains("light-mode") ? "#5d6e83" : "#a6b5c9", callback: value => `${value}%` } },
        x: { grid: { display: false }, ticks: { color: document.body.classList.contains("light-mode") ? "#5d6e83" : "#a6b5c9", maxTicksLimit: 12 } }
      }
    })
  });

  const daily = data.daily;
  const dayContainer = document.getElementById("forecastStudioDays");
  if (daily?.time?.length && dayContainer) {
    dayContainer.innerHTML = `<div class="weather-card"><div class="mb-3"><p class="section-kicker mb-1">Planning horizon</p><h4 class="mb-0">Seven-day outlook</h4></div><div class="extended-forecast-grid">${daily.time.map((date, index) => `
      <div class="extended-day"><span class="small text-secondary">${index === 0 ? "Today" : new Intl.DateTimeFormat([], { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`))}</span>
        <strong>${currentUnits === "metric" ? Math.round(daily.temperature_2m_max[index]) : Math.round(daily.temperature_2m_max[index] * 9 / 5 + 32)}° / ${currentUnits === "metric" ? Math.round(daily.temperature_2m_min[index]) : Math.round(daily.temperature_2m_min[index] * 9 / 5 + 32)}°</strong>
        <span class="small text-info"><i class="fas fa-umbrella me-1"></i>${daily.precipitation_probability_max[index] ?? 0}%</span></div>`).join("")}</div></div>`;
  }
}

function renderSelectedForecast() {
  const item = selectedForecastItem();
  if (!item) return;
  const data = latestForecastData;
  const localDate = new Intl.DateTimeFormat([], { weekday: "long", month: "short", day: "numeric", timeZone: data.timezone || "UTC" }).format(new Date(item.dt * 1000));
  const title = document.getElementById("forecastSelectionTitle");
  const summary = document.getElementById("forecastSelectionSummary");
  const temperature = document.getElementById("forecastSelectionTemp");
  const icon = document.getElementById("forecastSelectionIcon");
  if (title) title.textContent = `${localDate} · ${formatForecastTime(item, data.timezone)}`;
  document.getElementById("forecastTimeline")?.setAttribute("aria-valuetext", `${localDate} ${formatForecastTime(item, data.timezone)}`);
  if (summary) summary.textContent = `${item.weather[0].description} · ${Math.round((item.pop || 0) * 100)}% precipitation chance · ${item.main.humidity}% humidity · ${windSpeedLabel(item.wind.speed)} wind`;
  if (temperature) temperature.textContent = formatTemperature(item.main.temp);
  if (icon) icon.className = `fas ${weatherIconClass(item.weather[0].main)}`;
  document.querySelectorAll(".forecast-hour-chip").forEach((chip, index) => chip.classList.toggle("active", index === Number(document.getElementById("forecastTimeline")?.value)));
  const strip = document.getElementById("forecastDetailStrip");
  const hours = nextForecastHours(data);
  if (strip && !strip.childElementCount) {
    strip.innerHTML = hours.map((hour, index) => `<button type="button" class="forecast-hour-chip" onclick="selectForecastHour(${index})" aria-label="Show forecast for ${formatForecastTime(hour, data.timezone)}">${formatForecastTime(hour, data.timezone)}<strong>${formatTemperature(hour.main.temp)}</strong><span>${Math.round((hour.pop || 0) * 100)}% rain</span></button>`).join("");
  }
}

function weatherIconClass(condition = "") {
  const value = condition.toLowerCase();
  if (value.includes("thunder")) return "fa-cloud-bolt";
  if (value.includes("rain") || value.includes("drizzle")) return "fa-cloud-rain";
  if (value.includes("snow")) return "fa-snowflake";
  if (value.includes("cloud")) return "fa-cloud";
  if (value.includes("fog") || value.includes("mist")) return "fa-smog";
  return "fa-sun";
}

function selectForecastHour(value) {
  const range = document.getElementById("forecastTimeline");
  if (range) range.value = String(value);
  renderSelectedForecast();
}

function stepForecast(offset) {
  const range = document.getElementById("forecastTimeline");
  if (!range || range.disabled) return;
  selectForecastHour((Number(range.value) + offset + Number(range.max) + 1) % (Number(range.max) + 1));
}

function toggleForecastPlayback() {
  const button = document.getElementById("forecastPlayButton");
  if (forecastPlaybackTimer) {
    clearInterval(forecastPlaybackTimer);
    forecastPlaybackTimer = null;
    if (button) {
      button.innerHTML = '<i class="fas fa-play"></i>';
      button.setAttribute("aria-label", "Play forecast timeline");
    }
    return;
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    stepForecast(1);
    return;
  }
  forecastPlaybackTimer = setInterval(() => stepForecast(1), 1000);
  if (button) {
    button.innerHTML = '<i class="fas fa-pause"></i>';
    button.setAttribute("aria-label", "Pause forecast timeline");
  }
}

function chartOptions(overrides = {}) {
  const textColor = document.body.classList.contains("light-mode") ? "#5d6e83" : "#a6b5c9";
  return {
    responsive: true,
    maintainAspectRatio: true,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { labels: { color: textColor } },
      tooltip: { enabled: true }
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: textColor, maxTicksLimit: 10 } },
      y: { grid: { color: "rgba(166,181,201,.18)" }, ticks: { color: textColor } }
    },
    animation: { duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450 },
    ...overrides
  };
}

function renderForecastAnalytics() {
  const data = latestForecastData;
  const current = latestWeatherData;
  if (!data?.list?.length || typeof Chart === "undefined") return;
  analyticsCharts.forEach(chart => chart.destroy());
  analyticsCharts = [];
  const items = data.list;
  const labels = items.map(item => formatForecastTime(item, data.timezone));
  const datasets = [
    {
      id: "analyticsTemperatureChart",
      color: "#55c7f7",
      label: `Temperature (°${currentUnits === "metric" ? "C" : "F"})`,
      values: items.map(item => currentUnits === "metric" ? item.main.temp : item.main.temp * 9 / 5 + 32),
      fill: true
    },
    { id: "analyticsPrecipitationChart", color: "#7c9dff", label: "Precipitation chance (%)", values: items.map(item => Math.round((item.pop || 0) * 100)), suffix: "%" },
    {
      id: "analyticsHumidityChart",
      multiple: [
        { label: "Relative humidity (%)", values: items.map(item => item.main.humidity), color: "#36d6c2" },
        { label: `Dew point (°${currentUnits === "metric" ? "C" : "F"})`, values: items.map(item => item.main.dew_point === null || item.main.dew_point === undefined ? null : currentUnits === "metric" ? item.main.dew_point : item.main.dew_point * 9 / 5 + 32), color: "#7c9dff" }
      ]
    },
    { id: "analyticsWindChart", color: "#f0a7ff", label: `Wind speed (${currentUnits === "metric" ? "m/s" : "mph"})`, values: items.map(item => currentUnits === "metric" ? item.wind.speed : item.wind.speed * 2.23694) },
    { id: "analyticsPressureChart", color: "#f5be64", label: "Surface pressure (hPa)", values: items.map(item => item.main.pressure ?? null) }
  ];
  datasets.forEach((set) => {
    const canvas = document.getElementById(set.id);
    if (!canvas) return;
    const chartDatasets = set.multiple ? set.multiple.map(series => ({
      label: series.label,
      data: series.values,
      borderColor: series.color,
      backgroundColor: `${series.color}20`,
      fill: false,
      tension: 0.32,
      pointRadius: 0,
      pointHitRadius: 14
    })) : [{
      label: set.label,
      data: set.values,
      borderColor: set.color,
      backgroundColor: `${set.color}20`,
      fill: false,
      tension: 0.32,
      pointRadius: 0,
      pointHitRadius: 14
    }];
    analyticsCharts.push(new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels, datasets: chartDatasets },
      options: chartOptions()
    }));
  });
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const roseTotals = Array(directions.length).fill(0);
  const roseCounts = Array(directions.length).fill(0);
  items.forEach(item => {
    if (!Number.isFinite(item.wind.deg) || !Number.isFinite(item.wind.speed)) return;
    const sector = Math.round(item.wind.deg / 45) % directions.length;
    roseTotals[sector] += currentUnits === "metric" ? item.wind.speed : item.wind.speed * 2.23694;
    roseCounts[sector] += 1;
  });
  const roseCanvas = document.getElementById("analyticsWindRoseChart");
  if (roseCanvas && roseCounts.some(count => count > 0)) {
    analyticsCharts.push(new Chart(roseCanvas.getContext("2d"), {
      type: "polarArea",
      data: {
        labels: directions,
        datasets: [{
          label: `Average wind speed (${currentUnits === "metric" ? "m/s" : "mph"})`,
          data: roseTotals.map((total, index) => roseCounts[index] ? total / roseCounts[index] : null),
          backgroundColor: ["#55c7f780", "#7c9dff80", "#36d6c280", "#f0a7ff80", "#f5be6480", "#fb718580", "#60a5fa80", "#a3e63580"],
          borderColor: "rgba(255,255,255,.22)"
        }]
      },
      options: chartOptions({ scales: { r: { beginAtZero: true, grid: { color: "rgba(166,181,201,.16)" }, ticks: { color: document.body.classList.contains("light-mode") ? "#5d6e83" : "#a6b5c9", backdropColor: "transparent" } } } })
    }));
  }
  const location = document.getElementById("analyticsLocation");
  if (location) location.textContent = current ? `${current.name}${current.sys?.country ? `, ${current.sys.country}` : ""} · forecast` : "Forecast analytics";
  document.querySelectorAll("[data-temperature-unit]").forEach(element => element.textContent = `°${currentUnits === "metric" ? "C" : "F"}`);
  document.querySelectorAll("[data-wind-unit]").forEach(element => element.textContent = currentUnits === "metric" ? "m/s" : "mph");
}

function downloadForecastCsv() {
  const data = latestForecastData;
  if (!data?.list?.length) {
    setDataStatus("Forecast data unavailable", "error");
    return;
  }
  const rows = [["local_time", "temperature_c", "feels_like_c", "dew_point_c", "surface_pressure_hpa", "precipitation_probability_percent", "precipitation_mm", "humidity_percent", "wind_speed_m_s", "wind_direction_degrees", "wind_gust_m_s", "cloud_cover_percent"]];
  data.list.forEach(item => rows.push([
    item.local_time || item.dt_txt || new Date(item.dt * 1000).toISOString(),
    item.main.temp,
    item.main.feels_like,
    item.main.dew_point,
    item.main.pressure,
    Math.round((item.pop || 0) * 100),
    item.rain?.["1h"],
    item.main.humidity,
    item.wind.speed,
    item.wind.deg,
    item.wind.gust,
    item.clouds?.all
  ]));
  const csv = rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `skycast-forecast-${(latestWeatherData?.name || "location").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function windSpeedLabel(speed) {
  const value = currentUnits === "metric" ? speed : speed * 2.23694;
  return `${value.toFixed(1)} ${currentUnits === "metric" ? "m/s" : "mph"}`;
}

function renderActivityRecommendation(data, forecast = latestForecastData) {
  const container = document.getElementById("dailyInsight");
  if (!container || !data?.main || !forecast?.list?.length) return;
  const nextHours = nextForecastHours(forecast);
  const maxRain = Math.max(0, ...nextHours.map(item => item.pop || 0));
  const windMps = Number(data.wind?.speed) || 0;
  const temperatureC = Number(data.main.temp);
  let title = "Conditions look comfortable for outdoor plans";
  let reasons = [`${formatTemperature(temperatureC)} now`, `${Math.round(maxRain * 100)}% max hourly precipitation chance over the next 24 hours`, `${windSpeedLabel(windMps)} wind`];
  let icon = "fa-person-hiking";
  if (maxRain >= 0.6) {
    title = "Consider a rain-ready plan";
    reasons[1] = `Hourly precipitation chance reaches ${Math.round(maxRain * 100)}% in the next 24 hours`;
    icon = "fa-cloud-rain";
  } else if (windMps >= 10) {
    title = "Wind may affect exposed outdoor plans";
    reasons[2] = `Current wind speed is ${windSpeedLabel(windMps)}`;
    icon = "fa-wind";
  } else if (temperatureC >= 32 || temperatureC <= 0) {
    title = "Plan for temperature extremes";
    reasons[0] = `Current temperature is ${formatTemperature(temperatureC)}`;
    icon = temperatureC >= 32 ? "fa-sun" : "fa-snowflake";
  }
  container.innerHTML = `<div class="daily-insight-icon"><i class="fas ${icon}"></i></div><div><p class="section-kicker mb-1">A practical weather read · heuristic, not an official warning</p><h4 class="mb-2">${title}</h4><p class="mb-0 text-secondary">${reasons.join(" · ")}</p></div>`;
  container.style.display = "flex";
}

async function renderComparison() {
  const grid = document.getElementById("comparisonGrid");
  if (!grid) return;
  const favorites = JSON.parse(localStorage.getItem("favorites") || "[]");
  if (!favorites.length) {
    grid.innerHTML = '<div class="empty-state"><i class="fas fa-city"></i><p>Save at least one city to compare current weather.</p></div>';
    return;
  }
  grid.innerHTML = '<div class="empty-state"><i class="fas fa-circle-notch fa-spin"></i><p>Loading saved city conditions.</p></div>';
  const results = await Promise.allSettled(favorites.map(city => fetchJson(apiUrl("weather", { q: city, units: "metric" }))));
  grid.innerHTML = results.map((result, index) => {
    if (result.status === "rejected") {
      console.warn(`Comparison weather unavailable for "${favorites[index]}":`, result.reason);
      return `<article class="comparison-card comparison-error"><h4>${escapeHtml(favorites[index])}</h4><p>Current conditions are temporarily unavailable.</p></article>`;
    }
    const weather = result.value;
    const location = [weather.name, weather.sys?.country].filter(Boolean).join(", ");
    const localTime = formatCityDateTime(new Date(), weather, { hour: "2-digit", minute: "2-digit" });
    return `<button class="comparison-card" type="button" onclick="selectComparisonCity(this.dataset.city)" data-city="${escapeHtml(favorites[index])}">
      <span class="comparison-city">${escapeHtml(location)}</span><span class="comparison-local-time"><i class="fas fa-clock me-1"></i>${localTime} · ${escapeHtml(cityTimezoneLabel(weather))}</span>
      <span class="comparison-temperature">${formatTemperature(weather.main.temp)}</span><span class="text-capitalize">${escapeHtml(weather.weather[0].description)}</span>
      <span class="comparison-details">${weather.main.humidity}% humidity · ${windSpeedLabel(weather.wind.speed)} wind</span></button>`;
  }).join("");
}

function selectComparisonCity(city) {
  showPage("dashboard");
  getWeather(city);
}

function getLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        getWeatherByCoords(position.coords.latitude, position.coords.longitude);
      },
      (err) => {
        alert("Unable to retrieve your location. " + err.message);
      }
    );
  } else {
    alert("Geolocation is not supported by your browser.");
  }
}

function toggleTheme() {
  const body = document.body;
  const isDark = body.classList.contains("light-mode");
  const theme = isDark ? "dark" : "light";
  const icon = isDark ? "fa-moon" : "fa-sun";
  
  if (isDark) {
    body.classList.remove("light-mode");
  } else {
    body.classList.add("light-mode");
  }
  document.querySelectorAll("#themeToggle, #headerThemeToggle").forEach((button) => {
    button.innerHTML = `<i class="fas ${icon}"></i>`;
  });
  document.querySelectorAll(".header-theme-toggle").forEach((button) => {
    button.setAttribute("aria-label", `Switch to ${isDark ? "dark" : "light"} theme`);
  });
  localStorage.setItem("theme", theme);
  if (latestForecastData) {
    renderChart(latestForecastData);
    renderForecastStudio();
    renderForecastAnalytics();
  }
}

function toggleUnits() {
  currentUnits = currentUnits === "metric" ? "imperial" : "metric";
  localStorage.setItem("units", currentUnits);
  document.getElementById("unitToggle").textContent = currentUnits === "metric" ? "°C" : "°F";
  updateUnitSettingsLabel();
  const city = getSearchInput().value.trim();
  if (latestWeatherData && latestForecastData) {
    displayCurrent(latestWeatherData);
    const aqiBadge = document.getElementById("aqiBadgeDashboard");
    if (aqiBadge) aqiBadge.innerHTML = latestAqiHtml;
    const uvDisplay = document.getElementById("uvIndexDisplay");
    if (uvDisplay && latestUvHtml) uvDisplay.innerHTML = latestUvHtml;
    displayForecast(latestForecastData);
    displayHourly(latestForecastData);
    renderChart(latestForecastData);
    renderForecastStudio();
    renderForecastAnalytics();
    renderSafetyConditions(latestWeatherData);
    updateCalculators(latestWeatherData.coord.lat, latestWeatherData.coord.lon);
    fetchExtendedForecast(latestWeatherData.coord.lat, latestWeatherData.coord.lon);
    if (document.getElementById("comparison-page")?.style.display === "block") renderComparison();
  } else if (city) {
    getWeather(city);
  }
}

function updateUnitSettingsLabel() {
  const label = document.getElementById("settingsUnitTarget");
  if (label) label.textContent = currentUnits === "metric" ? "°F" : "°C";
}

function refreshWeather() {
  const city = getSearchInput().value.trim();
  if (city) getWeather(city);
  else if (latestWeatherData?.coord) getWeatherByCoords(latestWeatherData.coord.lat, latestWeatherData.coord.lon);
  else getWeather(DEFAULT_CITY);
}

function formatTemperature(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  const converted = currentUnits === "metric" ? numeric : (numeric * 9 / 5) + 32;
  return `${Math.round(converted)}°${currentUnits === "metric" ? "C" : "F"}`;
}

function safeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatForecastTime(item, timezone = "UTC") {
  if (item.local_time) {
    return item.local_time.slice(11, 16);
  }
  return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(item.dt * 1000));
}

function formatLocationTime(epochSeconds, timezone = "UTC") {
  if (!Number.isFinite(Number(epochSeconds))) return "--";
  return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(Number(epochSeconds) * 1000));
}

function setDataStatus(message, state = "ready") {
  const status = document.getElementById("dataStatus");
  if (!status) return;
  const icon = state === "loading" ? "fa-circle-notch fa-spin" : state === "error" ? "fa-triangle-exclamation" : "fa-circle-check";
  status.innerHTML = `<i class="fas ${icon} me-1"></i>${message}`;
  status.className = `status-pill status-${state}`;
  const updated = document.getElementById("headerUpdated");
  if (updated && state === "ready" && message === "Live data") {
    updated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
}

function loadOptionalLocationData(data) {
  renderMap(data).catch(error => {
    console.error("Weather map unavailable:", error);
    updateMapMessage("The selected map view is temporarily unavailable.");
  });
  getAirQuality(data.coord.lat, data.coord.lon);
  checkWeatherAlerts(data);
}

function toggleNotifications() {
  showPage("notifications");
}

function requestNotifications() {
  if (!("Notification" in window)) {
    alert("Browser notifications are not supported on this device.");
    return;
  }
  Notification.requestPermission().then(permission => {
    if (permission === "granted") {
      renderNotifications();
      notifyActiveWeatherAlerts();
    }
  }).catch(error => console.error("Browser notification permission request failed:", error));
}

function notifyActiveWeatherAlerts() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  for (const alert of notificationMessages) {
    const key = alert.id || `${alert.event}|${alert.start}`;
    if (notifiedAlertIds.has(key)) continue;
    notifiedAlertIds.add(key);
    new Notification(`SkyCast weather alert: ${alert.event}`, {
      body: `${alert.severity} · ${alert.area}`,
      tag: key
    });
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(error => console.warn("Offline cache unavailable:", error));
  }
}

// Initial theme check
if (localStorage.getItem("theme") === "light") {
  document.addEventListener("DOMContentLoaded", () => {
    document.body.classList.add("light-mode");
    document.querySelectorAll("#themeToggle, #headerThemeToggle").forEach((button) => {
      button.innerHTML = '<i class="fas fa-sun"></i>';
    });
  });
}

function displayFavorites() {
  const favorites = JSON.parse(localStorage.getItem("favorites") || "[]");
  if (favorites.length > 0) {
    const section = document.getElementById("favoritesSection");
    const list = document.getElementById("favoritesList");
    section.style.display = "block";
    let html = '<div class="d-flex flex-wrap justify-content-center gap-2 mb-3">';
    html += favorites.map(f => `
      <div class="btn-group">
        <button type="button" class="btn btn-sm btn-outline-light" onclick="getWeather(this.dataset.city)" data-city="${escapeHtml(f)}">${escapeHtml(f)}</button>
        <button type="button" class="btn btn-sm btn-outline-danger" onclick="removeFavorite(this.dataset.city)" data-city="${escapeHtml(f)}" title="Remove ${escapeHtml(f)}" aria-label="Remove ${escapeHtml(f)}"><i class="fas fa-times"></i></button>
      </div>
    `).join("");
    html += '</div>';
    html += `<div class="mt-3"><button class="btn btn-accent px-4 py-2 rounded-pill" onclick="toggleDashboard()"><i class="fas fa-th-large me-2"></i>View Multi-City Dashboard</button></div>`;
    list.innerHTML = html;
  } else {
    document.getElementById("favoritesSection").style.display = "none";
    document.getElementById("favoritesList").innerHTML = '<p class="text-secondary small mb-0">No saved locations yet. Use “Save” on a city forecast to keep it here.</p>';
  }
}

function removeFavorite(city) {
  let favorites = JSON.parse(localStorage.getItem("favorites") || "[]");
  favorites = favorites.filter(f => f !== city);
  localStorage.setItem("favorites", JSON.stringify(favorites));
  displayFavorites();
  if (document.getElementById("comparison-page")?.style.display === "block") renderComparison();
  if (document.getElementById("dashboardSection").style.display === "block") {
    renderDashboard();
  }
}

async function toggleDashboard() {
  const section = document.getElementById("dashboardSection");
  if (section.style.display === "none") {
    section.style.display = "block";
    await renderDashboard();
    section.scrollIntoView({ behavior: 'smooth' });
  } else {
    section.style.display = "none";
  }
}

async function renderDashboard() {
  const favorites = JSON.parse(localStorage.getItem("favorites") || "[]");
  const grid = document.getElementById("dashboardGrid");
  grid.innerHTML = '<div class="col-12 text-center"><div class="spinner-border text-light"></div></div>';
  
  const results = await Promise.allSettled(favorites.map(city => fetchJson(apiUrl("weather", { q: city, units: "metric" }))));
  const cards = results.flatMap((result, index) => {
    if (result.status === "rejected") {
      console.warn(`Saved location "${favorites[index]}" unavailable:`, result.reason);
      return [];
    }
    const data = result.value;
    const id = `favoriteSkycon-${index}`;
    return [`
      <div class="col-md-4 col-sm-6">
        <button type="button" class="forecast-card favorite-weather-card text-center h-100 p-3" onclick="getWeather(this.dataset.city)" data-city="${escapeHtml(favorites[index])}">
          <h6 class="mb-1">${escapeHtml(data.name)}</h6>
          <canvas id="${id}" width="50" height="50" aria-label="${escapeHtml(data.weather[0].description)}"></canvas>
          <h4 class="mb-0">${formatTemperature(data.main.temp)}</h4>
          <p class="small opacity-75 mb-0 text-capitalize">${escapeHtml(data.weather[0].description)}</p>
        </button>
      </div>`];
  });
  grid.innerHTML = cards.join("") || (favorites.length
    ? '<p class="text-center text-secondary">Saved location weather is temporarily unavailable. Please try again.</p>'
    : '<p class="text-center text-secondary">Save locations from the dashboard to compare their current weather here.</p>');
  results.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const canvas = document.getElementById(`favoriteSkycon-${index}`);
    if (canvas) setSkycon(canvas.id, "weather");
  });
}

async function getWeather(cityToSearch) {
  let city = typeof cityToSearch === 'string' ? cityToSearch : getSearchInput().value.trim();
  
  // Basic sanitization
  city = city.replace(/[<>]/g, "");

  if (!city) {
    alert("Please enter a city name.");
    return;
  }

  getSearchInput().value = city;

  // Update URL without reloading
  const newUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}?city=${encodeURIComponent(city)}`;
  window.history.pushState({ path: newUrl }, "", newUrl);

  setDataStatus("Loading weather", "loading");
  try {
    const currentData = await fetchJson(apiUrl("weather", { q: city, units: "metric" }));

    if (currentData.cod !== 200) {
      throw new Error(currentData.message);
    }

    const forecastData = await fetchJson(apiUrl("forecast", { q: city, units: "metric" }));
    currentData.timezone = forecastData.timezone || currentData.timezone;
    currentData.timezoneAbbreviation = forecastData.timezoneAbbreviation || currentData.timezoneAbbreviation;
    currentData.utcOffsetSeconds = forecastData.utcOffsetSeconds ?? currentData.utcOffsetSeconds;
    latestWeatherData = currentData;
    latestForecastData = forecastData;

    const prompt = document.getElementById("searchPrompt");
    if (prompt) prompt.style.display = "none";

    displayCurrent(currentData);
    displayForecast(forecastData);
    displayHourly(forecastData);
    fetchExtendedForecast(currentData.coord.lat, currentData.coord.lon);
    renderChart(forecastData);
    renderForecastStudio();
    renderForecastAnalytics();
    renderActivityRecommendation(currentData, forecastData);
    document.getElementById("visualsContainer").style.display = "block";
    document.getElementById("hourlyContainer").style.display = "block";
    setDataStatus("Live data");
    loadOptionalLocationData(currentData);
  } catch (err) {
    document.getElementById("weatherContainer").innerHTML = `<div class="col-md-8"><div class="weather-card error-state" role="alert"><i class="fas fa-triangle-exclamation"></i><h4>Weather could not be loaded</h4><p>${escapeHtml(err.message)}</p><button class="btn btn-outline-light btn-sm" type="button" onclick="refreshWeather()"><i class="fas fa-rotate-right me-2"></i>Try again</button></div></div>`;
    document.getElementById("forecastContainer").innerHTML = "";
    document.getElementById("visualsContainer").style.display = "none";
    document.getElementById("intelligenceSection").style.display = "none";
    setDataStatus("Unable to load weather", "error");
  }
}

async function checkWeatherAlerts(data) {
  const alertContainer = document.getElementById("safetyAlerts");
  if (!alertContainer || !data?.coord) return;
  alertCoordinates = { lat: data.coord.lat, lon: data.coord.lon };
  if (alertRefreshInterval) clearInterval(alertRefreshInterval);
  alertRefreshInterval = setInterval(() => {
    if (alertCoordinates) checkWeatherAlerts({ coord: alertCoordinates });
  }, 300000);
  alertContainer.className = "empty-state";
  alertContainer.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i><p class="mb-1">Loading official weather alerts.</p>';
  const notificationList = document.getElementById("notificationList");
  if (notificationList) {
    notificationList.className = "empty-state";
    notificationList.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i><p class="mb-0">Loading official weather alerts.</p>';
  }
  try {
    const result = await fetchJson(apiUrl("alerts", { lat: data.coord.lat, lon: data.coord.lon }));
    notificationMessages = result.alerts || [];
    renderNotifications();
    notifyActiveWeatherAlerts();
    if (!notificationMessages.length) {
      alertContainer.innerHTML = '<i class="fas fa-check-circle"></i><p class="mb-1">No Active Weather Alerts</p><small>Official NOAA/NWS alerts checked just now.</small>';
      return;
    }
    alertContainer.className = "safety-alert-list";
    alertContainer.innerHTML = notificationMessages.map((alert) => `
      <article class="alert-item alert-severity-${escapeHtml(alert.severity).toLowerCase()}">
        <div class="alert-item-title"><strong><i class="fas fa-triangle-exclamation me-2"></i>${escapeHtml(alert.event)}</strong><span class="alert-severity">${escapeHtml(alert.severity)}</span></div>
        <div class="alert-meta"><span><strong>Urgency:</strong> ${escapeHtml(alert.urgency)}</span><span><strong>Affected area:</strong> ${escapeHtml(alert.area)}</span></div>
        <div class="alert-meta"><span><strong>Issued:</strong> ${formatAlertTime(alert.start)}</span><span><strong>Expires:</strong> ${formatAlertTime(alert.end)}</span></div>
        <p>${escapeHtml(alert.description)}</p>
        <p class="mb-0"><strong>Safety instructions:</strong> ${escapeHtml(alert.instruction)}</p>
        <small class="d-block mt-2 opacity-75">Issuing authority: ${escapeHtml(alert.sender)} · ${escapeHtml(result.provider)}</small>
      </article>`).join("");
  } catch (error) {
    notificationMessages = [];
    renderNotifications();
    alertContainer.innerHTML = `<i class="fas fa-triangle-exclamation"></i><p class="mb-1">Official weather alerts unavailable.</p><small>Please try again shortly.</small>`;
    if (notificationList) {
      notificationList.className = "empty-state";
      notificationList.innerHTML = `<i class="fas fa-triangle-exclamation"></i><p class="mb-1">Official weather alerts unavailable.</p><small>Please try again shortly.</small>`;
    }
  }
}

function formatAlertTime(value) {
  if (!value) return "Unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function setSkycon(iconId, condition) {
  const cond = condition.toLowerCase();
  let skyconType = Skycons.PARTLY_CLOUDY_DAY;
  
  if (cond.includes('clear')) skyconType = Skycons.CLEAR_DAY;
  else if (cond.includes('cloud')) skyconType = Skycons.CLOUDY;
  else if (cond.includes('rain')) skyconType = Skycons.RAIN;
  else if (cond.includes('drizzle')) skyconType = Skycons.RAIN;
  else if (cond.includes('thunderstorm')) skyconType = Skycons.SLEET;
  else if (cond.includes('snow')) skyconType = Skycons.SNOW;
  else if (cond.includes('mist') || cond.includes('fog')) skyconType = Skycons.FOG;

  skycons.add(iconId, skyconType);
  skycons.play();
}

function displayCurrent(data) {
  const weather = data.weather[0];
  const main = data.main;
  const sys = data.sys;
  const location = `${data.name}, ${sys.country}`;
  const timezone = data.timezone || "UTC";
  const offsetSeconds = Number(data.utcOffsetSeconds) || 0;
  const sunrise = formatLocationTime(sys.sunrise + offsetSeconds, "UTC");
  const sunset = formatLocationTime(sys.sunset + offsetSeconds, "UTC");
  const windDir = getWindDirection(data.wind.deg);

  // SEO: Update JSON-LD
  const schema = {
    "@context": "https://schema.org",
    "@type": "WeatherForecast",
    "name": `Weather in ${location}`,
    "description": `Current temperature in ${location} is ${main.temp}°C with ${weather.description}.`,
    "currentCondition": weather.main,
    "temperature": `${main.temp} Celsius`
  };
  document.getElementById("weatherSchema").textContent = JSON.stringify(schema);

  const html = `
    <div class="col-md-8">
      <div class="weather-card current-weather-card animate__animated animate__fadeIn">
        <div class="d-flex justify-content-between align-items-start mb-4">
          <div>
            <h2 class="mb-0 text-start">${location}</h2>
            <p class="text-start opacity-75 text-capitalize">${weather.description}</p>
            <p class="current-local-time text-start mb-0" id="cityLocalTime"></p>
          </div>
          <button class="btn btn-outline-light btn-sm" onclick="saveFavorite('${data.name}')">
            <i class="far fa-star"></i> Save
          </button>
        </div>
        
        <div class="row align-items-center">
          <div class="col-md-6 text-center mb-4 mb-md-0">
            <div class="d-flex justify-content-center align-items-center">
                <canvas id="currentSkycon" width="100" height="100" style="margin-right: 15px;"></canvas>
                <h1 class="current-temperature" style="font-size: 4rem; font-weight: 600; margin-bottom: 0;">${formatTemperature(main.temp)}</h1>
            </div>
            <p class="opacity-75">Feels like ${formatTemperature(main.feels_like)}</p>
            <div class="today-range">
              <span>H: <strong>${formatTemperature(latestForecastData?.daily?.temperature_2m_max?.[0])}</strong></span>
              <span>L: <strong>${formatTemperature(latestForecastData?.daily?.temperature_2m_min?.[0])}</strong></span>
            </div>
            <div id="aqiBadgeDashboard" class="mt-2"></div>
          </div>
          <div class="col-md-6">
            <div class="row g-2">
                <div class="col-6">
                    <div class="weather-detail-tile">
                        <small class="d-block opacity-75"><i class="fas fa-tint me-2"></i>Humidity</small>
                        <span class="fw-bold">${main.humidity}%</span>
                    </div>
                </div>
                <div class="col-6">
                    <div class="weather-detail-tile">
                        <small class="d-block opacity-75"><i class="fas fa-wind me-2"></i>Wind</small>
                        <span class="fw-bold">${windSpeedLabel(data.wind.speed)} ${windDir}</span>
                    </div>
                </div>
                <div class="col-6">
                    <div class="weather-detail-tile">
                        <small class="d-block opacity-75"><i class="fas fa-compress-arrows-alt me-2"></i>Pressure</small>
                        <span class="fw-bold">${main.pressure} hPa</span>
                    </div>
                </div>
                <div class="col-6">
                    <div class="weather-detail-tile">
                        <small class="d-block opacity-75"><i class="fas fa-eye me-2"></i>Visibility</small>
                        <span class="fw-bold">${(currentUnits === "metric" ? data.visibility / 1000 : data.visibility / 1609.344).toFixed(1)} ${currentUnits === "metric" ? "km" : "mi"}</span>
                    </div>
                </div>
                <div class="col-6">
                    <div class="weather-detail-tile" id="uvIndexDisplay">
                        <small class="d-block opacity-75"><i class="fas fa-sun me-2"></i>UV Index</small>
                        <span class="fw-bold text-muted">Loading...</span>
                    </div>
                </div>
                <div class="col-6">
                    <div class="weather-detail-tile">
                        <small class="d-block opacity-75"><i class="fas fa-umbrella me-2"></i>Precipitation</small>
                        <span class="fw-bold">${data.rain ? (data.rain['1h'] || data.rain['3h'] || 0) : 0} mm</span>
                    </div>
                </div>
                <div class="col-6">
                    <div class="weather-detail-tile">
                        <small class="d-block opacity-75"><i class="fas fa-sun me-2"></i>Sunrise</small>
                        <span class="fw-bold">${sunrise}</span>
                    </div>
                </div>
                <div class="col-6">
                    <div class="weather-detail-tile">
                        <small class="d-block opacity-75"><i class="fas fa-moon me-2"></i>Sunset</small>
                        <span class="fw-bold">${sunset}</span>
                    </div>
                </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  document.getElementById("weatherContainer").innerHTML = html;
  renderMetricGrid(data);
  renderSafetyConditions(data);
  renderActivityRecommendation(data);
  document.getElementById("intelligenceSection").style.display = "block";
  document.getElementById("lastUpdated").textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  setSkycon("currentSkycon", weather.main);
  updateBackground(weather.main, sys);
}

function renderMetricGrid(data) {
  const main = data.main;
  const precipitationChance = nextForecastHours()[0]?.pop;
  const windDirection = Number.isFinite(data.wind?.deg) ? `${getWindDirection(data.wind.deg)} · ${data.wind.deg}°` : "Unavailable";
  const metrics = [
    ["Temperature", formatTemperature(main.temp), "fa-temperature-half", "accent"],
    ["Feels like", formatTemperature(main.feels_like), "fa-person-rays", "accent"],
    ["Humidity", `${main.humidity}%`, "fa-droplet", "blue"],
    ["Air pressure", `${main.pressure} hPa`, "fa-gauge-high", "purple"],
    ["Wind speed", windSpeedLabel(data.wind.speed), "fa-wind", "green"],
    ["Wind direction", windDirection, "fa-compass", "green"],
    ["Visibility", `${((data.visibility || 0) / (currentUnits === "metric" ? 1000 : 1609.344)).toFixed(1)} ${currentUnits === "metric" ? "km" : "mi"}`, "fa-eye", "blue"],
    ["Cloud coverage", `${data.clouds?.all ?? 0}%`, "fa-cloud", "purple"],
    ["Dew point", formatTemperature(main.dew_point ?? calculateDewPoint(main.temp, main.humidity)), "fa-temperature-arrow-down", "blue"],
    ["Precipitation chance", precipitationChance === undefined ? "Unavailable" : `${Math.round(precipitationChance * 100)}%`, "fa-cloud-rain", "accent"]
  ];
  if (Number.isFinite(data.wind?.gust)) metrics.push(["Wind gust", windSpeedLabel(data.wind.gust), "fa-wind", "green"]);
  document.getElementById("metricGrid").innerHTML = metrics.map(([label, value, icon, color]) => `
    <div class="metric-card">
      <div class="metric-icon metric-${color}"><i class="fas ${icon}"></i></div>
      <div><span>${label}</span><strong>${value}</strong></div>
    </div>`).join("");
}

function calculateDewPoint(temperature, humidity) {
  const a = 17.27;
  const b = 237.7;
  const gamma = (a * temperature) / (b + temperature) + Math.log(humidity / 100);
  return (b * gamma) / (a - gamma);
}

function getWindDirection(deg) {
  if (deg === null || deg === undefined || deg === "" || !Number.isFinite(Number(deg))) return "Unavailable";
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return directions[Math.round(deg / 45) % 8];
}

async function getAirQuality(lat, lon) {
  try {
    const data = await fetchJson(apiUrl("air-quality", { lat, lon }));
    const components = data.list[0].components;
    const aqi = data.list[0].main.aqi;
    const levels = {
      1: { text: "Good", class: "bg-success", advice: "Air quality is satisfactory, and air pollution poses little or no risk." },
      2: { text: "Fair", class: "bg-info", advice: "Air quality is acceptable. However, there may be a risk for some people, particularly those who are unusually sensitive to air pollution." },
      3: { text: "Moderate", class: "bg-warning text-dark", advice: "Members of sensitive groups may experience health effects. The general public is less likely to be affected." },
      4: { text: "Poor", class: "bg-danger", advice: "Everyone may begin to experience health effects; members of sensitive groups may experience more serious health effects." },
      5: { text: "Very Poor", class: "bg-dark", advice: "Health alert: The risk of health effects is increased for everyone." }
    };
    const badge = levels[aqi] || { text: "Unknown", class: "bg-secondary", advice: "" };
    
    const aqiHTML = `
      <div class="d-flex flex-column align-items-center mt-3">
        <span class="badge ${badge.class} aqi-pill aqi-level-${aqi} mb-2 p-2 px-3 fs-6">AQI: ${badge.text}</span>
        <div class="small opacity-75 d-flex gap-3 mb-2">
          <span>PM2.5: ${components.pm2_5}</span>
          <span>PM10: ${components.pm10}</span>
        </div>
        <p class="small text-center opacity-75 italic mb-0" style="max-width: 300px;">${badge.advice}</p>
      </div>
    `;
    latestAqiHtml = aqiHTML;

    const dashContainer = document.getElementById("aqiBadgeDashboard");
    if (dashContainer) dashContainer.innerHTML = aqiHTML;

    const pageContainer = document.getElementById("aqiBadgePage");
    if (pageContainer) pageContainer.innerHTML = aqiHTML;
    const pollutantGrid = document.getElementById("pollutantGrid");
    if (pollutantGrid) {
      const pollutants = [["PM2.5", components.pm2_5], ["PM10", components.pm10], ["O₃", components.o3], ["NO₂", components.no2], ["CO", components.co], ["SO₂", components.so2]];
      pollutantGrid.innerHTML = pollutants.map(([label, value]) => `<div><small>${label}</small><strong>${Number(value).toFixed(1)} <span class="small opacity-75">μg/m³</span></strong></div>`).join("");
    }
    const updated = document.getElementById("aqiUpdated");
    if (updated) updated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    const guidance = document.getElementById("aqiGuidance");
    if (guidance) guidance.innerHTML = `<strong><i class="fas fa-heart-pulse me-2 text-accent"></i>Health guidance</strong><p class="small opacity-75 mb-0 mt-2">${badge.advice}</p><span class="data-attribution">Provider: Open-Meteo Air Quality</span>`;
    const chartCanvas = document.getElementById("aqiChart");
    if (chartCanvas && window.Chart) {
      if (aqiChart) aqiChart.destroy();
      aqiChart = new Chart(chartCanvas, {
        type: "bar",
        data: { labels: ["PM2.5", "PM10", "O₃", "NO₂", "CO"], datasets: [{ data: [components.pm2_5, components.pm10, components.o3, components.no2, components.co], backgroundColor: ["#38bdf8", "#60a5fa", "#4ade80", "#c084fc", "#fbbf24"], borderRadius: 8 }] },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: "#94a3b8" }, grid: { display: false } }, y: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(148,163,184,.12)" } } } }
      });
    }

    const detailsContainer = document.getElementById("airQualityDetails");
    if (detailsContainer) {
      detailsContainer.innerHTML = `
        <div class="row g-3">
          ${Object.entries(components).map(([key, value]) => `
            <div class="col-6 col-md-3">
              <div class="p-2 border border-light border-opacity-10 rounded text-center">
                <small class="d-block opacity-50 text-uppercase" style="font-size: 0.6rem;">${key.replace('_', '.')}</small>
                <span class="fw-bold">${value}</span>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }
    
    // Calculate Heat Index and Dew Point
    updateCalculators(lat, lon);
    
    // Attempt UV Index
    const uvData = await fetchJson(apiUrl("uv", { lat, lon }));
    if (uvData && uvData.value !== undefined) {
      let uvClass = "text-success";
      if (uvData.value > 3) uvClass = "text-warning";
      if (uvData.value > 6) uvClass = "text-danger";
      latestUvHtml = `<small class="d-block opacity-75"><i class="fas fa-sun me-2"></i>UV Index</small><span class="fw-bold ${uvClass}">${uvData.value}</span>`;
      const uvContainer = document.getElementById("uvIndexDisplay");
      if (uvContainer) {
        uvContainer.innerHTML = latestUvHtml;
      }
    }
  } catch (err) {
    console.error("AQI/UV error:", err);
  }
}

function updateBackground(condition, sys) {
  const body = document.body;
  const now = Math.floor(Date.now() / 1000);
  const isNight = now < sys.sunrise || now > sys.sunset;
  
  const cond = condition.toLowerCase();
  let bgClass = "bg-default";
  
  if (isNight) {
    bgClass = "bg-night";
  } else {
    if (cond.includes('clear')) bgClass = "bg-sunny";
    else if (cond.includes('cloud')) bgClass = "bg-cloudy";
    else if (cond.includes('rain') || cond.includes('drizzle')) bgClass = "bg-rainy";
    else if (cond.includes('storm')) bgClass = "bg-stormy";
    else if (cond.includes('snow')) bgClass = "bg-snowy";
  }
  
  // Remove existing bg classes
  const classesToRemove = ["bg-default", "bg-sunny", "bg-cloudy", "bg-rainy", "bg-stormy", "bg-snowy", "bg-night"];
  body.classList.remove(...classesToRemove);
  body.classList.add("weather-bg", bgClass);
  
  initWeatherParticles(cond);
}

function initWeatherParticles(condition) {
  const canvas = document.getElementById("weatherParticles");
  const ctx = canvas.getContext("2d");
  let particles = [];
  
  if (particleInterval) clearInterval(particleInterval);
  
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  
  if (!particleResizeBound) {
    window.addEventListener('resize', () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    });
    particleResizeBound = true;
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const particleCount = 20;
  const type = (condition.includes('rain') || condition.includes('drizzle')) ? 'rain' :
               (condition.includes('snow')) ? 'snow' : 'none';

  if (type === 'none') {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  for (let i = 0; i < particleCount; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      velX: (type === 'snow') ? (Math.random() - 0.5) * 1 : 0,
      velY: (type === 'rain') ? Math.random() * 10 + 10 : (type === 'snow') ? Math.random() * 2 + 1 : Math.random() * 0.05,
      size: (type === 'rain') ? 2 : (type === 'snow') ? Math.random() * 3 + 1 : Math.random() * 2,
      opacity: Math.random()
    });
  }

  particleInterval = setInterval(() => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = (type === 'rain') ? '#0ea5e9' : '#ffffff';
    
    particles.forEach(p => {
      ctx.globalAlpha = p.opacity;
      if (type === 'rain') {
        ctx.fillRect(p.x, p.y, 1, 15);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      
      p.x += p.velX;
      p.y += p.velY;
      
      if (p.y > canvas.height) {
        p.y = -20;
        p.x = Math.random() * canvas.width;
      }
      if (p.x > canvas.width) p.x = 0;
      if (p.x < 0) p.x = canvas.width;
    });
  }, 50);
}

function displayForecast(data) {
  let forecastHTML = "";
  // Use the midday local-time item when available for the daily summary.
  const dailyForecasts = data.list.filter(item => item.dt_txt.includes("12:00:00"));

  dailyForecasts.forEach((day, index) => {
    const date = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: data.timezone || "UTC" }).format(new Date(day.dt * 1000));
    const rainProb = day.pop ? Math.round(day.pop * 10000) / 100 : 0; // pop is 0-1
    const iconId = `forecastSkycon-${index}`;
    forecastHTML += `
      <div class="col-md-2 col-6 mb-3">
        <div class="forecast-card animate__animated animate__fadeIn text-center" style="padding: 15px;">
          <p class="mb-1 small opacity-75">${date}</p>
          <canvas id="${iconId}" width="50" height="50" style="margin: 10px 0;"></canvas>
          <p class="mb-0"><strong>${formatTemperature(day.main.temp)}</strong></p>
          <p class="small mb-1 opacity-75 text-capitalize text-truncate">${day.weather[0].description}</p>
          <div class="small text-info">
            <i class="fas fa-umbrella me-1"></i>${Math.round(rainProb)}%
          </div>
        </div>
      </div>`;
    
    // Use setTimeout to ensure canvas is in DOM before adding Skycon
    setTimeout(() => setSkycon(iconId, day.weather[0].main), 100);
  });

  document.getElementById("forecastContainer").innerHTML = forecastHTML;
}

async function fetchExtendedForecast(lat, lon) {
  try {
    const data = await fetchJson(apiUrl("forecast", { lat, lon, units: "metric" }));
    const daily = data.daily;
    if (!daily?.time?.length) throw new Error("Extended forecast unavailable");
    document.getElementById("extendedForecastGrid").innerHTML = daily.time.map((day, index) => `
      <div class="extended-day">
        <span class="small opacity-75">${index === 0 ? "Today" : new Intl.DateTimeFormat([], { weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))}</span>
        <strong>${formatTemperature(daily.temperature_2m_max[index])} / ${formatTemperature(daily.temperature_2m_min[index])}</strong>
        <span class="small text-info"><i class="fas fa-umbrella me-1"></i>${daily.precipitation_probability_max[index] ?? 0}%</span>
      </div>`).join("");
    document.getElementById("extendedForecast").style.display = "block";
  } catch (error) {
    console.warn("Extended forecast unavailable:", error);
    document.getElementById("extendedForecast").style.display = "none";
  }
}

function saveFavorite(city) {
  let favorites = JSON.parse(localStorage.getItem("favorites") || "[]");
  if (!favorites.includes(city)) {
    favorites.push(city);
    localStorage.setItem("favorites", JSON.stringify(favorites));
    displayFavorites();
    if (document.getElementById("comparison-page")?.style.display === "block") renderComparison();
  } else {
    alert("City already in favorites!");
  }
}

function renderChart(data) {
  const ctx = document.getElementById('tempChart').getContext('2d');
  const textColor = document.body.classList.contains("light-mode") ? "#5d6e83" : "#cbd5e0";
  const dailyForecasts = data.list.filter(item => item.dt_txt.includes("12:00:00"));
  const labels = dailyForecasts.map(day => new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: data.timezone || "UTC" }).format(new Date(day.dt * 1000)));
  const temps = dailyForecasts.map(day => currentUnits === "metric" ? day.main.temp : (day.main.temp * 9 / 5) + 32);

  if (weatherChart) {
    weatherChart.destroy();
  }

  weatherChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: `Temp (°${currentUnits === "metric" ? "C" : "F"})`,
        data: temps,
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56, 189, 248, 0.2)',
        borderWidth: 3,
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#38bdf8'
      }]
    },
    options: {
      responsive: true,
      animation: { duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450 },
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.1)' },
          ticks: { color: textColor }
        },
        x: {
          grid: { display: false },
          ticks: { color: textColor }
        }
      }
    }
  });
}

const mapLayerDefinitions = {
  temperature: { path: "temp_new", title: "Temperature", units: "°C", range: "-30°  0°  30°", colors: "#2c7bb6, #abd9e9, #ffffbf, #fdae61, #d7191c" },
  rain: { path: "precipitation_new", title: "Rain radar", units: "Precipitation", range: "Light  Moderate  Heavy", colors: "#85d7ff, #32c48d, #ffe066, #ff7b54, #d7263d" },
  clouds: { path: "clouds_new", title: "Cloud cover", units: "%", range: "0%  50%  100%", colors: "#e8f1f8, #8fa8ba, #33495f" },
  humidity: { path: "humidity_new", title: "Relative humidity", units: "%", range: "0%  50%  100%", colors: "#fff7bc, #7fcdbb, #2c7fb8" },
  pressure: { path: "pressure_new", title: "Pressure", units: "hPa", range: "980  1013  1040", colors: "#313695, #74add1, #ffffbf, #f46d43, #a50026" },
  wind: { path: "wind_new", title: "Wind speed", units: "m/s", range: "Calm  10  30+", colors: "#ffffcc, #a1dab4, #41b6c4, #225ea8" },
  satellite: { path: "satellite", title: "Satellite imagery", units: "Visible imagery", range: "Natural color", colors: "#273746, #718c6a, #d5c7a1" }
};

function mapApiPath(path) {
  return `${apiBase}/map/${path}/{z}/{x}/{y}.png`;
}

function updateMapMessage(message = "") {
  const element = document.getElementById("mapLayerMessage");
  if (!element) return;
  element.textContent = message;
  element.hidden = !message;
}

function updateMapLegend() {
  const element = document.getElementById("mapLegend");
  const definition = mapLayerDefinitions[mapMode];
  if (!element || !definition) return;
  element.innerHTML = `<strong>${definition.title}</strong><span>${definition.units}</span><div class="map-legend-scale" style="background: linear-gradient(90deg, ${definition.colors});"></div><div class="map-legend-labels"><span>${definition.range.split("  ")[0]}</span><span>${definition.range.split("  ").at(-1)}</span></div>`;
}

function updateMapInfo(data) {
  const card = document.getElementById("mapCityCard");
  if (!card) return;
  const localTime = formatCityDateTime(new Date(), data, { hour: "2-digit", minute: "2-digit" });
  card.innerHTML = `<strong>${escapeHtml(data.name || "Selected location")}</strong><span>${Number(data.coord.lat).toFixed(3)}, ${Number(data.coord.lon).toFixed(3)}</span><span>${escapeHtml(cityTimezoneLabel(data))}</span><small>Local time ${localTime}</small>`;
}

function refreshMapLayer(mode) {
  if (!mapLayerProviderReady && mode !== "satellite") return;
  const layer = mapLayers[mode];
  if (!layer) return;
  layer.setUrl(`${mapApiPath(mapLayerDefinitions[mode].path)}?refresh=${Date.now()}`);
}

function configureMapLayer(layer, mode) {
  layer.on("loading", () => {
    if (mode === mapMode) updateMapMessage(`Loading ${mapLayerDefinitions[mode].title.toLowerCase()} layer...`);
  });
  layer.on("load", () => {
    if (mode === mapMode) updateMapMessage();
  });
  layer.on("tileerror", () => {
    if (mode === mapMode) updateMapMessage(`${mapLayerDefinitions[mode].title} layer is temporarily unavailable.`);
  });
  return layer;
}

async function renderMap(data) {
  const lat = Number(data.coord.lat);
  const lon = Number(data.coord.lon);
  const location = data.name || "Selected location";
  let status = {};
  try {
    status = await fetchJson(`${apiBase}/status`);
  } catch (error) {
    console.warn("Map provider status unavailable:", error);
  }
  mapLayerProviderReady = Boolean(status.mapTilesEnabled);
  document.querySelectorAll(".map-mode").forEach(button => {
    const unavailable = button.dataset.mapMode !== "satellite" && !mapLayerProviderReady;
    button.disabled = unavailable;
    button.setAttribute("aria-disabled", String(unavailable));
    button.title = unavailable ? "Weather map provider is not configured." : "";
  });
  if (!mapLayerProviderReady && mapMode !== "satellite") mapMode = "satellite";

  if (!weatherMap) {
    const mapElement = document.getElementById("map");
    mapElement.innerHTML = "";
    weatherMap = L.map(mapElement).setView([lat, lon], 9);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap contributors" }).addTo(weatherMap);
    mapLayers = {
      temperature: configureMapLayer(L.tileLayer(mapApiPath("temp_new"), { opacity: 0.58 }), "temperature"),
      rain: configureMapLayer(L.tileLayer(mapApiPath("precipitation_new"), { opacity: 0.62 }), "rain"),
      clouds: configureMapLayer(L.tileLayer(mapApiPath("clouds_new"), { opacity: 0.55 }), "clouds"),
      humidity: configureMapLayer(L.tileLayer(mapApiPath("humidity_new"), { opacity: 0.55 }), "humidity"),
      pressure: configureMapLayer(L.tileLayer(mapApiPath("pressure_new"), { opacity: 0.55 }), "pressure"),
      wind: configureMapLayer(L.tileLayer(mapApiPath("wind_new"), { opacity: 0.58 }), "wind"),
      satellite: configureMapLayer(L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { attribution: "&copy; Esri", opacity: 0.88 }), "satellite")
    };
    mapLayers[mapMode].addTo(weatherMap);
    setMapOpacity(document.getElementById("mapOpacity")?.value || 60);
    const addMapControl = (id, className, position) => {
      const control = L.control({ position });
      control.onAdd = () => {
        const element = document.createElement("div");
        element.id = id;
        element.className = className;
        if (id === "mapLayerMessage") element.hidden = true;
        return element;
      };
      control.addTo(weatherMap);
    };
    addMapControl("mapCityCard", "map-city-card", "topleft");
    addMapControl("mapLegend", "map-legend", "bottomright");
    addMapControl("mapLayerMessage", "map-layer-message", "topright");
    updateMapLegend();
    document.querySelectorAll(".map-mode").forEach(button => {
      const active = button.dataset.mapMode === mapMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (!mapLayerProviderReady) updateMapMessage("Weather overlays are unavailable until a tile provider is configured. Satellite imagery remains available.");
    clearInterval(mapRefreshIntervals.radar);
    clearInterval(mapRefreshIntervals.weather);
    mapRefreshIntervals.radar = setInterval(() => refreshMapLayer("rain"), 300000);
    mapRefreshIntervals.weather = setInterval(() => Object.keys(mapLayers).filter(mode => mode !== "rain" && mode !== "satellite").forEach(refreshMapLayer), 600000);
  } else {
    weatherMap.setView([lat, lon], weatherMap.getZoom());
  }

  updateMapInfo(data);
  if (mapMarker) mapMarker.setLatLng([lat, lon]).setPopupContent(escapeHtml(location));
  else mapMarker = L.marker([lat, lon]).addTo(weatherMap).bindPopup(escapeHtml(location)).openPopup();
  setTimeout(() => weatherMap.invalidateSize(), 400);
}

function setMapMode(mode, button) {
  if (mode !== "satellite" && !mapLayerProviderReady) {
    updateMapMessage("This weather overlay is unavailable because a compatible map tile provider is not configured.");
    return;
  }
  if (!weatherMap || !mapLayers[mode]) {
    updateMapMessage("Search a location before selecting a weather layer.");
    return;
  }
  if (mapLayers[mapMode]) weatherMap.removeLayer(mapLayers[mapMode]);
  mapMode = mode;
  mapLayers[mapMode].addTo(weatherMap);
  document.querySelectorAll(".map-mode").forEach(item => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-pressed", String(active));
  });
  document.getElementById("radarTimestamp").textContent = `${mapLayerDefinitions[mode].title} · refreshes every ${mode === "rain" ? 5 : 10} min`;
  updateMapLegend();
  updateMapMessage(`Loading ${mapLayerDefinitions[mode].title.toLowerCase()} layer...`);
}

function setMapOpacity(value) {
  const opacity = Math.min(100, Math.max(10, Number(value))) / 100;
  const output = document.getElementById("mapOpacityValue");
  if (output) output.value = `${Math.round(opacity * 100)}%`;
  Object.values(mapLayers).forEach(layer => layer.setOpacity(opacity));
}

function renderNotifications() {
  const list = document.getElementById("notificationList");
  if (!list) return;
  if (!notificationMessages.length) {
    list.className = "empty-state";
    list.innerHTML = '<i class="fas fa-shield-heart"></i><p class="mb-0">No Active Weather Alerts</p>';
    document.getElementById("notificationCount").classList.add("d-none");
    return;
  }
  list.className = "notification-list";
  list.innerHTML = notificationMessages.map(alert => `
    <article class="notification-item alert-severity-${escapeHtml(alert.severity).toLowerCase()}">
      <div class="alert-item-title"><strong><i class="fas fa-triangle-exclamation me-2"></i>${escapeHtml(alert.event)}</strong><span class="alert-severity">${escapeHtml(alert.severity)}</span></div>
      <div class="alert-meta"><span><strong>Urgency:</strong> ${escapeHtml(alert.urgency)}</span><span><strong>Affected area:</strong> ${escapeHtml(alert.area)}</span></div>
      <div class="alert-meta"><span><strong>Issued:</strong> ${formatAlertTime(alert.start)}</span><span><strong>Expires:</strong> ${formatAlertTime(alert.end)}</span></div>
      <p>${escapeHtml(alert.description)}</p>
      <p class="mb-0"><strong>Safety instructions:</strong> ${escapeHtml(alert.instruction)}</p>
      <small class="d-block mt-2 opacity-75">Issuing authority: ${escapeHtml(alert.sender)} · NOAA/NWS</small>
    </article>`).join("");
  const badge = document.getElementById("notificationCount");
  badge.textContent = notificationMessages.length;
  badge.classList.remove("d-none");
}

function renderSafetyCards() {
  const container = document.getElementById("safetyCards");
  if (!container) return;
  container.innerHTML = safetyTopics.map((topic, index) => `
    <article class="safety-card">
      <div class="safety-card-head"><div class="safety-icon"><i class="fas ${topic.icon}"></i></div><div><h5>${topic.title}</h5><p>${topic.summary}</p></div></div>
      <div class="safety-phases">
        <div><span>Before</span><p>${topic.before}</p></div>
        <div><span>During</span><p>${topic.during}</p></div>
        <div><span>After</span><p>${topic.after}</p></div>
      </div>
      <button class="read-more" type="button" onclick="toggleSafetyDetails(${index}, this)">Read More <i class="fas fa-arrow-right"></i></button>
      <div class="safety-details" hidden>Practical action: keep a charged phone, know your local emergency number, and follow instructions from your local emergency-management authority. This guidance is general information, not a substitute for official instructions.</div>
    </article>`).join("");
}

function toggleSafetyDetails(index, button) {
  const details = button.previousElementSibling;
  const expanded = !details.hidden;
  details.hidden = expanded;
  button.innerHTML = expanded ? 'Read More <i class="fas fa-arrow-right"></i>' : 'Read Less <i class="fas fa-arrow-up"></i>';
}

function renderSafetyConditions(data) {
  const container = document.getElementById("safetyConditions");
  if (!container || !data) return;
  const rainProbability = nextForecastHours()[0]?.pop;
  const values = [
    ["Location", `${data.name}, ${data.sys?.country || ""}`, "fa-location-dot"],
    ["Temperature", formatTemperature(data.main.temp), "fa-temperature-half"],
    ["Feels like", formatTemperature(data.main.feels_like), "fa-person-rays"],
    ["Wind", `${windSpeedLabel(data.wind.speed)} ${getWindDirection(data.wind.deg)}`, "fa-wind"],
    ["Humidity", `${data.main.humidity}%`, "fa-droplet"],
    ["Precipitation", rainProbability === undefined ? "Unavailable" : `${Math.round(rainProbability * 100)}%`, "fa-cloud-rain"],
    ["Air quality", "See AQI page", "fa-lungs"],
    ["Alert status", "No active alerts available", "fa-shield-check"]
  ];
  container.className = "safety-conditions";
  container.innerHTML = values.map(([label, value, icon]) => `<div class="condition-item"><i class="fas ${icon}"></i><span>${label}</span><strong>${value}</strong></div>`).join("");
  document.getElementById("safetyUpdated").textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function renderNewsEmptyState() {
  const container = document.getElementById("newsContainer");
  if (!container) return;
  container.innerHTML = `
    <div class="news-empty">
      <i class="fas fa-satellite-dish"></i>
      <h5>No matching stories right now</h5>
      <p>Try another topic or check back later for verified weather, environmental and climate headlines.</p>
      <span class="data-attribution">No fabricated headlines · Last checked ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
    </div>`;
}

const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));

function apiNewsUrl() {
  return apiUrl("news", { category: newsCategory, q: document.getElementById("newsSearch")?.value.trim() || "" });
}

async function loadNews() {
  const container = document.getElementById("newsContainer");
  if (!container) return;
  container.innerHTML = '<div class="news-empty"><i class="fas fa-circle-notch fa-spin"></i><h5>Loading verified news</h5><p>Fetching current weather, environment, climate and science headlines.</p></div>';
  try {
    const data = await fetchJson(apiNewsUrl());
    if (!data.articles?.length) {
      renderNewsEmptyState();
      return;
    }
    container.innerHTML = data.articles.map((article) => `
      <article class="news-card">
        ${article.image ? `<img src="${escapeHtml(article.image)}" alt="" loading="lazy" class="news-image">` : ""}
        <div class="news-card-body">
          <span class="data-attribution">${escapeHtml(article.category)} · ${escapeHtml(article.source)} · Powered by GNews</span>
          <h5><a href="${escapeHtml(article.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.title)}</a></h5>
          <p>${escapeHtml(article.description || "Read the full verified story from the publisher.")}</p>
          <small class="opacity-75">${escapeHtml(formatPublishedAt(article.publishedAt))}</small>
        </div>
      </article>
    `).join("");
    container.querySelectorAll("img.news-image").forEach(image => {
      image.addEventListener("error", () => image.remove(), { once: true });
    });
  } catch (error) {
    console.warn("News unavailable:", error.message);
    container.innerHTML = `<div class="news-empty"><i class="fas fa-triangle-exclamation"></i><h5>Live news is temporarily unavailable</h5><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function formatPublishedAt(value) {
  if (!value) return "Publication time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Publication time unavailable";
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`;
  if (elapsedMinutes < 1440) return `${Math.floor(elapsedMinutes / 60)} hr ago`;
  if (elapsedMinutes < 10080) return `${Math.floor(elapsedMinutes / 1440)} days ago`;
  return date.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

async function setupNews() {
  renderNewsEmptyState();
  document.querySelectorAll("[data-news-category]").forEach((button) => {
    button.addEventListener("click", () => {
      newsCategory = button.dataset.newsCategory;
      document.querySelectorAll("[data-news-category]").forEach((item) => item.classList.toggle("active", item === button));
      loadNews();
    });
  });
  document.getElementById("newsSearch")?.addEventListener("input", () => {
    clearTimeout(newsSearchTimer);
    newsSearchTimer = setTimeout(loadNews, 450);
  });
  loadNews();
}

function toggleMapFullscreen() {
  const mapContainer = document.getElementById("map");
  if (!document.fullscreenElement) {
    mapContainer.requestFullscreen().catch(err => {
      alert(`Error attempting to enable full-screen mode: ${err.message}`);
    });
  } else {
    document.exitFullscreen();
  }
}

function updateCalculators(lat, lon) {
  const data = latestWeatherData;
  if (!data || data.coord.lat !== lat || data.coord.lon !== lon) return;
  const temp = data.main.temp;
  const humidity = data.main.humidity;

  // Dew Point Calculation (approximate)
  // Td = T - ((100 - RH)/5)
  const dewPoint = temp - ((100 - humidity) / 5);
  document.getElementById("dewPointValue").innerText = formatTemperature(dewPoint);

  // Heat Index (simplified)
  // Only valid for temp > 26C and humidity > 40%
  let heatIndex = temp;
  if (temp > 26 && humidity > 40) {
    heatIndex = -8.78469475556 + 1.61139411 * temp + 2.33854883889 * humidity +
                -0.14611605 * temp * humidity + -0.012308094 * Math.pow(temp, 2) +
                -0.0164248277778 * Math.pow(humidity, 2) + 0.002211732 * Math.pow(temp, 2) * humidity +
                0.00072546 * temp * Math.pow(humidity, 2) + -0.000003582 * Math.pow(temp, 2) * Math.pow(humidity, 2);
  }
  document.getElementById("heatIndexValue").innerText = formatTemperature(heatIndex);

  // Wind Chill Calculation (North American and UK standard)
  // Only valid for temp <= 10C and wind speed > 4.8 km/h
  const windKmh = data.wind.speed * 3.6;
  let windChill = temp;
  if (temp <= 10 && windKmh > 4.8) {
    windChill = 13.12 + 0.6215 * temp - 11.37 * Math.pow(windKmh, 0.16) + 0.3965 * temp * Math.pow(windKmh, 0.16);
  }
  document.getElementById("windChillValue").innerText = formatTemperature(windChill);
}
