# Third-Party Licenses and Notices

SkyCast uses public data sources and open-source front-end libraries. This page summarizes the primary dependencies and their licensing terms. Review the upstream provider terms for any commercial or production deployment.

## Data providers

- Open-Meteo
  - Terms: https://open-meteo.com/en/terms
  - Weather-map data is model-derived and distributed under CC BY 4.0, with credit shown in the map interface.
  - The free API is non-commercial only. SkyCast's ad-supported deployment must use an Open-Meteo customer API subscription for weather-map data.
- GNews
  - Terms: https://gnews.io/terms
  - Used through the server-side proxy for filtered English weather, environmental, climate and science headlines.
- OpenStreetMap
  - License: Open Database License (ODbL) / CC BY-SA for map tiles and contributions
  - Street basemap service; attribution is displayed on the map.
- ESRI ArcGIS World Imagery
  - Terms: https://www.esri.com/en-us/legal/terms
  - Used for selectable terrain and satellite basemaps and subject to Esri service terms.
- NASA Global Imagery Browse Services (GIBS)
  - Documentation: https://nasa-gibs.github.io/gibs-api-docs/
  - Provides MODIS Terra corrected true-color satellite imagery. Daily imagery is delayed and is not a live geostationary cloud product.
  - NASA requests this acknowledgment: “We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS).”
- RainViewer Weather Radar API
  - API terms: https://www.rainviewer.com/api.html
  - The public API is for personal and educational use only. It is disabled by default because SkyCast is ad-supported.
  - Do not enable unless RainViewer grants permission covering the intended commercial deployment. When authorized, the map links to RainViewer and displays its attribution.

## Front-end libraries

- Bootstrap 5
  - License: MIT
  - Project page: https://getbootstrap.com/
- Chart.js
  - License: MIT
  - Project page: https://www.chartjs.org/
- Leaflet
  - License: BSD 2-Clause
  - Project page: https://leafletjs.com/
- Font Awesome
  - License: Icons are subject to Font Awesome Free license; the project is available under the Font Awesome Free license terms.
  - Project page: https://fontawesome.com/
- Animate.css
  - License: MIT
  - Project page: https://animate.style/
- Skycons
  - License: MIT
  - Project page: https://darkskyapp.github.io/skycons/
- Google Fonts
  - License: SIL Open Font License 1.1 (for the provided font files)
  - Project page: https://fonts.google.com/

## Project license

SkyCast is distributed under the MIT License. See [LICENSE](./LICENSE) for the full text.
