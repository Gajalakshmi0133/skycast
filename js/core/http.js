/**
 * SkyCast - HTTP client.
 *
 * Isomorphic on purpose: the server imports this to talk to upstream providers
 * and the browser imports the very same file when it falls back to calling
 * keyless providers directly. It therefore uses only `fetch` and
 * `AbortController`, which exist in both runtimes.
 *
 * Responsibilities:
 *   - hard timeout on every request
 *   - retry transient failures (429, 5xx, network errors) with exponential
 *     backoff plus jitter, honouring `Retry-After` when a provider sends it
 *   - surface rate limits and provider outages as typed errors so callers can
 *     degrade gracefully instead of crashing
 */

/** Status codes worth retrying. Everything else is a caller mistake. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);

export const DEFAULT_TIMEOUT_MS = 12_000;
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_BACKOFF_BASE_MS = 400;
const MAX_BACKOFF_MS = 8_000;

/**
 * Error raised for any non-2xx upstream response or transport failure.
 * `kind` lets the UI pick the right message without string matching.
 */
export class HttpError extends Error {
  /**
   * @param {string} message
   * @param {object} details
   * @param {number} [details.status]
   * @param {string} details.url - always present so logs are actionable
   * @param {"timeout"|"network"|"http"|"parse"|"aborted"} details.kind
   * @param {boolean} [details.retryable]
   * @param {string} [details.body]
   * @param {number|null} [details.retryAfterMs] - provider-requested wait, if any
   */
  constructor(message, { status = 0, url, kind, retryable = false, body = "", retryAfterMs = null } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.kind = kind;
    this.retryable = retryable;
    this.body = body;
    this.retryAfterMs = retryAfterMs;
  }
}

/** True when an error means "the provider could not serve this right now". */
export const isRetryable = (error) =>
  error instanceof HttpError ? error.retryable : true;

/** Honours a provider's `Retry-After` header (seconds or HTTP date). */
export const parseRetryAfter = (headerValue) => {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_BACKOFF_MS);

  const dateMs = Date.parse(headerValue);
  if (Number.isFinite(dateMs)) return Math.min(Math.max(dateMs - Date.now(), 0), MAX_BACKOFF_MS);
  return null;
};

/** Exponential backoff with full jitter, capped so we never stall a request. */
export const backoffDelay = (attempt, baseMs = DEFAULT_BACKOFF_BASE_MS) => {
  const exponential = Math.min(baseMs * 2 ** attempt, MAX_BACKOFF_MS);
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Perform one attempt, translating every failure mode into an HttpError.
 * @returns {Promise<Response>}
 */
const attemptFetch = async (url, { init, timeoutMs }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Merge signals so a caller-supplied signal still works alongside our timeout.
    const signal = init?.signal ? composeSignals(init.signal, controller.signal) : controller.signal;
    const response = await fetch(url, { ...init, signal });

    if (!response.ok) {
      const body = await safeReadText(response);
      const status = response.status;
      throw new HttpError(`Upstream responded ${status} for ${url}`, {
        status,
        url,
        kind: "http",
        retryable: RETRYABLE_STATUS.has(status),
        body: body.slice(0, 500),
        retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
      });
    }
    return response;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error?.name === "AbortError") {
      // Distinguish "we aborted on timeout" from "the caller aborted".
      const timedOut = !init?.signal?.aborted;
      throw new HttpError(
        timedOut ? `Request timed out after ${timeoutMs}ms: ${url}` : `Request aborted: ${url}`,
        { url, kind: timedOut ? "timeout" : "aborted", retryable: timedOut },
      );
    }
    throw new HttpError(`Network failure for ${url}: ${error?.message ?? "unknown"}`, {
      url,
      kind: "network",
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }
};

/** Combine an external signal with our timeout signal without leaking either. */
const composeSignals = (external, timeout) => {
  if (typeof AbortSignal.any === "function") return AbortSignal.any([external, timeout]);
  const controller = new AbortController();
  const abort = () => controller.abort();
  external.addEventListener("abort", abort, { once: true });
  timeout.addEventListener("abort", abort, { once: true });
  return controller.signal;
};

const safeReadText = async (response) => {
  try {
    return await response.text();
  } catch {
    return "";
  }
};

/**
 * Fetch with retries. Returns the raw Response so callers can choose how to
 * decode it (JSON, text, binary imagery).
 *
 * @param {string} url
 * @param {object} [options]
 * @param {RequestInit} [options.init]
 * @param {Record<string,string>} [options.headers]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxRetries]
 * @param {number} [options.backoffBaseMs]
 * @returns {Promise<Response>}
 */
export const httpRequest = async (url, options = {}) => {
  const {
    init = {},
    headers = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    backoffBaseMs = DEFAULT_BACKOFF_BASE_MS,
  } = options;

  const requestInit = { ...init, headers: { ...headers, ...(init.headers ?? {}) } };
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await attemptFetch(url, { init: requestInit, timeoutMs });
    } catch (error) {
      lastError = error;
      if (!(error instanceof HttpError) || !error.retryable || attempt === maxRetries) throw error;

      const delay = error.retryAfterMs ?? backoffDelay(attempt, backoffBaseMs);
      await sleep(delay);
    }
  }
  throw lastError;
};

/** Decode a response body as JSON, converting malformed payloads into HttpError. */
export const readJson = async (response) => {
  const body = await safeReadText(response);
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(`Malformed JSON from ${response.url}`, {
      status: response.status,
      url: response.url,
      kind: "parse",
      retryable: false,
      body: body.slice(0, 300),
    });
  }
};

/** Fetch and decode JSON in one call. */
export const fetchJson = async (url, options = {}) => {
  const response = await httpRequest(url, { ...options, headers: { Accept: "application/json", ...(options.headers ?? {}) } });
  return readJson(response);
};

/** Fetch and decode text in one call. */
export const fetchText = async (url, options = {}) => {
  const response = await httpRequest(url, options);
  return response.text();
};

/** Fetch binary content (satellite imagery, tiles) as an ArrayBuffer. */
export const fetchBinary = async (url, options = {}) => {
  const response = await httpRequest(url, options);
  return response.arrayBuffer();
};

/**
 * Build a configured client. The server passes a User-Agent (browsers forbid
 * setting one), the browser passes nothing and inherits its own.
 *
 * @param {{ userAgent?: string, timeoutMs?: number, maxRetries?: number, backoffBaseMs?: number }} [defaults]
 */
export const createHttpClient = (defaults = {}) => {
  const baseHeaders = defaults.userAgent ? { "User-Agent": defaults.userAgent } : {};

  /** @param {string} url @param {object} [options] */
  const request = (url, options = {}) =>
    httpRequest(url, {
      timeoutMs: defaults.timeoutMs,
      maxRetries: defaults.maxRetries,
      backoffBaseMs: defaults.backoffBaseMs,
      ...options,
      headers: { ...baseHeaders, ...(options.headers ?? {}) },
    });

  return {
    request,
    /** @param {string} url @param {object} [options] */
    json: async (url, options = {}) => readJson(await request(url, { ...options, headers: { Accept: "application/json", ...(options?.headers ?? {}) } })),
    /** @param {string} url @param {object} [options] */
    text: async (url, options = {}) => (await request(url, options)).text(),
    /** @param {string} url @param {object} [options] */
    binary: async (url, options = {}) => (await request(url, options)).arrayBuffer(),
  };
};

/** Default client used by the browser fallback path. */
export const http = createHttpClient({});
