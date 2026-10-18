export const MAP_LAYER_DEFINITIONS = Object.freeze({
  temperature: {
    title: "Temperature",
    units: "°C",
    range: "-20  0  20  40",
    colors: ["#313695", "#74add1", "#ffffbf", "#fdae61", "#d7191c"],
    field: "temperature"
  },
  rain: {
    title: "Rain radar",
    units: "Radar reflectivity",
    range: "Light  Moderate  Heavy",
    colors: ["#85d7ff", "#32c48d", "#ffe066", "#ff7b54", "#d7263d"],
    field: "radar"
  },
  precipitation: {
    title: "Precipitation estimate",
    units: "mm (model estimate)",
    range: "0  2  10  30+",
    colors: ["#e0f2fe", "#38bdf8", "#22c55e", "#facc15", "#ef4444"],
    field: "precipitation"
  },
  clouds: {
    title: "Cloud cover",
    units: "%",
    range: "0  25  50  75  100",
    colors: ["#f8fafc", "#cbd5e1", "#94a3b8", "#475569", "#1e293b"],
    field: "clouds"
  },
  humidity: {
    title: "Relative humidity",
    units: "%",
    range: "0  25  50  75  100",
    colors: ["#fff7bc", "#7fcdbb", "#41b6c4", "#2c7fb8", "#253494"],
    field: "humidity"
  },
  pressure: {
    title: "Surface pressure",
    units: "hPa",
    range: "960  990  1013  1030  1060",
    colors: ["#313695", "#74add1", "#ffffbf", "#f46d43", "#a50026"],
    field: "pressure"
  },
  wind: {
    title: "Wind speed",
    units: "km/h · direction shown by particles",
    range: "0  10  25  50  100+",
    colors: ["#ffffcc", "#a1dab4", "#41b6c4", "#225ea8", "#253494"],
    field: "wind"
  },
  satellite: {
    title: "Satellite imagery",
    units: "Daily MODIS true color",
    range: "Natural color",
    colors: ["#334155", "#94a3b8", "#e2e8f0"],
    field: "satellite"
  }
});

export function createMapState() {
  let overlay = "temperature";
  let basemap = "street";
  let opacity = 0.6;
  let frames = [];
  let frameIndex = -1;
  let playing = false;

  return {
    get overlay() { return overlay; },
    get basemap() { return basemap; },
    get opacity() { return opacity; },
    get frames() { return frames; },
    get frameIndex() { return frameIndex; },
    get playing() { return playing; },
    setOverlay(value) {
      if (!MAP_LAYER_DEFINITIONS[value]) throw new RangeError(`Unknown weather layer: ${value}`);
      overlay = value;
    },
    setBasemap(value) {
      if (!["street", "terrain", "satellite"].includes(value)) throw new RangeError(`Unknown basemap: ${value}`);
      basemap = value;
    },
    setOpacity(value) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) throw new TypeError("Map opacity must be a finite number.");
      opacity = Math.max(0.1, Math.min(1, parsed));
    },
    setFrames(value) {
      frames = normalizeRadarFrames(value);
      frameIndex = frames.length ? frames.length - 1 : -1;
      playing = false;
      return frames;
    },
    stepFrame(direction) {
      if (!frames.length) return null;
      const step = direction < 0 ? -1 : 1;
      frameIndex = (frameIndex + step + frames.length) % frames.length;
      return frames[frameIndex];
    },
    setFrameIndex(value) {
      if (!frames.length) return null;
      frameIndex = Math.max(0, Math.min(frames.length - 1, Math.trunc(Number(value))));
      return frames[frameIndex];
    },
    setPlaying(value) {
      playing = Boolean(value) && frames.length > 1;
      return playing;
    }
  };
}

export function normalizeRadarFrames(frames) {
  if (!Array.isArray(frames)) return [];
  return frames.filter(frame => Number.isInteger(Number(frame?.time))
    && Number(frame.time) <= Date.now() / 1000
    && /^\/v2\/radar\/[A-Za-z0-9_-]+$/.test(String(frame?.path || "")))
    .map(frame => ({ time: Number(frame.time), path: frame.path }))
    .sort((first, second) => first.time - second.time);
}

export function radarTileUrl(host, frame, zoom = "{z}", x = "{x}", y = "{y}") {
  const safeHost = String(host || "").replace(/\/+$/, "");
  if (!/^https:\/\/[A-Za-z0-9.-]+$/.test(safeHost)) throw new TypeError("Invalid radar tile host.");
  if (!normalizeRadarFrames([frame]).length) throw new TypeError("Invalid radar frame.");
  return `${safeHost}${frame.path}/256/${zoom}/${x}/${y}/2/1_1.png`;
}

export function weatherColor(definition, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const thresholds = {
    temperature: [-20, 0, 10, 20, 40],
    precipitation: [0, 0.5, 2, 10, 30],
    clouds: [0, 25, 50, 75, 100],
    humidity: [0, 25, 50, 75, 100],
    pressure: [960, 990, 1013, 1030, 1060],
    wind: [0, 10, 25, 50, 100]
  }[definition.field];
  if (!thresholds) return null;
  const index = thresholds.findIndex(limit => number <= limit);
  return definition.colors[Math.max(0, Math.min(definition.colors.length - 1, index < 0 ? definition.colors.length - 1 : index))];
}
