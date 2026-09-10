import { KeyConsole } from "@/components/telligence/KeyConsole";
import { gatewayRequest } from "@/lib/telligence/api";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  address: "0x1111111111111111111111111111111111111111",
  session: null as null | { address: string; expiresAt: string; csrfToken: string },
  authenticate: vi.fn(),
  logout: vi.fn(),
  clearSession: vi.fn(),
}));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: mocks.address }) }));
vi.mock("@/hooks/useCreatorSession", () => ({
  useCreatorSession: () => ({
    session: mocks.session,
    authenticate: mocks.authenticate,
    logout: mocks.logout,
    clearSession: mocks.clearSession,
    loading: false,
    error: null,
  }),
}));
vi.mock("@/components/WalletButton", () => ({
  WalletConnectButton: () => <button>Connect wallet</button>,
}));

const key = {
  id: "key-1",
  prefix: "tlg_key-1",
  name: "Production",
  dailyLimitUsd: "5",
  createdAt: "2026-09-01T00:00:00Z",
  expiresAt: null,
  revokedAt: null,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const apiBaseUrl = "https://gateway-production-389d.up.railway.app/api/v1";
/** The console reads the gateway config by URL; key responses answer in order. */
function stubFetch(
  responses: (Response | Promise<Response>)[],
  config: Response | Promise<Response> = json({ apiBaseUrl }),
) {
  const queue = [...responses];
  const request = vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "/api/telligence/v1/config") return config;
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected request in test: ${url}`);
    return next;
  });
  vi.stubGlobal("fetch", request);
  return request;
}
const keyRequests = (request: ReturnType<typeof vi.fn>) =>
  request.mock.calls.filter(([url]) => String(url).includes("/keys"));

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_TELLIGENCE_GATEWAY_URL;
  mocks.address = "0x1111111111111111111111111111111111111111";
  mocks.session = {
    address: mocks.address,
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
    csrfToken: "csrf-test",
  };
});

describe("Telligence key console", () => {
  it("requires creator authentication before requesting project keys", () => {
    mocks.session = null;
    render(<KeyConsole projectId="42" />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in to manage keys" }));
    expect(mocks.authenticate).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("creates a project-bound key with CSRF, shows its secret once, and revokes it", async () => {
    const request = stubFetch([
      json({ keys: [] }),
      json({ key, secret: "tlg_key-1_one-time-secret" }),
      json({ revoked: true }),
    ]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const storage = vi.spyOn(Storage.prototype, "setItem");
    render(<KeyConsole projectId="42" />);
    await screen.findByText("No API keys yet.");
    fireEvent.change(screen.getByLabelText("Key name"), { target: { value: "Production" } });
    fireEvent.change(screen.getByLabelText("Daily limit (USD)"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Create API key" }));
    await screen.findByDisplayValue("tlg_key-1_one-time-secret");
    expect(request).toHaveBeenCalledWith(
      "/api/telligence/v1/projects/42/keys",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ name: "Production", dailyLimitUsd: "5" }),
        headers: expect.objectContaining({ "X-CSRF-Token": "csrf-test" }),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy API key" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("tlg_key-1_one-time-secret"));
    expect(storage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Revoke Production" }));
    await screen.findByText("Revoked");
    expect(screen.queryByDisplayValue("tlg_key-1_one-time-secret")).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledWith(
      "/api/telligence/v1/projects/42/keys/key-1",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ "X-CSRF-Token": "csrf-test" }),
      }),
    );
  });

  it("clears secrets and metadata when the connected wallet changes", async () => {
    stubFetch([json({ keys: [] }), json({ key, secret: "tlg_key-1_one-time-secret" })]);
    const { rerender } = render(<KeyConsole projectId="42" />);
    await screen.findByText("No API keys yet.");
    fireEvent.change(screen.getByLabelText("Key name"), { target: { value: "Production" } });
    fireEvent.change(screen.getByLabelText("Daily limit (USD)"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Create API key" }));
    await screen.findByDisplayValue("tlg_key-1_one-time-secret");
    mocks.address = "0x2222222222222222222222222222222222222222";
    rerender(<KeyConsole projectId="42" />);
    expect(screen.queryByDisplayValue("tlg_key-1_one-time-secret")).not.toBeInTheDocument();
    expect(screen.queryByText("Production")).not.toBeInTheDocument();
  });

  it("discards a key response that arrives after changing projects", async () => {
    let resolveCreate!: (response: Response) => void;
    const delayed = new Promise<Response>((resolve) => {
      resolveCreate = resolve;
    });
    stubFetch([json({ keys: [] }), delayed, json({ keys: [] })]);
    const { rerender } = render(<KeyConsole projectId="42" />);
    await screen.findByText("No API keys yet.");
    fireEvent.change(screen.getByLabelText("Key name"), { target: { value: "Production" } });
    fireEvent.change(screen.getByLabelText("Daily limit (USD)"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Create API key" }));
    rerender(<KeyConsole projectId="43" />);
    await act(async () => resolveCreate(json({ key, secret: "tlg_key-1_one-time-secret" })));
    expect(screen.queryByDisplayValue("tlg_key-1_one-time-secret")).not.toBeInTheDocument();
  });

  it("shows key loading failures and permits retry without creating a key", async () => {
    const request = stubFetch([
      json(
        {
          error: {
            code: "provider_unavailable",
            message: "Compute service is unavailable. Try again shortly.",
          },
        },
        503,
      ),
      json({ keys: [] }),
    ]);
    render(<KeyConsole projectId="42" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Compute service is unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry loading keys" }));
    await screen.findByText("No API keys yet.");
    expect(keyRequests(request)).toHaveLength(2);
  });

  it("rejects nonpositive daily budgets before making a mutation", async () => {
    const request = stubFetch([json({ keys: [] })]);
    render(<KeyConsole projectId="42" />);
    await screen.findByText("No API keys yet.");
    fireEvent.change(screen.getByLabelText("Key name"), { target: { value: "Production" } });
    fireEvent.change(screen.getByLabelText("Daily limit (USD)"), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "Create API key" })).toBeDisabled();
    expect(keyRequests(request)).toHaveLength(1);
  });
});

describe("API base URL", () => {
  it("shows the gateway's own API base URL from its config, never this site's proxy", async () => {
    stubFetch([json({ keys: [] })]);
    render(<KeyConsole projectId="42" />);
    await screen.findByText("No API keys yet.");
    const field = screen.getByLabelText("API base URL");
    await waitFor(() => expect(field).toHaveValue(apiBaseUrl));
    expect(screen.getByText(/requests\/\{x-request-id\}/)).toHaveTextContent(
      `GET ${apiBaseUrl}/requests/{x-request-id}`,
    );
    expect(screen.queryByDisplayValue(/api\/telligence/)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/localhost/)).not.toBeInTheDocument();
  });

  it.each([
    json({ error: { message: "down" } }, 503),
    json({}),
    json({ apiBaseUrl: "/api/telligence/api/v1" }),
    json({ apiBaseUrl: "http://gateway.example/api/v1" }),
    json({ apiBaseUrl: "https://someone:secret@gateway.example/api/v1" }),
    json({ apiBaseUrl: "https://gateway.example/api/v1?key=1" }),
  ])("reports the base URL as unavailable instead of inventing one", async (config) => {
    stubFetch([json({ keys: [] })], config);
    render(<KeyConsole projectId="42" />);
    await screen.findByText("No API keys yet.");
    const field = screen.getByLabelText("API base URL");
    await waitFor(() => expect(field).toHaveValue("Unavailable"));
    expect(screen.queryByDisplayValue(/api\/telligence/)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/gateway\.example/)).not.toBeInTheDocument();
  });

  it("shows an unavailable state while the config is still loading", () => {
    stubFetch([new Promise<Response>(() => {})], new Promise<Response>(() => {}));
    render(<KeyConsole projectId="42" />);
    expect(screen.getByLabelText("API base URL")).toHaveValue("Unavailable");
  });
});

describe("key and session expiration", () => {
  it("removes a revealed key and marks it expired without another network response", async () => {
    vi.useFakeTimers();
    stubFetch([
      json({ keys: [] }),
      json({
        key: { ...key, expiresAt: new Date(Date.now() + 1000).toISOString() },
        secret: "tlg_key-1_one-time-secret",
      }),
    ]);
    render(<KeyConsole projectId="42" />);
    await act(async () => {});
    fireEvent.change(screen.getByLabelText("Key name"), { target: { value: "Production" } });
    fireEvent.change(screen.getByLabelText("Daily limit (USD)"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Create API key" }));
    await act(async () => {});
    expect(screen.getByDisplayValue("tlg_key-1_one-time-secret")).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(1001);
    });
    expect(screen.queryByDisplayValue("tlg_key-1_one-time-secret")).not.toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });

  it("does not render credentials from an expired session", () => {
    mocks.session!.expiresAt = new Date(Date.now() - 1).toISOString();
    render(<KeyConsole projectId="42" />);
    expect(screen.getByRole("button", { name: "Sign in to manage keys" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["1e3", "0.0000001", "1000000000"])(
    "rejects a daily limit that the gateway cannot represent: %s",
    async (value) => {
      stubFetch([json({ keys: [] })]);
      render(<KeyConsole projectId="42" />);
      await screen.findByText("No API keys yet.");
      fireEvent.change(screen.getByLabelText("Key name"), { target: { value: "Production" } });
      fireEvent.change(screen.getByLabelText("Daily limit (USD)"), { target: { value } });
      expect(screen.getByRole("button", { name: "Create API key" })).toBeDisabled();
    },
  );
});

describe("gateway API boundary", () => {
  it("only accepts relative gateway paths and rejects unsafe configured origins", async () => {
    await expect(gatewayRequest("https://evil.example/keys")).rejects.toThrow("gateway path");
    process.env.NEXT_PUBLIC_TELLIGENCE_GATEWAY_URL = "https://someone:secret@gateway.example";
    await expect(gatewayRequest("/v1/auth/session")).rejects.toThrow("gateway URL");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never routes bearer-key application traffic through the site", async () => {
    for (const path of ["/api/v1/models", "/api/v1/chat/completions", "/api/v1/requests/abc"])
      await expect(gatewayRequest(path)).rejects.toThrow("gateway path");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires CSRF on authenticated mutations and keeps credentials out of URLs", async () => {
    await expect(
      gatewayRequest("/v1/projects/42/keys", { method: "POST", body: { name: "Production" } }),
    ).rejects.toThrow("Sign in");
    expect(fetch).not.toHaveBeenCalled();
  });
});
