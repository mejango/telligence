// @vitest-environment node
import { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT } from "@/app/api/telligence/[...path]/route";
import { proxyGateway } from "@/lib/telligence/gatewayProxy.server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const site = "https://telligence.example";
const gateway = "https://gateway.example";
const project = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const session = "s".repeat(43);
const json = (value: unknown = { ok: true }, init?: ResponseInit) => Response.json(value, init);
const encode = (value: string) => new TextEncoder().encode(value);
function request(path: string, init: RequestInit = {}) {
  return new Request(`${site}/api/telligence${path}`, init);
}
function call(path: string, init: RequestInit = {}) {
  return proxyGateway(request(path, init), path.slice(1).split("/"));
}
function upstream() {
  return vi.mocked(fetch).mock.calls[0];
}
function sentHeaders() {
  return new Headers(upstream()[1]?.headers);
}

beforeEach(() => {
  vi.stubEnv("TELLIGENCE_GATEWAY_URL", gateway);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", site);
  vi.mocked(fetch).mockResolvedValue(json());
});
afterEach(() => vi.unstubAllEnvs());

describe("fixed Telligence gateway boundary", () => {
  it.each([
    ["/v1/config", "GET"],
    ["/v1/projects", "GET"],
    [`/v1/projects/${project}`, "GET"],
    ["/v1/auth/challenge", "POST"],
    ["/v1/auth/verify", "POST"],
    ["/v1/auth/session", "GET"],
    ["/v1/auth/logout", "POST"],
    ["/v1/projects/prepare", "POST"],
    ["/v1/projects", "POST"],
    [`/v1/projects/${project}/signer`, "POST"],
    [`/v1/projects/${project}/authentication/sync`, "POST"],
    [`/v1/projects/${project}/keys`, "GET"],
    [`/v1/projects/${project}/keys`, "POST"],
    [`/v1/projects/${project}/keys/${key}`, "DELETE"],
    ["/api/v1/models", "GET"],
    ["/api/v1/chat/completions", "POST"],
  ])("forwards only the supported %s %s operation", async (path, method) => {
    const response = await call(path, {
      method,
      headers: {
        Origin: site,
        "Content-Type": "application/json",
        Authorization: "Bearer tlg_secret",
      },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    expect(response.status).toBe(200);
    expect(String(upstream()[0])).toBe(`${gateway}${path}`);
    expect(upstream()[1]).toMatchObject({ method, redirect: "error", cache: "no-store" });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it.each([
    "/v1/prepare-signer",
    "/v1/projects/prepare/extra",
    "/v1/projects/not-a-uuid",
    "/v1/projects/not-a-uuid/signer",
    `/v1/projects/${project}/signer/extra`,
    `/v1/projects/${project}/authentication`,
    `/v1/projects/${project}/authentication/sync/extra`,
    `/v1/projects/${project}/authentication/rotate`,
    "/v1/config/",
    "/healthz",
    "/readyz",
    "/api/v1/embeddings",
    "/api/v1/chat/completions/extra",
    "/v1/%63onfig",
    "/v1//config",
    "/v1/../config",
    "/v1/projects/https:evil",
  ])("does not turn %s into an upstream request", async (path) => {
    expect((await call(path)).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["/v1/config", "POST"],
    ["/v1/projects", "DELETE"],
    ["/api/v1/models", "POST"],
    ["/v1/auth/session", "DELETE"],
    [`/v1/projects/${project}/keys/${key}`, "GET"],
    [`/v1/projects/${project}/signer`, "GET"],
    [`/v1/projects/${project}/signer`, "DELETE"],
    [`/v1/projects/${project}/authentication/sync`, "GET"],
    [`/v1/projects/${project}/authentication/sync`, "PATCH"],
    ["/v1/config", "HEAD"],
    ["/v1/config", "OPTIONS"],
    ["/v1/config", "PATCH"],
    ["/v1/config", "PUT"],
  ])("rejects unsupported method %s %s", async (path, method) => {
    expect((await call(path, { method })).status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("exports explicit denied methods so Next cannot infer HEAD or OPTIONS", async () => {
    for (const handler of [PATCH, PUT, HEAD, OPTIONS]) {
      expect((await handler(request("/v1/config"))).status).toBe(405);
    }
    for (const [handler, path, method] of [
      [GET, "/v1/config", "GET"],
      [POST, "/v1/auth/challenge", "POST"],
      [DELETE, `/v1/projects/${project}/keys/${key}`, "DELETE"],
    ] as const) {
      expect(
        (
          await handler(
            request(path, {
              method,
              headers: { Origin: site, "Content-Type": "application/json" },
              ...(method === "POST" ? { body: "{}" } : {}),
            }),
            { params: Promise.resolve({ path: path.slice(1).split("/") }) },
          )
        ).status,
      ).toBe(200);
    }
  });

  it.each(["?url=https://evil.example", "?", "#fragment"])(
    'rejects request suffix "%s"',
    async (suffix) => {
      const response = await proxyGateway(request(`/v1/config${suffix}`), ["v1", "config"]);
      expect(response.status).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    "",
    "http://gateway.example",
    "https://user:password@gateway.example",
    "https://gateway.example/v1",
    "https://gateway.example?",
    "https://gateway.example#",
    "https://gateway.example\\@evil.example",
    " https://gateway.example",
    "file:///tmp/gateway",
    "http://signer.railway.internal:8080",
    "http://gateway.railway.internal.evil.example:8080",
  ])("fails closed for invalid server gateway %s", async (value) => {
    vi.stubEnv("TELLIGENCE_GATEWAY_URL", value);
    const response = await call("/v1/config");
    expect(response.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain(value || "gateway.example");
  });

  it.each([
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://[::1]:8080",
    "http://gateway.railway.internal:8080",
    `${gateway}/`,
  ])("accepts a fixed local development or HTTPS origin %s", async (value) => {
    vi.stubEnv("TELLIGENCE_GATEWAY_URL", value);
    expect((await call("/v1/config")).status).toBe(200);
    expect(String(upstream()[0])).toBe(`${value.replace(/\/$/, "")}/v1/config`);
  });

  it.each([
    "",
    "http://public.example",
    "https://site.example/path",
    "https://user@site.example",
    "http://gateway.railway.internal:8080",
  ])("fails closed for invalid configured UI origin %s", async (value) => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", value);
    expect((await call("/v1/config")).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["https://evil.example", "null", `${site}/`, "http://telligence.example"])(
    "rejects a foreign or malformed browser Origin %s",
    async (origin) => {
      const response = await call("/v1/auth/challenge", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: "{}",
      });
      expect(response.status).toBe(403);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("does not manufacture an Origin for unauthenticated cross-site session requests", async () => {
    const cases: Record<string, string>[] = [
      {},
      { "Sec-Fetch-Site": "same-site" },
      { "Sec-Fetch-Site": "cross-site" },
    ];
    for (const headers of cases) {
      expect((await call("/v1/auth/session", { headers })).status).toBe(403);
    }
    expect(
      (
        await call("/v1/auth/challenge", {
          method: "POST",
          headers: { "Sec-Fetch-Site": "same-origin" },
        })
      ).status,
    ).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("binds ordinary same-origin browser session GETs to the configured UI origin", async () => {
    const response = await call("/v1/auth/session", {
      headers: {
        "Sec-Fetch-Site": "same-origin",
        Cookie: `unrelated=secret; telligence_session=${session}`,
      },
    });
    expect(response.status).toBe(200);
    expect(sentHeaders().get("origin")).toBe(site);
    expect(sentHeaders().get("cookie")).toBe(`telligence_session=${session}`);
  });

  it("forwards only session credentials and CSRF to creator routes", async () => {
    await call(`/v1/projects/${project}/keys`, {
      method: "POST",
      body: '{"name":"work"}',
      headers: {
        Origin: site,
        "Content-Type": "application/json",
        "X-CSRF-Token": "c".repeat(64),
        Cookie: `tracking=private; telligence_session=${session}; other=private`,
        Authorization: "Bearer inference-secret",
        "SIGN-IN-WITH-X": "provider-secret",
        "X-Forwarded-Host": "evil.example",
        "X-Forwarded-For": "1.2.3.4",
        "X-Signer-Secret": "private",
      },
    });
    expect(Object.fromEntries(sentHeaders())).toEqual({
      accept: "application/json",
      "content-type": "application/json",
      origin: site,
      cookie: `telligence_session=${session}`,
      "x-csrf-token": "c".repeat(64),
    });
    expect(new TextDecoder().decode(upstream()[1]?.body as Uint8Array)).toBe('{"name":"work"}');
  });

  it("does not send credentials on public reads or challenge requests", async () => {
    await call("/v1/projects", {
      headers: {
        Cookie: `telligence_session=${session}`,
        Authorization: "Bearer private",
        "X-CSRF-Token": "private",
      },
    });
    expect([...sentHeaders().keys()]).toEqual(["accept"]);
  });

  it("forwards only inference authorization and idempotency credentials without requiring browser origin", async () => {
    await call("/api/v1/chat/completions", {
      method: "POST",
      body: "{}",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer tlg_secret",
        "Idempotency-Key": "request-123",
        Cookie: `telligence_session=${session}`,
        "X-CSRF-Token": "private",
        "SIGN-IN-WITH-X": "private",
      },
    });
    expect(Object.fromEntries(sentHeaders())).toEqual({
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      authorization: "Bearer tlg_secret",
      "idempotency-key": "request-123",
    });
  });

  it("rejects ambiguous session cookies before forwarding", async () => {
    const response = await call("/v1/auth/session", {
      headers: {
        Origin: site,
        Cookie: `telligence_session=${session}; telligence_session=${session}`,
      },
    });
    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("scopes the one session cookie and strips all other upstream headers", async () => {
    const headers = new Headers({
      "X-Request-Id": project,
      Location: "https://evil.example",
      "Access-Control-Allow-Origin": "*",
      "Content-Length": "11",
      "X-Internal-Secret": "private",
    });
    headers.append(
      "Set-Cookie",
      `telligence_session=${session}; Path=/; Domain=gateway.example; Max-Age=3600; HttpOnly; SameSite=Strict`,
    );
    headers.append("Set-Cookie", "other=secret; HttpOnly; Path=/");
    vi.mocked(fetch).mockResolvedValue(json({ ok: true }, { headers }));
    const response = await call("/v1/auth/verify", {
      method: "POST",
      headers: { Origin: site, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(response.headers.getSetCookie()).toEqual([
      `telligence_session=${session}; Path=/api/telligence; HttpOnly; SameSite=Strict; Max-Age=3600; Secure`,
    ]);
    expect(response.headers.get("x-request-id")).toBe(project);
    for (const name of [
      "location",
      "access-control-allow-origin",
      "x-internal-secret",
      "content-length",
    ]) {
      expect(response.headers.get(name)).toBeNull();
    }
  });

  it("expires the same scoped cookie on logout and never accepts cookies from public routes", async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      json(
        {},
        {
          headers: {
            "Set-Cookie": "telligence_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict",
          },
        },
      ),
    );
    const response = await call("/v1/auth/logout", { method: "POST", headers: { Origin: site } });
    expect(response.headers.get("set-cookie")).toBe(
      "telligence_session=; Path=/api/telligence; HttpOnly; SameSite=Strict; Max-Age=0; Secure",
    );
    expect((await call("/v1/config")).headers.get("set-cookie")).toBeNull();
  });

  it("does not establish a browser session from a failed authentication response", async () => {
    vi.mocked(fetch).mockResolvedValue(
      json(
        { error: { code: "unauthorized" } },
        {
          status: 401,
          headers: {
            "Set-Cookie": `telligence_session=${session}; Max-Age=3600; HttpOnly; SameSite=Strict`,
          },
        },
      ),
    );
    const response = await call("/v1/auth/verify", {
      method: "POST",
      headers: { Origin: site, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it.each([undefined, "Basic private", "Bearer two secrets", `Bearer ${"s".repeat(513)}`])(
    "requires a bounded bearer token for inference",
    async (authorization) => {
      expect(
        (
          await call("/api/v1/models", {
            headers: authorization ? { Authorization: authorization } : {},
          })
        ).status,
      ).toBe(401);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("cancels a rejected request upload without awaiting its cancellation", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const req = new Request(`${site}/api/telligence/v1/auth/challenge`, {
      method: "POST",
      headers: { Origin: site, "Content-Type": "application/json", "Content-Length": "16385" },
      body: new ReadableStream({ cancel }),
      duplex: "half",
    } as RequestInit);
    expect((await proxyGateway(req, ["v1", "auth", "challenge"])).status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not follow or expose upstream redirects", async () => {
    const cancel = vi.fn();
    vi.mocked(fetch).mockResolvedValue(
      new Response(new ReadableStream({ cancel }), {
        status: 302,
        headers: { Location: "https://evil.example" },
      }),
    );
    const response = await call("/v1/config");
    expect(response.status).toBe(502);
    expect(response.headers.get("location")).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    [{ "Content-Type": "text/plain" }, "{}", 415],
    [{ "Content-Type": "application/json", "Content-Encoding": "gzip" }, "{}", 415],
    [{ "Content-Type": "application/json", "Content-Length": "NaN" }, "{}", 400],
    [{ "Content-Type": "application/json", "Content-Length": "16385" }, "{}", 413],
    [{ "Content-Type": "application/json" }, "x".repeat(16385), 413],
  ] as const)("rejects unsupported or oversized request bodies", async (headers, body, status) => {
    expect(
      (
        await call("/v1/auth/challenge", {
          method: "POST",
          headers: { ...headers, Origin: site },
          body,
        })
      ).status,
    ).toBe(status);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("bounds undeclared JSON response bodies and cancels excessive upstream data", async () => {
    const cancel = vi.fn();
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(1024 * 1024 + 1));
          },
          cancel,
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    expect((await call("/v1/config")).status).toBe(502);
    expect(cancel).toHaveBeenCalledOnce();
    expect(upstream()[1]?.signal?.aborted).toBe(true);
  });

  it("rejects HTML and unexpected event streams without exposing their bodies", async () => {
    for (const contentType of ["text/html", "text/event-stream"]) {
      vi.mocked(fetch).mockResolvedValue(
        new Response("private upstream error", { headers: { "Content-Type": contentType } }),
      );
      const response = await call("/v1/config");
      expect(response.status).toBe(502);
      expect(await response.text()).not.toContain("private upstream");
    }
  });
});

describe("bounded streaming and cancellation", () => {
  const inference = (signal?: AbortSignal) =>
    call("/api/v1/chat/completions", {
      method: "POST",
      body: '{"stream":true}',
      headers: { "Content-Type": "application/json", Authorization: "Bearer tlg_secret" },
      signal,
    });

  it("delivers SSE incrementally with backpressure and no buffered transcript", async () => {
    const cancel = vi.fn();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        new ReadableStream(
          {
            start(value) {
              controller = value;
            },
            cancel,
          },
          { highWaterMark: 0 },
        ),
        { headers: { "Content-Type": "text/event-stream" } },
      ),
    );
    const response = await inference();
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    const reader = response.body!.getReader();
    const first = reader.read();
    controller.enqueue(encode("data: first\n\n"));
    expect(await first).toEqual({ done: false, value: encode("data: first\n\n") });
    controller.enqueue(encode("data: [DONE]\n\n"));
    expect((await reader.read()).value).toEqual(encode("data: [DONE]\n\n"));
    controller.close();
    expect((await reader.read()).done).toBe(true);
    expect(cancel).not.toHaveBeenCalled();
    expect(upstream()[1]?.signal?.aborted).toBe(false);
  });

  it("propagates downstream cancellation to upstream without waiting on hostile cancellation", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    vi.mocked(fetch).mockResolvedValue(
      new Response(new ReadableStream({ cancel }), {
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    const response = await inference();
    await response.body!.cancel("user stopped");
    expect(cancel).toHaveBeenCalledOnce();
    expect(upstream()[1]?.signal?.aborted).toBe(true);
  });

  it("aborts an active stream on client disconnect and errors an outstanding read", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    vi.mocked(fetch).mockResolvedValue(
      new Response(new ReadableStream({ cancel }), {
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    const response = await inference(controller.signal);
    const read = response.body!.getReader().read();
    const observed = expect(read).rejects.toThrow();
    controller.abort();
    await observed;
    expect(cancel).toHaveBeenCalledOnce();
    expect(upstream()[1]?.signal?.aborted).toBe(true);
  });

  it("refuses an already aborted request without initiating an upstream call", async () => {
    expect((await inference(AbortSignal.abort())).status).toBe(499);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("times out stalled upstream connection and cancels a late response", async () => {
    vi.useFakeTimers();
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const response = call("/v1/config");
    await vi.advanceTimersByTimeAsync(15_001);
    expect((await response).status).toBe(504);
    expect(upstream()[1]?.signal?.aborted).toBe(true);
    const cancel = vi.fn();
    resolve(new Response(new ReadableStream({ cancel })));
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("times out stalled incoming bodies and cancels their reader", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const req = new Request(`${site}/api/telligence/v1/auth/challenge`, {
      method: "POST",
      headers: { Origin: site, "Content-Type": "application/json" },
      body: new ReadableStream({ cancel }),
      duplex: "half",
    } as RequestInit);
    const response = proxyGateway(req, ["v1", "auth", "challenge"]);
    await vi.advanceTimersByTimeAsync(15_001);
    expect((await response).status).toBe(504);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows inference startup latency but bounds idle reads and aborts the upstream fetch", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    vi.mocked(fetch).mockResolvedValue(
      new Response(new ReadableStream({ cancel }), {
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    const response = await inference();
    const observed = expect(response.body!.getReader().read()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(upstream()[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(30_001);
    await observed;
    expect(cancel).toHaveBeenCalledOnce();
    expect(upstream()[1]?.signal?.aborted).toBe(true);
  });

  it("bounds total stream lifetime even when the consumer stops reading", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    vi.mocked(fetch).mockResolvedValue(
      new Response(new ReadableStream({ cancel }), {
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    const response = await inference();
    await vi.advanceTimersByTimeAsync(130_001);
    await expect(response.body!.getReader().read()).rejects.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
    expect(upstream()[1]?.signal?.aborted).toBe(true);
  });

  it("enforces the full stream byte budget", async () => {
    const cancel = vi.fn();
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1));
          },
          cancel,
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      ),
    );
    const response = await inference();
    await expect(response.body!.getReader().read()).rejects.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
    expect(upstream()[1]?.signal?.aborted).toBe(true);
  });
});

describe("project authentication mutation routes", () => {
  const routes = [
    [`/v1/projects/${project}/signer`, JSON.stringify({ preparationId: key })],
    [`/v1/projects/${project}/authentication/sync`, "{}"],
  ] as const;

  it.each(routes)(
    "forwards only creator-session credentials and bounded JSON for %s",
    async (path, body) => {
      const response = await call(path, {
        method: "POST",
        body,
        headers: {
          Origin: site,
          "Content-Type": "application/json",
          Cookie: `tracking=private; telligence_session=${session}`,
          "X-CSRF-Token": "c".repeat(64),
          Authorization: "Bearer inference-secret",
          "X-Signer-Secret": "private",
          "SIGN-IN-WITH-X": "provider-secret",
        },
      });
      expect(response.status).toBe(200);
      expect(String(upstream()[0])).toBe(`${gateway}${path}`);
      expect(Object.fromEntries(sentHeaders())).toEqual({
        accept: "application/json",
        "content-type": "application/json",
        origin: site,
        cookie: `telligence_session=${session}`,
        "x-csrf-token": "c".repeat(64),
      });
      expect(new TextDecoder().decode(upstream()[1]?.body as Uint8Array)).toBe(body);
    },
  );

  it.each(routes)(
    "requires exact browser origin and rejects malformed CSRF for %s",
    async (path, body) => {
      const cases: Record<string, string>[] = [
        { Origin: "https://evil.example" },
        { Origin: site, "X-CSRF-Token": "malformed" },
      ];
      for (const extra of cases) {
        const response = await call(path, {
          method: "POST",
          body,
          headers: {
            "Content-Type": "application/json",
            Cookie: `telligence_session=${session}`,
            ...extra,
          },
        });
        expect(response.status).toBe(extra.Origin === site ? 400 : 403);
      }
      expect(
        (
          await call(path, {
            method: "POST",
            body,
            headers: {
              "Content-Type": "application/json",
              "Sec-Fetch-Site": "same-origin",
              Cookie: `telligence_session=${session}`,
              "X-CSRF-Token": "c".repeat(64),
            },
          })
        ).status,
      ).toBe(403);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(routes)("requires JSON and retains the 16 KiB request cap for %s", async (path) => {
    expect((await call(path, { method: "POST", headers: { Origin: site } })).status).toBe(415);
    expect(
      (
        await call(path, {
          method: "POST",
          headers: { Origin: site, "Content-Type": "application/json" },
          body: JSON.stringify({ data: "x".repeat(16 * 1024) }),
        })
      ).status,
    ).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });
});
