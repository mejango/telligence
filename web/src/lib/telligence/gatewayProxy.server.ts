import "server-only";
import { validatedGatewayOrigin, validatedSiteOrigin } from "./gatewayOrigin.server";

const PREFIX = "/api/telligence";
const SESSION_COOKIE = "telligence_session";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PROJECT_PATH = new RegExp(`^/v1/projects/${UUID}$`);
const KEYS_PATH = new RegExp(`^/v1/projects/${UUID}/keys$`);
const KEY_PATH = new RegExp(`^/v1/projects/${UUID}/keys/${UUID}$`);
const PROJECT_AUTHENTICATION_PATH = new RegExp(
  `^/v1/projects/${UUID}/(?:signer|authentication/sync)$`,
);
const REQUEST_BYTES = 16 * 1024;
const INFERENCE_REQUEST_BYTES = 128 * 1024;
const RESPONSE_BYTES = 1024 * 1024;
const INFERENCE_RESPONSE_BYTES = 8 * 1024 * 1024;
const READ_TIMEOUT_MS = 15_000;
const INFERENCE_READ_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
// The gateway's own inference deadline is 120 seconds. Leave it time to settle.
const INFERENCE_TIMEOUT_MS = 130_000;

type Operation = {
  methods: readonly string[];
  access: "public" | "auth" | "session" | "inference";
  body?: "required" | "optional";
};

class ProxyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const unavailable = () =>
  new ProxyError(502, "gateway_unavailable", "The compute service is unavailable.");
const timedOut = () =>
  new ProxyError(
    504,
    "gateway_timeout",
    "The compute service timed out. Check request status before retrying.",
  );
const disconnected = () => new ProxyError(499, "client_disconnected", "The request was cancelled.");

function errorResponse(error: unknown) {
  const safe = error instanceof ProxyError ? error : unavailable();
  return Response.json(
    { error: { code: safe.code, message: safe.message } },
    {
      status: safe.status,
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    },
  );
}

export function gatewayMethodNotAllowed() {
  return errorResponse(new ProxyError(405, "method_not_allowed", "This method is not supported."));
}

function operationFor(path: string): Operation | null {
  if (path === "/v1/config") return { methods: ["GET"], access: "public" };
  if (path === "/v1/projects")
    return { methods: ["GET", "POST"], access: "public", body: "required" };
  if (PROJECT_PATH.test(path)) return { methods: ["GET"], access: "public" };
  if (path === "/v1/auth/challenge" || path === "/v1/auth/verify") {
    return { methods: ["POST"], access: "auth", body: "required" };
  }
  if (path === "/v1/auth/session") return { methods: ["GET"], access: "session" };
  if (path === "/v1/auth/logout" || path === "/v1/projects/prepare") {
    return { methods: ["POST"], access: "session", body: "optional" };
  }
  if (PROJECT_AUTHENTICATION_PATH.test(path))
    return { methods: ["POST"], access: "session", body: "required" };
  if (KEYS_PATH.test(path))
    return { methods: ["GET", "POST"], access: "session", body: "required" };
  if (KEY_PATH.test(path)) return { methods: ["DELETE"], access: "session" };
  if (path === "/api/v1/models") return { methods: ["GET"], access: "inference" };
  if (path === "/api/v1/chat/completions") {
    return { methods: ["POST"], access: "inference", body: "required" };
  }
  return null;
}

