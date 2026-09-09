import { act, fireEvent, render, screen } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  useEnsAddress: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/hooks/ens/useEnsAddress", () => ({
  useEnsAddress: (name: string | undefined, opts?: { enabled?: boolean }) =>
    mocks.useEnsAddress(name, opts),
}));

import { RevnetSearch } from "@/components/layout/RevnetSearch";

const ADDRESS = "0x000000000000000000000000000000000000dEaD";
const SHORT_ADDRESS = "0x0000...dEaD";
const ENS_NAME = "jango.eth";

function stubSearchApi(projects: unknown[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ projects }),
    })),
  );
}

async function typeQuery(value: string) {
  fireEvent.change(screen.getByRole("searchbox"), { target: { value } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.push.mockReset();
  mocks.useEnsAddress.mockReset();
  mocks.useEnsAddress.mockReturnValue({ data: null, isFetching: false });
  stubSearchApi();
});

describe("search:account — RevnetSearch account routing", () => {
  it("enables the server-rendered search only after hydration can retain input and handle submission", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<RevnetSearch />);
    document.body.append(container);
    let root: Root | undefined;
    try {
      expect(screen.getByRole("searchbox")).toBeDisabled();
      await act(async () => {
        root = hydrateRoot(container, <RevnetSearch />);
      });
      expect(screen.getByRole("searchbox")).toBeEnabled();
      fireEvent.change(screen.getByRole("searchbox"), { target: { value: "@fixture-revnet" } });
      expect(screen.getByRole("search")).toHaveAttribute("action", "/@fixture-revnet");
      expect(screen.getByRole("link", { name: /Open revnet handle/i })).toHaveAttribute(
        "href",
        "/@fixture-revnet",
      );
    } finally {
      await act(async () => root?.unmount());
      container.remove();
    }
  });

  it("shows an account row for a valid 0x address and navigates on click", async () => {
    render(<RevnetSearch />);
    await typeQuery(ADDRESS);

    const row = screen.getByRole("button", { name: new RegExp("View account") });
    expect(row).toHaveTextContent(SHORT_ADDRESS);

    fireEvent.click(row);
    expect(mocks.push).toHaveBeenCalledWith(`/account/${ADDRESS}`);
  });

  it("navigates to the account page on Enter for an address query", async () => {
    render(<RevnetSearch />);
    await typeQuery(ADDRESS);

    fireEvent.submit(screen.getByRole("search"));
    expect(mocks.push).toHaveBeenCalledWith(`/account/${ADDRESS}`);
  });

  it("resolves an ENS name, shows the account row, and navigates to /account/{name}", async () => {
    mocks.useEnsAddress.mockImplementation((name: string | undefined) =>
      name === ENS_NAME ? { data: ADDRESS, isFetching: false } : { data: null, isFetching: false },
    );
    render(<RevnetSearch />);

    // Before the debounce fires, the pending state is shown instead of a row.
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: ENS_NAME } });
    expect(screen.getByText("Resolving name…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /View account/ })).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    const row = screen.getByRole("button", { name: /View account/ });
    expect(row).toHaveTextContent(ENS_NAME);
    expect(row).toHaveTextContent(SHORT_ADDRESS);

    fireEvent.click(row);
    expect(mocks.push).toHaveBeenCalledWith(`/account/${ENS_NAME}`);
  });

  it("shows no account row when an ENS-looking name does not resolve", async () => {
    render(<RevnetSearch />);
    await typeQuery("does-not-resolve.eth");

    expect(screen.queryByRole("button", { name: /View account/ })).not.toBeInTheDocument();
    expect(screen.getByText("No matching revnets.")).toBeInTheDocument();
  });

  it("leaves plain-text project search untouched", async () => {
    stubSearchApi([
      {
        projectId: 3,
        chainId: 1,
        chainIds: [1, 8453],
        suckerGroupId: "group-3",
        name: "Revnet",
        ticker: "REV",
      },
    ]);
    render(<RevnetSearch />);
    await typeQuery("revnet");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/search-projects?q=revnet",
      expect.anything(),
    );
    expect(screen.queryByText(/View account/)).not.toBeInTheDocument();
    expect(mocks.useEnsAddress).toHaveBeenLastCalledWith(undefined, { enabled: false });

    const row = screen.getByRole("button", { name: /Revnet/ });
    fireEvent.click(row);
    expect(mocks.push).toHaveBeenCalledWith("/eth:3");
  });

  it("opens canonical @handle routes without treating them as account ENS names", async () => {
    render(<RevnetSearch />);
    await typeQuery("@DESIGN.JUICEBOX");

    const row = screen.getByRole("link", { name: /Open revnet handle/i });
    expect(row).toHaveTextContent("@design.juicebox");
    expect(row).toHaveAttribute("href", "/@design.juicebox");
    expect(row).toHaveAttribute("data-project-navigation", "document");
    expect(mocks.useEnsAddress).toHaveBeenLastCalledWith(undefined, { enabled: false });
    expect(globalThis.fetch).not.toHaveBeenCalled();

    fireEvent.click(row);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("submits a valid @handle directly and rejects malformed handle input", async () => {
    render(<RevnetSearch />);
    await typeQuery("@design.juicebox");
    const form = screen.getByRole("search");
    expect(form).toHaveAttribute("action", "/@design.juicebox");
    const submit = new Event("submit", { bubbles: true, cancelable: true });
    // The controlled form clears itself, so the handler captures the target,
    // prevents the default submit, and forces a document navigation itself.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(form.dispatchEvent(submit)).toBe(false);
    consoleError.mockRestore();
    expect(mocks.push).not.toHaveBeenCalled();

    await typeQuery("@bad..handle");
    expect(screen.getByText("Enter a valid @handle.")).toBeInTheDocument();
  });
});
