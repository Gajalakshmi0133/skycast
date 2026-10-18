const severityRank = {
  extreme: 5,
  severe: 4,
  moderate: 3,
  minor: 2,
  unknown: 1
};

const hazardKeywords = [
  "thunderstorm", "lightning", "tornado", "cyclone", "hurricane", "wind", "rain", "flood",
  "storm", "heat", "heatwave", "cold", "fog", "snow", "blizzard", "hail", "fire", "smoke"
];

function normalizeTimestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function stableFingerprint(alert) {
  return [alert.provider, alert.id || alert.event || "", alert.area || "", alert.start || "", alert.end || "", alert.hazardType || ""].join("|").toLowerCase();
}

function hazardFromText(event, description = "") {
  const haystack = `${event || ""} ${description || ""}`.toLowerCase();
  const match = hazardKeywords.find(keyword => haystack.includes(keyword));
  return match || "weather";
}

export function normalizeAlert(raw, provider, sourceUrl) {
  if (!raw || typeof raw !== "object") return null;
  const event = String(raw.event || raw.title || raw.name || "Weather alert").trim();
  const description = String(raw.description || raw.summary || raw.text || "").trim();
  const source = String(raw.sender || raw.source || provider || "unknown source").trim();
  const area = String(raw.area || raw.district || raw.location || raw.areaDesc || "Affected area unavailable").trim();
  const severity = String(raw.severity || raw.level || "Unknown").trim();
  const urgency = String(raw.urgency || raw.priority || "Unknown").trim();
  const issueTime = normalizeTimestamp(raw.start || raw.issued || raw.effective || raw.onset || raw.issueTime);
  const effectiveTime = normalizeTimestamp(raw.effective || raw.start || raw.onset || raw.issueTime);
  const expiryTime = normalizeTimestamp(raw.end || raw.expires || raw.expiry || raw.validUntil);
  const lastUpdate = normalizeTimestamp(raw.lastUpdate || raw.updated || raw.modified || raw.last_updated || issueTime || effectiveTime || expiryTime);
  const id = String(raw.id || raw.alertId || raw.identifier || `${provider}:${event}:${area}:${issueTime || Date.now()}`).trim();
  const status = raw.status === "cancelled" || raw.status === "expired" || (!expiryTime && raw.status === "inactive")
    ? "expired"
    : raw.status === "acknowledged" || raw.status === "resolved"
      ? "acknowledged"
      : "active";

  return {
    id,
    provider,
    sourceUrl: sourceUrl || raw.sourceUrl || "",
    hazardType: hazardFromText(event, description),
    event,
    severity: severity || "Unknown",
    urgency: urgency || "Unknown",
    area,
    issueTime,
    effectiveTime,
    expiryTime,
    lastUpdate,
    description,
    coordinates: raw.coordinates || raw.geo || raw.location || null,
    status,
    acknowledgementStatus: raw.acknowledgementStatus || raw.acknowledged || "pending",
    raw
  };
}

export function dedupeAlerts(alerts = []) {
  const map = new Map();
  for (const alert of alerts) {
    const key = stableFingerprint(alert);
    const existing = map.get(key);
    if (!existing || (alert.lastUpdate && (!existing.lastUpdate || new Date(alert.lastUpdate) > new Date(existing.lastUpdate)))) {
      map.set(key, alert);
    }
  }
  return [...map.values()].sort((first, second) => {
    const score = (severityRank[second.severity?.toLowerCase()] || 1) - (severityRank[first.severity?.toLowerCase()] || 1);
    if (score !== 0) return score;
    return new Date(second.lastUpdate || second.issueTime || 0) - new Date(first.lastUpdate || first.issueTime || 0);
  });
}

export function mergeProviderPayloads(rawAlerts, providerName) {
  const items = Array.isArray(rawAlerts) ? rawAlerts : [];
  return items
    .map(item => normalizeAlert(item, providerName, item.sourceUrl || item.url || item.source || ""))
    .filter(Boolean);
}

export async function fetchImdDistrictWarnings(client, lat, lon) {
  if (!client || typeof client.json !== "function") return [];
  const endpoints = [
    `https://api.imd.gov.in/api/warnings?lat=${lat}&lon=${lon}`,
    `https://api.imd.gov.in/warnings?lat=${lat}&lon=${lon}`,
    `https://api.imd.gov.in/v1/warnings?lat=${lat}&lon=${lon}`,
    `https://mausam.imd.gov.in/api/warnings?lat=${lat}&lon=${lon}`
  ];

  for (const endpoint of endpoints) {
    try {
      const data = await client.json(endpoint, { headers: { Accept: "application/json" } });
      const warnings = Array.isArray(data) ? data : Array.isArray(data.alerts) ? data.alerts : Array.isArray(data.warnings) ? data.warnings : [];
      if (!warnings.length) continue;
      return mergeProviderPayloads(warnings, "IMD");
    } catch {
      // IMD public feeds are optional and are not guaranteed to be exposed on every deployment.
    }
  }
  return [];
}

export async function collectAlertsForLocation({ lat, lon, fetchNws, fetchImd, client } = {}) {
  const warnings = [];
  const providers = [];
  if (typeof fetchNws === "function") {
    providers.push("NOAA/NWS");
    warnings.push(...(await fetchNws({ lat, lon, client })));
  }
  if (typeof fetchImd === "function") {
    providers.push("IMD");
    warnings.push(...(await fetchImd({ lat, lon, client })));
  }

  const deduped = dedupeAlerts(warnings.filter(Boolean));
  const activeAlerts = deduped.filter(alert => (alert.status || "active") !== "expired");
  const providerNames = deduped.length ? [...new Set(deduped.map(alert => alert.provider))] : providers;
  return {
    alerts: activeAlerts,
    provider: providerNames.length ? providerNames.join(" + ") : "No official provider",
    fetchedAt: new Date().toISOString(),
    meta: {
      active: activeAlerts.length,
      expired: deduped.filter(alert => alert.status === "expired").length,
      acknowledged: deduped.filter(alert => alert.status === "acknowledged").length,
      location: { lat, lon }
    },
    snapshot: deduped
  };
}
