# 🌤️ SkyCast – Responsive Weather Forecast Website

SkyCast is a mobile-friendly weather web app for **current conditions**, forecasts, air quality, news and interactive weather maps. The static HTML/CSS/JavaScript frontend can be served by the bundled Node.js HTTP server or Cloudflare Pages, with provider credentials kept server-side.

---

---

## ✨ Features

- 🔍 **City-based weather search**: Get weather info for any city worldwide.
- 🌡️ **Real-time conditions**: Current temperature, pressure, wind, and humidity.
- 🗓️ **Forecast Studio**: Step through the next 24 hourly forecast points and review the seven-day outlook.
- 📈 **Atmospheric analytics**: Interactive charts for forecast temperature, precipitation chance, humidity, dew point, wind, wind direction and pressure, with CSV export.
- 🗺️ **Interactive weather maps**: Leaflet maps with configured live weather overlays, layer legends and opacity control.
- ⭐ **City comparison**: Compare current conditions across saved cities.
- 🌤️ **Transparent daily guidance**: Clearly marked heuristic suggestions based on current conditions and forecast values.
- 🔒 **Location privacy**: Startup uses the default city; location permission is requested only after choosing the current-location control.
- 🔗 **Deep Linking**: Shareable URLs that load specific city weather on open.
- 🎨 **Modern UI**: Gradient background and dark purple-themed cards with Bootstrap 5.
- ⚡ **Animations**: Smooth entrance effects using Animate.css.

---

## 🚀 Technologies Used

- **Frontend**: HTML5, CSS3, JavaScript (ES6)
- **Framework**: Bootstrap 5
- **Charts**: Chart.js
- **Maps**: Leaflet with model-based temperature, cloud, humidity, pressure, wind and precipitation-estimate fields; NASA GIBS satellite imagery; independent street, terrain and satellite basemaps
- **Animations**: Animate.css
- **Icons**: Font Awesome + Weather Icons
- **API**: OpenWeather current conditions, Open-Meteo model grids and forecasts, NASA GIBS satellite imagery, GNews articles

---

## 📂 Project Structure

```
skycast/
├── index.html          # Main landing page
├── css/
│   └── style.css       # Custom styling
├── js/
│   ├── script.js       # Core UI logic and same-origin API calls
│   └── core/
│       ├── alerts.js      # Runtime-neutral official alert processing
│       └── weather-map.js # Map layer state and radar frame utilities
├── functions/
│   └── api/            # Cloudflare Pages Functions; provider keys stay server-side
├── scripts/
│   └── build.mjs       # Static Pages output and build-time SEO URL configuration
├── server/
│   ├── index.js        # Static server and weather proxy routes
│   ├── config.js       # Node server environment configuration
│   └── alert-system.js # Node alert snapshot persistence
├── assets/             # Social preview, images and icons
├── LICENSE             # MIT License
└── ads.txt             # AdSense verification
```

---

## 🔧 Getting Started

### 1. Clone or Download

```bash
git clone https://github.com/yourusername/skycast.git
cd skycast
```

### 2. Configure providers

Copy `.env.example` to `.env`, then set `OPENWEATHER_API_KEY` for current
conditions, `GNEWS_API_KEY` for live news, and `OPEN_METEO_API_KEY` for map
weather grids. The map grid uses Open-Meteo's customer API because the free
service is restricted to non-commercial use. The Node server reads `.env` at
startup and forwards browser requests through same-origin API endpoints. No
provider key is sent to or included in browser code.
GNews results are requested in English and filtered to weather, environment,
climate and science topics. Never put provider keys in `index.html` or
client-side JavaScript.

The weather map requests an Open-Meteo customer API grid for temperature,
relative humidity, surface pressure, cloud cover, wind, and precipitation.
These are model-analysis estimates, not station observations; precipitation is
not radar. Configure a paid Open-Meteo API key for ad-supported deployment.
Open-Meteo data requires CC BY 4.0 attribution. The forecast studio and
analytics continue to label forecast data as forecasts; CSV downloads contain
forecast values only.

Official location-aware weather alerts use the NOAA/NWS active alerts API
through the server proxy. No browser key is required; the server sends the
configured `SKYCAST_CONTACT` value as its contact User-Agent. NOAA/NWS coverage
is for the United States; locations outside that coverage return no active
alerts rather than inferred or fabricated warnings. Alert responses are cached
for five minutes.

