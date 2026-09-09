/** Browser requests share the gateway's HttpOnly session; secrets never enter URLs. */
export function gatewayOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_TELLIGENCE_GATEWAY_URL;
  if (!configured) return "/api/telligence";
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("The configured gateway URL is invalid.");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  )
    throw new Error(
      "The configured gateway URL must use HTTPS without credentials, query parameters, or fragments.",
    );
  return url.href.replace(/\/$/, "");
}

export class GatewayError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export type GatewayRequestOptions = {
  method?: "GET" | "POST" | "DELETE" | "PATCH";
  body?: unknown;
  csrfToken?: string;
  signal?: AbortSignal;
};

export async function gatewayRequest<T>(
  path: string,
  options: GatewayRequestOptions = {},
): Promise<T> {
  if (!/^\/(?:v1|api\/v1)\/[a-zA-Z0-9/_-]+$/.test(path) || path.includes("..")) {
    throw new Error("Invalid gateway path.");
  }
  const method = options.method ?? "GET";
  const publicAuth = path === "/v1/auth/challenge" || path === "/v1/auth/verify";
  if (method !== "GET" && !publicAuth && !options.csrfToken) {
    throw new GatewayError("Sign in again before changing this project.", 401, "session_required");
  }
  const response = await fetch(`${gatewayOrigin()}${path}`, {
    method,
    credentials: "include",
    cache: "no-store",
    redirect: "error",
    headers: {
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.csrfToken ? { "X-CSRF-Token": options.csrfToken } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: options.signal,
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new GatewayError(
      "The compute service returned an unreadable response. Try again.",
      response.status,
    );
  }
  if (!response.ok) {
    const error = (payload as { error?: { message?: unknown; code?: unknown } })?.error;
    throw new GatewayError(
      typeof error?.message === "string"
        ? error.message
        : "The compute service could not complete this request. Try again.",
      response.status,
      typeof error?.code === "string" ? error.code : undefined,
    );
  }
  return payload as T;
}
