import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT } from "./config.js";
import {
  collectAlertsForLocation as collectAlerts,
  dedupeAlerts,
  fetchImdDistrictWarnings,
  mergeProviderPayloads,
  normalizeAlert
} from "../js/core/alerts.js";

export { dedupeAlerts, fetchImdDistrictWarnings, mergeProviderPayloads, normalizeAlert };

const STORE_DIR = join(PROJECT_ROOT, "data");
const STORE_PATH = join(STORE_DIR, "alert-store.json");

function ensureStore() {
  mkdirSync(STORE_DIR, { recursive: true });
  if (!existsSync(STORE_PATH)) {
    writeFileSync(STORE_PATH, JSON.stringify({ alerts: [], history: [], updatedAt: null }, null, 2), "utf8");
  }
}

function readStore() {
  ensureStore();
  try {
    return JSON.parse(readFileSync(STORE_PATH, "utf8"));
  } catch {
    return { alerts: [], history: [], updatedAt: null };
  }
}

function writeStore(store) {
  ensureStore();
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

export function saveAlertSnapshot(alerts, metadata = {}) {
  const store = readStore();
  const list = dedupeAlerts(alerts);
  store.alerts = list;
  store.updatedAt = new Date().toISOString();
  store.metadata = { ...store.metadata, ...metadata };
  store.history = [...list.map(alert => ({ ...alert, storedAt: new Date().toISOString() })), ...store.history].slice(0, 400);
  writeStore(store);
  return list;
}

export function loadAlertSnapshot() {
  const store = readStore();
  return {
    alerts: Array.isArray(store.alerts) ? store.alerts : [],
    history: Array.isArray(store.history) ? store.history : [],
    updatedAt: store.updatedAt || null,
    metadata: store.metadata || {}
  };
}

export async function collectAlertsForLocation(options = {}) {
  const result = await collectAlerts(options);
  saveAlertSnapshot(result.snapshot, {
    lat: options.lat,
    lon: options.lon,
    alertCount: result.snapshot.length,
    activeCount: result.meta.active,
    providerCount: new Set(result.snapshot.map(alert => alert.provider)).size
  });
  const { snapshot, ...response } = result;
  return response;
}