Weather Explorer's temperature, cloud, humidity, pressure, wind, and modeled
precipitation estimate layers are built from the map viewport's sampled
Open-Meteo grid. Wind particles follow the model's direction and speed. NASA
GIBS MODIS Terra corrected true-color satellite imagery is a daily product and
is not live geostationary cloud imagery. Street, terrain, and satellite
basemaps are independent from these weather layers.

The RainViewer public API terms currently allow personal and educational use
only, not this ad-supported site. Rain radar therefore remains disabled by
default, and no model precipitation is labeled or displayed as observed radar.
Use the separate precipitation estimate layer for modeled rainfall, or
integrate a commercial radar feed whose license and regional coverage include
the intended deployment.
After obtaining written permission that covers commercial use, set the
Cloudflare/Node secret `RAINVIEWER_COMMERCIAL_LICENSE_CONFIRMED=true` to enable
the integration. It reads current metadata dynamically, uses only returned
historical frames, checks the provider's coverage mask at the selected
location, and is constrained to RainViewer's documented maximum tile zoom of
7. Coverage varies by country, including India; the integration reports
unavailable coverage rather than substituting estimates. Do not enable this
setting without the required permission.

### 3. Run the App

```bash
npm run dev
```

Open the URL printed by the server and start searching. The bundled Node server
serves both the frontend and `/api/*` routes. If you prefer VS Code Go Live,
start `npm run dev` in a second terminal as well; the frontend automatically
uses the API on port 3000 and the server allows local cross-origin requests.
For a separate production frontend, set the `skycast-api-base` meta tag in
`index.html` to the backend API URL, including `/api`. If a provider is
unavailable, the UI shows a clear unavailable state instead of inventing data.

The version in `package.json` is the canonical application version. Both the
development server and production build inject it into the About page and app
footer. `404.html` is the custom not-found page for static deployments; the
Node server serves the same page with an HTTP 404 status.

The Privacy Policy describes the providers and integrations present in this
repository. Before publishing, the site owner must supply the monitored
privacy contact, legal controller details, hosting-log retention period, and
the active Google AdSense/consent settings. No analytics integration is
currently included in the application code.

### Ad placements

The weather dashboard uses the responsive horizontal slots `6405613516` and
`8270685252`, the desktop-only right rail `3227996156`, and the Multiplex slot
`5087872730`. The privacy and third-party license pages use the horizontal
slot; the 404 page does not load ads. `js/ads.js` loads the existing publisher
script once and queues each visible manual unit once. For a new eligible HTML
page, include the existing publisher meta tag, generated `<ins>` markup, and
`<script src="js/ads.js" defer></script>`; do not add another publisher loader
or inline `adsbygoogle.push()` call. Auto ads, if desired, must be configured
separately in the AdSense account, with placements reviewed to avoid excess
ad density.

### Deploy to Cloudflare Pages

SkyCast is a static HTML/CSS/JavaScript application with server-side API
endpoints; it does not use a frontend framework. Cloudflare Pages serves the
files produced by `npm run build` in `dist/`, and Pages Functions in
`functions/api/` provide same-origin `/api/*` routes. A separate Node.js server
is not needed on Cloudflare.

#### Cloudflare dashboard settings

1. Push the project to GitHub or GitLab. Confirm `.env` and `.dev.vars*` files
   are not tracked; `.gitignore` excludes them. If a real key was ever
   committed, revoke it with its provider before continuing.
2. In Cloudflare, open **Workers & Pages → Create application → Pages →
   Connect to Git** and select the repository.
   Use Git integration or Wrangler for deployment; Cloudflare's dashboard
   Direct Upload flow does not deploy Pages Functions.