function requestHeaders(req: Request, operation: Operation, siteOrigin: string) {
  const headers = new Headers({
    accept:
      operation.access === "inference" && req.method === "POST"
        ? "application/json, text/event-stream"
        : "application/json",
  });
  const origin = req.headers.get("origin");
  if (origin !== null && origin !== siteOrigin) {
    throw new ProxyError(403, "origin_forbidden", "This web origin is not permitted.");
  }
  const protectedRoute = operation.access === "auth" || operation.access === "session";
  const fetchSite = req.headers.get("sec-fetch-site");
  if (protectedRoute) {
    // Browsers usually omit Origin on same-origin GETs. Fetch Metadata provides
    // the browser-controlled same-origin assertion; Host/X-Forwarded-* never do.
    if (
      (!origin && !(req.method === "GET" && fetchSite === "same-origin")) ||
      (fetchSite !== null && fetchSite !== "same-origin")
    ) {
      throw new ProxyError(403, "origin_forbidden", "A permitted web origin is required.");
    }
    headers.set("origin", origin ?? siteOrigin);
  } else if (origin) headers.set("origin", origin);

  if (operation.access === "session") {
    const cookie = req.headers.get("cookie") ?? "";
    if (cookie.length > 8192)
      throw new ProxyError(400, "invalid_cookie", "Invalid session cookie.");
    const sessions = cookie
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${SESSION_COOKIE}=`));
    if (
      sessions.length > 1 ||
      (sessions[0] && !new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43}$`).test(sessions[0]))
    ) {
      throw new ProxyError(400, "invalid_cookie", "Invalid session cookie.");
    }
    if (sessions[0]) headers.set("cookie", sessions[0]);
    if (req.method !== "GET") {
      const csrf = req.headers.get("x-csrf-token");
      if (csrf !== null) {
        if (!/^[a-f0-9]{64}$/.test(csrf))
          throw new ProxyError(400, "invalid_csrf", "Invalid request token.");
        headers.set("x-csrf-token", csrf);
      }
    }
  }
  if (operation.access === "inference") {
    const authorization = req.headers.get("authorization");
    if (authorization === null || !/^Bearer [A-Za-z0-9_.-]{1,512}$/i.test(authorization)) {
      throw new ProxyError(401, "unauthorized", "Valid credentials are required.");
    }
    headers.set("authorization", authorization);
    if (req.method === "POST") {
      const idempotency = req.headers.get("idempotency-key");
      if (idempotency !== null) {
        if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(idempotency)) {
          throw new ProxyError(400, "invalid_idempotency", "Invalid idempotency key.");
        }
        headers.set("idempotency-key", idempotency);
      }
    }
  }
  return headers;
}

function deadline(requestSignal: AbortSignal, timeoutMs: number) {
  const controller = new AbortController();
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
      once: true,
    });
  });
  // Abort can occur between awaited operations. Its rejection stays observed.
  void aborted.catch(() => {});
  const onDisconnect = () => controller.abort(disconnected());
  requestSignal.addEventListener("abort", onDisconnect, { once: true });
  if (requestSignal.aborted) onDisconnect();
  const timer = setTimeout(() => controller.abort(timedOut()), timeoutMs);
  return {
    signal: controller.signal,
    abort: (reason: unknown) => controller.abort(reason),
    async wait<T>(promise: Promise<T>, readTimeoutMs?: number): Promise<T> {
      const idle = readTimeoutMs
        ? setTimeout(() => controller.abort(timedOut()), readTimeoutMs)
        : null;
      try {
        return await Promise.race([promise, aborted]);
      } finally {
        if (idle !== null) clearTimeout(idle);
      }
    },
    cleanup() {
      clearTimeout(timer);
      requestSignal.removeEventListener("abort", onDisconnect);
    },
  };
}
type Deadline = ReturnType<typeof deadline>;

// Never await provider-controlled cancellation: an unresponsive stream must not
// retain this request indefinitely. Both failures and cancellations are observed.
function cancelBody(body: ReadableStream<Uint8Array> | null) {
  try {
    void body?.cancel().catch(() => {});
  } catch {
    /* The reader may already own the stream. */
  }
}
function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    void reader.cancel().catch(() => {});
  } catch {
    /* It may already be closed. */
  }
}
function releaseReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    reader.releaseLock();
  } catch {
    /* An aborted read may settle on the next microtask. */
  }
}

function checkLength(headers: Headers, maxBytes: number, request = false) {
  const value = headers.get("content-length");
  if (value === null) return;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw request
      ? new ProxyError(400, "invalid_length", "Invalid request length.")
      : unavailable();
  }
  if (Number(value) > maxBytes) {
    throw request ? new ProxyError(413, "body_too_large", "Request is too large.") : unavailable();
  }
}

