import test from "node:test";
import assert from "node:assert/strict";
import { dedupeAlerts, normalizeAlert } from "../server/alert-system.js";

test("normalizeAlert converts provider payloads into the shared alert model", () => {
  const alert = normalizeAlert({
    id: "imd-001",
    event: "Heavy Rain Warning",
    severity: "Severe",
    urgency: "Immediate",
    area: "Bengaluru",
    effective: "2025-06-01T12:00:00Z",
    expires: "2025-06-01T18:00:00Z",
    sender: "IMD",
    description: "Heavy rainfall expected over the next few hours.",
    status: "active",
    lastUpdate: "2025-06-01T13:00:00Z"
  }, "IMD", "https://met.gov.in");

  assert.equal(alert.provider, "IMD");
  assert.equal(alert.hazardType, "rain");
  assert.equal(alert.severity, "Severe");
  assert.equal(alert.status, "active");
  assert.equal(alert.sourceUrl, "https://met.gov.in");
  assert.equal(alert.area, "Bengaluru");
});

test("dedupeAlerts keeps the newest record for the same provider alert fingerprint", () => {
  const alerts = [
    normalizeAlert({ id: "imd-001", event: "Heavy Rain Warning", severity: "Moderate", area: "Bengaluru", start: "2025-06-01T12:00:00Z", end: "2025-06-01T18:00:00Z", description: "Heavy rainfall." }, "IMD", "https://met.gov.in"),
    normalizeAlert({ id: "imd-001", event: "Heavy Rain Warning", severity: "Severe", area: "Bengaluru", start: "2025-06-01T12:00:00Z", end: "2025-06-01T18:00:00Z", description: "Heavy rainfall.", lastUpdate: "2025-06-01T13:30:00Z" }, "IMD", "https://met.gov.in")
  ];

  const deduped = dedupeAlerts(alerts);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].severity, "Severe");
});