3. Use these build settings:
   - **Framework preset:** None
   - **Production branch:** your default branch (for example, `main`)
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Root directory:** `/` (the repository root)
4. Before the first production deploy, configure the Pages project:
   - In **Settings → Builds → Environment variables**, set `SITE_URL` to
     `https://skycast.pages.dev` (or the exact custom domain you intend to use)
     for Production and Preview. The build replaces the SEO URL tokens in the
     canonical URL, social metadata, `robots.txt`, and `sitemap.xml`. If it is
     unset, local builds use `https://skycast.pages.dev`; Cloudflare builds use
     `CF_PAGES_URL` when available.
   - In **Settings → Variables and Secrets → Functions**, add these for the
     **Production** environment:
   - `OPENWEATHER_API_KEY` — add as an encrypted **Secret**. Required for
     current weather.
   - `OPEN_METEO_API_KEY` — add as an encrypted **Secret** from a paid
     Open-Meteo plan. Required for model-based weather map grids on this
     ad-supported site.
   - `RAINVIEWER_COMMERCIAL_LICENSE_CONFIRMED` — leave unset/false unless
     RainViewer has granted permission for this site's commercial use.
   - `GNEWS_API_KEY` — add as an encrypted **Secret**. Required for live news.
   - `SKYCAST_CONTACT` — add as a regular **Variable** with the real NOAA/NWS
     contact email you supplied. This is used in the upstream User-Agent.
   - `SITE_URL` — add as a regular **Variable** with the same canonical site
     URL so Pages Functions use the correct site identity.
5. Save the settings and trigger **Retry deployment** (or push a commit). Add
   the same provider secrets to **Preview** only if preview deployments should
   also access live weather and news.
6. Open the generated `*.pages.dev` URL. To use a custom domain, add it under
   **Custom domains** and update `SITE_URL` in the build and Functions
   environments to that exact HTTPS URL, then rebuild and redeploy.

The required production secrets are `OPENWEATHER_API_KEY`, `OPEN_METEO_API_KEY`,
and `GNEWS_API_KEY`;
the required regular production variables are `SKYCAST_CONTACT` and `SITE_URL`.
`UPSTREAM_TIMEOUT_MS`, `UPSTREAM_MAX_RETRIES`, and
`UPSTREAM_BACKOFF_BASE_MS` are optional regular Functions variables; Functions
have defaults. No `NODE_ENV`, `PORT`, API base URL, or CORS configuration is
required. The browser calls relative `/api/...` URLs on the Pages domain, so
weather/news requests are same-origin and do not require cross-origin CORS
headers. Never put secrets in `index.html`, `js/`, build output, or build
environment variables.

OpenWeather and GNews remain subject to their provider account access and
quotas. Open-Meteo and NASA GIBS are attributed in the map interface. Confirm
that all existing Open-Meteo integrations have the appropriate commercial
entitlement before monetizing the site. Official alerts use NOAA/NWS and are
only available in its service area. No fabricated weather tiles are generated.
Cloudflare Pages static asset requests are free, while Pages Function
invocations count toward the Workers Free daily quota (currently 100,000
requests per day); check the [current Cloudflare Functions pricing
documentation](https://developers.cloudflare.com/pages/functions/pricing/)
before launch.

#### Build and local Pages preview

```powershell
npm ci
npm run build
npx wrangler@latest pages dev dist
```

Wrangler loads local `.env` values for development convenience when that file
is present; it is ignored and must never be committed. The Node development server
remains available with `npm run dev`. To publish from a shell instead of Git
integration, run `npx wrangler pages deploy dist --project-name skycast` after
Cloudflare authentication and keep the repository-root `functions/` directory
available so Wrangler can include the API Functions.

#### Deployment verification

After deploying, visit `/api/status` and confirm the response reports
`"configured":true` and `"newsConfigured":true` without including either key.
Then load the dashboard, search a city, open Weather News, and switch map
layers. Missing credentials are reported as unavailable providers; set the
encrypted secrets and redeploy rather than adding keys to browser code.
Cloudflare's [Pages build
settings](https://developers.cloudflare.com/pages/configuration/build-configuration/)
and [Functions
guides](https://developers.cloudflare.com/pages/functions/) document the
platform behavior used by this configuration.

---

## ✅ Deployment checklist

Before launch, verify the following:

- Add a real `SKYCAST_CONTACT` value to the Cloudflare environment for NOAA/NWS requests.
- Keep API keys on the server only; never embed them in browser code.
- Review the privacy policy and third-party notices in [privacy-policy.html](privacy-policy.html) and [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
- Confirm the site loads without console errors and that all critical routes return expected HTTP status codes.

## ⚖️ License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.

---

## 🧑‍💻 Author

**Gajalakshmi**
[🔗 GitHub](https://github.com/gajalakshmi0133)
[🔗 LinkedIn](https://www.linkedin.com/in/gajalakshmi-k-201884283/)
