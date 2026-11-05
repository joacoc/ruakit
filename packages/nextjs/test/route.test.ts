// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { afterEach, expect, it, vi } from "vitest";
import { createRouteHandler } from "../src/index.js";
import { createRouteHandler as createServerRouteHandler } from "@ruakit/nextjs/server";

vi.mock("server-only", () => ({}));

afterEach(() => vi.unstubAllEnvs());

const body = JSON.stringify({
  prompt: "Open billing",
  snapshot: { text: "Billing" },
});
const post = (init: RequestInit = {}) =>
  new Request("https://app.example/v1/plan", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" },
    ...init,
  });

it("adds the server key and streams the body without forwarding browser credentials", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("RUAKIT_API_KEY", "server-secret");
  vi.stubEnv("RUAKIT_SERVER_URL", "https://planner.example/base/");
  const controller = new AbortController();
  const request = post({
    signal: controller.signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer browser-controlled-key",
      Cookie: "session=private",
      Origin: "https://app.example",
    },
  });
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url, init) => {
      expect(String(url)).toBe("https://planner.example/base/plan");
      const upstream = new Request(url, init);
      expect(await upstream.text()).toBe(body);
      expect(upstream.headers.get("authorization")).toBe(
        "Bearer server-secret",
      );
      expect(upstream.headers.has("cookie")).toBe(false);
      expect(upstream.headers.has("origin")).toBe(false);
      expect(init).toMatchObject({
        signal: request.signal,
        cache: "no-store",
        redirect: "error",
      });
      return Response.json({ type: "clarify", message: "Which page?" });
    });
  const response = await createRouteHandler({ fetch: fetcher }).POST(request);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    type: "clarify",
    message: "Which page?",
  });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.has("authorization")).toBe(false);
  expect(fetcher).toHaveBeenCalledOnce();
});

it("allows local development without a key", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("RUAKIT_API_KEY", "");
  vi.stubEnv("RUAKIT_SERVER_URL", undefined);
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url, init) => {
      expect(String(url)).toBe("http://127.0.0.1:4320/v1/plan");
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      return Response.json({ type: "clarify", message: "Which page?" });
    });
  expect(
    (await createRouteHandler({ fetch: fetcher }).POST(post())).status,
  ).toBe(200);
});

it("resolves explicit configuration at request time and preserves upstream failures", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("RUAKIT_API_KEY", "wrong-env-key");
  vi.stubEnv("RUAKIT_SERVER_URL", "https://wrong.example");
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url, init) => {
      expect(String(url)).toBe("https://planner.example/plan");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer explicit-key",
      );
      return Response.json(
        { error: "Too many requests." },
        {
          status: 429,
          headers: { "Retry-After": "30", "Set-Cookie": "upstream=private" },
        },
      );
    });
  const handler = createRouteHandler({
    apiKey: "explicit-key",
    serverUrl: "https://planner.example",
    fetch: fetcher,
  });
  const response = await handler.POST(post());
  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({ error: "Too many requests." });
  expect(response.headers.get("retry-after")).toBe("30");
  expect(response.headers.has("set-cookie")).toBe(false);
});

it("requires the production key at request time and defaults to the hosted versioned API", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("RUAKIT_API_KEY", undefined);
  vi.stubEnv("RUAKIT_SERVER_URL", undefined);
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json({ type: "clarify", message: "Which page?" }),
    );
  const { POST } = createServerRouteHandler({ fetch: fetcher });
  expect((await POST(post())).status).toBe(503);
  expect(fetcher).not.toHaveBeenCalled();
  vi.stubEnv("RUAKIT_API_KEY", "key");
  expect((await POST(post())).status).toBe(200);
  expect(String(fetcher.mock.calls[0]![0])).toBe(
    "https://api.ruakit.com/v1/plan",
  );
  expect(
    new Headers(fetcher.mock.calls[0]![1]!.headers).get("authorization"),
  ).toBe("Bearer key");
});

it.each([
  "ftp://planner.example",
  "https://user:secret@planner.example",
  "https://planner.example?key=secret",
  "not-a-url",
])(
  "rejects invalid planner URL %s without making a request",
  async (serverUrl) => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await createRouteHandler({
      apiKey: "key",
      serverUrl,
      fetch: fetcher,
    }).POST(post());
    expect(response.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it("runs application authorization before forwarding or reading the body", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const authorize = vi.fn().mockResolvedValue(false);
  const { POST } = createRouteHandler({ authorize, fetch: fetcher });
  const request = post();
  expect((await POST(request)).status).toBe(401);
  expect(authorize).toHaveBeenCalledWith(request);
  expect(request.bodyUsed).toBe(false);
  authorize.mockResolvedValue(
    Response.json({ error: "Forbidden." }, { status: 403 }),
  );
  expect((await POST(post())).status).toBe(403);
  authorize.mockRejectedValue(new Error("private-session-detail"));
  const failed = await POST(post());
  expect(failed.status).toBe(500);
  expect(await failed.text()).not.toContain("private-session-detail");
  expect(fetcher).not.toHaveBeenCalled();
});

it("forwards authorized requests and passes cancellation upstream", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const controller = new AbortController();
  const request = post({ signal: controller.signal });
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (_url, init) => {
      started();
      return new Promise((_, reject) => {
        init!.signal!.addEventListener(
          "abort",
          () => reject(init!.signal!.reason),
          { once: true },
        );
      });
    });
  const pending = createRouteHandler({
    authorize: () => true,
    fetch: fetcher,
  }).POST(request);
  await began;
  controller.abort();
  expect((await pending).status).toBe(502);
  expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
});

it("does not buffer streamed responses or expose private network errors", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const stream = new ReadableStream<Uint8Array>();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(stream));
  const { POST } = createRouteHandler({ fetch: fetcher });
  expect((await POST(post())).body).toBe(stream);
  fetcher.mockRejectedValueOnce(new Error("request failed with server-secret"));
  const failed = await POST(post());
  expect(failed.status).toBe(502);
  expect(await failed.text()).not.toContain("server-secret");
});

it("rejects unsupported methods and non-JSON bodies without contacting the planner", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const { POST } = createRouteHandler({ fetch: fetcher });
  const method = await POST(new Request("https://app.example/v1/plan"));
  expect(method.status).toBe(405);
  expect(method.headers.get("allow")).toBe("POST");
  expect(
    (await POST(post({ headers: { "Content-Type": "text/plain" } }))).status,
  ).toBe(415);
  expect(fetcher).not.toHaveBeenCalled();
});