async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  budget: Deadline,
  request = false,
  readTimeoutMs = READ_TIMEOUT_MS,
) {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await budget.wait(reader.read(), readTimeoutMs);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw request
          ? new ProxyError(413, "body_too_large", "Request is too large.")
          : unavailable();
      }
      chunks.push(value);
    }
  } catch (error) {
    cancelReader(reader);
    throw error;
  } finally {
    releaseReader(reader);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function responseHeaders(upstream: Response, path: string, siteOrigin: string, streaming: boolean) {
  const headers = new Headers({
    "content-type": streaming
      ? "text/event-stream; charset=utf-8"
      : "application/json; charset=utf-8",
    "cache-control": "no-store, no-transform",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  if (streaming) headers.set("x-accel-buffering", "no");
  const requestId = upstream.headers.get("x-request-id");
  if (requestId && /^[A-Za-z0-9_-]{1,128}$/.test(requestId)) headers.set("x-request-id", requestId);
  if (upstream.ok && (path === "/v1/auth/verify" || path === "/v1/auth/logout")) {
    const cookies = upstream.headers
      .getSetCookie()
      .filter((value) => value.startsWith(`${SESSION_COOKIE}=`));
    if (cookies.length > 1) throw unavailable();
    if (cookies[0]) {
      const [pair, ...attributes] = cookies[0].split(";").map((value) => value.trim());
      const secret = pair.slice(SESSION_COOKIE.length + 1);
      const ages = attributes.filter((value) => /^max-age=/i.test(value));
      if (ages.length !== 1 || !/^max-age=\d{1,4}$/i.test(ages[0])) throw unavailable();
      const maxAge = Number(ages[0].slice(8));
      const logout = path === "/v1/auth/logout";
      if (
        (logout && (secret !== "" || maxAge !== 0)) ||
        (!logout && (!/^[A-Za-z0-9_-]{43}$/.test(secret) || maxAge < 1 || maxAge > 3600))
      )
        throw unavailable();
      // Keep the session host-only and confined to this proxy. Reconstruct the
      // attributes so upstream Domain/Path values cannot broaden its scope.
      headers.set(
        "set-cookie",
        `${SESSION_COOKIE}=${secret}; Path=${PREFIX}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${siteOrigin.startsWith("https:") ? "; Secure" : ""}`,
      );
    }
  }
  return headers;
}

function streamResponse(body: ReadableStream<Uint8Array>, budget: Deadline, maxBytes: number) {
  const reader = body.getReader();
  let total = 0;
  let finished = false;
  let stop: () => void;
  const finish = (cancel: boolean) => {
    if (finished) return;
    finished = true;
    budget.signal.removeEventListener("abort", stop);
    if (cancel) cancelReader(reader);
    releaseReader(reader);
    budget.cleanup();
  };
  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        stop = () => {
          if (finished) return;
          controller.error(budget.signal.reason);
          finish(true);
        };
        budget.signal.addEventListener("abort", stop, { once: true });
        if (budget.signal.aborted) stop();
      },
      async pull(controller) {
        try {
          const { done, value } = await budget.wait(reader.read(), INFERENCE_READ_TIMEOUT_MS);
          if (finished) return;
          if (done) {
            controller.close();
            finish(false);
            return;
          }
          total += value.byteLength;
          if (total > maxBytes) throw unavailable();
          controller.enqueue(value);
        } catch (error) {
          if (!finished) budget.abort(error);
        }
      },
      cancel() {
        // Finish before abort so cancelling a consumer never errors its closed stream.
        finish(true);
        budget.abort(disconnected());
      },
    },
    { highWaterMark: 0 },
  );
}

