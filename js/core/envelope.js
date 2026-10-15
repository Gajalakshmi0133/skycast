/**
 * SkyCast - response envelope.
 *
 * Every API route, and every browser-side fallback call, wraps its payload in
 * this exact shape. One contract means the UI can render provenance honestly
 * for any provider without special-casing any of them:
 *
 *   { ok, data, meta: { source, dataType, updatedAt, cached, stale, ... } }
 *
 * `dataType` is deliberately explicit. SkyCast never presents a forecast as an
 * observation, and never calls delayed imagery "live".
 */

/**
 * How the underlying numbers came to exist. This drives the badge the user
 * sees, so the vocabulary is fixed here rather than invented per component.
 *
 * - observed      : a measurement, or an analysis of measurements, for now
 * - forecast      : a model prediction for a future time
 * - nowcast       : short-range extrapolation, minutes ahead
 * - near-real-time: observational product with a known, short publication lag
 * - delayed       : observational product with a material lag (hours+)
 * - climatology   : long-term statistics, not current conditions
 * - archive       : historical record, definitely not current conditions
 * - reference     : static reference data (coastlines, place names)
 */
export const DATA_TYPES = Object.freeze({
  observed: { label: "Observed", tone: "live" },
  forecast: { label: "Forecast", tone: "forecast" },
  nowcast: { label: "Nowcast", tone: "nowcast" },
  "near-real-time": { label: "Near real-time", tone: "near" },
  delayed: { label: "Delayed", tone: "delayed" },
  climatology: { label: "Climatology", tone: "muted" },
  archive: { label: "Archive", tone: "muted" },
  reference: { label: "Reference", tone: "muted" },
});

/** Human label for a data type, falling back to the raw key. */
export const dataTypeLabel = (dataType) => DATA_TYPES[dataType]?.label ?? String(dataType ?? "Unknown");

/** UI tone for a data type, used to colour the provenance badge. */
export const dataTypeTone = (dataType) => DATA_TYPES[dataType]?.tone ?? "muted";

/**
 * Build a successful envelope.
 *
 * @param {unknown} data
 * @param {object} meta
 * @param {string} meta.source - human readable provider name
 * @param {string} [meta.sourceUrl] - provider home or attribution link
 * @param {keyof typeof DATA_TYPES} meta.dataType
 * @param {string|number} [meta.updatedAt] - provider's own update time, if it publishes one
 * @param {string|number} [meta.observedAt] - time the data describes
 * @param {boolean} [meta.cached]
 * @param {boolean} [meta.stale]
 * @param {number} [meta.ageSeconds]
 * @param {string} [meta.attribution]
 * @param {string} [meta.notes]
 * @param {object} [meta.extra]
 */
export const ok = (data, meta = {}) => ({
  ok: true,
  data,
  meta: {
    source: meta.source ?? "Unknown",
    sourceUrl: meta.sourceUrl ?? null,
    dataType: meta.dataType ?? "observed",
    dataTypeLabel: dataTypeLabel(meta.dataType ?? "observed"),
    dataTypeTone: dataTypeTone(meta.dataType ?? "observed"),
    updatedAt: toIso(meta.updatedAt ?? meta.observedAt ?? null),
    observedAt: toIso(meta.observedAt ?? null),
    fetchedAt: toIso(meta.fetchedAt ?? Date.now()),
    cached: Boolean(meta.cached),
    stale: Boolean(meta.stale),
    ageSeconds: Number.isFinite(meta.ageSeconds) ? meta.ageSeconds : 0,
    attribution: meta.attribution ?? null,
    notes: meta.notes ?? null,
    ...(meta.extra ?? {}),
  },
});

/** Machine-readable failure codes so the client can react without parsing prose. */
export const ERROR_CODES = Object.freeze({
  BAD_REQUEST: "BAD_REQUEST",
  INVALID_COORDINATES: "INVALID_COORDINATES",
  NOT_FOUND: "NOT_FOUND",
  NOT_CONFIGURED: "NOT_CONFIGURED",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  RATE_LIMITED: "RATE_LIMITED",
  TIMEOUT: "TIMEOUT",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  INTERNAL: "INTERNAL",
});

