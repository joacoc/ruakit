// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import "server-only";

export interface RouteHandlerOptions {
  /** Server credential. Defaults to the server's RUAKIT_API_KEY. */
  apiKey?: string;
  /** API base URL (including /v1); appends /plan. Defaults to RUAKIT_SERVER_URL or the hosted/local API. */
  serverUrl?: string;
  /** Check the application's user session before forwarding. Return a Response to reject explicitly. */
  authorize?: (
    request: Request,
  ) => boolean | Response | Promise<boolean | Response>;
  fetch?: typeof globalThis.fetch;
}

export interface RouteHandlers {
  POST(request: Request): Promise<Response>;
}

function jsonError(message: string, status: number): Response {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

/** Forward App Router planning requests with a server-only API key. */
export function createRouteHandler(
  options: RouteHandlerOptions = {},
): RouteHandlers {
  return {
    async POST(request) {
      if (request.method !== "POST") {
        const response = jsonError("Method not allowed.", 405);
        response.headers.set("Allow", "POST");
        return response;
      }
      try {
        if (options.authorize) {
          const result = await options.authorize(request);
          if (result instanceof Response) return result;
          if (result !== true) return jsonError("Unauthorized.", 401);
        }
      } catch {
        return jsonError("RuaKit authorization failed.", 500);
      }
      if (
        request.headers
          .get("content-type")
          ?.split(";")[0]
          ?.trim()
          .toLowerCase() !== "application/json"
      ) {
        return jsonError("Expected application/json.", 415);
      }
      if (!request.body) return jsonError("Expected a request body.", 400);

      // Resolve configuration at request time so Next.js builds need no runtime secrets.
      const production = process.env.NODE_ENV === "production";
      const apiKey = (options.apiKey ?? process.env.RUAKIT_API_KEY)?.trim();
      if (production && !apiKey) {
        return jsonError("Set RUAKIT_API_KEY on the Next.js server.", 503);
      }
      const serverUrl =
        options.serverUrl ??
        process.env.RUAKIT_SERVER_URL ??
        (production ? "https://api.ruakit.com/v1" : "http://127.0.0.1:4320/v1");
      let endpoint: URL;
      try {
        if (!serverUrl) throw new Error();
        const base = new URL(serverUrl);
        if (
          !["http:", "https:"].includes(base.protocol) ||
          base.username ||
          base.password ||
          base.search ||
          base.hash
        ) {
          throw new Error();
        }
        base.pathname = `${base.pathname.replace(/\/+$/, "")}/plan`;
        endpoint = base;
      } catch {
        return jsonError(
          "Set a valid RUAKIT_SERVER_URL on the Next.js server.",
          503,
        );
      }

      try {
        const headers = new Headers({
          "Content-Type": "application/json",
          Accept: "application/json",
        });
        if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);
        const init: RequestInit & { duplex: "half" } = {
          method: "POST",
          headers,
          body: request.body,
          signal: request.signal,
          duplex: "half",
          cache: "no-store",
          redirect: "error",
        };
        const upstream = await (options.fetch ?? globalThis.fetch)(
          endpoint,
          init,
        );
        const responseHeaders = new Headers({
          "Content-Type":
            upstream.headers.get("content-type") ?? "application/json",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        const retryAfter = upstream.headers.get("retry-after");
        if (retryAfter) responseHeaders.set("Retry-After", retryAfter);
        return new Response(upstream.body, {
          status: upstream.status,
          headers: responseHeaders,
        });
      } catch {
        return jsonError("Unable to reach the RuaKit planner.", 502);
      }
    },
  };
}
