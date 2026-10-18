import test from "node:test";
import assert from "node:assert/strict";
import {
  MAP_LAYER_DEFINITIONS,
  createMapState,
  normalizeRadarFrames,
  radarTileUrl,
  weatherColor
} from "../js/core/weather-map.js";

test("map layer selectors keep independent basemap and weather-overlay state", () => {
  const state = createMapState();
  state.setOverlay("humidity");
  state.setBasemap("terrain");
  state.setOverlay("wind");
  assert.equal(state.overlay, "wind");
  assert.equal(state.basemap, "terrain");
  assert.deepEqual(
    ["temperature", "precipitation", "clouds", "humidity", "pressure", "wind"].map(key => MAP_LAYER_DEFINITIONS[key].field),
    ["temperature", "precipitation", "clouds", "humidity", "pressure", "wind"]
  );
  assert.throws(() => state.setOverlay("not-a-layer"), RangeError);
  assert.throws(() => state.setBasemap("weather"), RangeError);
});

test("weather legends use layer-specific fields, units, and colors", () => {
  assert.equal(MAP_LAYER_DEFINITIONS.temperature.units, "°C");
  assert.equal(MAP_LAYER_DEFINITIONS.humidity.units, "%");
  assert.equal(MAP_LAYER_DEFINITIONS.pressure.units, "hPa");
  assert.match(MAP_LAYER_DEFINITIONS.wind.units, /km\/h/);
  assert.notEqual(weatherColor(MAP_LAYER_DEFINITIONS.temperature, 0), weatherColor(MAP_LAYER_DEFINITIONS.humidity, 0));
  assert.equal(weatherColor(MAP_LAYER_DEFINITIONS.pressure, Number.NaN), null);
});

test("radar timeline accepts only validated available past frames and advances among them", () => {
  const now = Math.floor(Date.now() / 1000);
  const frames = normalizeRadarFrames([
    { time: now - 600, path: "/v2/radar/frame-older" },
    { time: now - 300, path: "/v2/radar/frame-newer" },
    { time: now + 300, path: "/v2/radar/future" },
    { time: now - 120, path: "/invalid/frame" },
    { time: "unknown", path: "/v2/radar/invalid-time" }
  ]);
  const state = createMapState();
  state.setFrames(frames);
  assert.equal(state.frameIndex, 1);
  assert.equal(state.frames.length, 2);
  assert.equal(state.stepFrame(-1).path, "/v2/radar/frame-older");
  assert.equal(state.stepFrame(1).path, "/v2/radar/frame-newer");
  assert.equal(state.setFrameIndex(100).path, "/v2/radar/frame-newer");
  assert.equal(state.setPlaying(true), true);
  assert.equal(state.setPlaying(false), false);
});

test("radar timeline handles missing data and builds frame tiles from live metadata", () => {
  const state = createMapState();
  assert.deepEqual(state.setFrames(null), []);
  assert.equal(state.stepFrame(1), null);
  assert.equal(state.setPlaying(true), false);
  const frame = { time: 1, path: "/v2/radar/abc123" };
  assert.equal(
    radarTileUrl("https://tilecache.rainviewer.com", frame, 7, 42, 63),
    "https://tilecache.rainviewer.com/v2/radar/abc123/256/7/42/63/2/1_1.png"
  );
  assert.throws(() => radarTileUrl("https://attacker.example/path", frame), TypeError);
  assert.throws(() => radarTileUrl("https://tilecache.rainviewer.com", { time: 1, path: "/v2/radar/../secret" }), TypeError);
});
