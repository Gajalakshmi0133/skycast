import { createHttpClient } from "../../js/core/http.js";
import { weatherApi } from "../../server/provider-api.js";

export function onRequest({ request, env }) {
  if (request.method !== "GET") {
    return Response.json({ cod: 405, message: "Method not allowed." }, {
      status: 405,
      headers: { allow: "GET", "cache-control": "no-store" }
    });
  }
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const client = createHttpClient({
    timeoutMs: Number(env.UPSTREAM_TIMEOUT_MS) || 12_000,
    maxRetries: Number(env.UPSTREAM_MAX_RETRIES) || 2,
    backoffBaseMs: Number(env.UPSTREAM_BACKOFF_BASE_MS) || 400
  });
  return weatherApi(params, env, { httpClient: client, isProduction: true });
}