/** Fixed same-origin browser/API boundary, never a general-purpose HTTP proxy. */
export async function proxyGateway(req: Request, segments: readonly string[]): Promise<Response> {
  let budget: Deadline | undefined;
  let upstream: Response | undefined;
  let streamed = false;
  try {
    const url = new URL(req.url);
    if (
      url.search ||
      url.hash ||
      req.url.includes("?") ||
      req.url.includes("#") ||
      url.username ||
      url.password
    ) {
      throw new ProxyError(
        400,
        "unsupported_query",
        "Query parameters and URL credentials are not supported.",
      );
    }
    const path = `/${segments.join("/")}`;
    const operation = operationFor(path);
    if (!operation || url.pathname !== `${PREFIX}${path}`) {
      throw new ProxyError(404, "not_found", "Route not found.");
    }
    if (!operation.methods.includes(req.method)) return gatewayMethodNotAllowed();
    if (path === "/v1/projects" && req.method === "POST") operation.access = "session";
    let gatewayOrigin: string;
    let siteOrigin: string;
    try {
      gatewayOrigin = validatedGatewayOrigin();
      siteOrigin = validatedSiteOrigin();
    } catch {
      throw new ProxyError(503, "gateway_not_configured", "The compute service is not configured.");
    }
    const headers = requestHeaders(req, operation, siteOrigin);
    const inference = operation.access === "inference";
    budget = deadline(req.signal, inference ? INFERENCE_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
    if (budget.signal.aborted) throw budget.signal.reason;
    let body: Uint8Array<ArrayBuffer> | undefined;
    if (req.method === "POST" && (req.body || operation.body === "required")) {
      if (
        !/^application\/json(?:\s*;.*)?$/i.test(req.headers.get("content-type") ?? "") ||
        ![null, "identity"].includes(req.headers.get("content-encoding"))
      ) {
        throw new ProxyError(415, "content_type", "Use an uncompressed application/json body.");
      }
      const maxBytes = inference ? INFERENCE_REQUEST_BYTES : REQUEST_BYTES;
      checkLength(req.headers, maxBytes, true);
      body = await readBounded(req.body, maxBytes, budget, true);
      headers.set("content-type", "application/json");
    } else if (req.body || Number(req.headers.get("content-length") ?? 0) !== 0) {
      throw new ProxyError(400, "unexpected_body", "This request does not accept a body.");
    }
    if (budget.signal.aborted) throw budget.signal.reason;
    const pending = fetch(`${gatewayOrigin}${path}`, {
      method: req.method,
      headers,
      body,
      redirect: "error",
      cache: "no-store",
      signal: budget.signal,
    });
    const activeBudget = budget;
    void pending.then(
      (response) => {
        if (activeBudget.signal.aborted) cancelBody(response.body);
      },
      () => {},
    );
    upstream = await budget.wait(pending);
    if (
      upstream.status < 200 ||
      (upstream.status >= 300 && upstream.status < 400) ||
      upstream.status > 599
    )
      throw unavailable();
    const contentType = upstream.headers.get("content-type") ?? "";
    const streaming =
      path === "/api/v1/chat/completions" &&
      upstream.ok &&
      /^text\/event-stream(?:\s*;.*)?$/i.test(contentType);
    if (!streaming && !/^application\/json(?:\s*;.*)?$/i.test(contentType)) throw unavailable();
    const maxBytes = inference ? INFERENCE_RESPONSE_BYTES : RESPONSE_BYTES;
    checkLength(upstream.headers, maxBytes);
    const outgoingHeaders = responseHeaders(upstream, path, siteOrigin, streaming);
    if (streaming) {
      if (!upstream.body) throw unavailable();
      const response = new Response(streamResponse(upstream.body, budget, maxBytes), {
        status: upstream.status,
        headers: outgoingHeaders,
      });
      streamed = true;
      return response;
    }
    const bytes = await readBounded(
      upstream.body,
      maxBytes,
      budget,
      false,
      inference ? INFERENCE_READ_TIMEOUT_MS : READ_TIMEOUT_MS,
    );
    return new Response(bytes, { status: upstream.status, headers: outgoingHeaders });
  } catch (error) {
    budget?.abort(error);
    if (req.body && !req.body.locked) cancelBody(req.body);
    if (upstream?.body && !upstream.body.locked) cancelBody(upstream.body);
    return errorResponse(error);
  } finally {
    if (!streamed) budget?.cleanup();
  }
}
