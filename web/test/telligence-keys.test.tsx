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
    const request = vi
      .fn()
      .mockResolvedValueOnce(json({ keys: [] }))
      .mockResolvedValueOnce(json({ key, secret: "tlg_key-1_one-time-secret" }))
      .mockResolvedValueOnce(json({ revoked: true }));
    vi.stubGlobal("fetch", request);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const storage = vi.spyOn(Storage.prototype, "setItem");
    render(<KeyConsole projectId="42" />);
    await screen.findByText("No API keys yet.");
    fireEvent.change(screen.getByLabelText("Key name"), { target: { value: "Production" } });
    fireEvent.change(screen.getByLabelText("Daily limit (USD)"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Create API key" }));
    await screen.findByDisplayValue("tlg_key-1_one-time-secret");
    expect(request).toHaveBeenNthCalledWith(
      2,
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
    expect(request).toHaveBeenNthCalledWith(
      3,
      "/api/telligence/v1/projects/42/keys/key-1",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ "X-CSRF-Token": "csrf-test" }),
      }),
    );
  });

  it("clears secrets and metadata when the connected wallet changes", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ keys: [] }))
        .mockResolvedValueOnce(json({ key, secret: "tlg_key-1_one-time-secret" })),
    );
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
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ keys: [] }))
        .mockReturnValueOnce(delayed)
        .mockResolvedValueOnce(json({ keys: [] })),
    );
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
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          json(
            {
              error: {
                code: "provider_unavailable",
                message: "Compute service is unavailable. Try again shortly.",
              },
            },
            503,
          ),
        )
        .mockResolvedValueOnce(json({ keys: [] })),
    );
    render(<KeyConsole projectId="42" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Compute service is unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry loading keys" }));
    await screen.findByText("No API keys yet.");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects nonpositive daily budgets before making a mutation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ keys: [] })));
    render(<KeyConsole projectId="42" />);
    await screen.findByText("No API keys yet.");
    fireEvent.change(screen.getByLabelText("Key name"), { target: { value: "Production" } });
    fireEvent.change(screen.getByLabelText("Daily limit (USD)"), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "Create API key" })).toBeDisabled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("key and session expiration", () => {
  it("removes a revealed key and marks it expired without another network response", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json({ keys: [] }))
        .mockResolvedValueOnce(
          json({
            key: { ...key, expiresAt: new Date(Date.now() + 1000).toISOString() },
            secret: "tlg_key-1_one-time-secret",
          }),
        ),
    );
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
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ keys: [] })));
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
    process.env.NEXT_PUBLIC_TELLIGENCE_GATEWAY_URL = "https://user:password@gateway.example";
    await expect(gatewayRequest("/v1/auth/session")).rejects.toThrow("gateway URL");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires CSRF on authenticated mutations and keeps credentials out of URLs", async () => {
    await expect(
      gatewayRequest("/v1/projects/42/keys", { method: "POST", body: { name: "Production" } }),
    ).rejects.toThrow("Sign in");
    expect(fetch).not.toHaveBeenCalled();
  });
});
