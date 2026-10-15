import { apiStatus } from "../../server/provider-api.js";

export function onRequest({ request, env }) {
  if (request.method !== "GET") {
    return Response.json({ message: "Method not allowed." }, {
      status: 405,
      headers: { allow: "GET", "cache-control": "no-store" }
    });
  }
  return Response.json(apiStatus(env), {
    headers: { "cache-control": "no-store" }
  });
}