/**
 * Build a failure envelope. Always paired with a real HTTP status so caches and
 * monitoring behave, but the body still describes the problem for the UI.
 *
 * @param {object} details
 * @param {string} details.code
 * @param {string} details.message - user-facing, already free of jargon
 * @param {string} [details.provider]
 * @param {boolean} [details.retryable]
 * @param {string} [details.detail] - technical detail for logs only
 */
export const fail = ({ code = ERROR_CODES.INTERNAL, message, provider = null, retryable = false, detail = null }) => ({
  ok: false,
  error: { code, message, provider, retryable, detail },
  meta: { fetchedAt: new Date().toISOString() },
});

/** Map an HttpError-ish object onto a failure envelope plus HTTP status. */
export const fromError = (error, provider = null) => {
  const status = Number(error?.status) || 0;
  const kind = error?.kind ?? "unknown";

  if (kind === "timeout") {
    return {
      status: 504,
      envelope: fail({
        code: ERROR_CODES.TIMEOUT,
        message: `${provider ?? "Provider"} did not respond in time.`,
        provider,
        retryable: true,
        detail: error.message,
      }),
    };
  }
  if (status === 429) {
    return {
      status: 429,
      envelope: fail({
        code: ERROR_CODES.RATE_LIMITED,
        message: `${provider ?? "Provider"} is rate limiting SkyCast. Data will resume shortly.`,
        provider,
        retryable: true,
        detail: error.message,
      }),
    };
  }
  if (status === 404) {
    return {
      status: 404,
      envelope: fail({
        code: ERROR_CODES.NOT_FOUND,
        message: `${provider ?? "Provider"} has no data for that location or time.`,
        provider,
        retryable: false,
        detail: error.message,
      }),
    };
  }
  if (status === 401 || status === 403) {
    return {
      status: 502,
      envelope: fail({
        code: ERROR_CODES.NOT_CONFIGURED,
        message: `${provider ?? "Provider"} rejected SkyCast's credentials. Check the API key in .env.`,
        provider,
        retryable: false,
        detail: error.message,
      }),
    };
  }
  return {
    status: 502,
    envelope: fail({
      code: ERROR_CODES.PROVIDER_UNAVAILABLE,
      message: `${provider ?? "Provider"} data is temporarily unavailable.`,
      provider,
      retryable: Boolean(error?.retryable),
      detail: error?.message ?? String(error),
    }),
  };
};

/** Normalise any date-ish value to an ISO string, or null. */
export function toIso(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    // Accept seconds or milliseconds since epoch.
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Report freshness in the words the user should see. Deliberately blunt: if the
 * age exceeds the freshness window the wording says so.
 *
 * @param {{ updatedAt?: string|null, observedAt?: string|null, stale?: boolean, dataType?: string }} meta
 * @param {number} [freshnessWindowSeconds]
 */
export const freshnessLabel = (meta, freshnessWindowSeconds = 3600) => {
  if (meta?.stale) return "Stale - provider unreachable";
  const reference = meta?.observedAt ?? meta?.updatedAt;
  if (!reference) return meta?.dataType === "forecast" ? "Forecast" : "Update time not published";

  const ageSeconds = Math.max(0, Math.round((Date.now() - new Date(reference).getTime()) / 1000));
  if (ageSeconds < 60) return "Updated just now";
  if (ageSeconds < 3600) return `Updated ${Math.round(ageSeconds / 60)} min ago`;
  if (ageSeconds < 86400) return `Updated ${Math.round(ageSeconds / 3600)} h ago`;
  if (ageSeconds > freshnessWindowSeconds * 4) return `Last available ${Math.round(ageSeconds / 3600)} h ago`;
  return `Updated ${Math.round(ageSeconds / 86400)} d ago`;
};
